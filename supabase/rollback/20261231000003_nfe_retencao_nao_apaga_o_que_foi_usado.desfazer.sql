-- DESFAZER 20261231000003_nfe_retencao_nao_apaga_o_que_foi_usado.sql: devolve cot_nfe_sincronizar à versão da 20261015000002 (a limpeza de 30 dias volta a apagar também as notas já lançadas).
-- As permissões não mudam (create or replace as mantém). Linha que a limpeza já tiver apagado NÃO volta daqui: só do backup diário do Supabase.

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
