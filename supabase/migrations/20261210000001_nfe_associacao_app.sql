-- App de Compras Spazio — Fase 3: associar o produto de um item da nota PELO APP (aba "Lançamento fiscal").
--
-- Item "sem produto": a linha da importação da NF-e no SisChef não está associada a nenhum produto. Até aqui o Ivan tinha de ir ao SisChef
-- associar. Agora ele digita o produto no app (a lista é a que já está no app: itens_semana, os insumos e bebidas com o código do SisChef),
-- escolhe e CONFIRMA; o app mostra o ✓ verde de "confirmado".
--
-- ETAPA 1 (esta migração): o app só GUARDA a decisão. NADA muda no SisChef, e a nota com item sem produto no SisChef continua sem poder ser
-- lançada pelo app: o robô ainda não aplica a decisão na tela do SisChef (etapa 2: o robô aplica; teste acompanhado).
--
-- Desenho: uma coluna jsonb em cot_nfe em vez de mexer em `itens`. A leitura da SEFAZ (cot_nfe_sincronizar) reescreve `itens` a cada rodada
-- e apagaria a decisão; a coluna nova a leitura nunca toca (o `on conflict do update` dela só lista as colunas dela).
--   associacoes_app = { "<n do item na NF>": { "produto_id": 3138573, "produto_nome": "...", "unidade": "un", "origem": "lista", "por": "email", "em": "timestamp" } }
-- O nome e a unidade do produto vêm do servidor (itens_semana, a semana mais nova em que o produto aparece; ou, para produto novo, o palpite do
-- robô gravado no próprio item), nunca do aparelho. `origem`: 'lista' (itens_semana) ou 'sugestao' (palpite do robô).
--
-- cot_nfe_associar (admin): só nota 'na_fila' que não está descartada, não ficou pela metade ('erro') e que o robô não está lançando agora
-- (reserva 'lancando' de menos de 30 min — o mesmo limite da Edge Function lancar-nfe); só item que ainda NÃO tem produto de verdade no SisChef
-- (item "decidido só pelo painel" pode ser refeito); só produto que existe em itens_semana OU que é o palpite do robô PARA ESSE ITEM
-- (item.sugestao: o robô lê o cadastro do SisChef; vale para produto novo, criado no SisChef depois da lista semanal — ex.: CHOCOLATE BIS —,
-- que só entra em itens_semana na semana seguinte; nesse caso o nome vem do palpite e a unidade fica em branco). Escolher de novo troca a
-- decisão; com p_produto_id nulo a decisão é desfeita (não dá erro se não havia). Grava o antes/depois em historico_alteracoes.

alter table public.cot_nfe
  add column if not exists associacoes_app jsonb
    check (associacoes_app is null or jsonb_typeof(associacoes_app) = 'object');

create or replace function public.cot_nfe_associar(p_chave text, p_n integer, p_produto_id bigint) returns void
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
                                 'por', email_atual(), 'em', cot_agora());
  update cot_nfe set associacoes_app = coalesce(associacoes_app, '{}'::jsonb) || jsonb_build_object(p_n::text, v_depois), atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
    jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_depois)));
end $$;

-- Só o admin logado executa (a checagem de admin está dentro da função); anon e o público não.
revoke execute on function public.cot_nfe_associar(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.cot_nfe_associar(text, integer, bigint) to authenticated;
