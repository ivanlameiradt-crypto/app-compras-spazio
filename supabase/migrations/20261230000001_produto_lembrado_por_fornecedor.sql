-- App de Compras Spazio — o app LEMBRA o produto de cada item da nota por FORNECEDOR + CÓD. FOR + UNIDADE DA NOTA (pedido do Ivan, 14/11/2026).
--
-- O QUE MUDA (só cria UMA função; nenhuma tabela nova, nada que já existe é alterado)
--   cot_nfe_produto_lembrado(p_cnpj): lê as notas JÁ LANÇADAS daquele fornecedor (cot_nfe.situacao = 'lancada') e devolve, para cada CÓD. FOR + unidade da
--   nota, o produto que o Ivan escolheu no app (cot_nfe.associacoes_app), com a conversão, quantas vezes e a data da última nota.
--
-- POR QUÊ
--   A descrição do item muda a cada compra (ex.: OLIVEIRA E OLIVEIRA, CÓD. FOR 0009085, "...SH 32,7000" / "SH 35,1600"), então o SisChef não reconhece o item e a
--   nota chega sem produto; o Ivan escolhia de novo toda vez. O app passa a associar sozinho, pelo mesmo caminho do toque do Ivan (cot_nfe_associar).
--
-- REGRAS
--   • CÓD. FOR sai da descrição do item, como codForDoItem do app: "CÓD. FOR: 0009085 GUARANA ..." -> "0009085" (texto exato). Unidade = itens[].unidade_sischef em maiúsculas.
--   • Só entra decisão com produto_id e que NÃO é de origem 'sischef' (essa guarda só a conversão de item que já vem associado).
--   • Só devolve a linha se TODAS as decisões daquele CÓD. FOR + unidade concordam no MESMO produto_id e na MESMA conversão (sem conversão = sem conversão).
--     Divergiu = nada (o app pergunta ao Ivan, como hoje).
--   • ultima_em = lancada_em da nota mais recente (ou atualizado_em, se faltar).
--
-- QUEM FAZ O QUÊ: só o admin logado (exigir_admin); executa só para authenticated.
--
-- COMO DESFAZER: supabase/rollback/20261230000001_produto_lembrado_por_fornecedor.desfazer.sql
--   drop function if exists public.cot_nfe_produto_lembrado(text);

create or replace function public.cot_nfe_produto_lembrado(p_cnpj text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cnpj text;
begin
  perform exigir_admin();
  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido: informe os 14 dígitos do emitente';
  end if;
  return coalesce((
    with decisoes as (
      select btrim((regexp_match(coalesce(it.e ->> 'descricao', ''), '^\s*C[OÓ]D\.?\s*FOR\.?:?\s*(\S+)', 'i'))[1]) as cod_forn,
             upper(btrim(coalesce(it.e ->> 'unidade_sischef', ''))) as unidade_nota,
             (d.v ->> 'produto_id')::bigint as produto_id,
             nullif(btrim(coalesce(d.v ->> 'produto_nome', '')), '') as produto_nome,
             case when jsonb_typeof(d.v -> 'conversao') = 'number' and (d.v ->> 'conversao')::numeric > 0 then (d.v ->> 'conversao')::numeric end as conversao,
             coalesce(n.lancada_em, n.atualizado_em) as em
        from cot_nfe n
        cross join lateral jsonb_each(coalesce(n.associacoes_app, '{}'::jsonb)) as d(k, v)
        cross join lateral (select t.e from jsonb_array_elements(coalesce(n.itens, '[]'::jsonb)) as t(e) where t.e ->> 'n' = d.k limit 1) as it
       where n.cnpj_emitente = v_cnpj
         and n.situacao = 'lancada'
         and jsonb_typeof(d.v) = 'object'
         and lower(btrim(coalesce(d.v ->> 'origem', ''))) <> 'sischef'
         and coalesce(d.v ->> 'produto_id', '') ~ '^[0-9]+$'
    ),
    grupos as (
      select cod_forn, unidade_nota,
             min(produto_id) as produto_id,
             (array_agg(produto_nome order by em desc) filter (where produto_nome is not null))[1] as produto_nome,
             min(conversao) as conversao,
             count(*) as vezes,
             max(em) as ultima_em
        from decisoes
       where cod_forn is not null and cod_forn <> '' and unidade_nota <> ''
       group by cod_forn, unidade_nota
      having min(produto_id) = max(produto_id)
         and (count(conversao) = 0 or (count(conversao) = count(*) and min(conversao) = max(conversao)))
    )
    select jsonb_agg(jsonb_build_object('cod_forn', g.cod_forn, 'unidade_nota', g.unidade_nota, 'produto_id', g.produto_id, 'produto_nome', g.produto_nome,
                                        'conversao', g.conversao, 'vezes', g.vezes, 'ultima_em', g.ultima_em)
                     order by g.cod_forn collate "C", g.unidade_nota collate "C")
      from grupos g
  ), '[]'::jsonb);
end $$;

revoke execute on function public.cot_nfe_produto_lembrado(text) from public, anon, authenticated;
grant execute on function public.cot_nfe_produto_lembrado(text) to authenticated;
