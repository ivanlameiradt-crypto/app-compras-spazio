-- App de Compras Spazio — a unidade que a decisão do app guarda (associacoes_app[n].unidade) passa a vir da planilha do Ivan (produto_planilha), quando o produto
-- está nela; senão continua a de itens_semana (palpite pelo nome). Só isso muda em cot_nfe_associar: mesmas travas, mesma conversão, mesmo histórico.
-- Efeito: manjericão, alface, corante vermelho e óleo de gergelim (nome "(KG)", SisChef em UN) e a carne filé (sem sufixo, SisChef em KG) passam a pedir
-- (ou dispensar) a conversão pela unidade certa.

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
  v_planilha text;
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

  -- A unidade do SisChef que o Ivan escreveu na planilha de produtos (produto_planilha, 08/10/2026) MANDA sobre a de itens_semana, que era um palpite pelo nome.
  select lower(pl.unidade) into v_planilha from produto_planilha pl where pl.produto_id = p_produto_id;
  if v_planilha is not null then v_unidade := v_planilha; end if;

  v_nome := regexp_replace(btrim(v_nome), '\s+', ' ', 'g'); -- o cadastro às vezes traz espaço duplo ("LEITE CONDESSADO  - INSUMOS"): guarda com espaço simples
  v_depois := jsonb_build_object('produto_id', p_produto_id, 'produto_nome', v_nome, 'unidade', v_unidade, 'origem', v_origem,
                                 'conversao', p_conversao, -- null quando não informada: o robô só converte quando há número aqui
                                 'por', email_atual(), 'em', cot_agora());
  update cot_nfe set associacoes_app = coalesce(associacoes_app, '{}'::jsonb) || jsonb_build_object(p_n::text, v_depois), atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
    jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_depois)));
end $$;
