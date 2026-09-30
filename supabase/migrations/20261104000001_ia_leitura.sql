-- App de Compras Spazio — Fase 2, Bloco B: leitura com IA da resposta do vendedor (texto, print, áudio).
-- Desenho: compra-semanal/docs/DESIGN-fase-2.md, seção 4 (B.6) — a fonte da verdade. Contrato 1B: docs/contrato-1b.md.
-- Quinta migration da Fase 2 (Onda 3), depois do E1, da D1, da C1 e da D2 (§8.2). Só entra com o piloto fechado (G3).
-- A IA NASCE DESLIGADA (cot_ia_config.ligada = false, liberada_em null): só liga depois da avaliação com respostas
-- reais (B.14.6), quando o Ivan grava liberada_em por SQL. A leitura só PROPÕE; quem grava é o App, no toque em Gravar,
-- com o login do Ivan (origem nova 'ivan_ia' via cot_responder_admin).
-- Segue o padrão das outras: create or replace, security definer, set search_path = public, bloco de permissões completo
-- no fim. Relógio de negócio = cot_agora(); fuso sempre explícito (cot_data_local, cot_instante), nunca o da sessão.
--
-- base: cot_responder_admin(bigint,uuid,jsonb,jsonb,text) reescrita — corpo IDÊNTICO ao da 1B, só a lista de origens
-- ganha 'ivan_ia' (B.6.1; teste fase2-base.test.ts X2 compara os dois corpos). Nenhuma outra função da 1B/E1 muda.

-- ================= Origem nova 'ivan_ia' nos três CHECK (B.6.1)

alter table public.cot_itens drop constraint cot_itens_origem_check;
alter table public.cot_itens add constraint cot_itens_origem_check
  check (origem in ('vendedor', 'ivan_digitou', 'ivan_colou', 'ivan_ia'));
alter table public.cot_envios drop constraint cot_envios_origem_check;
alter table public.cot_envios add constraint cot_envios_origem_check
  check (origem in ('vendedor', 'ivan_digitou', 'ivan_colou', 'ivan_ia'));
alter table public.cot_cotacoes drop constraint cot_cotacoes_gerais_origem_check;
alter table public.cot_cotacoes add constraint cot_cotacoes_gerais_origem_check
  check (gerais_origem in ('vendedor', 'ivan_digitou', 'ivan_colou', 'ivan_ia'));

-- cot_responder_admin: corpo idêntico ao da 1B; a única mudança é 'ivan_ia' na lista de origens aceitas (B.6.1).
create or replace function public.cot_responder_admin(p_cotacao bigint, p_envio_id uuid, p_itens jsonb, p_gerais jsonb,
                                                      p_origem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c cot_cotacoes; v_env cot_envios; v_fmt text; v_it jsonb; v_r jsonb; v_itens jsonb := '[]'::jsonb; v_ger jsonb;
  v_gravou boolean := false; v_res jsonb; v_agora timestamptz := cot_agora();
begin
  perform exigir_admin();
  if p_origem is null or p_origem not in ('ivan_digitou', 'ivan_colou', 'ivan_ia') then
    raise exception 'origem inválida';
  end if;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if p_envio_id is not null then
    select * into v_env from cot_envios where envio_id = p_envio_id;
    if found then
      if v_env.cotacao_id = c.id then
        return v_env.resultado || jsonb_build_object('reenvio', true);
      end if;
      raise exception 'envio de outra cotação';
    end if;
  end if;
  if not (c.status in ('pronta', 'enviada', 'respondida') or (c.status = 'fechada' and c.resultado is null)) then
    raise exception 'esta cotação não aceita mais respostas';
  end if;
  v_fmt := cot_checar_formato(p_envio_id, p_itens, p_gerais);
  if v_fmt is not null then
    raise exception 'envio inválido: %', v_fmt;
  end if;
  for v_it in select x from jsonb_array_elements(p_itens) with ordinality as t(x, n) order by n loop
    v_r := cot_aplicar_resposta(c.id, v_it, p_origem);
    v_gravou := v_gravou or v_r ->> 'resultado' = 'gravado';
    v_itens := v_itens || jsonb_build_array(v_r);
  end loop;
  if p_gerais is not null and jsonb_typeof(p_gerais) <> 'null' then
    v_ger := cot_aplicar_gerais(c.id, p_gerais, p_origem);
    v_gravou := v_gravou or v_ger ->> 'resultado' = 'gravado';
  end if;
  if v_gravou then
    update cot_cotacoes
       set enviada_em = coalesce(enviada_em, v_agora),
           status = case when status in ('pronta', 'enviada') then 'respondida' else status end
     where id = c.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'recebido_em', cot_iso(v_agora), 'itens', v_itens, 'gerais', v_ger);
  insert into cot_envios (envio_id, cotacao_id, origem, recebido_em, resultado)
  values (p_envio_id, c.id, p_origem, v_agora, v_res);
  return v_res || jsonb_build_object('reenvio', false);
end $$;

-- ================= Tabelas (B.6.2)

-- Configuração da leitura com IA (uma linha só, id = 1). O banco NÃO guarda a chave da Anthropic; ela fica só nos
-- Secrets das Edge Functions. Modelo, esforço e limites mudam só por SQL, a pedido do Ivan. RLS ligado, nenhuma
-- política: authenticated não lê (o App lê pelo cot_ia_status).
create table public.cot_ia_config (
  id             int primary key check (id = 1),
  ligada         boolean not null default false,
  liberada_em    timestamptz,                        -- gravada por SQL quando a avaliação B.14.6 passou (com o OK do Ivan)
  modelo         text not null default 'claude-opus-5'
                   check (modelo in ('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5')),
  esforco        text not null default 'low' check (esforco in ('low', 'medium', 'high')),
  limite_dia     int not null default 30 check (limite_dia between 0 and 200),
  limite_mes     int not null default 150 check (limite_mes between 0 and 2000),
  mudado_por     text references usuarios (email),
  atualizado_em  timestamptz
);
insert into public.cot_ia_config (id) values (1);   -- nasce desligada (defaults acima)

-- Uma linha por toque em "Ler com IA" que passou pelo banco. A proposta é a saída já conferida, com trechos, NUNCA o
-- texto inteiro nem a imagem; apagada (null) aos 180 dias. RLS ligado; só o admin lê; escrita só pelas funções.
create table public.cot_leituras_ia (
  id                 bigint generated always as identity primary key,
  cotacao_id         bigint not null references cot_cotacoes (id) on delete cascade,
  criado_por         text not null references usuarios (email),
  criado_em          timestamptz not null,
  caracteres         int not null check (caracteres between 0 and 8000),
  imagens            int not null check (imagens between 0 and 3),
  transcricao        boolean not null,
  status             text not null default 'em_andamento' check (status in ('em_andamento', 'ok', 'erro')),
  erro               text check (erro in ('desligada', 'recusa', 'incompleta', 'invalida', 'tempo', 'ocupada',
                                          'sem_credito', 'chave', 'api')),
  modelo             text,
  tokens_entrada     int,
  tokens_saida       int,
  custo_usd          numeric(10, 5),
  duracao_ms         int,
  itens_propostos    int,
  itens_incertos     int,
  proposta           jsonb,               -- só a proposta conferida, com trechos; nunca o texto/imagem; apagada aos 180 dias
  concluida_em       timestamptz,
  envio_id           uuid references cot_envios (envio_id) on delete set null,
  gravada_em         timestamptz,
  itens_gravados     int,
  itens_corrigidos   int,
  itens_descartados  int,
  itens_discordantes int,
  constraint cot_leituras_ia_erro_status check (erro is null or status = 'erro')
);
create index cot_leituras_ia_cotacao on public.cot_leituras_ia (cotacao_id);
create index cot_leituras_ia_criado on public.cot_leituras_ia (criado_em);

-- ================= View de uso (B.6.2), para a medição do piloto e a linha do consolidado (B.9)

create view public.cot_ia_uso with (security_invoker = true) as
select c.semana_id,
       count(*)                                              as leituras,
       count(*) filter (where l.status = 'ok')              as ok,
       count(*) filter (where l.status = 'erro')            as erros,
       count(*) filter (where l.erro = 'recusa')            as recusas,
       count(*) filter (where l.imagens > 0)                as com_print,
       count(*) filter (where l.transcricao)                as transcricoes,
       coalesce(sum(l.itens_propostos), 0)                  as itens_propostos,
       coalesce(sum(l.itens_gravados), 0)                   as itens_gravados,
       coalesce(sum(l.itens_corrigidos), 0)                 as itens_corrigidos,
       coalesce(sum(l.custo_usd), 0)                        as custo_usd
  from public.cot_leituras_ia l
  join public.cot_cotacoes c on c.id = l.cotacao_id
 group by c.semana_id;

-- ================= RLS (leitura só do admin; escrita só pelas funções)

alter table public.cot_ia_config enable row level security;   -- nenhuma política: authenticated não lê
alter table public.cot_leituras_ia enable row level security;
create policy cot_leituras_ia_ler on public.cot_leituras_ia for select to authenticated using (eh_admin());

-- ================= Funções (B.6.3)

-- número inteiro >= 0 num jsonb (ausente/null valem: melhor esforço), interno, sem grant.
create or replace function public.cot_ia_inteiro_nn(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v is null or jsonb_typeof(v) = 'null'
      or (jsonb_typeof(v) = 'number' and (v::text)::numeric >= 0 and (v::text)::numeric = floor((v::text)::numeric))
$$;

-- uso da IA (hoje, mês e custo do mês), montado chave por chave; interno, sem grant.
create or replace function public.cot_ia_uso_json(p_config cot_ia_config) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hoje', (select count(*) from cot_leituras_ia
              where criado_em >= cot_instante(cot_data_local(cot_agora()), time '00:00')),
    'limite_dia', p_config.limite_dia,
    'mes', (select count(*) from cot_leituras_ia
             where criado_em >= cot_instante(date_trunc('month', cot_data_local(cot_agora()))::date, time '00:00')),
    'limite_mes', p_config.limite_mes,
    'custo_mes_usd', (select coalesce(sum(custo_usd), 0) from cot_leituras_ia
                       where criado_em >= cot_instante(date_trunc('month', cot_data_local(cot_agora()))::date, time '00:00')))
$$;

-- Inicia uma leitura: confere admin, IA ligada, cotação, entrada e limites; ANTES de o modelo ser chamado (a Edge
-- Function só chama a Anthropic depois desta função devolver ok). Devolve a lista da cotação por LISTA BRANCA (só o que
-- pode ir à API, B.10): número, nome, qtd, unidade, rótulo, embalagem/fator confirmados, nota e descrição/código do
-- fornecedor — nunca ref_*, avisos, qtd_sugerida, custo, telefone, código do link, nome/empresa do vendedor.
create or replace function public.cot_ia_iniciar(p_cotacao bigint, p_caracteres int, p_imagens int, p_transcricao boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg cot_ia_config; c cot_cotacoes; v_id bigint; v_dia int; v_mes int;
  v_inicio_dia timestamptz := cot_instante(cot_data_local(cot_agora()), time '00:00');
  v_inicio_mes timestamptz := cot_instante(date_trunc('month', cot_data_local(cot_agora()))::date, time '00:00');
  v_itens jsonb;
begin
  perform exigir_admin();
  select * into cfg from cot_ia_config where id = 1 for update;  -- trava: duas chamadas juntas não passam do limite
  if not cfg.ligada then
    raise exception 'a leitura com IA está desligada';
  end if;
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if not (c.status in ('pronta', 'enviada', 'respondida') or (c.status = 'fechada' and c.resultado is null)) then
    raise exception 'esta cotação não aceita mais respostas';
  end if;
  if p_caracteres is null or p_caracteres < 0 or p_caracteres > 8000
     or p_imagens is null or p_imagens < 0 or p_imagens > 3
     or (coalesce(p_caracteres, 0) = 0 and coalesce(p_imagens, 0) = 0) then
    raise exception 'leitura inválida';
  end if;
  select count(*) into v_dia from cot_leituras_ia where criado_em >= v_inicio_dia;
  if v_dia >= cfg.limite_dia then
    raise exception 'limite de leituras com IA de hoje atingido (%)', cfg.limite_dia;
  end if;
  select count(*) into v_mes from cot_leituras_ia where criado_em >= v_inicio_mes;
  if v_mes >= cfg.limite_mes then
    raise exception 'limite de leituras com IA do mês atingido (%)', cfg.limite_mes;
  end if;
  -- limpeza: a proposta com mais de 180 dias é apagada (o resto da linha fica, para a medição)
  update cot_leituras_ia set proposta = null
   where proposta is not null and criado_em < cot_agora() - interval '180 days';
  insert into cot_leituras_ia (cotacao_id, criado_por, criado_em, caracteres, imagens, transcricao, modelo)
  values (c.id, email_atual(), cot_agora(), p_caracteres, p_imagens, coalesce(p_transcricao, false), cfg.modelo)
  returning id into v_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'numero', x.numero, 'nome', x.nome, 'qtd', x.qtd, 'unidade', x.unidade, 'rotulo', x.rotulo,
           'vende_por_litro', x.vende_por_litro,
           'embalagem', case when x.fator_confirmado then x.embalagem end,
           'fator', case when x.fator_confirmado then x.fator end,
           'nota', x.nota_vendedor,
           'descricao_fornecedor', x.descricao_fornecedor, 'codigo_fornecedor', x.codigo_fornecedor)
         order by x.numero), '[]'::jsonb)
    into v_itens
    from cot_itens x where x.cotacao_id = c.id and x.incluido and x.numero is not null;
  return jsonb_build_object(
    'leitura_id', v_id, 'modelo', cfg.modelo, 'esforco', cfg.esforco,
    'hoje', cot_data_txt(cot_data_local(cot_agora())), 'dia_semana', cot_dia_curto(cot_data_local(cot_agora())),
    'versao', c.versao, 'itens', v_itens, 'uso', cot_ia_uso_json(cfg));
end $$;

-- Conclui a leitura (melhor esforço da Edge Function): grava o resultado e a proposta conferida.
create or replace function public.cot_ia_concluir(p_leitura bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  l cot_leituras_ia; v_status text; v_erro text; v_modelo text;
begin
  perform exigir_admin();
  select * into l from cot_leituras_ia where id = p_leitura and criado_por = email_atual() and status = 'em_andamento'
    for update;
  if not found then
    raise exception 'leitura não encontrada ou já concluída';
  end if;
  v_status := p ->> 'status';
  v_erro := p ->> 'erro';
  v_modelo := p ->> 'modelo';
  if v_status is null or v_status not in ('ok', 'erro')
     or (v_status = 'erro' and (v_erro is null or v_erro not in ('desligada', 'recusa', 'incompleta', 'invalida',
                                                                  'tempo', 'ocupada', 'sem_credito', 'chave', 'api')))
     or (v_status = 'ok' and v_erro is not null)
     or (v_status = 'ok' and (p -> 'proposta') is null)
     or v_modelo is null or v_modelo not in ('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5')
     or not cot_ia_inteiro_nn(p -> 'tokens_entrada') or not cot_ia_inteiro_nn(p -> 'tokens_saida')
     or not cot_ia_inteiro_nn(p -> 'duracao_ms') or not cot_ia_inteiro_nn(p -> 'itens_propostos')
     or not cot_ia_inteiro_nn(p -> 'itens_incertos')
     or (p ? 'custo_usd' and (jsonb_typeof(p -> 'custo_usd') <> 'number' or (p ->> 'custo_usd')::numeric < 0))
     or (v_status = 'ok' and (jsonb_typeof(p -> 'proposta') <> 'object' or pg_column_size(p -> 'proposta') > 200000)) then
    raise exception 'conclusão inválida';
  end if;
  update cot_leituras_ia
     set status = v_status, erro = v_erro, modelo = v_modelo,
         tokens_entrada = (p ->> 'tokens_entrada')::int, tokens_saida = (p ->> 'tokens_saida')::int,
         duracao_ms = (p ->> 'duracao_ms')::int, custo_usd = (p ->> 'custo_usd')::numeric,
         itens_propostos = (p ->> 'itens_propostos')::int, itens_incertos = (p ->> 'itens_incertos')::int,
         proposta = case when v_status = 'ok' then p -> 'proposta' end, concluida_em = cot_agora()
   where id = l.id;
end $$;

-- Registra a gravação por IA (melhor esforço, depois do toque em Gravar do App).
create or replace function public.cot_ia_gravada(p_leitura bigint, p_envio_id uuid, p_resumo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare l cot_leituras_ia; e cot_envios;
begin
  perform exigir_admin();
  select * into l from cot_leituras_ia where id = p_leitura and criado_por = email_atual() and status = 'ok' for update;
  if not found then
    raise exception 'leitura não encontrada ou não concluída';
  end if;
  select * into e from cot_envios where envio_id = p_envio_id;
  if not found or e.cotacao_id <> l.cotacao_id or e.origem <> 'ivan_ia' then
    raise exception 'envio não confere com a leitura';
  end if;
  if l.envio_id is not null then
    if l.envio_id = p_envio_id then
      return;                                  -- o mesmo envio de novo não muda nada (idempotente)
    end if;
    raise exception 'leitura já gravada';
  end if;
  if not cot_ia_inteiro_nn(p_resumo -> 'gravados') or not cot_ia_inteiro_nn(p_resumo -> 'corrigidos')
     or not cot_ia_inteiro_nn(p_resumo -> 'descartados') or not cot_ia_inteiro_nn(p_resumo -> 'discordancias') then
    raise exception 'resumo inválido';
  end if;
  update cot_leituras_ia
     set envio_id = p_envio_id, gravada_em = cot_agora(),
         itens_gravados = (p_resumo ->> 'gravados')::int, itens_corrigidos = (p_resumo ->> 'corrigidos')::int,
         itens_descartados = (p_resumo ->> 'descartados')::int, itens_discordantes = (p_resumo ->> 'discordancias')::int
   where id = l.id;
end $$;

-- Estado da IA para o cartão "Ligar e desligar" do App. O banco não tem a chave da Anthropic; o status não diz nada dela.
create or replace function public.cot_ia_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg cot_ia_config;
begin
  perform exigir_admin();
  select * into cfg from cot_ia_config where id = 1;
  return jsonb_build_object(
    'ligada', cfg.ligada, 'liberada', cfg.liberada_em is not null, 'liberada_em', cot_iso(cfg.liberada_em),
    'modelo', cfg.modelo, 'uso', cot_ia_uso_json(cfg));
end $$;

-- Liga ou desliga a IA. Ligar só vale depois da avaliação com respostas reais (liberada_em gravado por SQL). Desligar
-- sempre vale.
create or replace function public.cot_ia_ligar(p_ligada boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg cot_ia_config;
begin
  perform exigir_admin();
  if p_ligada is null then
    raise exception 'informe se a leitura com IA fica ligada';
  end if;
  select * into cfg from cot_ia_config where id = 1 for update;
  if p_ligada and cfg.liberada_em is null then
    raise exception 'A leitura com IA ainda não passou na avaliação com respostas reais.';
  end if;
  update cot_ia_config set ligada = p_ligada, mudado_por = email_atual(), atualizado_em = cot_agora() where id = 1;
  return cot_ia_status();
end $$;

-- ================= Permissões (bloco completo, no padrão da 20261001000001 / E1)

-- 1. Tabelas: o Supabase dá por padrão a anon e authenticated todos os privilégios em toda tabela e sequência nova de
-- public. Leitura pela RLS; escrita só pelas funções.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- 2. Tabelas e views cot_*: nada para anon; o admin lê (a RLS restringe a eh_admin()); limites, avisos, cadastros
-- aplicados e cot_ia_config só a chave de serviço. B acrescenta cot_leituras_ia (admin lê) e a view cot_ia_uso.
revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
              public.cot_categorias, public.cot_ia_config, public.cot_leituras_ia,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
              public.cot_ia_uso
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_categorias, public.cot_leituras_ia,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
                public.cot_ia_uso
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
             public.cot_categorias, public.cot_ia_config, public.cot_leituras_ia,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
             public.cot_ia_uso
  to service_role;

-- 3. Funções: lista completa (1A + 1B + E1 + as 5 novas de B para authenticated). As internas ficam sem grant.
revoke execute on all functions in schema public from public, anon, authenticated;
-- cot_m_json (E1) e as internas da IA (cot_ia_uso_json, cot_ia_inteiro_nn) ficam sem grant, nem para o service_role.
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
revoke execute on function public.cot_ia_uso_json(cot_ia_config), public.cot_ia_inteiro_nn(jsonb) from service_role;
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
  -- Fase 1B: aba Cotações (admin), etiquetas (usuário ativo) e a prévia do vendedor
  public.cot_cancelar(bigint), public.cot_confirmar_envio(bigint), public.cot_congelar(bigint),
  public.cot_dados_envio(bigint), public.cot_definir_nota(bigint, text), public.cot_definir_vendedor(bigint, bigint),
  public.cot_descongelar(bigint), public.cot_desfazer_pedido(bigint),
  public.cot_dispensar(bigint), public.cot_gravar_pedido(bigint, jsonb), public.cot_liberar_loja(bigint),
  public.cot_marcar_item(bigint, boolean), public.cot_marcas_semana(bigint), public.cot_nova_versao(bigint),
  public.cot_preparar(bigint), public.cot_responder_admin(bigint, uuid, jsonb, jsonb, text),
  public.cot_trocar_codigo(bigint), public.cot_voltar_a_cotar(bigint),
  public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  -- Fase 2, E1: painel de economia (admin)
  public.cot_painel_economia(date, date), public.cot_historico_item(bigint, date, date),
  -- Fase 2, B: leitura com IA (admin)
  public.cot_ia_iniciar(bigint, integer, integer, boolean), public.cot_ia_concluir(bigint, jsonb),
  public.cot_ia_gravada(bigint, uuid, jsonb), public.cot_ia_status(), public.cot_ia_ligar(boolean)
  to authenticated;
-- A página do vendedor (chave anônima + código da cotação): só estas duas (B não muda anon).
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb) to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_aplicar_cadastros(jsonb)
  to service_role;

-- ================= Fase 2, Bloco D: grants reaplicados por cima (INTEGRAÇÃO ENTRE FRENTES).
-- Esta migration é a última por nome de arquivo hoje, e §8.6 manda a última reaplicar a lista COMPLETA — que
-- inclui a D (20261015000002_recebimento_nfe, aplicada antes desta). O `revoke execute on all functions` acima
-- tira o grant das funções da D; este bloco o devolve, além dos grants de leitura das tabelas/views da D. Foi
-- acrescentado pela frente da D; a frente da B deve mantê-lo (ou incorporá-lo à sua lista) ao finalizar. Sem a
-- migration da D no disco, este bloco falha — por isso ele fica DEPOIS do bloco da B, e as duas migrations
-- entram juntas na branch fase-2.
grant select on public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
                public.cot_nfe_leituras, public.cot_conferencia to authenticated;
grant all on public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
             public.cot_nfe_leituras, public.cot_conferencia, public.cot_desempenho to service_role;
revoke execute on function public.cot_nfe_exigir_robo(text), public.cot_nfe_vendedor(text, text),
  public.cot_nfe_casar(text), public.cot_nfe_conferir(text), public.cot_nfe_cnpj_trocar(text, bigint),
  public.cot_nfe_email(text), public.cot_pedido_antes_de_apagar() from service_role;
grant execute on function
  public.cot_pedidos_a_receber(), public.cot_registrar_recebimento(bigint, uuid, timestamptz, jsonb, text, text),
  public.cot_desfazer_recebimento(bigint), public.cot_definir_entrega(bigint, date),
  public.cot_marcar_entrada(bigint, boolean), public.cot_nfe_vincular(text, bigint), public.cot_nfe_desvincular(text),
  public.cot_desempenho_vendedores(), public.cot_cnpj_mover(text, bigint), public.cot_cnpj_remover(text)
  to authenticated;
grant execute on function public.cot_nfe_sincronizar(text, jsonb),
  public.cot_nfe_marcar_notificado(text, text, text, text), public.cot_nfe_marcar_lancadas(text, jsonb)
  to anon;
