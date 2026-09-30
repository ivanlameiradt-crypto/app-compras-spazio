-- App de Compras Spazio — Fase 2, Bloco D1: recebimento do pedido e conferência da NF-e.
-- Desenho: compra-semanal/docs/DESIGN-fase-2.md, seção 6 (D.5, D.5.1 a D.5.7) — a fonte da verdade.
-- Segunda migration da Fase 2 (Onda 1), logo depois do E1 (a cot_conferencia lê a cot_economia_linhas dele).
-- NÃO reescreve nenhuma função da 1B (o md5(prosrc) de toda função existente é igual depois desta migration;
-- teste fase2-base.test.ts, X2). A cot_marcas só é reescrita pela D2 (20261029000002_falta_definitiva.sql).
-- Tudo em public com prefixo cot_; RLS ligado; escrita só pelas funções. Relógio de negócio = cot_agora();
-- fuso sempre explícito (cot_data_local). O robô de NF-e usa a chave anônima + o segredo do Vault (D.5.7),
-- nunca a chave de serviço.

-- base: nenhuma função da 1B reescrita (X2 do md5).

-- ================= Tabelas

-- Acompanhamento do pedido (D.5.1). Uma linha por pedido, criada no primeiro uso.
create table public.cot_pedidos_acomp (
  cotacao_id        bigint primary key references cot_pedidos(cotacao_id) on delete cascade,
  entrega_prevista  date,
  entrada_manual_em timestamptz,
  entrada_manual_por text references usuarios(email),
  atualizado_por    text not null references usuarios(email),
  atualizado_em     timestamptz not null
);

-- Recebimento físico (D.5.1). Uma linha por entrega (um pedido pode chegar em partes). Sem cascade em
-- cotacao_id: o gatilho cot_pedido_antes_de_apagar (D.5.5) impede apagar pedido com recebimento.
create table public.cot_recebimentos (
  id           bigint generated always as identity primary key,
  envio_id     uuid not null unique,
  cotacao_id   bigint not null references cot_pedidos(cotacao_id),
  recebido_em  timestamptz not null,
  recebido_por text not null references usuarios(email),
  registrado_em timestamptz not null,
  itens        jsonb not null check (jsonb_typeof(itens) = 'array'),
  observacao   text check (cot_texto_ok(observacao, 200, true))
);
create index on public.cot_recebimentos (cotacao_id);

-- CNPJ do emitente → vendedor (D.5.1). Um vendedor pode ter vários CNPJs (filiais).
create table public.cot_fornecedores_cnpj (
  cnpj        text primary key check (cnpj ~ '^[0-9]{14}$'),
  vendedor_id bigint not null references cot_vendedores(id),
  origem      text not null check (origem in ('nome', 'ivan')),
  nome_na_nf  text not null,
  criado_em   timestamptz not null
);

-- Espelho das NF-e de compra vistas na fila do SisChef (só o CNPJ da Spazio) (D.5.1).
create table public.cot_nfe (
  chave         text primary key check (chave ~ '^[0-9]{44}$'),
  cnpj_emitente text not null check (cnpj_emitente = substr(chave, 7, 14)),
  emitente      text not null check (char_length(emitente) between 1 and 120),
  numero        text not null check (char_length(numero) between 1 and 20),
  emissao       date not null,
  valor_nf      numeric(12,2) not null,
  xml_lido      boolean not null,
  v_prod        numeric(12,2),
  v_desc        numeric(12,2),
  v_ipi         numeric(12,2),
  v_st          numeric(12,2),
  v_frete       numeric(12,2),
  v_outro       numeric(12,2),
  itens         jsonb not null,
  vendedor_id   bigint references cot_vendedores(id),
  cotacao_id    bigint references cot_pedidos(cotacao_id),
  vinculo       text check (vinculo in ('auto', 'ivan')),
  nao_e_pedido  boolean not null default false,
  situacao      text not null check (situacao in ('na_fila', 'saiu_da_fila', 'lancada')),
  primeiro_visto_em timestamptz not null,
  visto_na_fila_em  timestamptz not null,
  saiu_da_fila_em   timestamptz,
  lancada_em    timestamptz,
  nf_sischef    text,
  conferencia   jsonb,
  conferencia_hash text,
  notificado_hash  text,
  notificado_em    timestamptz,
  atualizado_em    timestamptz not null,
  check (vinculo is distinct from 'auto' or cotacao_id is not null),
  check (not nao_e_pedido or (cotacao_id is null and vinculo = 'ivan'))
);
create index on public.cot_nfe (vendedor_id, emissao);
create index on public.cot_nfe (cotacao_id);
create index on public.cot_nfe (cnpj_emitente);

-- Auditoria das leituras (D.5.1). Serve para o App mostrar "última leitura das notas".
create table public.cot_nfe_leituras (
  id      bigint generated always as identity primary key,
  lida_em timestamptz not null,
  notas   int not null,
  completa boolean not null,
  origem  text not null check (origem in ('agendada', 'app'))
);

-- ================= Credencial do robô (D.5.4)

-- Primeira linha das 3 funções do robô: compara p_segredo com o segredo cot_nfe_robo do Vault. Vazio,
-- ausente ou diferente → exceção "não autorizado", antes de qualquer leitura ou gravação. Interna.
create or replace function public.cot_nfe_exigir_robo(p_segredo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_segredo text;
begin
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cot_nfe_robo';
  if v_segredo is null or v_segredo = '' or p_segredo is null or p_segredo = '' or p_segredo <> v_segredo then
    raise exception 'não autorizado';
  end if;
end $$;

-- ================= Vendedor e casamento da NF (internas)

-- Troca (ou apaga, com vendedor null) a linha de cot_fornecedores_cnpj e recasa as NF-e do CNPJ sem vínculo
-- do Ivan (D.5.3.1). Interna. Grava historico_alteracoes por NF mexida.
create or replace function public.cot_nfe_cnpj_trocar(p_cnpj text, p_vendedor bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n cot_nfe; v_antes jsonb; v_muda int := 0;
begin
  if p_vendedor is null then
    delete from cot_fornecedores_cnpj where cnpj = p_cnpj;
  else
    update cot_fornecedores_cnpj set vendedor_id = p_vendedor, origem = 'ivan' where cnpj = p_cnpj;
  end if;
  for n in select * from cot_nfe where cnpj_emitente = p_cnpj and vinculo is distinct from 'ivan' and not nao_e_pedido loop
    v_antes := to_jsonb(n);
    update cot_nfe set vendedor_id = p_vendedor, cotacao_id = null, vinculo = null,
                       conferencia = null, conferencia_hash = null, atualizado_em = cot_agora()
     where chave = n.chave;
    perform cot_nfe_casar(n.chave);
    perform cot_nfe_conferir(n.chave);
    insert into historico_alteracoes (quem, tabela, registro, antes, depois)
      values (email_atual(), 'cot_nfe', n.chave, v_antes, (select to_jsonb(x) from cot_nfe x where x.chave = n.chave));
    v_muda := v_muda + 1;
  end loop;
  return v_muda;
end $$;

-- Vendedor da NF (D.5.3.1). Aprende o CNPJ pela grafia da NF quando casa pelo nome. Interna.
create or replace function public.cot_nfe_vendedor(p_cnpj text, p_emitente text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select vendedor_id into v_id from cot_fornecedores_cnpj where cnpj = p_cnpj;
  if v_id is not null then
    return v_id;
  end if;
  select vendedor_id into v_id from cot_fornecedores where nome_normalizado = cot_normalizar(p_emitente);
  if v_id is not null then
    insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
    values (p_cnpj, v_id, 'nome', p_emitente, cot_agora())
    on conflict (cnpj) do nothing;
    return v_id;
  end if;
  return null;
end $$;

-- Pedido da NF (D.5.3.2). Só roda com vendedor, vinculo null/'auto' e não "não é pedido". Interna.
create or replace function public.cot_nfe_casar(p_chave text) returns void
language plpgsql security definer set search_path = public as $$
declare n cot_nfe; v_cotacao bigint;
begin
  select * into n from cot_nfe where chave = p_chave;
  if n.vendedor_id is null or n.nao_e_pedido or n.vinculo = 'ivan' then
    return;
  end if;
  -- candidato = pedido do vendedor com confirmado_em entre emissao-15 e emissao+1; pontos = itens em comum
  select c.id into v_cotacao
    from cot_cotacoes c join cot_pedidos p on p.cotacao_id = c.id
   where c.vendedor_id = n.vendedor_id and c.resultado = 'pedido'
     and cot_data_local(p.confirmado_em) between n.emissao - 15 and n.emissao + 1
   order by (select count(*) from jsonb_array_elements(p.itens) l
              where (l ->> 'produto_id')::bigint in
                    (select (j ->> 'produto_id')::bigint from jsonb_array_elements(n.itens) j
                      where j ? 'produto_id' and (j ->> 'produto_id') is not null)) desc,
            p.confirmado_em desc
   limit 1;
  -- só casa se tem pelo menos um ponto (item em comum)
  if v_cotacao is not null then
    if not exists (
      select 1 from cot_pedidos p, jsonb_array_elements(p.itens) l
       where p.cotacao_id = v_cotacao
         and (l ->> 'produto_id')::bigint in
             (select (j ->> 'produto_id')::bigint from jsonb_array_elements(n.itens) j
               where j ? 'produto_id' and (j ->> 'produto_id') is not null)) then
      v_cotacao := null;
    end if;
  end if;
  update cot_nfe set cotacao_id = v_cotacao,
                     vinculo = case when v_cotacao is not null then 'auto' end,
                     atualizado_em = cot_agora()
   where chave = p_chave;
end $$;

-- Conferência de uma NF casada (D.5.3.3). Grava conferencia e conferencia_hash. Interna.
create or replace function public.cot_nfe_conferir(p_chave text) returns void
language plpgsql security definer set search_path = public as $$
declare
  n cot_nfe; c cot_cotacoes; j jsonb; v_itens jsonb := '[]'::jsonb;
  v_pid bigint; v_num int; v_cot bigint; v_motivo text;
  v_ped jsonb; v_qtd numeric; v_base text; v_fator numeric; v_pcomb numeric; v_marca text; v_kg numeric;
  v_unid text; v_nf_unid text; v_divisor numeric; v_comb_unit numeric; v_cobrado_unit numeric;
  v_esperado numeric; v_cobrado numeric; v_dif numeric; v_imposto numeric; v_estado text; v_marca_est text;
  v_acima int := 0; v_valor_acima numeric := 0; v_confira int := 0; v_fora int := 0; v_naoconf int := 0;
  v_imposto_total numeric := 0; v_marca_confira int := 0; v_qtd_amais boolean := false; v_avisos jsonb := '[]'::jsonb;
  v_frete_acima numeric; v_soma_frete numeric; v_hash text; v_desc numeric;
begin
  select * into n from cot_nfe where chave = p_chave;
  if n.cotacao_id is null then
    update cot_nfe set conferencia = null, conferencia_hash = null, atualizado_em = cot_agora() where chave = p_chave;
    return;
  end if;
  select * into c from cot_cotacoes where id = n.cotacao_id;
  for j in select value from jsonb_array_elements(n.itens) loop
    v_pid := case when j ? 'produto_id' and (j ->> 'produto_id') is not null then (j ->> 'produto_id')::bigint end;
    v_motivo := null; v_num := null; v_cot := n.cotacao_id; v_ped := null;
    v_esperado := null; v_cobrado := null; v_dif := null; v_comb_unit := null; v_cobrado_unit := null;
    v_qtd := (case when j ? 'qtd' and (j ->> 'qtd') is not null then (j ->> 'qtd')::numeric end);
    v_imposto := coalesce((j ->> 'v_ipi')::numeric, 0) + coalesce((j ->> 'v_st')::numeric, 0);
    v_marca_est := null;

    -- procura a linha do pedido casado; se não achar, procura noutro candidato do mesmo vendedor (complementar)
    if v_pid is not null then
      select l into v_ped from cot_pedidos p, lateral jsonb_array_elements(p.itens) l
       where p.cotacao_id = n.cotacao_id and (l ->> 'produto_id')::bigint = v_pid limit 1;
      if v_ped is null then
        select l, c2.id into v_ped, v_cot
          from cot_cotacoes c2 join cot_pedidos p on p.cotacao_id = c2.id, lateral jsonb_array_elements(p.itens) l
         where c2.vendedor_id = n.vendedor_id and c2.resultado = 'pedido' and c2.id <> n.cotacao_id
           and cot_data_local(p.confirmado_em) between n.emissao - 15 and n.emissao + 1
           and (l ->> 'produto_id')::bigint = v_pid
         order by p.confirmado_em desc limit 1;
        if v_ped is not null then
          v_motivo := 'do pedido de ' || cot_ddmm((select cot_data_local(p.confirmado_em) from cot_pedidos p where p.cotacao_id = v_cot));
        end if;
      end if;
    end if;

    if v_pid is null then
      v_estado := 'nao_conferivel'; v_motivo := 'item ainda não associado no SisChef (associe no painel de notas)';
      v_naoconf := v_naoconf + 1;
    elsif v_ped is null then
      v_estado := 'fora_do_pedido'; v_motivo := 'veio na NF e não estava no pedido'; v_fora := v_fora + 1;
    else
      v_num := (v_ped ->> 'numero')::int;
      v_base := v_ped ->> 'base'; v_fator := (v_ped ->> 'fator')::numeric;
      v_pcomb := (v_ped ->> 'preco_combinado')::numeric; v_marca := v_ped ->> 'marca';
      select i.unidade, i.kg_por_litro into v_unid, v_kg from cot_itens i
       where i.cotacao_id = v_cot and i.produto_id = v_pid;
      v_nf_unid := case when upper(coalesce(j ->> 'unidade_sischef', '')) = 'KG' then 'kg' else 'un' end;
      if v_qtd is null then
        v_estado := 'nao_conferivel'; v_motivo := 'conversão de unidade (UN DIFERE) ainda não decidida';
        v_naoconf := v_naoconf + 1;
      elsif v_nf_unid <> v_unid then
        v_estado := 'nao_conferivel'; v_motivo := 'unidade da NF diferente da do pedido'; v_naoconf := v_naoconf + 1;
      else
        v_divisor := case v_base when 'un' then 1 when 'kg' then 1 when 'embalagem' then v_fator when 'litro' then v_kg end;
        if v_base = 'embalagem' and v_fator is null then
          v_estado := 'nao_conferivel'; v_motivo := 'pedido sem fator de embalagem'; v_naoconf := v_naoconf + 1;
        elsif v_base = 'litro' and v_kg is null then
          v_estado := 'nao_conferivel'; v_motivo := 'preço combinado por litro, sem conversão'; v_naoconf := v_naoconf + 1;
        else
          v_comb_unit := v_pcomb / v_divisor;
          v_esperado := round(v_qtd * v_comb_unit, 2);
          v_desc := coalesce((j ->> 'v_desc')::numeric, 0);
          v_cobrado := (j ->> 'v_prod')::numeric - v_desc;
          v_cobrado_unit := round(v_cobrado / nullif(v_qtd, 0), 4);
          v_dif := v_cobrado - v_esperado;
          if v_dif > 0.01 then
            if not n.xml_lido then
              v_estado := 'confira'; v_motivo := 'acima pelo valor bruto; o XML não foi lido e pode haver desconto';
              v_confira := v_confira + 1;
            else
              v_estado := 'acima'; v_acima := v_acima + 1; v_valor_acima := v_valor_acima + v_dif;
            end if;
          elsif v_dif < -0.01 then
            v_estado := 'abaixo';
          else
            v_estado := 'igual';
          end if;
        end if;
        -- marca
        if v_marca is null then
          v_marca_est := 'sem_marca';
        elsif not exists (select 1 from regexp_split_to_table(cot_normalizar(v_marca), '\s+') w
                           where char_length(w) >= 3 and position(w in cot_normalizar(coalesce(j ->> 'descricao', ''))) = 0) then
          v_marca_est := 'ok';
        else
          v_marca_est := 'confira'; v_marca_confira := v_marca_confira + 1;
        end if;
      end if;
    end if;

    if v_imposto > 0 then
      v_imposto_total := v_imposto_total + v_imposto;
    end if;

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'n', (j ->> 'n')::int, 'produto_id', v_pid, 'cotacao_id', v_cot, 'numero', v_num, 'estado', v_estado,
      'qtd', v_qtd, 'esperado', v_esperado, 'cobrado', v_cobrado, 'dif', case when v_dif is null then null else round(v_dif, 2) end,
      'combinado_unit', case when v_comb_unit is null then null else round(v_comb_unit, 4) end,
      'cobrado_unit', v_cobrado_unit, 'imposto', v_imposto, 'marca', v_marca_est, 'motivo', v_motivo));
  end loop;

  -- imposto informativo
  if v_imposto_total > 0 then
    v_avisos := v_avisos || to_jsonb('imposto na NF: + R$ ' || to_char(v_imposto_total, 'FM999999990D00') || ' (IPI/ST), fora da comparação');
  end if;
  -- frete acima (nível do pedido): o frete combinado é conhecido quando c.frete não é nulo, e a comparação é
  -- sobre a SOMA de v_frete das NF casadas com este pedido (D.5.3.3) — um pedido em 2+ notas com o frete cobrado
  -- em cada uma passaria despercebido se cada NF fosse conferida sozinha.
  select sum(x.v_frete) into v_soma_frete from cot_nfe x where x.cotacao_id = n.cotacao_id and x.v_frete is not null;
  if c.frete is not null and v_soma_frete is not null and v_soma_frete > c.frete + 0.01 then
    v_frete_acima := round(v_soma_frete - c.frete, 2);
    v_avisos := v_avisos || to_jsonb('frete acima do combinado'::text);
  end if;
  -- quantidade a mais (nível do pedido): como o frete, a sobre-entrega pode aparecer só na SOMA das NF casadas
  -- com P — um produto entregue em 2+ notas passaria despercebido se cada NF fosse conferida sozinha. Soma a
  -- qtd das NF do pedido por produto (das itens de cot_nfe, inclusive esta, já gravada) e compara com a qtd do
  -- pedido, na mesma tolerância da view cot_conferencia (un 0; kg 2%): coincide com qtd_nf = 'a_mais'.
  select coalesce(bool_or(
           s.nf_qtd > l.qtd + (case when i.unidade = 'kg' then 0.02 * l.qtd else 0 end)), false)
    into v_qtd_amais
    from cot_economia_linhas l
    join cot_itens i on i.cotacao_id = l.cotacao_id and i.produto_id = l.produto_id
    join (select (it ->> 'produto_id')::bigint as produto_id, sum((it ->> 'qtd')::numeric) as nf_qtd
            from cot_nfe x cross join lateral jsonb_array_elements(x.itens) it
           where x.cotacao_id = n.cotacao_id
             and it ? 'produto_id' and (it ->> 'produto_id') is not null and (it ->> 'qtd') is not null
           group by (it ->> 'produto_id')::bigint) s on s.produto_id = l.produto_id
   where l.cotacao_id = n.cotacao_id;
  if coalesce(n.v_outro, 0) > 0 then
    v_avisos := v_avisos || to_jsonb('outras despesas na NF: R$ ' || to_char(n.v_outro, 'FM999999990D00'));
  end if;
  -- par suspeito: item fora do pedido + item do pedido sem NF
  if v_fora > 0 and exists (
      select 1 from cot_pedidos p, lateral jsonb_array_elements(p.itens) l
       where p.cotacao_id = n.cotacao_id
         and (l ->> 'produto_id')::bigint not in
             (select (j2 ->> 'produto_id')::bigint from jsonb_array_elements(n.itens) j2
               where j2 ? 'produto_id' and (j2 ->> 'produto_id') is not null)) then
    v_avisos := v_avisos || to_jsonb('pode ser o mesmo produto com outro cadastro no SisChef: confira a associação'::text);
  end if;

  v_hash := md5(v_itens::text || jsonb_build_object(
    'acima', v_acima, 'valor_acima', round(v_valor_acima, 2), 'confira', v_confira, 'fora_do_pedido', v_fora,
    'nao_conferivel', v_naoconf, 'imposto', round(v_imposto_total, 2), 'frete_acima', v_frete_acima,
    'marca_confira', v_marca_confira, 'qtd_a_mais', v_qtd_amais)::text);

  update cot_nfe set
    conferencia = jsonb_build_object(
      'cotacao_id', n.cotacao_id,
      'casamento', jsonb_build_object('pontos', (
         select count(*) from jsonb_array_elements(n.itens) j2
          where j2 ? 'produto_id' and (j2 ->> 'produto_id') is not null
            and (j2 ->> 'produto_id')::bigint in
                (select (l ->> 'produto_id')::bigint from cot_pedidos p, jsonb_array_elements(p.itens) l where p.cotacao_id = n.cotacao_id)),
         'origem', coalesce(n.vinculo, 'auto')),
      'itens', v_itens,
      'resumo', jsonb_build_object('acima', v_acima, 'valor_acima', round(v_valor_acima, 2), 'confira', v_confira,
        'fora_do_pedido', v_fora, 'nao_conferivel', v_naoconf, 'imposto', round(v_imposto_total, 2),
        'frete_acima', v_frete_acima, 'marca_confira', v_marca_confira, 'qtd_a_mais', v_qtd_amais, 'avisos', v_avisos)),
    conferencia_hash = v_hash,
    atualizado_em = cot_agora()
   where chave = p_chave;
end $$;

-- ================= Gatilho: pedido com recebimento não é desfeito (D.5.5)
create or replace function public.cot_pedido_antes_de_apagar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from cot_recebimentos r where r.cotacao_id = old.cotacao_id) then
    raise exception 'este pedido já tem recebimento registrado (%): desfaça o recebimento antes de desfazer o pedido',
      (select cot_ddmm(cot_data_local(min(r.recebido_em))) from cot_recebimentos r where r.cotacao_id = old.cotacao_id);
  end if;
  update cot_nfe set cotacao_id = null, vinculo = null, conferencia = null, conferencia_hash = null,
                     atualizado_em = cot_agora()
   where cotacao_id = old.cotacao_id;
  return old;
end $$;
drop trigger if exists cot_pedido_antes_de_apagar on public.cot_pedidos;
create trigger cot_pedido_antes_de_apagar before delete on public.cot_pedidos
  for each row execute function public.cot_pedido_antes_de_apagar();

-- ================= Views (security_invoker; só o admin lê, salvo cot_desempenho)

-- Uma linha por item de pedido, em cima da cot_economia_linhas do E (a linha de pedido única). Junta a entrega
-- (cot_recebimentos), a NF-e casada e a conferência (D.5.2).
create view public.cot_conferencia with (security_invoker = true) as
with rec as (
  -- soma das entregas por (cotacao, produto) e o resto da entrega mais recente que registrou falta no item
  select r.cotacao_id, (it ->> 'produto_id')::bigint as produto_id, (it ->> 'numero')::int as numero,
         sum((it ->> 'chegou')::numeric) as chegou, sum(coalesce((it ->> 'avaria')::numeric, 0)) as avaria,
         (array_agg(it ->> 'resto' order by r.recebido_em desc, r.id desc)
            filter (where (it ->> 'resto') is not null))[1] as resto,
         count(*) as entregas
    from cot_recebimentos r cross join lateral jsonb_array_elements(r.itens) it
   group by r.cotacao_id, (it ->> 'produto_id')::bigint, (it ->> 'numero')::int
),
-- itens de NF conferidos, expandidos da conferencia de cada NF casada, casados pela linha do pedido (cotacao_id, produto_id)
nfi as (
  select (ci ->> 'cotacao_id')::bigint as cotacao_id, (ci ->> 'produto_id')::bigint as produto_id,
         n.chave, ci
    from cot_nfe n cross join lateral jsonb_array_elements(n.conferencia -> 'itens') ci
   where n.conferencia is not null and (ci ->> 'produto_id') is not null
),
nf as (
  select cotacao_id, produto_id,
         array_agg(distinct chave) as nf_chaves,
         sum((ci ->> 'qtd')::numeric) filter (where (ci ->> 'qtd') is not null) as nf_qtd,
         sum(case when (ci ->> 'dif') is not null and (ci ->> 'dif')::numeric > 0 then (ci ->> 'dif')::numeric else 0 end) as valor_acima,
         sum(coalesce((ci ->> 'imposto')::numeric, 0)) as imposto,
         (array_agg((ci ->> 'cobrado_unit')::numeric order by chave desc) filter (where (ci ->> 'cobrado_unit') is not null))[1] as cobrado_unit,
         (array_agg((ci ->> 'combinado_unit')::numeric) filter (where (ci ->> 'combinado_unit') is not null))[1] as combinado_unit,
         -- pior estado de preço: acima > confira > nao_conferivel > abaixo > igual
         (array_agg((ci ->> 'estado') order by case (ci ->> 'estado')
             when 'acima' then 1 when 'confira' then 2 when 'nao_conferivel' then 3 when 'fora_do_pedido' then 3
             when 'abaixo' then 4 when 'igual' then 5 else 6 end))[1] as preco_estado,
         -- pior marca: confira > sem_marca > ok
         (array_agg((ci ->> 'marca') order by case (ci ->> 'marca')
             when 'confira' then 1 when 'sem_marca' then 2 when 'ok' then 3 else 4 end))[1] as marca_estado,
         array_remove(array_agg(distinct (ci ->> 'motivo')), null) as motivos
    from nfi group by cotacao_id, produto_id
),
-- estado do recebimento por pedido
ped_rec as (
  select l.cotacao_id,
         bool_or(coalesce(rec.entregas, 0) > 0) as tem_entrega,
         bool_or(rec.chegou is not null and (l.qtd - rec.chegou) >
                 (case when i.unidade = 'kg' then 0.02 * l.qtd else 0 end)) as tem_falta,
         bool_or(rec.chegou is not null and (l.qtd - rec.chegou) >
                 (case when i.unidade = 'kg' then 0.02 * l.qtd else 0 end) and rec.resto = 'vem_depois') as falta_que_vem
    from cot_economia_linhas l
    left join cot_itens i on i.cotacao_id = l.cotacao_id and i.produto_id = l.produto_id
    left join rec on rec.cotacao_id = l.cotacao_id and rec.produto_id = l.produto_id
   group by l.cotacao_id
)
select l.cotacao_id, l.semana_id, l.vendedor_id, l.versao, l.confirmado_em, a.entrega_prevista,
       l.numero, l.produto_id, i.nome, i.unidade, l.qtd, l.base, l.embalagens, l.fator,
       l.preco_combinado, l.preco_convertido, l.marca,
       rec.chegou, rec.avaria,
       case when rec.entregas is not null
            then greatest(l.qtd - rec.chegou - (case when i.unidade = 'kg' and (l.qtd - rec.chegou) <= 0.02 * l.qtd then (l.qtd - rec.chegou) else 0 end), 0) end as falta,
       rec.resto,
       case when rec.entregas is not null and rec.resto = 'nao_vem'
            then greatest(l.qtd - rec.chegou - (case when i.unidade = 'kg' and (l.qtd - rec.chegou) <= 0.02 * l.qtd then (l.qtd - rec.chegou) else 0 end), 0)
            else 0 end as falta_definitiva,
       case when not pr.tem_entrega then 'aguardando'
            when not pr.tem_falta then 'completo'
            when pr.falta_que_vem then 'parcial'
            else 'com_falta' end as recebimento,
       coalesce(nf.nf_chaves, '{}') as nf_chaves,
       nf.nf_qtd,
       case when nf.produto_id is null then 'sem_nf'
            when nf.nf_qtd is null then 'sem_nf'
            when abs(nf.nf_qtd - l.qtd) <= (case when i.unidade = 'kg' then 0.02 * l.qtd else 0 end) then 'igual'
            when nf.nf_qtd > l.qtd then 'a_mais' else 'a_menos' end as qtd_nf,
       coalesce(nf.preco_estado, 'sem_nf') as preco,
       coalesce(nf.valor_acima, 0) as valor_acima,
       nf.combinado_unit, nf.cobrado_unit,
       coalesce(nf.imposto, 0) as imposto,
       nf.marca_estado as marca_nf,
       coalesce(nf.motivos, '{}') as motivos
  from cot_economia_linhas l
  left join cot_itens i on i.cotacao_id = l.cotacao_id and i.produto_id = l.produto_id
  left join cot_pedidos_acomp a on a.cotacao_id = l.cotacao_id
  left join rec on rec.cotacao_id = l.cotacao_id and rec.produto_id = l.produto_id
  left join nf on nf.cotacao_id = l.cotacao_id and nf.produto_id = l.produto_id
  join ped_rec pr on pr.cotacao_id = l.cotacao_id;

-- Desempenho do vendedor nos últimos 56 dias (D.10). Usa cot_agora() e cot_data_local (internas): só o
-- service_role lê a view; o App lê pela cot_desempenho_vendedores() (D.5.2).
create view public.cot_desempenho with (security_invoker = true) as
with ped as (
  select c.id as cotacao_id, c.vendedor_id, p.confirmado_em, a.entrega_prevista,
         exists (select 1 from cot_recebimentos r where r.cotacao_id = c.id) as tem_rec,
         (select cot_data_local(min(r.recebido_em)) from cot_recebimentos r where r.cotacao_id = c.id) as primeira_entrega,
         (select min(least(coalesce(cot_data_local(x.lancada_em), 'infinity'::date),
                           coalesce(cot_data_local(x.saiu_da_fila_em), 'infinity'::date)))
            from cot_nfe x where x.cotacao_id = c.id and x.situacao in ('lancada', 'saiu_da_fila')) as nf_entrou
    from cot_cotacoes c join cot_pedidos p on p.cotacao_id = c.id
    left join cot_pedidos_acomp a on a.cotacao_id = c.id
   where c.resultado = 'pedido' and p.confirmado_em >= cot_agora() - interval '56 days'
),
ped2 as (
  select pd.*,
         (nf_entrou is not null and nf_entrou <> 'infinity'::date) as tem_nf,
         cot_data_local(cot_agora()) as hoje
    from ped pd
),
p_flags as (
  select pd.*,
    (entrega_prevista is not null) as com_prazo,
    (entrega_prevista is not null and
      ((tem_rec and primeira_entrega <= entrega_prevista) or
       (not tem_rec and tem_nf and nf_entrou <= entrega_prevista))) as no_prazo,
    (tem_rec and entrega_prevista is not null and primeira_entrega > entrega_prevista) as atrasado,
    (not tem_rec and tem_nf and entrega_prevista is not null and nf_entrou > entrega_prevista) as sem_registro,
    (not tem_rec and not tem_nf and entrega_prevista is not null and entrega_prevista < hoje) as nao_chegou,
    (not tem_rec and tem_nf) as entregue_nf
  from ped2 pd
),
itens_rec as (
  -- itens de pedidos com pelo menos uma entrega registrada
  select cf.vendedor_id,
         count(*) as itens,
         count(*) filter (where cf.recebimento = 'completo' or cf.falta is null or cf.falta = 0) as completos,
         count(*) filter (where cf.falta is not null and cf.falta > 0) as com_falta,
         count(*) filter (where coalesce(cf.avaria, 0) > 0) as com_avaria
    from cot_conferencia cf
   where cf.cotacao_id in (select cotacao_id from p_flags where tem_rec)
   group by cf.vendedor_id
),
itens_nf as (
  select cf.vendedor_id,
         count(*) filter (where cf.preco in ('igual', 'acima', 'abaixo')) as conferidos,
         count(*) filter (where cf.preco = 'igual') as preco_igual,
         count(*) filter (where cf.preco = 'acima') as acima,
         coalesce(sum(cf.valor_acima) filter (where cf.preco = 'acima'), 0) as valor_acima,
         count(*) filter (where cf.preco = 'abaixo') as abaixo
    from cot_conferencia cf
   where cf.cotacao_id in (select cotacao_id from p_flags)
   group by cf.vendedor_id
)
select v.id as vendedor_id, cot_rotulo(v.empresa) as rotulo,
       count(*)::int as pedidos,
       count(*) filter (where f.com_prazo)::int as com_prazo,
       count(*) filter (where not f.com_prazo)::int as sem_prazo,
       count(*) filter (where f.no_prazo)::int as no_prazo,
       count(*) filter (where f.atrasado)::int as atrasados,
       coalesce(round(avg(f.primeira_entrega - f.entrega_prevista) filter (where f.atrasado), 1), 0) as atraso_medio_dias,
       count(*) filter (where f.sem_registro)::int as sem_registro,
       count(*) filter (where f.nao_chegou)::int as nao_chegou,
       count(*) filter (where f.entregue_nf)::int as entregue_nf,
       coalesce(max(ir.itens), 0)::int as itens,
       coalesce(max(ir.completos), 0)::int as itens_completos,
       coalesce(max(ir.com_falta), 0)::int as itens_com_falta,
       coalesce(max(ir.com_avaria), 0)::int as itens_com_avaria,
       coalesce(max(inf.conferidos), 0)::int as itens_conferidos,
       coalesce(max(inf.preco_igual), 0)::int as itens_preco_igual,
       coalesce(max(inf.acima), 0)::int as itens_acima,
       coalesce(max(inf.valor_acima), 0) as valor_acima,
       coalesce(max(inf.abaixo), 0)::int as itens_abaixo
  from p_flags f
  join cot_vendedores v on v.id = f.vendedor_id
  left join itens_rec ir on ir.vendedor_id = f.vendedor_id
  left join itens_nf inf on inf.vendedor_id = f.vendedor_id
 group by v.id, v.empresa;

-- ================= Funções do robô (chave anônima + segredo)

-- Espelha uma leitura da fila de notas (D.5.4). Valida tudo antes de gravar (tudo ou nada).
create or replace function public.cot_nfe_sincronizar(p_segredo text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lida timestamptz; v_completa boolean; v_origem text; v_notas jsonb; nota jsonb; item jsonb;
  v_chave text; v_chaves text[] := '{}'; v_totais jsonb; n cot_nfe; v_xml boolean; v_itens jsonb;
  v_vid bigint; v_cnpj text; v_resumo jsonb; v_conf jsonb; v_avisar jsonb := '[]'::jsonb;
  v_conferidas jsonb := '[]'::jsonb; v_sairam text[]; v_com_vend int := 0; v_com_ped int := 0; v_prim int;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  -- validação
  if jsonb_typeof(p -> 'notas') <> 'array' then raise exception 'leitura de notas inválida: notas'; end if;
  v_lida := case when (p ->> 'lida_em') ~ '^\d{4}-\d{2}-\d{2}T' then (p ->> 'lida_em')::timestamptz end;
  if v_lida is null then raise exception 'leitura de notas inválida: lida_em'; end if;
  if jsonb_typeof(p -> 'completa') <> 'boolean' then raise exception 'leitura de notas inválida: completa'; end if;
  v_completa := (p ->> 'completa')::boolean;
  v_origem := p ->> 'origem';
  if v_origem not in ('agendada', 'app') then raise exception 'leitura de notas inválida: origem'; end if;
  v_notas := p -> 'notas';
  if jsonb_array_length(v_notas) > 300 then raise exception 'leitura de notas inválida: notas'; end if;
  for nota in select value from jsonb_array_elements(v_notas) loop
    v_chave := nota ->> 'chave';
    if v_chave is null or v_chave !~ '^[0-9]{44}$' then raise exception 'leitura de notas inválida: chave'; end if;
    if v_chave = any(v_chaves) then raise exception 'leitura de notas inválida: chave'; end if;
    v_chaves := v_chaves || v_chave;
    if not cot_texto_ok(nota ->> 'emitente', 120) or char_length(coalesce(nota ->> 'emitente', '')) < 1 then
      raise exception 'leitura de notas inválida: emitente'; end if;
    if char_length(coalesce(nota ->> 'numero', '')) not between 1 and 20 then raise exception 'leitura de notas inválida: numero'; end if;
    if cot_ler_data(nota ->> 'emissao') is null then raise exception 'leitura de notas inválida: emissao'; end if;
    if (nota ->> 'valor_nf')::numeric < 0 or (nota ->> 'valor_nf')::numeric > 10000000 then raise exception 'leitura de notas inválida: valor_nf'; end if;
    if jsonb_typeof(nota -> 'itens') <> 'array' or jsonb_array_length(nota -> 'itens') > 300 then raise exception 'leitura de notas inválida: itens'; end if;
    for item in select value from jsonb_array_elements(nota -> 'itens') loop
      if (item ->> 'n')::int < 1 then raise exception 'leitura de notas inválida: n'; end if;
      if not cot_texto_ok(item ->> 'descricao', 300) or char_length(coalesce(item ->> 'descricao', '')) < 1 then
        raise exception 'leitura de notas inválida: descricao'; end if;
      if (item ? 'produto_id') and (item ->> 'produto_id') is not null then
        if (item ->> 'produto_id')::bigint <= 0 then raise exception 'leitura de notas inválida: produto_id'; end if;
        if coalesce(item ->> 'associacao', '') not in ('sischef', 'painel') then raise exception 'leitura de notas inválida: associacao'; end if;
      end if;
      if (item ? 'qtd') and (item ->> 'qtd') is not null and (item ->> 'qtd')::numeric <= 0 then raise exception 'leitura de notas inválida: qtd'; end if;
      if char_length(coalesce(item ->> 'unidade_sischef', '')) > 10 then raise exception 'leitura de notas inválida: unidade_sischef'; end if;
    end loop;
  end loop;

  -- efeito
  insert into cot_nfe_leituras (lida_em, notas, completa, origem)
  values (v_lida, jsonb_array_length(v_notas), v_completa, v_origem);

  for nota in select value from jsonb_array_elements(v_notas) loop
    v_chave := nota ->> 'chave';
    v_totais := nota -> 'totais';
    v_xml := jsonb_typeof(v_totais) = 'object';
    v_itens := nota -> 'itens';
    select * into n from cot_nfe where chave = v_chave;
    if found and n.xml_lido and not v_xml then
      -- XML não volta atrás: mantém os totais/valores do XML; só atualiza associação, qtd e unidade item a item
      update cot_nfe set
        emitente = nota ->> 'emitente', numero = nota ->> 'numero', emissao = (nota ->> 'emissao')::date,
        valor_nf = (nota ->> 'valor_nf')::numeric,
        itens = (select jsonb_agg(
                   case when o.value ->> 'n' = ni.value ->> 'n'
                        then o.value || jsonb_build_object('produto_id',
                               case when ni.value ? 'produto_id' then ni.value -> 'produto_id' else o.value -> 'produto_id' end,
                             'associacao', ni.value -> 'associacao', 'qtd', ni.value -> 'qtd', 'unidade_sischef', ni.value -> 'unidade_sischef')
                        else o.value end)
                 from jsonb_array_elements(n.itens) o
                 left join lateral (select value from jsonb_array_elements(v_itens) i2 where i2.value ->> 'n' = o.value ->> 'n' limit 1) ni on true),
        situacao = case when n.situacao = 'lancada' then 'lancada' else 'na_fila' end,
        visto_na_fila_em = v_lida, atualizado_em = cot_agora()
       where chave = v_chave;
    else
      insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido,
        v_prod, v_desc, v_ipi, v_st, v_frete, v_outro, itens, situacao, primeiro_visto_em, visto_na_fila_em, atualizado_em)
      values (v_chave, substr(v_chave, 7, 14), nota ->> 'emitente', nota ->> 'numero', (nota ->> 'emissao')::date,
        (nota ->> 'valor_nf')::numeric, v_xml,
        (v_totais ->> 'v_prod')::numeric, (v_totais ->> 'v_desc')::numeric, (v_totais ->> 'v_ipi')::numeric,
        (v_totais ->> 'v_st')::numeric, (v_totais ->> 'v_frete')::numeric, (v_totais ->> 'v_outro')::numeric,
        v_itens, 'na_fila', v_lida, v_lida, cot_agora())
      on conflict (chave) do update set
        emitente = excluded.emitente, numero = excluded.numero, emissao = excluded.emissao, valor_nf = excluded.valor_nf,
        xml_lido = excluded.xml_lido, v_prod = excluded.v_prod, v_desc = excluded.v_desc, v_ipi = excluded.v_ipi,
        v_st = excluded.v_st, v_frete = excluded.v_frete, v_outro = excluded.v_outro, itens = excluded.itens,
        situacao = case when cot_nfe.situacao = 'lancada' then 'lancada' else 'na_fila' end,
        visto_na_fila_em = v_lida, atualizado_em = cot_agora();
    end if;

    -- vendedor, casamento e conferência
    v_cnpj := substr(v_chave, 7, 14);
    v_vid := (select vendedor_id from cot_nfe where chave = v_chave and vinculo is distinct from 'ivan' and not nao_e_pedido);
    select vendedor_id into v_vid from cot_nfe where chave = v_chave;
    if (select vinculo from cot_nfe where chave = v_chave) is distinct from 'ivan'
       and not (select nao_e_pedido from cot_nfe where chave = v_chave) then
      v_vid := cot_nfe_vendedor(v_cnpj, nota ->> 'emitente');
      update cot_nfe set vendedor_id = v_vid, atualizado_em = cot_agora() where chave = v_chave;
      perform cot_nfe_casar(v_chave);
    end if;
    perform cot_nfe_conferir(v_chave);

    select * into n from cot_nfe where chave = v_chave;
    if n.vendedor_id is not null then v_com_vend := v_com_vend + 1; end if;
    if n.cotacao_id is not null then
      v_com_ped := v_com_ped + 1;
      v_resumo := n.conferencia -> 'resumo';
      v_conferidas := v_conferidas || jsonb_build_array(jsonb_build_object(
        'chave', n.chave, 'vendedor', cot_rotulo((select empresa from cot_vendedores v where v.id = n.vendedor_id)),
        'numero', n.numero, 'resumo', v_resumo));
      -- avisar: hash mudou e há algo a avisar
      if n.conferencia_hash is distinct from n.notificado_hash and (
           (v_resumo ->> 'acima')::int > 0 or (v_resumo ->> 'confira')::int > 0 or (v_resumo ->> 'fora_do_pedido')::int > 0
           or (v_resumo -> 'frete_acima') <> 'null'::jsonb or (v_resumo ->> 'marca_confira')::int > 0
           or (v_resumo ->> 'qtd_a_mais')::boolean) then
        v_avisar := v_avisar || jsonb_build_array(jsonb_build_object(
          'chave', n.chave, 'hash', n.conferencia_hash, 'hash_anterior', n.notificado_hash,
          'email', cot_nfe_email(n.chave)));
      end if;
    end if;
  end loop;

  -- saídas da fila (só leitura completa)
  v_sairam := '{}';
  if v_completa then
    update cot_nfe set situacao = 'saiu_da_fila', saiu_da_fila_em = v_lida, atualizado_em = cot_agora()
     where situacao = 'na_fila' and chave <> all(v_chaves);
    select coalesce(array_agg(chave), '{}') into v_sairam from cot_nfe
     where situacao = 'saiu_da_fila' and saiu_da_fila_em = v_lida;
  end if;

  -- retenção
  delete from cot_nfe where vendedor_id is null and vinculo is null and not nao_e_pedido
     and visto_na_fila_em < cot_agora() - interval '30 days';
  delete from cot_nfe_leituras where lida_em < cot_agora() - interval '60 days';

  return jsonb_build_object('notas', jsonb_array_length(v_notas), 'com_vendedor', v_com_vend, 'com_pedido', v_com_ped,
    'sairam', to_jsonb(v_sairam), 'conferidas', v_conferidas, 'avisar', v_avisar);
end $$;

-- Dados prontos do e-mail de conferência de uma NF (D.9.1). Interna, usada pela sincronização.
create or replace function public.cot_nfe_email(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n cot_nfe; c cot_cotacoes; v cot_vendedores; p cot_pedidos; v_linhas jsonb := '[]'::jsonb; ci jsonb;
begin
  select * into n from cot_nfe where chave = p_chave;
  select * into c from cot_cotacoes where id = n.cotacao_id;
  select * into v from cot_vendedores where id = n.vendedor_id;
  select * into p from cot_pedidos where cotacao_id = n.cotacao_id;
  for ci in select value from jsonb_array_elements(n.conferencia -> 'itens') loop
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'numero', ci -> 'numero', 'nome', (select i.nome from cot_itens i where i.cotacao_id = (ci ->> 'cotacao_id')::bigint and i.produto_id = (ci ->> 'produto_id')::bigint),
      'qtd_nf', ci -> 'qtd', 'estado', ci -> 'estado', 'esperado', ci -> 'esperado', 'cobrado', ci -> 'cobrado',
      'combinado_unit', ci -> 'combinado_unit', 'cobrado_unit', ci -> 'cobrado_unit',
      'marca', ci -> 'marca', 'motivo', ci -> 'motivo'));
  end loop;
  return jsonb_build_object(
    'vendedor', cot_rotulo(v.empresa), 'empresa', v.empresa,
    'nf', n.numero, 'emissao', cot_data_txt(n.emissao), 'emissao_ddmm', cot_ddmm(n.emissao),
    'valor', n.valor_nf, 'situacao', n.situacao,
    'pedido', jsonb_build_object('versao', c.versao, 'confirmado_local', cot_local(p.confirmado_em),
      'confirmado_ddmm', cot_ddmm(cot_data_local(p.confirmado_em)),
      'entrega_prevista', (select cot_data_txt(a.entrega_prevista) from cot_pedidos_acomp a where a.cotacao_id = n.cotacao_id),
      'casamento', n.conferencia -> 'casamento'),
    'resumo', n.conferencia -> 'resumo', 'linhas', v_linhas);
end $$;

-- Compara-e-troca de notificado_hash (D.5.4). true se trocou.
create or replace function public.cot_nfe_marcar_notificado(p_segredo text, p_chave text, p_hash_antigo text, p_hash_novo text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  update cot_nfe set notificado_hash = p_hash_novo, notificado_em = cot_agora()
   where chave = p_chave and notificado_hash is not distinct from p_hash_antigo;
  get diagnostics v = row_count;
  return v > 0;
end $$;

-- Marca notas como lançadas (D.5.4). Idempotente; ignora chave desconhecida; devolve quantas mudaram.
create or replace function public.cot_nfe_marcar_lancadas(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; v int := 0;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  for e in select value from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    update cot_nfe set situacao = 'lancada', lancada_em = (e ->> 'lancada_em')::timestamptz,
                       nf_sischef = e ->> 'nf_sischef', saiu_da_fila_em = coalesce(saiu_da_fila_em, (e ->> 'lancada_em')::timestamptz),
                       atualizado_em = cot_agora()
     where chave = e ->> 'chave' and situacao <> 'lancada';
    if found then v := v + 1; end if;
  end loop;
  return v;
end $$;

-- ================= Funções do usuário ativo

-- Pedidos a receber, sem preço (D.5.4). Lista branca de chaves.
create or replace function public.cot_pedidos_a_receber() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  perform exigir_ativo();
  select coalesce(jsonb_agg(x order by x_prev, x_conf), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
      'cotacao_id', c.id, 'vendedor', cot_rotulo(v.empresa), 'confirmado_em', cot_iso(p.confirmado_em),
      'confirmado_local', cot_local(p.confirmado_em),
      'entrega_prevista', cot_data_txt(a.entrega_prevista),
      'recebimento', (select cf.recebimento from cot_conferencia cf where cf.cotacao_id = c.id limit 1),
      'itens', (select jsonb_agg(jsonb_build_object(
                  'numero', cf.numero, 'nome', cf.nome, 'unidade', cf.unidade, 'qtd', cf.qtd,
                  'embalagens', cf.embalagens, 'fator', cf.fator,
                  'embalagem', coalesce(i.embalagem, 'embalagem'), 'marca', cf.marca,
                  'chegou', coalesce(cf.chegou, 0), 'avaria', coalesce(cf.avaria, 0), 'resto', cf.resto)
                  order by cf.numero)
                  from cot_conferencia cf left join cot_itens i on i.cotacao_id = cf.cotacao_id and i.produto_id = cf.produto_id
                 where cf.cotacao_id = c.id),
      'entregas', (select coalesce(jsonb_agg(jsonb_build_object('recebido_local', cot_local(r.recebido_em),
                     'quem', coalesce(u.nome, r.recebido_por)) order by r.recebido_em), '[]'::jsonb)
                     from cot_recebimentos r left join usuarios u on u.email = r.recebido_por where r.cotacao_id = c.id)
    ) as x, a.entrega_prevista as x_prev, p.confirmado_em as x_conf
    from cot_cotacoes c join cot_pedidos p on p.cotacao_id = c.id
    join cot_vendedores v on v.id = c.vendedor_id
    left join cot_pedidos_acomp a on a.cotacao_id = c.id
   where c.resultado = 'pedido'
     and (( p.confirmado_em >= cot_agora() - interval '30 days'
            and (select cf.recebimento from cot_conferencia cf where cf.cotacao_id = c.id limit 1) in ('aguardando', 'parcial'))
          or exists (select 1 from cot_recebimentos r where r.cotacao_id = c.id and r.recebido_em >= cot_agora() - interval '48 hours'))
    order by a.entrega_prevista asc nulls last, p.confirmado_em asc
  ) y;
  return v_res;
end $$;

-- Registra uma entrega (D.5.4).
create or replace function public.cot_registrar_recebimento(p_cotacao bigint, p_envio_id uuid, p_recebido_em timestamptz,
  p_itens jsonb, p_resto text, p_observacao text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c cot_cotacoes; p cot_pedidos; r cot_recebimentos; e jsonb; v_num int; v_vistos int[] := '{}';
  v_chegou numeric; v_avaria numeric; v_obs text; v_resto text; v_recebido timestamptz; v_itens jsonb := '[]'::jsonb;
  ped_item jsonb; v_qtd numeric; v_ja numeric; v_faltas jsonb := '[]'::jsonb; v_avarias jsonb := '[]'::jsonb; v_rid bigint;
  v_estado text; v_falta numeric; v_unid text; v_sem_chegou boolean := true; v_algum_naovem boolean := false;
begin
  perform exigir_ativo();
  if p_envio_id is null then raise exception 'envio sem identificador'; end if;
  select * into r from cot_recebimentos where envio_id = p_envio_id;
  if found then
    return jsonb_build_object('recebimento_id', r.id, 'recebimento',
      (select cf.recebimento from cot_conferencia cf where cf.cotacao_id = r.cotacao_id limit 1),
      'faltas', '[]'::jsonb, 'avarias', '[]'::jsonb, 'reenvio', true);
  end if;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found or c.resultado is distinct from 'pedido' then raise exception 'pedido não encontrado'; end if;
  select * into p from cot_pedidos where cotacao_id = p_cotacao;
  if p.confirmado_em < cot_agora() - interval '30 days' then
    raise exception 'pedido antigo demais para registrar recebimento (mais de 30 dias)';
  end if;
  v_recebido := coalesce(p_recebido_em, cot_agora());
  if cot_data_local(v_recebido) < cot_data_local(p.confirmado_em) or v_recebido > cot_agora() + interval '5 minutes' then
    raise exception 'data do recebimento fora do período do pedido';
  end if;
  if p_resto is not null and p_resto not in ('vem_depois', 'nao_vem') then raise exception 'resto inválido'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'informe o que chegou (ou marque que não veio nada)'; end if;
  for e in select value from jsonb_array_elements(p_itens) loop
    v_num := (e ->> 'numero')::int;
    select l into ped_item from cot_pedidos pp, lateral jsonb_array_elements(pp.itens) l
     where pp.cotacao_id = p_cotacao and (l ->> 'numero')::int = v_num limit 1;
    if ped_item is null then raise exception 'item % não está neste pedido', v_num; end if;
    if v_num = any(v_vistos) then raise exception 'item % repetido', v_num; end if;
    v_vistos := v_vistos || v_num;
    v_chegou := (e ->> 'chegou')::numeric;
    if v_chegou is null or v_chegou < 0 or v_chegou > 1000000 then raise exception 'quantidade inválida no item %', v_num; end if;
    v_avaria := coalesce((e ->> 'avaria')::numeric, 0);
    if v_avaria < 0 or v_avaria > v_chegou then raise exception 'avaria maior que o que chegou no item %', v_num; end if;
    v_obs := e ->> 'obs';
    if not cot_texto_ok(v_obs, 80) then raise exception 'observação inválida no item %', v_num; end if;
    v_resto := e ->> 'resto';
    if v_resto is not null and v_resto not in ('vem_depois', 'nao_vem') then raise exception 'resto inválido no item %', v_num; end if;
    if v_chegou > 0 then v_sem_chegou := false; end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('numero', v_num, 'produto_id', (ped_item ->> 'produto_id')::bigint,
      'chegou', v_chegou, 'avaria', v_avaria, 'obs', v_obs, 'resto_bruto', v_resto));
  end loop;
  -- "todos chegou 0 e nenhum marcou não vem" → precisa dizer o que chegou
  if v_sem_chegou then
    for e in select value from jsonb_array_elements(v_itens) loop
      if coalesce(e ->> 'resto_bruto', p_resto) = 'nao_vem' then v_algum_naovem := true; end if;
    end loop;
    if not v_algum_naovem then raise exception 'informe o que chegou (ou marque que não veio nada)'; end if;
  end if;
  if not cot_texto_ok(p_observacao, 200, true) then raise exception 'observação inválida'; end if;

  -- resolve o resto de cada item: se ainda tem falta somando as entregas anteriores e ficou sem resto → erro
  for e in select value from jsonb_array_elements(v_itens) loop
    v_num := (e ->> 'numero')::int;
    select l into ped_item from cot_pedidos pp, lateral jsonb_array_elements(pp.itens) l
     where pp.cotacao_id = p_cotacao and (l ->> 'numero')::int = v_num limit 1;
    v_qtd := (ped_item ->> 'qtd')::numeric;
    select i.unidade into v_unid from cot_itens i where i.cotacao_id = p_cotacao and i.produto_id = (ped_item ->> 'produto_id')::bigint;
    v_ja := coalesce((select sum((it ->> 'chegou')::numeric) from cot_recebimentos rr, lateral jsonb_array_elements(rr.itens) it
                       where rr.cotacao_id = p_cotacao and (it ->> 'numero')::int = v_num), 0);
    v_falta := v_qtd - (v_ja + (e ->> 'chegou')::numeric);
    if v_unid = 'kg' and v_falta <= 0.02 * v_qtd then v_falta := 0; end if;
    v_resto := coalesce(e ->> 'resto_bruto', p_resto);
    if v_falta > 0 and v_resto is null then
      raise exception 'diga se o que faltou do item % ainda vem ou não vem mais', v_num;
    end if;
    v_itens := jsonb_set(v_itens, array[(select ordinality - 1 from jsonb_array_elements(v_itens) with ordinality o where (o.value ->> 'numero')::int = v_num)::text],
      (e - 'resto_bruto') || jsonb_build_object('resto', case when v_falta > 0 then v_resto end));
    if v_falta > 0 then
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('numero', v_num,
        'nome', (select i.nome from cot_itens i where i.cotacao_id = p_cotacao and i.produto_id = (ped_item ->> 'produto_id')::bigint),
        'falta', v_falta, 'resto', case when v_falta > 0 then v_resto end));
    end if;
    if (e ->> 'avaria')::numeric > 0 then
      v_avarias := v_avarias || jsonb_build_array(jsonb_build_object('numero', v_num,
        'nome', (select i.nome from cot_itens i where i.cotacao_id = p_cotacao and i.produto_id = (ped_item ->> 'produto_id')::bigint),
        'avaria', (e ->> 'avaria')::numeric, 'obs', e ->> 'obs'));
    end if;
  end loop;

  insert into cot_recebimentos (envio_id, cotacao_id, recebido_em, recebido_por, registrado_em, itens, observacao)
  values (p_envio_id, p_cotacao, v_recebido, email_atual(), cot_agora(), v_itens, p_observacao)
  returning id into v_rid;

  v_estado := (select cf.recebimento from cot_conferencia cf where cf.cotacao_id = p_cotacao limit 1);
  return jsonb_build_object('recebimento_id', v_rid, 'recebimento', v_estado, 'faltas', v_faltas, 'avarias', v_avarias);
end $$;

-- Desfaz uma entrega (admin), grava historico (D.5.4).
create or replace function public.cot_desfazer_recebimento(p_recebimento bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r cot_recebimentos;
begin
  perform exigir_admin();
  select * into r from cot_recebimentos where id = p_recebimento;
  if not found then raise exception 'recebimento não encontrado'; end if;
  delete from cot_recebimentos where id = p_recebimento;
  insert into historico_alteracoes (quem, tabela, registro, antes, depois)
  values (email_atual(), 'cot_recebimentos', p_recebimento::text, to_jsonb(r), null);
end $$;

-- Grava a entrega prevista (admin).
create or replace function public.cot_definir_entrega(p_cotacao bigint, p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare p cot_pedidos;
begin
  perform exigir_admin();
  select * into p from cot_pedidos where cotacao_id = p_cotacao;
  if not found then raise exception 'pedido não encontrado'; end if;
  if p_data is not null and (p_data < cot_data_local(p.confirmado_em) or p_data > cot_data_local(p.confirmado_em) + 30) then
    raise exception 'entrega prevista fora do período (até 30 dias depois do pedido)';
  end if;
  insert into cot_pedidos_acomp (cotacao_id, entrega_prevista, atualizado_por, atualizado_em)
  values (p_cotacao, p_data, email_atual(), cot_agora())
  on conflict (cotacao_id) do update set entrega_prevista = excluded.entrega_prevista,
    atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em;
end $$;

-- "Já entrou no estoque" (admin); false desfaz.
create or replace function public.cot_marcar_entrada(p_cotacao bigint, p_entrou boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  if not exists (select 1 from cot_pedidos where cotacao_id = p_cotacao) then raise exception 'pedido não encontrado'; end if;
  insert into cot_pedidos_acomp (cotacao_id, entrada_manual_em, entrada_manual_por, atualizado_por, atualizado_em)
  values (p_cotacao, case when p_entrou then cot_agora() end, case when p_entrou then email_atual() end, email_atual(), cot_agora())
  on conflict (cotacao_id) do update set
    entrada_manual_em = case when p_entrou then cot_agora() end,
    entrada_manual_por = case when p_entrou then email_atual() end,
    atualizado_por = email_atual(), atualizado_em = cot_agora();
end $$;

-- "É deste pedido" / "Esta NF não é de pedido" (admin).
create or replace function public.cot_nfe_vincular(p_chave text, p_cotacao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n cot_nfe; c cot_cotacoes;
begin
  perform exigir_admin();
  select * into n from cot_nfe where chave = p_chave;
  if not found then raise exception 'NF-e não encontrada'; end if;
  if p_cotacao is null then
    update cot_nfe set nao_e_pedido = true, cotacao_id = null, vinculo = 'ivan', conferencia = null,
                       conferencia_hash = null, atualizado_em = cot_agora() where chave = p_chave;
    return jsonb_build_object('chave', p_chave, 'nao_e_pedido', true);
  end if;
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found or c.resultado is distinct from 'pedido' then raise exception 'pedido não encontrado'; end if;
  if n.vendedor_id is not null and n.vendedor_id <> c.vendedor_id then
    raise exception 'esta NF-e é de outro vendedor (%)', cot_rotulo((select empresa from cot_vendedores v where v.id = n.vendedor_id));
  end if;
  if n.vendedor_id is null then
    insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
    values (n.cnpj_emitente, c.vendedor_id, 'ivan', n.emitente, cot_agora()) on conflict (cnpj) do nothing;
  end if;
  update cot_nfe set vendedor_id = c.vendedor_id, cotacao_id = p_cotacao, vinculo = 'ivan', nao_e_pedido = false,
                     atualizado_em = cot_agora() where chave = p_chave;
  perform cot_nfe_conferir(p_chave);
  return (select conferencia from cot_nfe where chave = p_chave);
end $$;

-- Volta ao casamento automático (admin).
create or replace function public.cot_nfe_desvincular(p_chave text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  if not exists (select 1 from cot_nfe where chave = p_chave) then raise exception 'NF-e não encontrada'; end if;
  update cot_nfe set vinculo = null, nao_e_pedido = false, cotacao_id = null, conferencia = null,
                     conferencia_hash = null, atualizado_em = cot_agora() where chave = p_chave;
  perform cot_nfe_casar(p_chave);
  perform cot_nfe_conferir(p_chave);
end $$;

-- Move o CNPJ para outro vendedor (admin, 2ª revisão n.º 12).
create or replace function public.cot_cnpj_mover(p_cnpj text, p_vendedor bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_atual bigint; v_n int;
begin
  perform exigir_admin();
  select vendedor_id into v_atual from cot_fornecedores_cnpj where cnpj = p_cnpj;
  if v_atual is null then raise exception 'CNPJ não encontrado'; end if;
  if not exists (select 1 from cot_vendedores where id = p_vendedor) then raise exception 'vendedor não encontrado'; end if;
  if v_atual = p_vendedor then return jsonb_build_object('nfes_movidas', 0); end if;
  v_n := cot_nfe_cnpj_trocar(p_cnpj, p_vendedor);
  return jsonb_build_object('nfes_movidas', v_n);
end $$;

-- Remove o CNPJ (admin, 2ª revisão n.º 12).
create or replace function public.cot_cnpj_remover(p_cnpj text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform exigir_admin();
  if not exists (select 1 from cot_fornecedores_cnpj where cnpj = p_cnpj) then raise exception 'CNPJ não encontrado'; end if;
  v_n := cot_nfe_cnpj_trocar(p_cnpj, null);
  return jsonb_build_object('nfes_sem_vendedor', v_n);
end $$;

-- O App lê o desempenho por aqui (admin), nunca a view direto (D.5.2, 2ª revisão n.º 1).
create or replace function public.cot_desempenho_vendedores() returns setof cot_desempenho
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_admin();
  return query select * from cot_desempenho;
end $$;

-- ================= RLS: leitura só do admin; nenhuma política de escrita
alter table public.cot_pedidos_acomp enable row level security;
alter table public.cot_recebimentos enable row level security;
alter table public.cot_fornecedores_cnpj enable row level security;
alter table public.cot_nfe enable row level security;
alter table public.cot_nfe_leituras enable row level security;
create policy cot_pedidos_acomp_ler on public.cot_pedidos_acomp for select to authenticated using (eh_admin());
create policy cot_recebimentos_ler on public.cot_recebimentos for select to authenticated using (eh_admin());
create policy cot_fornecedores_cnpj_ler on public.cot_fornecedores_cnpj for select to authenticated using (eh_admin());
create policy cot_nfe_ler on public.cot_nfe for select to authenticated using (eh_admin());
create policy cot_nfe_leituras_ler on public.cot_nfe_leituras for select to authenticated using (eh_admin());

-- ================= Permissões (bloco completo, no padrão da 20261001000001 + E1)

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- Tabelas e views cot_*: D1 acrescenta 5 tabelas + a view cot_conferencia (admin lê); cot_desempenho fica só
-- para o service_role (D.5.7). cot_limites, cot_avisos e cot_cadastros_aplicados seguem só service_role.
revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
              public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
              public.cot_nfe_leituras,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
              public.cot_conferencia, public.cot_desempenho
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_categorias,
                public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
                public.cot_nfe_leituras,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
                public.cot_conferencia
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
             public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
             public.cot_nfe_leituras,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
             public.cot_conferencia, public.cot_desempenho
  to service_role;

-- Funções: lista completa (1A + 1B + E1 + D1). As internas ficam sem grant e com revoke explícito do service_role.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
-- internas da D1 (D.5.4): nem o service_role as executa
revoke execute on function public.cot_nfe_exigir_robo(text) from service_role;
revoke execute on function public.cot_nfe_vendedor(text, text) from service_role;
revoke execute on function public.cot_nfe_casar(text) from service_role;
revoke execute on function public.cot_nfe_conferir(text) from service_role;
revoke execute on function public.cot_nfe_cnpj_trocar(text, bigint) from service_role;
revoke execute on function public.cot_nfe_email(text) from service_role;
revoke execute on function public.cot_pedido_antes_de_apagar() from service_role;
grant execute on function
  public.email_atual(), public.eh_ativo(), public.eh_admin(),
  public.ajustar_item(bigint, numeric, boolean), public.aprovar_semana(bigint), public.encerrar_semana(bigint),
  public.abrir_compra(uuid, bigint, text),
  public.registrar_item(uuid, uuid, bigint, numeric, numeric, text),
  public.desmarcar_item(uuid, bigint),
  public.fechar_compra(uuid, boolean, numeric, text),
  public.cancelar_compra(uuid),
  public.aprovar_compra(uuid), public.marcar_lancada(uuid),
  public.corrigir_item_compra(uuid, numeric, numeric), public.corrigir_compra(uuid, boolean, numeric),
  public.nomes_equipe(),
  public.admin_fechar_compra(uuid, boolean, numeric),
  -- Fase 1B
  public.cot_cancelar(bigint), public.cot_confirmar_envio(bigint), public.cot_congelar(bigint),
  public.cot_dados_envio(bigint), public.cot_definir_nota(bigint, text), public.cot_definir_vendedor(bigint, bigint),
  public.cot_descongelar(bigint), public.cot_desfazer_pedido(bigint),
  public.cot_dispensar(bigint), public.cot_gravar_pedido(bigint, jsonb), public.cot_liberar_loja(bigint),
  public.cot_marcar_item(bigint, boolean), public.cot_marcas_semana(bigint), public.cot_nova_versao(bigint),
  public.cot_preparar(bigint), public.cot_responder_admin(bigint, uuid, jsonb, jsonb, text),
  public.cot_trocar_codigo(bigint), public.cot_voltar_a_cotar(bigint),
  public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  -- Fase 2, E1
  public.cot_painel_economia(date, date), public.cot_historico_item(bigint, date, date),
  -- Fase 2, D1: recebimento e NF-e (admin/ativo)
  public.cot_pedidos_a_receber(), public.cot_registrar_recebimento(bigint, uuid, timestamptz, jsonb, text, text),
  public.cot_desfazer_recebimento(bigint), public.cot_definir_entrega(bigint, date),
  public.cot_marcar_entrada(bigint, boolean), public.cot_nfe_vincular(text, bigint), public.cot_nfe_desvincular(text),
  public.cot_desempenho_vendedores(), public.cot_cnpj_mover(text, bigint), public.cot_cnpj_remover(text)
  to authenticated;
-- anon: as 2 da página do vendedor + as 3 do robô (só com o segredo, D.5.7).
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  public.cot_nfe_sincronizar(text, jsonb), public.cot_nfe_marcar_notificado(text, text, text, text),
  public.cot_nfe_marcar_lancadas(text, jsonb)
  to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_aplicar_cadastros(jsonb)
  to service_role;
