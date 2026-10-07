-- App de Compras Spazio — Fase 3, ETAPA 2 da associação pelo app ("confirmou no app → pode lançar"): a decisão ganha a CONVERSÃO de unidade.
--
-- Na etapa 1 (migração 20261210000001) o app só GUARDAVA a escolha do produto em cot_nfe.associacoes_app e o Lançar continuava travado,
-- porque o robô da nuvem não aplicava a decisão na tela do SisChef. Nesta etapa o robô passa a receber associacoes_app (Edge Function
-- lancar-nfe) e a associar o produto na importação da NF-e antes de lançar. Para isso ele precisa de mais um dado: quando a unidade da nota
-- é diferente da unidade do cadastro do produto (UN DIFERE), a tela do SisChef abre um modal de conversão e pergunta quanto vale 1 unidade
-- da nota em unidades do produto. Ex.: lata de leite condensado de 395 g — a nota vem em UN e o produto é em KG → 1 UN = 0,395 KG. Quem sabe
-- isso é o Ivan, então a caixa de associação do app passa a perguntar (só quando as unidades diferem) e a decisão guarda:
--   associacoes_app = { "<n do item na NF>": { ..., "conversao": 0.395 } }      -- null = sem conversão (unidades iguais, ou o robô decide pelo cadastro vivo)
--
-- A RPC cot_nfe_associar ganha o 4º parâmetro p_conversao numeric (default null). A assinatura antiga de 3 parâmetros é REMOVIDA (drop) de
-- propósito: com as duas vivas o PostgREST não saberia qual chamar quando o app manda p_conversao nulo (ambiguidade), e o app novo sempre manda
-- os 4. Regras da conversão, todas no banco (fail-closed: o de-para que o robô grava no SisChef é PERMANENTE para o código do fornecedor):
-- nula = sem conversão; se vier, tem de ser maior que zero, até 10000 e com no máximo 4 casas decimais (é o que o modal do SisChef aceita;
-- motor_logica.conversao_decidida do robô aplica o mesmo limite). O banco NÃO confere se as unidades diferem: isso quem sabe é o robô, com o
-- cadastro vivo do SisChef (conversão informada com unidades iguais vira REVISAR lá; o app só pergunta quando as unidades que ele conhece diferem).
-- O resto da função é o MESMO da etapa 1 (quem pode, em que nota, em que item, que produto vale); a conversão entra em v_depois e, com ela, no
-- histórico (historico_alteracoes), que é por onde se confere depois o que foi decidido e por quem.

drop function if exists public.cot_nfe_associar(text, integer, bigint);

create or replace function public.cot_nfe_associar(p_chave text, p_n integer, p_produto_id bigint, p_conversao numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_nf cot_nfe;
  v_item jsonb;
  v_nome text;
  v_unidade text;
  v_origem text;
  v_antes jsonb;
  v_depois jsonb;
begin
  perform exigir_admin();
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
  v_antes := v_nf.associacoes_app -> p_n::text;

  -- Conversão informada é conferida SEMPRE (mesmo num desfazer): é o número que o robô vai digitar no modal do SisChef, e lá fica para sempre.
  if p_conversao is not null then
    if p_conversao <> round(p_conversao, 4) then raise exception 'a conversão aceita no máximo 4 casas decimais'; end if;
    if p_conversao <= 0 or p_conversao > 10000 then raise exception 'a conversão precisa ser maior que zero e até 10000'; end if;
  end if;

  if p_produto_id is null then -- desfaz a decisão do app (se não havia, não faz nada)
    if v_antes is not null then
      update cot_nfe set associacoes_app = nullif(associacoes_app - p_n::text, '{}'::jsonb), atualizado_em = cot_agora() where chave = p_chave;
      perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
        jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', null)));
    end if;
    return;
  end if;

  if coalesce(btrim(v_item ->> 'produto_id'), '') <> '' and coalesce(lower(btrim(v_item ->> 'associacao')), '') <> 'painel' then
    raise exception 'este item já está associado no SisChef';
  end if;
  select i.produto, i.unidade into v_nome, v_unidade from itens_semana i where i.produto_id = p_produto_id order by i.semana_id desc, i.id desc limit 1;
  if found then
    v_origem := 'lista';
  elsif coalesce(v_item #>> '{sugestao,id}', '') = p_produto_id::text and btrim(coalesce(v_item #>> '{sugestao,nome}', '')) <> '' then
    v_nome := left(btrim(v_item #>> '{sugestao,nome}'), 200); v_unidade := null; v_origem := 'sugestao'; -- produto novo: ainda fora de itens_semana
  else
    raise exception 'produto fora da lista de insumos';
  end if;

  v_nome := regexp_replace(btrim(v_nome), '\s+', ' ', 'g'); -- o cadastro às vezes traz espaço duplo ("LEITE CONDESSADO  - INSUMOS"): guarda com espaço simples
  v_depois := jsonb_build_object('produto_id', p_produto_id, 'produto_nome', v_nome, 'unidade', v_unidade, 'origem', v_origem,
                                 'conversao', p_conversao, -- null quando não informada: o robô só converte quando há número aqui
                                 'por', email_atual(), 'em', cot_agora());
  update cot_nfe set associacoes_app = coalesce(associacoes_app, '{}'::jsonb) || jsonb_build_object(p_n::text, v_depois), atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
    jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_depois)));
end $$;

-- Só o admin logado executa (a checagem de admin está dentro da função); anon e o público não. Agora para a assinatura de 4 parâmetros.
revoke execute on function public.cot_nfe_associar(text, integer, bigint, numeric) from public, anon, authenticated;
grant execute on function public.cot_nfe_associar(text, integer, bigint, numeric) to authenticated;
