-- App de Compras Spazio — funções de escrita. Todas validam papel e estado antes de mexer.

-- ================= Semana
create or replace function public.importar_semana(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_data   date := (p ->> 'data_referencia')::date;
  v_id     bigint;
  v_status text;
begin
  if v_data is null then
    raise exception 'data_referencia obrigatória';
  end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'lista de itens vazia';
  end if;

  select id, status into v_id, v_status from semanas where data_referencia = v_data for update;
  if v_id is not null and v_status <> 'rascunho' then
    return jsonb_build_object('resultado', 'ja_aprovada', 'semana_id', v_id);
  end if;

  if v_id is null then
    insert into semanas (data_referencia) values (v_data) returning id into v_id;
  else
    delete from itens_semana where semana_id = v_id;
    update semanas set gerada_em = now() where id = v_id;
  end if;

  insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, estoque_minimo,
                            qtd_sugerida, qtd_aprovada, preco_estimado, data_ultima_compra,
                            fornecedor_ultima, situacao, negativo, incluido)
  select v_id, x.produto_id, x.produto, x.bebida,
         case when x.produto ~* '\(\s*KG\s*\)' then 'kg' else 'un' end,
         x.estoque, coalesce(x.estoque_minimo, 0), x.qtd_sugerida,
         case when x.qtd_sugerida > 0 and not (not x.bebida and x.situacao = 'ESTOQUE NEGATIVO')
              then x.qtd_sugerida else 0 end,
         x.preco_estimado, x.data_ultima_compra, x.fornecedor_ultima, x.situacao,
         (not x.bebida and x.situacao = 'ESTOQUE NEGATIVO'),
         (x.qtd_sugerida > 0 and not (not x.bebida and x.situacao = 'ESTOQUE NEGATIVO'))
    from jsonb_to_recordset(p -> 'itens') as x(
           produto_id bigint, produto text, bebida boolean, estoque numeric, estoque_minimo numeric,
           qtd_sugerida numeric, preco_estimado numeric, data_ultima_compra date,
           fornecedor_ultima text, situacao text);

  return jsonb_build_object('resultado', case when v_status is null then 'criada' else 'substituida' end,
                            'semana_id', v_id, 'itens', jsonb_array_length(p -> 'itens'));
end $$;

create or replace function public.ajustar_item(p_item bigint, p_qtd numeric, p_incluido boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  if p_qtd is null or p_qtd < 0 then
    raise exception 'quantidade não pode ser negativa';
  end if;
  update itens_semana i
     set qtd_aprovada = p_qtd, incluido = (p_incluido and p_qtd > 0)
    from semanas s
   where i.id = p_item and s.id = i.semana_id and s.status = 'rascunho';
  if not found then
    raise exception 'só dá para ajustar a lista enquanto ela está em rascunho';
  end if;
end $$;

create or replace function public.aprovar_semana(p_semana bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  if exists (select 1 from semanas where status = 'em_compra' and id <> p_semana) then
    raise exception 'encerre a semana anterior antes de aprovar esta';
  end if;
  update semanas set status = 'em_compra', aprovada_por = email_atual(), aprovada_em = now()
   where id = p_semana and status = 'rascunho';
  if not found then
    raise exception 'esta semana não está em rascunho';
  end if;
end $$;

create or replace function public.encerrar_semana(p_semana bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  if exists (select 1 from compras where semana_id = p_semana and status = 'aberta') then
    raise exception 'há compras abertas nesta semana; peça para fecharem antes';
  end if;
  update semanas set status = 'encerrada', encerrada_em = now()
   where id = p_semana and status = 'em_compra';
  if not found then
    raise exception 'esta semana não está em compra';
  end if;
end $$;

-- ================= Compra (celular do comprador)
create or replace function public.minha_compra_aberta(p_compra uuid) returns compras
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  select * into c from compras where id = p_compra for update;
  if not found then
    raise exception 'compra não encontrada';
  end if;
  if c.comprador <> email_atual() then
    raise exception 'esta compra é de outra pessoa';
  end if;
  if c.status <> 'aberta' then
    raise exception 'esta compra já foi fechada';
  end if;
  return c;
end $$;

create or replace function public.abrir_compra(p_id uuid, p_semana bigint, p_loja text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_ativo();
  if exists (select 1 from compras where id = p_id) then
    return; -- reenvio da fila
  end if;
  if not exists (select 1 from semanas where id = p_semana and status = 'em_compra') then
    raise exception 'esta lista não está liberada para compra';
  end if;
  insert into compras (id, semana_id, loja, comprador)
  values (p_id, p_semana, trim(p_loja), email_atual()); -- o app já manda em maiúsculas
end $$;

create or replace function public.registrar_item(p_id uuid, p_compra uuid, p_item bigint, p_qtd numeric,
                                                 p_preco numeric, p_resultado text) returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  perform exigir_ativo();
  c := minha_compra_aberta(p_compra);
  if p_resultado is null or p_resultado not in ('comprado', 'parcial', 'nao_achei') then
    raise exception 'resultado inválido';
  end if;
  if not exists (select 1 from itens_semana where id = p_item and semana_id = c.semana_id and incluido) then
    raise exception 'item fora da lista desta semana';
  end if;
  if p_resultado <> 'nao_achei' and (p_qtd is null or p_qtd <= 0) then
    raise exception 'informe a quantidade comprada';
  end if;
  if p_preco is not null and p_preco < 0 then
    raise exception 'preço não pode ser negativo';
  end if;
  insert into compras_itens (id, compra_id, item_semana_id, qtd, preco_unit, resultado, marcado_por)
  values (p_id, p_compra, p_item,
          case when p_resultado = 'nao_achei' then 0 else p_qtd end,
          case when p_resultado = 'nao_achei' then null else p_preco end,
          p_resultado, email_atual())
  on conflict (compra_id, item_semana_id) do update
     set qtd = excluded.qtd, preco_unit = excluded.preco_unit,
         resultado = excluded.resultado, marcado_em = now();
end $$;

create or replace function public.desmarcar_item(p_compra uuid, p_item bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_ativo();
  perform minha_compra_aberta(p_compra);
  delete from compras_itens where compra_id = p_compra and item_semana_id = p_item;
end $$;

create or replace function public.fechar_compra(p_compra uuid, p_com_nota boolean, p_total numeric, p_foto text)
returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  perform exigir_ativo();
  select * into c from compras where id = p_compra for update;
  if found and c.comprador = email_atual() and c.status = 'fechada' then
    return; -- reenvio da fila
  end if;
  c := minha_compra_aberta(p_compra);
  if not exists (select 1 from compras_itens where compra_id = p_compra) then
    raise exception 'marque pelo menos um item antes de fechar a compra';
  end if;
  if p_com_nota is null then
    raise exception 'informe se a compra foi com nota ou sem nota';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'informe o total pago';
  end if;
  update compras
     set status = 'fechada', com_nota = p_com_nota, total_pago = p_total, foto_cupom = p_foto, fechada_em = now()
   where id = p_compra;
end $$;

-- ================= Fila de lançamento (administrador)
create or replace function public.aprovar_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  update compras set status = 'aprovada', aprovada_por = email_atual(), aprovada_em = now()
   where id = p_compra and status = 'fechada';
  if not found then
    raise exception 'só dá para aprovar compra fechada';
  end if;
end $$;

create or replace function public.marcar_lancada(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  update compras set status = 'lancada', lancada_por = email_atual(), lancada_em = now()
   where id = p_compra and status = 'aprovada';
  if not found then
    raise exception 'só dá para marcar como lançada uma compra aprovada';
  end if;
end $$;

create or replace function public.corrigir_item_compra(p_linha uuid, p_qtd numeric, p_preco numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_depois jsonb;
begin
  perform exigir_admin();
  if p_qtd is null or p_qtd < 0 or (p_preco is not null and p_preco < 0) then
    raise exception 'quantidade e preço não podem ser negativos';
  end if;
  select to_jsonb(ci) into v_antes from compras_itens ci where id = p_linha;
  if v_antes is null then
    raise exception 'linha não encontrada';
  end if;
  update compras_itens ci set qtd = p_qtd, preco_unit = p_preco where ci.id = p_linha
  returning to_jsonb(ci) into v_depois;
  insert into historico_alteracoes (quem, tabela, registro, antes, depois)
  values (email_atual(), 'compras_itens', p_linha::text, v_antes, v_depois);
end $$;

create or replace function public.corrigir_compra(p_compra uuid, p_com_nota boolean, p_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_depois jsonb;
begin
  perform exigir_admin();
  if p_total is null or p_total < 0 then
    raise exception 'total não pode ser negativo';
  end if;
  select to_jsonb(c) into v_antes from compras c where id = p_compra;
  if v_antes is null then
    raise exception 'compra não encontrada';
  end if;
  update compras c set com_nota = p_com_nota, total_pago = p_total where c.id = p_compra
  returning to_jsonb(c) into v_depois;
  insert into historico_alteracoes (quem, tabela, registro, antes, depois)
  values (email_atual(), 'compras', p_compra::text, v_antes, v_depois);
end $$;

-- ================= Permissões (reaplica tudo: o Supabase libera funções novas por padrão)
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.email_atual(), public.eh_ativo(), public.eh_admin(),
  public.ajustar_item(bigint, numeric, boolean), public.aprovar_semana(bigint), public.encerrar_semana(bigint),
  public.abrir_compra(uuid, bigint, text),
  public.registrar_item(uuid, uuid, bigint, numeric, numeric, text),
  public.desmarcar_item(uuid, bigint),
  public.fechar_compra(uuid, boolean, numeric, text),
  public.aprovar_compra(uuid), public.marcar_lancada(uuid),
  public.corrigir_item_compra(uuid, numeric, numeric), public.corrigir_compra(uuid, boolean, numeric)
  to authenticated;
grant execute on function public.importar_semana(jsonb) to service_role;
