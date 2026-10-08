-- App de Compras Spazio — conversão de unidade para item que JÁ vem associado no SisChef mas com "UN DIFERE".
--
-- Caso real (MATEUS 000089284, 07/10/2026): o creme de leite já estava associado no SisChef (de lançamentos antigos), mas a nota vem em UN e o
-- cadastro é em KG, e nunca ficou registrada a conversão — a linha da importação mostra "UN DIFERE" e o robô para antes de gerar o pedido. A
-- cot_nfe_associar recusa item que já está associado ("este item já está associado no SisChef"), então o Ivan não tinha onde informar a conversão.
--
-- Esta função guarda SÓ a conversão, em cot_nfe.associacoes_app[n] com origem "sischef" (é como o robô a distingue de uma decisão de produto antiga,
-- que continua ignorada para item associado). O produto é o que a leitura viu no item (produto_id/produto_nome); o Ivan não escolhe produto aqui.
-- O robô só a aplica quando a linha da importação realmente mostra UN DIFERE: ele clica no aviso, confere o modal, digita e confere a Qtde Conver.
--
-- Mesmas travas da cot_nfe_associar (só admin; nota na fila, não descartada, sem lançamento pela metade nem robô trabalhando) e a mesma régua da
-- conversão (> 0, até 10000, no máximo 4 casas — o que o modal do SisChef aceita e o motor_logica.conversao_decidida do robô confere).
-- p_conversao nula desfaz (só apaga uma decisão com origem "sischef"; nunca uma decisão de produto).

create or replace function public.cot_nfe_converter_item(p_chave text, p_n integer, p_conversao numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_nf cot_nfe;
  v_item jsonb;
  v_pid bigint;
  v_nome text;
  v_antes jsonb;
  v_depois jsonb;
begin
  perform exigir_admin();
  select * into v_nf from cot_nfe where chave = p_chave for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if v_nf.situacao <> 'na_fila' then raise exception 'esta nota não está mais na fila: não dá para informar a conversão'; end if;
  if v_nf.descartada_em is not null then raise exception 'esta nota foi descartada: volte-a para a fila antes de informar a conversão'; end if;
  if v_nf.lancamento_estado = 'erro' then raise exception 'esta nota ficou pela metade: confira no SisChef'; end if;
  if v_nf.lancamento_estado = 'lancando' and coalesce(v_nf.lancamento_em, cot_agora()) > cot_agora() - interval '30 minutes' then
    raise exception 'o robô está lançando esta nota agora: aguarde terminar';
  end if;

  select t.e into v_item from jsonb_array_elements(coalesce(v_nf.itens, '[]'::jsonb)) as t(e) where t.e ->> 'n' = p_n::text limit 1;
  if v_item is null then raise exception 'item não encontrado na nota'; end if;
  v_antes := v_nf.associacoes_app -> p_n::text;

  if p_conversao is not null then
    if p_conversao <> round(p_conversao, 4) then raise exception 'a conversão aceita no máximo 4 casas decimais'; end if;
    if p_conversao <= 0 or p_conversao > 10000 then raise exception 'a conversão precisa ser maior que zero e até 10000'; end if;
  end if;

  if p_conversao is null then -- desfaz a conversão (só a de origem "sischef")
    if v_antes is not null and lower(coalesce(v_antes ->> 'origem', '')) = 'sischef' then
      update cot_nfe set associacoes_app = nullif(associacoes_app - p_n::text, '{}'::jsonb), atualizado_em = cot_agora() where chave = p_chave;
      perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
        jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', null)));
    end if;
    return;
  end if;

  if coalesce(btrim(v_item ->> 'produto_id'), '') = '' or coalesce(lower(btrim(v_item ->> 'associacao')), '') = 'painel' then
    raise exception 'este item ainda não está associado no SisChef: escolha o produto na caixa de associação';
  end if;
  begin
    v_pid := (btrim(v_item ->> 'produto_id'))::bigint;
  exception when others then
    raise exception 'o código do produto deste item não é válido: associe no SisChef';
  end;
  v_nome := regexp_replace(btrim(coalesce(nullif(v_item ->> 'produto_nome', ''), 'produto ' || v_pid::text)), '\s+', ' ', 'g');

  v_depois := jsonb_build_object('produto_id', v_pid, 'produto_nome', v_nome, 'unidade', null, 'origem', 'sischef',
                                 'conversao', p_conversao, 'por', email_atual(), 'em', cot_agora());
  update cot_nfe set associacoes_app = coalesce(associacoes_app, '{}'::jsonb) || jsonb_build_object(p_n::text, v_depois), atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_antes)),
    jsonb_build_object('associacao_app', jsonb_build_object('n', p_n, 'decisao', v_depois)));
end $$;

revoke execute on function public.cot_nfe_converter_item(text, integer, numeric) from public, anon, authenticated;
grant execute on function public.cot_nfe_converter_item(text, integer, numeric) to authenticated;
