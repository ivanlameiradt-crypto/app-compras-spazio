-- App de Compras Spazio — o app LEMBRA o produto de cada item da nota por FORNECEDOR + CÓD. FOR + UNIDADE DA NOTA (pedido do Ivan, 14/11/2026).
--
-- O QUE MUDA (só acrescenta; nenhuma função existente é alterada, nenhuma tabela nova)
--   1) Coluna cot_nfe.lembrado_recusado (jsonb, nula por padrão): lista dos n de item em que o Ivan TROCOU ou DESFEZ uma associação feita sozinha pelo app.
--      O app nunca mais associa sozinho esses itens daquela nota (nem depois de recarregar).
--   2) cot_nfe_produto_lembrado(p_cnpj): lê as notas JÁ LANÇADAS do fornecedor e devolve, por CÓD. FOR + unidade da nota, o produto que o IVAN escolheu
--      (cot_nfe.associacoes_app), com a conversão, a unidade do produto, o preço por unidade da nota (preco_ref), quantas vezes e a data da última nota.
--   3) cot_nfe_associar_lembrado(p_chave, p_n, p_produto_id, p_conversao): a gravação AUTOMÁTICA do app. Mesmas travas de cot_nfe_associar, grava com
--      origem 'lembrado' e SÓ se o item ainda não tem decisão e não foi recusado (nunca sobrescreve). true = gravou; false = não precisou.
--   4) cot_nfe_recusar_lembrado(p_chave, p_n): guarda o n em lembrado_recusado (o Ivan trocou ou desfez a associação automática).
--   5) cot_nfe_lembrado_calcular(p_cnpj): a consulta INTERNA usada por 2 e 3 (ninguém executa direto: sem grant). A 3 se defende sozinha: só grava se o produto,
--      a conversão e a unidade forem os lembrados e o preço por unidade da nota estiver entre 0,8× e 1,2× o preco_ref (a mesma faixa do robô).
--
-- POR QUÊ
--   A descrição do item muda a cada compra (ex.: OLIVEIRA E OLIVEIRA, CÓD. FOR 0009085, "...SH 32,7000" / "SH 35,1600"), então o SisChef não reconhece o item e a
--   nota chega sem produto; o Ivan escolhia de novo toda vez.
--
-- REGRAS DE cot_nfe_produto_lembrado
--   • CÓD. FOR sai da descrição do item, como codForDoItem do app ("CÓD. FOR: 0009085 GUARANA ..." -> "0009085"). Unidade da nota = itens[].unidade_sischef em maiúsculas.
--   • Só entra decisão do IVAN: com produto_id e origem que NÃO é 'sischef' (só conversão) nem 'lembrado' (feita sozinha pelo app).
--   • Só devolve a linha se TODAS as decisões concordam no MESMO produto_id e na MESMA conversão (sem conversão = sem conversão). Divergiu = nada.
--   • preco_ref = total da linha ÷ quantidade da nota (itens[].valor ÷ itens[].qtd, 4 casas) da decisão mais recente; sem os dois = null. Mesma conta do robô.
--   • vezes = quantas NOTAS (chaves distintas). unidade = a unidade do produto da decisão mais recente, em maiúsculas. ultima_em = lancada_em da nota mais recente (sem lancada_em = null; nunca outra data).
--   • CNPJ da nota = coalesce(cnpj_emitente, substr(chave, 7, 14)), como a tela.
--
-- QUEM FAZ O QUÊ: as três funções são do admin logado (exigir_admin); executam só para authenticated.
--
-- COMO DESFAZER: supabase/rollback/20261230000001_produto_lembrado_por_fornecedor.desfazer.sql

alter table public.cot_nfe
  add column if not exists lembrado_recusado jsonb
    constraint cot_nfe_lembrado_recusado_forma check (lembrado_recusado is null or (jsonb_typeof(lembrado_recusado) = 'array' and jsonb_array_length(lembrado_recusado) <= 500));

grant select on public.cot_nfe to service_role;

create or replace function public.cot_nfe_lembrado_calcular(p_cnpj text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce((

    with decisoes as (
      select btrim((regexp_match(coalesce(it.e ->> 'descricao', ''), '^\s*C[OÓ]D\.?\s*FOR\.?:?\s*(\S+)', 'i'))[1]) as cod_forn,
             upper(btrim(coalesce(it.e ->> 'unidade_sischef', ''))) as unidade_nota,
             (d.v ->> 'produto_id')::bigint as produto_id,
             nullif(btrim(coalesce(d.v ->> 'produto_nome', '')), '') as produto_nome,
             nullif(upper(btrim(coalesce(d.v ->> 'unidade', ''))), '') as unidade,
             case when jsonb_typeof(d.v -> 'conversao') = 'number' and (d.v ->> 'conversao')::numeric > 0 then (d.v ->> 'conversao')::numeric end as conversao,
             case when jsonb_typeof(it.e -> 'valor') = 'number' and jsonb_typeof(it.e -> 'qtd') = 'number'
                       and (it.e ->> 'valor')::numeric > 0 and (it.e ->> 'qtd')::numeric > 0
                  then round((it.e ->> 'valor')::numeric / (it.e ->> 'qtd')::numeric, 4) end as preco,
             n.lancada_em as em,
             n.chave as chave
        from cot_nfe n
        cross join lateral jsonb_each(coalesce(n.associacoes_app, '{}'::jsonb)) as d(k, v)
        cross join lateral (select t.e from jsonb_array_elements(coalesce(n.itens, '[]'::jsonb)) as t(e) where t.e ->> 'n' = d.k limit 1) as it
       where coalesce(n.cnpj_emitente, substr(n.chave, 7, 14)) = p_cnpj
         and n.situacao = 'lancada'
         and jsonb_typeof(d.v) = 'object'
         and lower(btrim(coalesce(d.v ->> 'origem', ''))) not in ('sischef', 'lembrado')
         and coalesce(d.v ->> 'produto_id', '') ~ '^[0-9]+$'
    ),
    grupos as (
      select cod_forn, unidade_nota,
             min(produto_id) as produto_id,
             (array_agg(produto_nome order by em desc nulls last) filter (where produto_nome is not null))[1] as produto_nome,
             (array_agg(unidade order by em desc nulls last))[1] as unidade,
             (array_agg(preco order by em desc nulls last))[1] as preco_ref,
             min(conversao) as conversao,
             count(distinct chave) as vezes,
             max(em) as ultima_em
        from decisoes
       where cod_forn is not null and cod_forn <> '' and unidade_nota <> ''
       group by cod_forn, unidade_nota
      having min(produto_id) = max(produto_id)
         and (count(conversao) = 0 or (count(conversao) = count(*) and min(conversao) = max(conversao)))
    )
    select jsonb_agg(jsonb_build_object('cod_forn', g.cod_forn, 'unidade_nota', g.unidade_nota, 'produto_id', g.produto_id, 'produto_nome', g.produto_nome,
                                        'unidade', g.unidade, 'conversao', g.conversao, 'preco_ref', g.preco_ref, 'vezes', g.vezes, 'ultima_em', g.ultima_em)
                     order by g.cod_forn collate "C", g.unidade_nota collate "C")
      from grupos g
  ), '[]'::jsonb)
$$;

create or replace function public.cot_nfe_produto_lembrado(p_cnpj text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cnpj text;
begin
  perform exigir_admin();
  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido: informe os 14 dígitos do emitente';
  end if;
  return cot_nfe_lembrado_calcular(v_cnpj);
end $$;

create or replace function public.cot_nfe_associar_lembrado(p_chave text, p_n integer, p_produto_id bigint, p_conversao numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_nf cot_nfe;
  v_item jsonb;
  v_nome text;
  v_unidade text;
  v_depois jsonb;
  v_planilha text;
  v_lemb jsonb;
  v_preco numeric;
begin
  perform exigir_admin();
  if p_produto_id is null then raise exception 'informe o produto'; end if;
  select * into v_nf from cot_nfe where chave = p_chave for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if v_nf.situacao <> 'na_fila' then raise exception 'esta nota não está mais na fila: não dá para associar'; end if;
  if v_nf.descartada_em is not null then raise exception 'esta nota foi descartada: volte-a para a fila antes de associar'; end if;
  if v_nf.lancamento_estado = 'erro' then raise exception 'esta nota ficou pela metade: confira no SisChef'; end if;
  if v_nf.lancamento_estado = 'lancando' and coalesce(v_nf.lancamento_em, cot_agora()) > cot_agora() - interval '30 minutes' then
    raise exception 'o robô está lançando esta nota agora: aguarde terminar';
  end if;

  select t.e into v_item from jsonb_array_elements(coalesce(v_nf.itens, '[]'::jsonb)) as t(e) where t.e ->> 'n' = p_n::text limit 1;
  if v_item is null then raise exception 'item não encontrado na nota'; end if;

  if p_conversao is not null then
    if p_conversao <> round(p_conversao, 4) then raise exception 'a conversão aceita no máximo 4 casas decimais'; end if;
    if p_conversao <= 0 or p_conversao > 10000 then raise exception 'a conversão precisa ser maior que zero e até 10000'; end if;
  end if;

  if v_nf.associacoes_app ? p_n::text then return false; end if;
  if coalesce(v_nf.lembrado_recusado, '[]'::jsonb) @> to_jsonb(p_n) then return false; end if;

  if coalesce(btrim(v_item ->> 'produto_id'), '') <> '' and coalesce(lower(btrim(v_item ->> 'associacao')), '') <> 'painel' then
    raise exception 'este item já está associado no SisChef';
  end if;
  select i.produto, i.unidade into v_nome, v_unidade from itens_semana i where i.produto_id = p_produto_id order by i.semana_id desc, i.id desc limit 1;
  if not found then
    if exists (select 1 from produto_planilha pl where pl.produto_id = p_produto_id and btrim(coalesce(pl.descricao, '')) <> '') then
      select left(btrim(pl.descricao), 200) into v_nome from produto_planilha pl where pl.produto_id = p_produto_id;
      v_unidade := null;
    else
      raise exception 'produto fora da lista de insumos';
    end if;
  end if;
  select lower(pl.unidade) into v_planilha from produto_planilha pl where pl.produto_id = p_produto_id;
  if v_planilha is not null then v_unidade := v_planilha; end if;

  select l.e into v_lemb
    from jsonb_array_elements(cot_nfe_lembrado_calcular(coalesce(v_nf.cnpj_emitente, substr(v_nf.chave, 7, 14)))) as l(e)
   where l.e ->> 'cod_forn' = btrim((regexp_match(coalesce(v_item ->> 'descricao', ''), '^\s*C[OÓ]D\.?\s*FOR\.?:?\s*(\S+)', 'i'))[1])
     and l.e ->> 'unidade_nota' = upper(btrim(coalesce(v_item ->> 'unidade_sischef', '')))
   limit 1;
  if v_lemb is null then return false; end if;
  if (v_lemb ->> 'produto_id')::bigint <> p_produto_id then return false; end if;
  if (v_lemb ->> 'conversao')::numeric is distinct from p_conversao then return false; end if;
  if coalesce(v_lemb ->> 'unidade', '') = '' or v_lemb ->> 'unidade' <> upper(btrim(coalesce(v_unidade, ''))) then return false; end if;
  if jsonb_typeof(v_item -> 'valor') <> 'number' or jsonb_typeof(v_item -> 'qtd') <> 'number'
     or (v_item ->> 'valor')::numeric <= 0 or (v_item ->> 'qtd')::numeric <= 0 or coalesce((v_lemb ->> 'preco_ref')::numeric, 0) <= 0 then
    return false;
  end if;
  v_preco := (v_item ->> 'valor')::numeric / (v_item ->> 'qtd')::numeric;
  if v_preco < 0.8 * (v_lemb ->> 'preco_ref')::numeric or v_preco > 1.2 * (v_lemb ->> 'preco_ref')::numeric then return false; end if;

  v_nome := regexp_replace(btrim(v_nome), '\s+', ' ', 'g');
  v_depois := jsonb_build_object('produto_id', p_produto_id, 'produto_nome', v_nome, 'unidade', v_unidade, 'origem', 'lembrado',
                                 'conversao', p_conversao, 'por', email_atual(), 'em', cot_agora());
  update cot_nfe set associacoes_app = coalesce(associacoes_app, '{}'::jsonb) || jsonb_build_object(p_n::text, v_depois), atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', null)),
    jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_depois)));
  return true;
end $$;

create or replace function public.cot_nfe_recusar_lembrado(p_chave text, p_n integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_nf cot_nfe;
begin
  perform exigir_admin();
  if p_n is null or p_n < 1 then raise exception 'item inválido'; end if;
  select * into v_nf from cot_nfe where chave = p_chave for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if coalesce(v_nf.lembrado_recusado, '[]'::jsonb) @> to_jsonb(p_n) then return; end if;
  update cot_nfe set lembrado_recusado = coalesce(lembrado_recusado, '[]'::jsonb) || to_jsonb(p_n), atualizado_em = cot_agora() where chave = p_chave;
end $$;

revoke execute on function public.cot_nfe_lembrado_calcular(text) from public, anon, authenticated;
revoke execute on function public.cot_nfe_produto_lembrado(text) from public, anon, authenticated;
grant execute on function public.cot_nfe_produto_lembrado(text) to authenticated;
revoke execute on function public.cot_nfe_associar_lembrado(text, integer, bigint, numeric) from public, anon, authenticated;
grant execute on function public.cot_nfe_associar_lembrado(text, integer, bigint, numeric) to authenticated;
revoke execute on function public.cot_nfe_recusar_lembrado(text, integer) from public, anon, authenticated;
grant execute on function public.cot_nfe_recusar_lembrado(text, integer) to authenticated;
