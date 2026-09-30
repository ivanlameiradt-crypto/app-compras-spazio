-- App de Compras Spazio — Fase 2, Bloco C2: o que o App aprende sozinho (regras da lista, fatores a confirmar
-- e histórico de cotações). Desenho: DESIGN-fase-2.md, C.4.8 a C.4.12 — a fonte da verdade.
-- ÚLTIMA migration por nome de arquivo (20261126). Por isso ela fecha com o bloco de permissões COMPLETO
-- (1A + 1B + E1 + D + B + C1 + C2): anon só cotacao_abrir/cotacao_responder (+ as 3 do robô de NF-e, só com o
-- segredo); service_role com a lista do robô (com cot_exportar_cadastros no lugar de cot_aplicar_cadastros).
-- Reescreve TRÊS funções (fase2-base.test.ts, X2 da C2 confere o md5): importar_semana (1A), cot_exportar_cadastros
-- e cot_produtos_cadastro (as duas da C1). O Bloco A, que ainda não existe, recria depois o cot_confirmar_fator,
-- o cot_contar_aguardando, o cot_produtos_cadastro (coluna disputa), o cot_fatores_a_confirmar (concorrente em
-- disputa) e o cot_exportar_cadastros (cruzada/disputas/catalogo_vendedor). Aqui a disputa fica pendente (null).

-- ================= Tabelas e colunas (C.4.8 e C.4.9)

create table public.lista_regras (
  produto_id    bigint primary key,
  acao          text not null check (acao in ('barrar', 'incluir')),
  motivo        text check (motivo is null or (char_length(motivo) between 1 and 80
                                               and motivo !~ '[\x01-\x1F\x7F\u0080-\u009F]')),
  produto_nome  text not null,                -- guardado: o produto pode sair da planilha-base
  criada_por    text not null references public.usuarios (email),
  criada_em     timestamptz not null default now(),
  check (acao <> 'barrar' or motivo is not null)
);
alter table public.itens_semana
  add column regra text check (regra in ('barrar', 'incluir')),   -- retrato da regra na importação
  add column regra_motivo text;

create table public.cot_fator_descartes (
  produto_id bigint not null, vendedor_id bigint not null references public.cot_vendedores (id),
  fator numeric not null, descartado_por text not null, descartado_em timestamptz not null default now(),
  primary key (produto_id, vendedor_id, fator)
);

alter table public.lista_regras enable row level security;
create policy lista_regras_ler on public.lista_regras for select to authenticated using (eh_admin());
alter table public.cot_fator_descartes enable row level security;
create policy cot_fator_descartes_ler on public.cot_fator_descartes for select to authenticated using (eh_admin());

-- ================= Regras da lista (C.4.8)

-- Mesma conta na importação e no rascunho (interna, imutável; sem grant nem para service_role).
create or replace function public.lista_incluido(p_qtd numeric, p_negativo boolean, p_selos jsonb, p_acao text) returns boolean
language sql immutable set search_path = public as $$
  select case when p_acao = 'barrar' then false
              when p_acao = 'incluir' then p_qtd > 0 and not p_negativo
                   and not exists (select 1 from jsonb_array_elements(p_selos) s where s ->> 'codigo' <> 'linha_alta')
              else p_qtd > 0 and not p_negativo and jsonb_array_length(p_selos) = 0 end
$$;

-- importar_semana reescrito sobre o da 20260928000001 (a última definição). Mudanças mínimas: junta lista_regras,
-- usa lista_incluido, grava regra/regra_motivo e devolve "regras". Sem nenhuma regra, o resultado é idêntico ao
-- de hoje (X4 e o payload real de 22/09).
create or replace function public.importar_semana(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_data   date := (p ->> 'data_referencia')::date;
  v_id     bigint;
  v_status text;
  v_item   jsonb;
  v_selo   jsonb;
  v_barrados int;
  v_incluidos int;
begin
  if v_data is null then
    raise exception 'data_referencia obrigatória';
  end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'lista de itens vazia';
  end if;

  for v_item in select e from jsonb_array_elements(p -> 'itens') as e loop
    if coalesce(jsonb_typeof(v_item -> 'selos'), 'null') not in ('array', 'null') then
      raise exception 'selos do produto % precisam ser uma lista', v_item ->> 'produto_id';
    end if;
    for v_selo in
      select s from jsonb_array_elements(case when jsonb_typeof(v_item -> 'selos') = 'array'
                                              then v_item -> 'selos' else '[]'::jsonb end) as s
    loop
      if jsonb_typeof(v_selo) is distinct from 'object'
         or jsonb_typeof(v_selo -> 'codigo') is distinct from 'string'
         or (v_selo ->> 'codigo') not in ('linha_alta', 'bebida_negativa', 'preco_fora', 'fracao_un')
         or jsonb_typeof(v_selo -> 'texto') is distinct from 'string'
         or char_length(v_selo ->> 'texto') not between 1 and 200 then
        raise exception 'selo inválido no produto %: %', v_item ->> 'produto_id', left(v_selo::text, 120);
      end if;
    end loop;
  end loop;

  select id, status into v_id, v_status from semanas where data_referencia = v_data for update;
  if v_id is not null and v_status <> 'rascunho' then
    return jsonb_build_object('resultado', 'ja_aprovada', 'semana_id', v_id, 'selos', true);
  end if;

  if v_id is null then
    insert into semanas (data_referencia) values (v_data) returning id into v_id;
  else
    delete from itens_semana where semana_id = v_id;
    update semanas set gerada_em = now() where id = v_id;
  end if;

  insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, estoque_minimo,
                            qtd_sugerida, qtd_aprovada, preco_estimado, custo_medio, data_ultima_compra,
                            fornecedor_ultima, situacao, negativo, incluido, selos, regra, regra_motivo)
  select v_id, x.produto_id, x.produto, x.bebida,
         case when x.produto ~* '\(\s*KG\s*\)' then 'kg' else 'un' end,
         x.estoque, coalesce(x.estoque_minimo, 0), x.qtd_sugerida,
         case when i.incluido then x.qtd_sugerida else 0 end,
         case when x.preco_estimado > 0 then x.preco_estimado end,
         case when x.custo_medio > 0 then x.custo_medio end,
         x.data_ultima_compra, x.fornecedor_ultima, x.situacao,
         n.negativo, i.incluido, n.selos, r.acao, r.motivo
    from jsonb_to_recordset(p -> 'itens') as x(
           produto_id bigint, produto text, bebida boolean, estoque numeric, estoque_minimo numeric,
           qtd_sugerida numeric, preco_estimado numeric, custo_medio numeric, data_ultima_compra date,
           fornecedor_ultima text, situacao text, selos jsonb)
    left join lista_regras r on r.produto_id = x.produto_id
    cross join lateral (
      select (not x.bebida and x.situacao = 'ESTOQUE NEGATIVO') as negativo,
             case when jsonb_typeof(x.selos) = 'array' then x.selos else '[]'::jsonb end as selos
    ) n
    cross join lateral (
      select lista_incluido(x.qtd_sugerida, n.negativo, n.selos, r.acao) as incluido
    ) i
    -- o left join de lista_regras poderia reordenar as linhas (o id de itens_semana sai da ordem de inserção);
    -- ordena por produto_id para o retrato ficar igual ao da 20260928000001 (sem join, ordem do array).
    order by x.produto_id;

  -- barrados = itens com regra de barrar; incluidos = só os que a regra fez entrar (com selo)
  select count(*) filter (where regra = 'barrar'),
         count(*) filter (where regra = 'incluir' and incluido and jsonb_array_length(selos) > 0)
    into v_barrados, v_incluidos
    from itens_semana where semana_id = v_id;

  return jsonb_build_object('resultado', case when v_status is null then 'criada' else 'substituida' end,
                            'semana_id', v_id, 'itens', jsonb_array_length(p -> 'itens'), 'selos', true,
                            'regras', jsonb_build_object('barrados', v_barrados, 'incluidos', v_incluidos));
end $$;

create or replace function public.lista_regra_salvar(p_produto_id bigint, p_acao text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_motivo text := nullif(trim(p_motivo), '');
  v_nome   text;
  v_semana bigint;
  it       itens_semana;
  v_efeito text := 'nenhum';
  v_antes  jsonb;
begin
  perform exigir_admin();
  if p_acao not in ('barrar', 'incluir') then
    raise exception 'ação inválida (barrar ou incluir)';
  end if;
  if p_acao = 'incluir' then
    v_motivo := null;
  elsif v_motivo is null or not cot_texto_ok(v_motivo, 80) then
    raise exception 'diga o motivo, ex.: É da Kūkan';
  end if;
  select produto into v_nome from itens_semana
   where produto_id = p_produto_id and semana_id = (select id from semanas order by data_referencia desc limit 1);
  if v_nome is null then
    raise exception 'produto desconhecido';
  end if;

  v_antes := (select to_jsonb(r) from lista_regras r where r.produto_id = p_produto_id);
  insert into lista_regras (produto_id, acao, motivo, produto_nome, criada_por)
  values (p_produto_id, p_acao, v_motivo, v_nome, email_atual())
  on conflict (produto_id) do update
    set acao = excluded.acao, motivo = excluded.motivo, produto_nome = excluded.produto_nome,
        criada_por = excluded.criada_por, criada_em = now();
  perform cot_registrar_mudanca('lista_regras', p_produto_id::text, v_antes,
            (select to_jsonb(r) from lista_regras r where r.produto_id = p_produto_id));

  -- aplica na hora só à semana em rascunho que tiver o produto (nunca em_compra nem encerrada)
  select id into v_semana from semanas where status = 'rascunho'
   and exists (select 1 from itens_semana i where i.semana_id = semanas.id and i.produto_id = p_produto_id)
   order by data_referencia desc limit 1;
  if v_semana is not null then
    select * into it from itens_semana where semana_id = v_semana and produto_id = p_produto_id for update;
    if p_acao = 'barrar' and it.incluido then
      update itens_semana set incluido = false, qtd_aprovada = 0, regra = 'barrar', regra_motivo = v_motivo
       where id = it.id;
      v_efeito := 'tirado';
    elsif p_acao = 'incluir' and not it.incluido
          and lista_incluido(it.qtd_sugerida, it.negativo, it.selos, 'incluir') then
      update itens_semana set incluido = true, qtd_aprovada = it.qtd_sugerida, regra = 'incluir', regra_motivo = null
       where id = it.id;
      v_efeito := 'incluido';
    else
      update itens_semana set regra = p_acao, regra_motivo = v_motivo where id = it.id;
    end if;
  end if;
  return jsonb_build_object('semana_rascunho', v_semana, 'efeito', v_efeito);
end $$;

create or replace function public.lista_regra_remover(p_produto_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_semana bigint;
begin
  perform exigir_admin();
  v_antes := (select to_jsonb(r) from lista_regras r where r.produto_id = p_produto_id);
  if v_antes is null then
    raise exception 'regra não encontrada';
  end if;
  delete from lista_regras where produto_id = p_produto_id;
  perform cot_registrar_mudanca('lista_regras', p_produto_id::text, v_antes, null);
  select id into v_semana from semanas where status = 'rascunho'
   and exists (select 1 from itens_semana i where i.semana_id = semanas.id and i.produto_id = p_produto_id)
   order by data_referencia desc limit 1;
  if v_semana is not null then
    update itens_semana set regra = null, regra_motivo = null
     where semana_id = v_semana and produto_id = p_produto_id;   -- sem mexer em incluido
  end if;
end $$;

-- ================= Fatores a confirmar (C.4.9)

create or replace function public.cot_descartar_fator(p_produto_id bigint, p_vendedor_id bigint, p_fator numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  insert into cot_fator_descartes (produto_id, vendedor_id, fator, descartado_por)
  values (p_produto_id, p_vendedor_id, p_fator, email_atual())
  on conflict do nothing;
  perform cot_registrar_mudanca('cot_fator_descartes', p_produto_id || '/' || p_vendedor_id || '/' || p_fator,
            null, jsonb_build_object('produto_id', p_produto_id, 'vendedor_id', p_vendedor_id, 'fator', p_fator));
end $$;

-- Sugestões de embalagem/fator vindas das respostas e das NF-e, do vendedor atual de cada produto (o ramo do
-- concorrente em disputa é do Bloco A, ainda não construído). Fora as que já são o padrão confirmado e as descartadas.
create or replace function public.cot_fatores_a_confirmar()
returns table(produto_id bigint, produto text, unidade text, bebida boolean, vendedor_id bigint,
  fator numeric, embalagem_sugerida text, origem text, ref text, vezes int, ultima timestamptz,
  exemplos jsonb, padrao_embalagem text, padrao_fator numeric, padrao_confirmado_em timestamptz, conflito boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform exigir_admin();
  return query
  with nova as (select id from semanas order by data_referencia desc limit 1),
  atual as (
    select i.produto_id, i.produto, i.unidade, i.bebida,
           coalesce(cat.vendedor_id, v.vendedor_id, v.vendedor_motivo_id) as vendedor_id
      from itens_semana i
      left join cot_catalogo cat on cat.produto_id = i.produto_id
      cross join lateral cot_vendedor_do_item(i.id) v
     where i.semana_id = (select id from nova)
  ),
  respostas as (
    select x.produto_id, c.vendedor_id, x.fator_informado as fator, 'resposta'::text as origem,
           (array_agg(x.id order by x.respondido_em desc nulls last))[1]::text as ref,
           count(distinct c.semana_id)::int as vezes, max(x.respondido_em) as ultima,
           coalesce((select jsonb_agg(z) from (
              select distinct jsonb_build_object('data_referencia', cot_data_txt(s2.data_referencia), 'versao', c2.versao) as z
                from cot_itens x2 join cot_cotacoes c2 on c2.id = x2.cotacao_id join semanas s2 on s2.id = c2.semana_id
               where x2.produto_id = x.produto_id and c2.vendedor_id = c.vendedor_id
                 and x2.estado = 'tem' and x2.base = 'embalagem' and x2.fator_informado = x.fator_informado
                 and c2.status not in ('rascunho', 'liberada', 'substituida', 'cancelada')
               limit 3) w), '[]'::jsonb) as exemplos,
           null::text as emb_fonte
      from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
     where x.incluido and x.estado = 'tem' and x.base = 'embalagem' and x.fator_informado is not null
       and c.status not in ('rascunho', 'liberada', 'substituida', 'cancelada')
     group by x.produto_id, c.vendedor_id, x.fator_informado
  ),
  nfe as (
    select (it ->> 'produto_id')::bigint as produto_id, n.vendedor_id,
           round((it ->> 'qtd')::numeric / (it ->> 'qtd_nf')::numeric, 3) as fator,
           case upper(it ->> 'unidade_nf')
             when 'CX' then 'caixa' when 'FD' then 'fardo' when 'FARDO' then 'fardo'
             when 'PCT' then 'pacote' when 'SC' then 'saco' when 'SACO' then 'saco' end as emb_nf,
           lower(coalesce(it ->> 'unidade_sischef', '')) as un_nf, n.chave, n.emissao
      from cot_nfe n cross join lateral jsonb_array_elements(n.itens) it
     where n.vendedor_id is not null and (it ->> 'produto_id') is not null
       and (it ->> 'qtd_nf') is not null and (it ->> 'qtd_nf')::numeric > 0 and (it ->> 'qtd') is not null
       and upper(coalesce(it ->> 'unidade_nf', '')) in ('CX', 'FD', 'FARDO', 'PCT', 'SC', 'SACO')
  ),
  nfe_grp as (
    select g.produto_id, g.vendedor_id, g.fator, 'nfe'::text as origem,
           (array_agg(g.chave order by g.emissao desc))[1] as ref,
           count(distinct g.chave)::int as vezes, max(g.emissao)::timestamptz as ultima,
           '[]'::jsonb as exemplos, (array_agg(g.emb_nf order by g.emissao desc))[1] as emb_fonte
      from nfe g join atual a on a.produto_id = g.produto_id
     where g.un_nf = lower(a.unidade) and (a.unidade <> 'un' or g.fator = round(g.fator, 0))
     group by g.produto_id, g.vendedor_id, g.fator
  ),
  sug as (
    select produto_id, vendedor_id, fator, origem, ref, vezes, ultima, exemplos, emb_fonte from respostas
    union all
    select produto_id, vendedor_id, fator, origem, ref, vezes, ultima, exemplos, emb_fonte from nfe_grp
  )
  select a.produto_id, a.produto, a.unidade, a.bebida, s.vendedor_id, s.fator,
         coalesce(
           case when s.origem = 'nfe' then s.emb_fonte
                when cat.vendedor_id = s.vendedor_id and cat.embalagem is not null then cat.embalagem end,
           case when a.unidade = 'kg' then 'pacote' when a.bebida then 'fardo' else 'caixa' end) as embalagem_sugerida,
         s.origem, s.ref, s.vezes, s.ultima, s.exemplos,
         case when cat.fator_confirmado_em is not null and cat.vendedor_id = s.vendedor_id then cat.embalagem end,
         case when cat.fator_confirmado_em is not null and cat.vendedor_id = s.vendedor_id then cat.fator end,
         case when cat.vendedor_id = s.vendedor_id then cat.fator_confirmado_em end,
         (cat.fator_confirmado_em is not null and cat.vendedor_id = s.vendedor_id and cat.fator <> s.fator) as conflito
    from sug s
    join atual a on a.produto_id = s.produto_id and a.vendedor_id = s.vendedor_id
    left join cot_catalogo cat on cat.produto_id = s.produto_id
   where not exists (select 1 from cot_fator_descartes d
                      where d.produto_id = s.produto_id and d.vendedor_id = s.vendedor_id and d.fator = s.fator)
     and not (cat.fator_confirmado_em is not null and cat.vendedor_id = s.vendedor_id and cat.fator = s.fator)
   order by conflito desc, s.vezes desc, s.ultima desc nulls last;
end $$;

-- ================= Histórico (C.4.10). security_invoker: a RLS de admin das cot_* vale para quem lê.

create view public.cot_historico_itens with (security_invoker = true) as
select s.id as semana_id, s.data_referencia, c.vendedor_id, c.id as cotacao_id, c.versao, c.complementar,
       c.status, c.resultado, x.produto_id, x.nome, x.unidade, x.qtd, x.estado, x.base, x.preco_digitado,
       x.emb_unidades, x.emb_gramas, x.emb_ml, x.preco_convertido, x.marca_informada, x.ref_preco, x.ref_situacao,
       (el.produto_id is not null) as no_pedido, el.qtd as qtd_pedido, el.preco_convertido as preco_pedido
  from cot_cotacoes c
  join semanas s on s.id = c.semana_id
  join cot_itens x on x.cotacao_id = c.id and x.incluido
  left join cot_economia_linhas el on el.cotacao_id = c.id and el.produto_id = x.produto_id
 where c.congelada_em is not null and c.status not in ('substituida', 'cancelada');

create view public.cot_historico_semanas with (security_invoker = true) as
select
  c.semana_id, s.data_referencia, c.vendedor_id,
  (count(*) filter (where c.congelada_em is not null))::int as versoes,
  case
    when bool_or(c.resultado = 'pedido') then 'pedido'
    when bool_or(c.resultado = 'dispensado') then 'dispensado'
    when bool_or(c.status in ('pronta', 'enviada', 'respondida') or (c.status = 'fechada' and c.resultado is null)) then 'em_aberto'
    when bool_or(c.status = 'liberada') then 'loja'
    when bool_or(c.status = 'cancelada') then 'cancelada'
    else 'nao_enviada'
  end as desfecho,
  coalesce(it.itens, 0) as itens,
  coalesce(it.respondidos, 0) as respondidos,
  coalesce(it.tem, 0) as tem,
  coalesce(el.pedido_itens, 0) as pedido_itens,
  coalesce(el.comparados, 0) as comparados,
  coalesce(el.total_pedido, 0) as total_pedido,
  coalesce(el.total_ultimo, 0) as total_ultimo,
  coalesce(el.total_pedido, 0) - coalesce(el.total_ultimo, 0) as diferenca,
  case when coalesce(el.total_ultimo, 0) > 0 then round(el.total_pedido / el.total_ultimo - 1, 4) end as pct,
  max(c.enviada_em) as enviada_em,
  env.primeira_resposta_em,
  env.canais
from cot_cotacoes c
join semanas s on s.id = c.semana_id
left join lateral (
  select count(*) filter (where x.incluido)::int as itens,
         count(*) filter (where x.incluido and x.estado <> 'sem_resposta')::int as respondidos,
         count(*) filter (where x.incluido and x.estado = 'tem')::int as tem
    from cot_cotacoes c2 join cot_itens x on x.cotacao_id = c2.id
   where c2.semana_id = c.semana_id and c2.vendedor_id = c.vendedor_id
     and c2.congelada_em is not null and c2.status not in ('substituida', 'cancelada')
) it on true
left join lateral (
  select count(*)::int as pedido_itens,
         count(*) filter (where l.comparavel)::int as comparados,
         round(coalesce(sum(l.valor_pedido) filter (where l.comparavel), 0), 2) as total_pedido,
         round(coalesce(sum(l.valor_ultimo) filter (where l.comparavel), 0), 2) as total_ultimo
    from cot_economia_linhas l
   where l.semana_id = c.semana_id and l.vendedor_id = c.vendedor_id
) el on true
left join lateral (
  select min(e.recebido_em) filter (where e.origem = 'vendedor') as primeira_resposta_em,
         (select jsonb_agg(distinct e2.origem order by e2.origem)
            from cot_envios e2 join cot_cotacoes c3 on c3.id = e2.cotacao_id
           where c3.semana_id = c.semana_id and c3.vendedor_id = c.vendedor_id) as canais
    from cot_envios e join cot_cotacoes c4 on c4.id = e.cotacao_id
   where c4.semana_id = c.semana_id and c4.vendedor_id = c.vendedor_id
) env on true
group by c.semana_id, s.data_referencia, c.vendedor_id, it.itens, it.respondidos, it.tem,
         el.pedido_itens, el.comparados, el.total_pedido, el.total_ultimo, env.primeira_resposta_em, env.canais;

-- ================= cot_produtos_cadastro reescrito (drop + create: muda o tipo de retorno; C.4.6)
-- Acrescenta regra, regra_motivo, a_confirmar (nº de sugestões) e disputa (o Bloco A preenche; aqui null).
drop function if exists public.cot_produtos_cadastro();
create function public.cot_produtos_cadastro()
returns table(produto_id bigint, produto text, nome_limpo text, unidade text, bebida boolean,
  fornecedor_ultima text, data_ultima_compra date, vendedor_id bigint, via text, motivo text,
  vendedor_motivo_id bigint, catalogo_origem text, escolhido_em timestamptz, nome_para_vendedor text,
  nota_vendedor text, embalagem text, fator numeric, fator_confirmado_em timestamptz,
  vende_por_litro boolean, kg_por_litro numeric, kg_por_litro_confirmado_em timestamptz,
  descricao_fornecedor text, codigo_fornecedor text, categoria text,
  regra text, regra_motivo text, a_confirmar int, disputa jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform exigir_admin();
  return query
  with fa as (select f.produto_id, count(*)::int as n from cot_fatores_a_confirmar() f group by f.produto_id)
  select i.produto_id, i.produto, cot_nome_limpo(i.produto), i.unidade, i.bebida,
         i.fornecedor_ultima, i.data_ultima_compra,
         v.vendedor_id, v.via, v.motivo, v.vendedor_motivo_id,
         cat.origem, cat.atualizado_em, cat.nome_para_vendedor, cat.nota_vendedor,
         cat.embalagem, cat.fator, cat.fator_confirmado_em,
         coalesce(cat.vende_por_litro, false), cat.kg_por_litro, cat.kg_por_litro_confirmado_em,
         cat.descricao_fornecedor, cat.codigo_fornecedor,
         coalesce(ctg.categoria, case when i.bebida then 'Bebidas' else 'Insumos' end),
         i.regra, i.regra_motivo, coalesce(fa.n, 0), null::jsonb
    from itens_semana i
    cross join lateral cot_vendedor_do_item(i.id) v
    left join cot_catalogo cat on cat.produto_id = i.produto_id
    left join cot_categorias ctg on ctg.produto_id = i.produto_id
    left join fa on fa.produto_id = i.produto_id
   where i.semana_id = (select id from semanas order by data_referencia desc limit 1)
   order by i.produto_id;
end $$;

-- ================= cot_exportar_cadastros reescrito (acrescenta regras e categorias; C.4.7)
create or replace function public.cot_exportar_cadastros() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gerado_em', cot_iso(cot_agora()),
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', v.codigo, 'nome', v.nome, 'empresa', v.empresa, 'whatsapp', v.whatsapp, 'ativo', v.ativo)
        order by v.codigo) from cot_vendedores v), '[]'::jsonb),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object(
        'nome_fornecedor', f.nome_original, 'vendedor_codigo', v.codigo)
        order by f.nome_normalizado) from cot_fornecedores f join cot_vendedores v on v.id = f.vendedor_id), '[]'::jsonb),
    'cnpjs', coalesce((select jsonb_agg(jsonb_build_object(
        'cnpj', n.cnpj, 'vendedor_codigo', v.codigo, 'origem', n.origem, 'nome_na_nf', n.nome_na_nf)
        order by n.cnpj) from cot_fornecedores_cnpj n join cot_vendedores v on v.id = n.vendedor_id), '[]'::jsonb),
    'catalogo', coalesce((select jsonb_agg(jsonb_build_object(
        'produto_id', c.produto_id, 'vendedor_codigo', v.codigo, 'origem', c.origem,
        'nome_para_vendedor', c.nome_para_vendedor, 'embalagem', c.embalagem, 'fator', c.fator,
        'fator_confirmado_em', cot_iso(c.fator_confirmado_em), 'vende_por_litro', c.vende_por_litro,
        'kg_por_litro', c.kg_por_litro, 'kg_por_litro_confirmado_em', cot_iso(c.kg_por_litro_confirmado_em),
        'descricao_fornecedor', c.descricao_fornecedor, 'codigo_fornecedor', c.codigo_fornecedor,
        'descricao_de_fornecedor', c.descricao_de_fornecedor, 'nota_vendedor', c.nota_vendedor,
        'atualizado_em', cot_iso(c.atualizado_em)) order by c.produto_id)
        from cot_catalogo c left join cot_vendedores v on v.id = c.vendedor_id), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(jsonb_build_object('data', cot_data_txt(f.data), 'nome', f.nome)
        order by f.data) from cot_feriados f), '[]'::jsonb),
    'regras', coalesce((select jsonb_agg(jsonb_build_object('produto_id', r.produto_id, 'acao', r.acao,
        'motivo', r.motivo, 'produto_nome', r.produto_nome) order by r.produto_id) from lista_regras r), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('produto_id', ct.produto_id, 'categoria', ct.categoria)
        order by ct.produto_id) from cot_categorias ct), '[]'::jsonb))
$$;

-- ================= Permissões — BLOCO COMPLETO (1A + 1B + E1 + D + B + C1 + C2), esta é a última migration (§8.6)

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- Tabelas e views: nada para anon; o admin lê (RLS eh_admin()); só a chave de serviço lê cot_cadastros_aplicados,
-- cot_limites, cot_avisos, cot_ia_config e a view cot_desempenho. lista_regras, cot_fator_descartes e as duas
-- views de histórico entram na leitura do admin.
revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
              public.cot_ia_config, public.cot_leituras_ia,
              public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
              public.cot_nfe_leituras, public.lista_regras, public.cot_fator_descartes,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
              public.cot_ia_uso, public.cot_conferencia, public.cot_desempenho,
              public.cot_historico_itens, public.cot_historico_semanas
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_categorias, public.cot_leituras_ia,
                public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
                public.cot_nfe_leituras, public.lista_regras, public.cot_fator_descartes,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
                public.cot_ia_uso, public.cot_conferencia,
                public.cot_historico_itens, public.cot_historico_semanas
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
             public.cot_ia_config, public.cot_leituras_ia,
             public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
             public.cot_nfe_leituras, public.lista_regras, public.cot_fator_descartes,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
             public.cot_ia_uso, public.cot_conferencia, public.cot_desempenho,
             public.cot_historico_itens, public.cot_historico_semanas
  to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
-- internas sem grant nem para o service_role (§2.2 regra 6a) e a virada (cot_aplicar_cadastros).
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
revoke execute on function public.cot_ia_uso_json(cot_ia_config), public.cot_ia_inteiro_nn(jsonb) from service_role;
revoke execute on function public.cot_nfe_exigir_robo(text), public.cot_nfe_vendedor(text, text),
  public.cot_nfe_casar(text), public.cot_nfe_conferir(text), public.cot_nfe_cnpj_trocar(text, bigint),
  public.cot_nfe_email(text), public.cot_pedido_antes_de_apagar() from service_role;
revoke execute on function public.cot_registrar_mudanca(text, text, jsonb, jsonb),
  public.cot_whatsapp_normalizar(text), public.cot_codigo_novo(text),
  public.cot_contar_aguardando(bigint, bigint), public.lista_incluido(numeric, boolean, jsonb, text) from service_role;
revoke execute on function public.cot_aplicar_cadastros(jsonb) from service_role;
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
  public.cot_cancelar(bigint), public.cot_confirmar_envio(bigint), public.cot_congelar(bigint),
  public.cot_dados_envio(bigint), public.cot_definir_nota(bigint, text), public.cot_definir_vendedor(bigint, bigint),
  public.cot_descongelar(bigint), public.cot_desfazer_pedido(bigint),
  public.cot_dispensar(bigint), public.cot_gravar_pedido(bigint, jsonb), public.cot_liberar_loja(bigint),
  public.cot_marcar_item(bigint, boolean), public.cot_marcas_semana(bigint), public.cot_nova_versao(bigint),
  public.cot_preparar(bigint), public.cot_responder_admin(bigint, uuid, jsonb, jsonb, text),
  public.cot_trocar_codigo(bigint), public.cot_voltar_a_cotar(bigint),
  public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  public.cot_painel_economia(date, date), public.cot_historico_item(bigint, date, date),
  public.cot_ia_iniciar(bigint, integer, integer, boolean), public.cot_ia_concluir(bigint, jsonb),
  public.cot_ia_gravada(bigint, uuid, jsonb), public.cot_ia_status(), public.cot_ia_ligar(boolean),
  public.cot_pedidos_a_receber(), public.cot_registrar_recebimento(bigint, uuid, timestamptz, jsonb, text, text),
  public.cot_desfazer_recebimento(bigint), public.cot_definir_entrega(bigint, date),
  public.cot_marcar_entrada(bigint, boolean), public.cot_nfe_vincular(text, bigint), public.cot_nfe_desvincular(text),
  public.cot_desempenho_vendedores(), public.cot_cnpj_mover(text, bigint), public.cot_cnpj_remover(text),
  -- Fase 2, C1: cadastros no App (admin)
  public.cot_vendedor_salvar(jsonb), public.cot_vendedor_excluir(bigint),
  public.cot_grafia_salvar(text, bigint), public.cot_grafia_remover(text),
  public.cot_feriado_salvar(date, text), public.cot_feriado_remover(date),
  public.cot_definir_nome(bigint, text), public.cot_definir_litro(bigint, boolean),
  public.cot_confirmar_kg_por_litro(bigint, numeric),
  public.cot_confirmar_fator(bigint, bigint, text, numeric, text, text),
  public.cot_tirar_fator(bigint), public.cot_catalogo_soltar_vendedor(bigint),
  public.cot_produtos_cadastro(), public.cot_fornecedores_sem_vendedor(integer),
  -- Fase 2, C2: regras da lista e fatores a confirmar (admin)
  public.lista_regra_salvar(bigint, text, text), public.lista_regra_remover(bigint),
  public.cot_fatores_a_confirmar(), public.cot_descartar_fator(bigint, bigint, numeric)
  to authenticated;
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
  public.cot_exportar_cadastros()
  to service_role;
