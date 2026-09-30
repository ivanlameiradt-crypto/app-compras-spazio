-- App de Compras Spazio — Fase 2, Bloco E1: painel de economia.
-- Desenho: compra-semanal/docs/DESIGN-fase-2.md, seção 7 (E.4.1, E.4.2, E.4.3, E.4.5) — a fonte da verdade.
-- Primeira migration da Fase 2 (Onda 1). Só leitura: cria cot_categorias, a view cot_economia_linhas
-- (a "linha de pedido única" da Fase 2, que a conferência da NF-e e o histórico da C2 vão ler), e as duas
-- funções do painel do admin (cot_painel_economia, cot_historico_item). NÃO reescreve nenhuma função da 1B
-- (o md5(prosrc) de toda função existente é igual depois desta migration; teste fase2-base.test.ts, X2).
-- Tudo em public com prefixo cot_; RLS ligado; escrita só pelas funções (nenhuma escrita neste bloco).
-- Relógio de negócio = cot_agora(); fuso sempre explícito (nunca o TimeZone da sessão), pela cot_data_local.

-- base: nenhuma função reescrita (E.9 teste 2 / §10.3 X2).

-- ================= Tabelas

-- Categoria fina (opcional). Vazia = "Bebidas" ou "Insumos" pelo itens_semana.bebida (cot_economia_linhas).
-- Só é gravada pelo App (cot_definir_categoria, C.4.5), se o Ivan quiser categoria fina; o E1 só lê.
create table public.cot_categorias (
  produto_id   bigint primary key,
  categoria    text not null check (char_length(categoria) between 1 and 30 and categoria !~ '[[:cntrl:]]'),
  aplicado_em  timestamptz not null default now()
);

-- ================= View (security_invoker: a RLS de admin de cot_pedidos vale para quem lê)

-- Uma linha por linha de pedido confirmado (jsonb_to_recordset de cot_pedidos.itens). É a definição ÚNICA de
-- "linha de pedido" e de "comparável" (preço convertido não nulo e item com referência ok e último preço > 0)
-- da Fase 2. Invariante (testado): somando as linhas de uma semana com a fórmula M, o resultado é idêntico à
-- linha da cot_economia. O pedido desfeito sai sozinho (a linha de cot_pedidos é apagada).
create view public.cot_economia_linhas with (security_invoker = true) as
select s.id as semana_id, s.data_referencia, s.status as semana_status,
       date_trunc('month', s.data_referencia)::date as mes,        -- mês = o da segunda-feira da semana
       c.id as cotacao_id, c.vendedor_id, c.versao, p.confirmado_em,
       l.produto_id, l.numero,
       coalesce(isem.produto, i.nome) as produto, isem.unidade,
       coalesce(cat.categoria, case when isem.bebida then 'Bebidas' else 'Insumos' end) as categoria,
       l.qtd, l.base, l.embalagens, l.fator, l.preco_combinado, l.preco_convertido, l.marca,
       i.ref_preco, i.ref_data, i.ref_situacao,
       k.comparavel,
       case when k.comparavel then l.qtd * l.preco_convertido end as valor_pedido,   -- sem arredondar
       case when k.comparavel then l.qtd * i.ref_preco end as valor_ultimo,
       case when k.comparavel then null
            when l.preco_convertido is null then 'sem_conversao'
            when i.ref_situacao = 'antiga' then 'ultimo_preco_antigo'
            else 'sem_referencia' end as motivo_sem_comparacao
  from public.cot_pedidos p
  join public.cot_cotacoes c on c.id = p.cotacao_id
  join public.semanas s on s.id = c.semana_id
  cross join lateral jsonb_to_recordset(p.itens) as l(produto_id bigint, numero int, qtd numeric, base text,
       embalagens numeric, fator numeric, preco_combinado numeric, preco_convertido numeric, marca text)
  left join public.cot_itens i on i.cotacao_id = c.id and i.produto_id = l.produto_id
  left join public.itens_semana isem on isem.id = i.item_semana_id
  left join public.cot_categorias cat on cat.produto_id = l.produto_id
  cross join lateral (select coalesce(l.preco_convertido is not null and i.ref_situacao = 'ok'
                                      and i.ref_preco > 0, false) as comparavel) k;

-- ================= RLS: leitura só do admin; nenhuma política de escrita (o E1 não escreve)
alter table public.cot_categorias enable row level security;
create policy cot_categorias_ler on public.cot_categorias for select to authenticated using (eh_admin());

-- ================= Métricas M (interna, sem grant; revoke explícito também do service_role, §2.2 regra 6a)

-- Bloco M do desenho (E.4.2): as métricas de qualquer grupo de linhas, já com diferença e percentual, num
-- objeto jsonb. Recebe os agregados já somados (totais arredondados a 2 casas). Reaproveitada pelo painel em
-- cada grupo (total, semana, mês, vendedor, categoria, item) para que a regra seja escrita uma vez só.
create or replace function public.cot_m_json(p_pedidos bigint, p_itens bigint, p_comparados bigint,
  p_acima bigint, p_total_pedido numeric, p_total_ultimo numeric) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'pedidos', p_pedidos::int, 'itens', p_itens::int, 'comparados', p_comparados::int,
    'sem_comparacao', (p_itens - p_comparados)::int, 'acima', p_acima::int,
    'total_pedido', p_total_pedido, 'total_ultimo', p_total_ultimo,
    'diferenca', round(p_total_pedido - p_total_ultimo, 2),
    'pct', case when p_total_ultimo > 0 then round(p_total_pedido / p_total_ultimo - 1, 4) end)
$$;

-- ================= Funções do painel (admin)

-- Painel de economia do período (E.4.3). Devolve tudo já somado, num JSON só. A regra de "comparável" é a da
-- cot_economia (via cot_economia_linhas), então painel, Resumo e Histórico nunca discordam. As somas por grupo
-- podem diferir do total em R$ 0,01 por grupo (arredondamento; o rodapé da tela diz isso).
create or replace function public.cot_painel_economia(p_de date default null, p_ate date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ate date; v_de date; v_inicio date; v_res jsonb;
begin
  perform exigir_admin();
  v_ate := coalesce(p_ate, cot_data_local(cot_agora()));
  select min(data_referencia) into v_inicio from cot_economia;
  v_de := coalesce(p_de, v_inicio, v_ate);
  if v_de > v_ate then
    raise exception 'período inválido';
  end if;
  if v_ate - v_de > 400 then
    raise exception 'período maior que 400 dias';
  end if;

  with l as (
    select * from cot_economia_linhas where data_referencia between v_de and v_ate
  ),
  -- Preço no SisChef (todas as compras): a foto mais nova de cada data de compra, nas semanas do período (+6).
  compras as (
    select distinct on (i.produto_id, i.data_ultima_compra)
           i.produto_id, i.produto, i.unidade, i.data_ultima_compra as data,
           i.preco_estimado as preco, i.custo_medio, i.fornecedor_ultima as fornecedor
      from itens_semana i join semanas s on s.id = i.semana_id
     where s.data_referencia between v_de and v_ate + 6
       and i.preco_estimado > 0 and i.data_ultima_compra is not null
     order by i.produto_id, i.data_ultima_compra, s.data_referencia desc
  ),
  -- fora de [0,5; 2] do custo médio sai (fardo dividido, UN DIFERE), pela mesma regra do sem_referencia
  compras_ok as (
    select * from compras
     where not (custo_medio > 0 and (preco / custo_medio < 0.5 or preco / custo_medio > 2))
  ),
  sischef as (
    select produto_id,
           (array_agg(produto order by data desc))[1] as produto,
           (array_agg(unidade order by data desc))[1] as unidade,
           count(*)::int as compras,
           (array_agg(data order by data asc))[1] as d_prim,
           (array_agg(preco order by data asc))[1] as p_prim,
           (array_agg(fornecedor order by data asc))[1] as f_prim,
           (array_agg(data order by data desc))[1] as d_ult,
           (array_agg(preco order by data desc))[1] as p_ult,
           (array_agg(fornecedor order by data desc))[1] as f_ult
      from compras_ok group by produto_id
  ),
  -- só com 2 compras ou mais e a compra mais nova dentro do período (a mais antiga pode ser base de antes)
  sischef_var as (
    select *, round(p_ult / p_prim - 1, 4) as variacao
      from sischef where compras >= 2 and d_ult >= v_de and p_prim > 0
  )
  select jsonb_build_object(
    'de', cot_data_txt(v_de),
    'ate', cot_data_txt(v_ate),
    'inicio', case when v_inicio is not null then cot_data_txt(v_inicio) end,
    'total', (select cot_m_json(count(distinct cotacao_id), count(*),
                       count(*) filter (where comparavel),
                       count(*) filter (where comparavel and preco_convertido > ref_preco),
                       round(coalesce(sum(valor_pedido), 0), 2), round(coalesce(sum(valor_ultimo), 0), 2))
                from l),
    'desde_inicio', (select jsonb_build_object('diferenca', round(coalesce(sum(diferenca), 0), 2),
                              'semanas', count(*)::int) from cot_economia),
    -- semanas: da própria cot_economia (as com pedido no período); acumulado no período e desde o piloto
    'semanas', coalesce((
        select jsonb_agg(
          jsonb_build_object('semana_id', semana_id, 'data_referencia', cot_data_txt(data_referencia),
            'status', status, 'acumulado', round(acum_periodo, 2), 'acumulado_desde_inicio', round(acum_inicio, 2))
          || cot_m_json(pedidos, itens, comparados, acima, total_pedido, total_ultimo)
          order by data_referencia)
        from (
          select e.semana_id, e.data_referencia, s.status, e.pedidos, e.itens_pedido as itens,
                 e.itens_com_referencia as comparados,
                 (select count(*) filter (where x.comparavel and x.preco_convertido > x.ref_preco)
                    from cot_economia_linhas x where x.semana_id = e.semana_id)::int as acima,
                 e.total_pedido, e.total_ultimo,
                 sum(e.diferenca) over (order by e.data_referencia rows between unbounded preceding and current row) as acum_inicio,
                 sum(case when e.data_referencia between v_de and v_ate then e.diferenca else 0 end)
                   over (order by e.data_referencia rows between unbounded preceding and current row) as acum_periodo
            from cot_economia e join semanas s on s.id = e.semana_id
        ) sx where data_referencia between v_de and v_ate), '[]'::jsonb),
    'meses', coalesce((
        select jsonb_agg(jsonb_build_object('mes', cot_data_txt(mes))
                 || cot_m_json(pedidos, itens, comparados, acima, tp, tu) order by mes)
        from (select mes, count(distinct cotacao_id) as pedidos, count(*) as itens,
                     count(*) filter (where comparavel) as comparados,
                     count(*) filter (where comparavel and preco_convertido > ref_preco) as acima,
                     round(coalesce(sum(valor_pedido), 0), 2) as tp, round(coalesce(sum(valor_ultimo), 0), 2) as tu
                from l group by mes) g), '[]'::jsonb),
    'vendedores', coalesce((
        select jsonb_agg(jsonb_build_object('vendedor_id', vendedor_id, 'rotulo', rotulo, 'semanas', semanas)
                 || cot_m_json(pedidos, itens, comparados, acima, tp, tu) order by tp - tu, rotulo)
        from (select li.vendedor_id, cot_rotulo(v.empresa) as rotulo, count(distinct li.semana_id)::int as semanas,
                     count(distinct li.cotacao_id) as pedidos, count(*) as itens,
                     count(*) filter (where li.comparavel) as comparados,
                     count(*) filter (where li.comparavel and li.preco_convertido > li.ref_preco) as acima,
                     round(coalesce(sum(li.valor_pedido), 0), 2) as tp, round(coalesce(sum(li.valor_ultimo), 0), 2) as tu
                from l li join cot_vendedores v on v.id = li.vendedor_id group by li.vendedor_id, v.empresa) g), '[]'::jsonb),
    'categorias', coalesce((
        select jsonb_agg(jsonb_build_object('categoria', categoria)
                 || cot_m_json(pedidos, itens, comparados, acima, tp, tu) order by tp - tu, categoria)
        from (select categoria, count(distinct cotacao_id) as pedidos, count(*) as itens,
                     count(*) filter (where comparavel) as comparados,
                     count(*) filter (where comparavel and preco_convertido > ref_preco) as acima,
                     round(coalesce(sum(valor_pedido), 0), 2) as tp, round(coalesce(sum(valor_ultimo), 0), 2) as tu
                from l group by categoria) g), '[]'::jsonb),
    'itens', coalesce((
        select jsonb_agg(
          jsonb_build_object('produto_id', produto_id, 'produto', produto, 'unidade', unidade, 'categoria', categoria,
            'qtd', qtd, 'preco_primeiro', preco_primeiro, 'preco_ultimo', preco_ultimo,
            'variacao', case when com_preco >= 2 and preco_primeiro > 0 and preco_ultimo > 0
                             then round(preco_ultimo / preco_primeiro - 1, 4) end,
            'pontos', pontos)
          || cot_m_json(pedidos, itens, comparados, acima, tp, tu)
          order by tp - tu, produto)
        from (
          select li.produto_id,
                 (array_agg(li.produto order by li.data_referencia desc))[1] as produto,
                 (array_agg(li.unidade order by li.data_referencia desc))[1] as unidade,
                 (array_agg(li.categoria order by li.data_referencia desc))[1] as categoria,
                 count(distinct li.cotacao_id) as pedidos, count(*) as itens,
                 count(*) filter (where li.comparavel) as comparados,
                 count(*) filter (where li.comparavel and li.preco_convertido > li.ref_preco) as acima,
                 round(coalesce(sum(li.valor_pedido), 0), 2) as tp, round(coalesce(sum(li.valor_ultimo), 0), 2) as tu,
                 sum(li.qtd) as qtd,
                 (array_agg(li.preco_convertido order by li.data_referencia asc)
                    filter (where li.preco_convertido is not null))[1] as preco_primeiro,
                 (array_agg(li.preco_convertido order by li.data_referencia desc)
                    filter (where li.preco_convertido is not null))[1] as preco_ultimo,
                 count(*) filter (where li.preco_convertido is not null) as com_preco,
                 (select coalesce(jsonb_agg(jsonb_build_object('data', cot_data_txt(pt.data_referencia),
                            'vendedor', cot_rotulo(pv.empresa), 'preco', pt.preco_convertido, 'ultimo', pt.ref_preco)
                            order by pt.data_referencia, pt.cotacao_id), '[]'::jsonb)
                    from cot_economia_linhas pt join cot_vendedores pv on pv.id = pt.vendedor_id
                   where pt.produto_id = li.produto_id and pt.data_referencia between v_de and v_ate) as pontos
            from l li group by li.produto_id
        ) g), '[]'::jsonb),
    'sem_comparacao', coalesce((
        select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'produto', produto, 'linhas', linhas,
                 'motivo', motivo) order by produto)
        from (select li.produto_id, (array_agg(li.produto order by li.data_referencia desc))[1] as produto,
                     count(*)::int as linhas,
                     (array_agg(li.motivo_sem_comparacao order by li.data_referencia desc, li.cotacao_id desc))[1] as motivo
                from l li where not li.comparavel group by li.produto_id) g), '[]'::jsonb),
    'sischef', jsonb_build_object(
       'altas', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('produto_id', produto_id, 'produto', produto, 'unidade', unidade,
                     'compras', compras,
                     'primeiro', jsonb_build_object('data', cot_data_txt(d_prim), 'preco', p_prim, 'fornecedor', f_prim),
                     'ultimo', jsonb_build_object('data', cot_data_txt(d_ult), 'preco', p_ult, 'fornecedor', f_ult),
                     'variacao', variacao) as a
              from sischef_var where variacao > 0 order by variacao desc limit 10) t), '[]'::jsonb),
       'quedas', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('produto_id', produto_id, 'produto', produto, 'unidade', unidade,
                     'compras', compras,
                     'primeiro', jsonb_build_object('data', cot_data_txt(d_prim), 'preco', p_prim, 'fornecedor', f_prim),
                     'ultimo', jsonb_build_object('data', cot_data_txt(d_ult), 'preco', p_ult, 'fornecedor', f_ult),
                     'variacao', variacao) as a
              from sischef_var where variacao < 0 order by variacao asc limit 10) t), '[]'::jsonb))
  ) into v_res;
  return v_res;
end $$;

-- Histórico por produto único da Fase 2 (E.4.3): usado na tela Histórico do item e em Cadastros → Produto.
create or replace function public.cot_historico_item(p_produto_id bigint, p_de date default null, p_ate date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ate date; v_de date; v_produto text; v_unidade text; v_bebida boolean; v_res jsonb;
begin
  perform exigir_admin();
  v_ate := coalesce(p_ate, cot_data_local(cot_agora()));
  v_de := coalesce(p_de, v_ate - 365);
  if v_de > v_ate then
    raise exception 'período inválido';
  end if;
  if v_ate - v_de > 731 then
    raise exception 'período maior que 731 dias';
  end if;

  select i.produto, i.unidade, i.bebida into v_produto, v_unidade, v_bebida
    from itens_semana i join semanas s on s.id = i.semana_id
   where i.produto_id = p_produto_id
   order by s.data_referencia desc, i.id desc limit 1;
  if v_produto is null then
    select nome, unidade into v_produto, v_unidade from cot_itens
     where produto_id = p_produto_id order by id desc limit 1;
  end if;

  select jsonb_build_object(
    'produto_id', p_produto_id,
    'produto', v_produto,
    'unidade', v_unidade,
    'categoria', coalesce((select categoria from cot_categorias where produto_id = p_produto_id),
                          case when v_bebida then 'Bebidas' else 'Insumos' end),
    'de', cot_data_txt(v_de), 'ate', cot_data_txt(v_ate),
    -- compras_sischef: a mesma regra do bloco sischef, mas SEM descartar (a fora de [0,5;2] vem com conferir)
    'compras_sischef', coalesce((
        select jsonb_agg(jsonb_build_object('data', cot_data_txt(data), 'preco', preco, 'fornecedor', fornecedor,
                 'conferir', coalesce(custo_medio > 0 and (preco / custo_medio < 0.5 or preco / custo_medio > 2), false))
                 order by data)
        from (select distinct on (i.data_ultima_compra) i.data_ultima_compra as data, i.preco_estimado as preco,
                     i.custo_medio, i.fornecedor_ultima as fornecedor
                from itens_semana i join semanas s on s.id = i.semana_id
               where i.produto_id = p_produto_id and s.data_referencia between v_de and v_ate + 6
                 and i.preco_estimado > 0 and i.data_ultima_compra is not null
               order by i.data_ultima_compra, s.data_referencia desc) c), '[]'::jsonb),
    -- cotacoes: cot_itens_admin com a cotação em pronta/enviada/respondida/fechada, só itens incluídos "tem";
    -- sem conversão → preço null; no_pedido quando a cotação tem linha de pedido do produto
    'cotacoes', coalesce((
        select jsonb_agg(jsonb_build_object('data_referencia', cot_data_txt(s.data_referencia),
                 'vendedor', cot_rotulo(v.empresa), 'versao', c.versao, 'preco', ia.preco_convertido,
                 'delta', ia.delta, 'marca', ia.marca_informada, 'avisos', to_jsonb(ia.avisos_ivan),
                 'no_pedido', exists(select 1 from cot_economia_linhas el
                                      where el.cotacao_id = c.id and el.produto_id = p_produto_id))
                 order by s.data_referencia, c.vendedor_id, c.versao)
        from cot_itens_admin ia
        join cot_cotacoes c on c.id = ia.cotacao_id
        join semanas s on s.id = c.semana_id
        join cot_vendedores v on v.id = c.vendedor_id
       where ia.produto_id = p_produto_id and ia.incluido and ia.estado = 'tem'
         and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
         and s.data_referencia between v_de and v_ate), '[]'::jsonb),
    'pedidos', coalesce((
        select jsonb_agg(jsonb_build_object('data_referencia', cot_data_txt(l.data_referencia),
                 'vendedor', cot_rotulo(v.empresa), 'qtd', l.qtd, 'preco', l.preco_convertido,
                 'preco_combinado', l.preco_combinado, 'base', l.base, 'embalagens', l.embalagens,
                 'fator', l.fator, 'ultimo', l.ref_preco, 'comparavel', l.comparavel, 'marca', l.marca)
                 order by l.data_referencia, l.vendedor_id)
        from cot_economia_linhas l join cot_vendedores v on v.id = l.vendedor_id
       where l.produto_id = p_produto_id and l.data_referencia between v_de and v_ate), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ================= Permissões (bloco completo, no padrão da 20261001000001)

-- 1. Tabelas: o Supabase dá por padrão a anon e authenticated todos os privilégios em toda tabela e sequência
-- nova de public. Leitura pela RLS; escrita só pelas funções.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- 2. Tabelas e views cot_*: nada para anon; o admin lê (a RLS restringe a eh_admin()); limites, avisos e
-- cadastros aplicados só a chave de serviço. E1 acrescenta cot_categorias e a view cot_economia_linhas.
revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
              public.cot_categorias,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_categorias,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
             public.cot_categorias,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas
  to service_role;

-- 3. Funções: lista completa (1A + 1B + as 2 novas do E1). As internas ficam sem grant.
revoke execute on all functions in schema public from public, anon, authenticated;
-- cot_m_json é interna: nem o service_role a executa (§2.2, regra 6a)
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
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
  public.cot_painel_economia(date, date), public.cot_historico_item(bigint, date, date)
  to authenticated;
-- A página do vendedor (chave anônima + código da cotação): só estas duas.
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb) to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_aplicar_cadastros(jsonb)
  to service_role;
