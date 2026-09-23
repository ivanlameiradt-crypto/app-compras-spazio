-- App de Compras Spazio — ajustes da revisão final (I2, M3, M12 e reforço de segurança).

-- ================= I2: compra aberta esquecida trava o encerramento da semana
-- Cancela uma compra aberta e vazia (o dono, ou o administrador cancelando a de qualquer um).
create or replace function public.cancelar_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  perform exigir_ativo();
  select * into c from compras where id = p_compra for update;
  if not found then
    raise exception 'compra não encontrada';
  end if;
  if c.comprador <> email_atual() and not eh_admin() then
    raise exception 'esta compra é de outra pessoa';
  end if;
  if c.status <> 'aberta' then
    raise exception 'só dá para cancelar uma compra aberta';
  end if;
  if exists (select 1 from compras_itens where compra_id = p_compra) then
    raise exception 'esta compra já tem item marcado; feche-a em vez de cancelar';
  end if;
  delete from compras where id = p_compra;
end $$;

-- Reforça em nível de banco a regra que aprovar_semana já checa na aplicação: nunca duas semanas
-- 'em_compra' ao mesmo tempo (índice sobre uma expressão constante, só nas linhas com esse status).
create unique index semanas_uma_em_compra on semanas ((true)) where status = 'em_compra';

-- encerrar_semana agora nomeia as compras abertas (loja e comprador) em vez de só recusar.
create or replace function public.encerrar_semana(p_semana bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_abertas text;
begin
  perform exigir_admin();
  select string_agg(loja || ' (' || split_part(comprador, '@', 1) || ')', ', ' order by aberta_em)
    into v_abertas
    from compras where semana_id = p_semana and status = 'aberta';
  if v_abertas is not null then
    raise exception 'há compras abertas nesta semana: %; peça para fecharem antes', v_abertas;
  end if;
  update semanas set status = 'encerrada', encerrada_em = now()
   where id = p_semana and status = 'em_compra';
  if not found then
    raise exception 'esta semana não está em compra';
  end if;
end $$;

-- ================= M3: reenvio de fechar_compra depois de aprovada/lançada não pode dar erro
-- Antes só 'fechada' era idempotente; qualquer status diferente de 'aberta' (do dono) agora é.
create or replace function public.fechar_compra(p_compra uuid, p_com_nota boolean, p_total numeric, p_foto text)
returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  perform exigir_ativo();
  select * into c from compras where id = p_compra for update;
  if found and c.comprador = email_atual() and c.status <> 'aberta' then
    return; -- reenvio da fila depois de já fechada (mesmo já aprovada/lançada): idempotente
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

-- ================= M12: "Comprado por" deve mostrar o nome cadastrado, não o e-mail
create or replace function public.nomes_equipe() returns table(email text, nome text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_ativo();
  return query select u.email, u.nome from usuarios u where u.ativo;
end $$;

-- ================= Extra (advisor de segurança do Supabase): search_path fixo também aqui
-- O corpo já usa auth.jwt() totalmente qualificado, então search_path = '' não muda o comportamento.
alter function public.email_atual() set search_path = '';

-- ================= Permissões (reaplica tudo: toda migration nova reseta os grants antigos)
revoke execute on all functions in schema public from public, anon, authenticated;
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
  public.nomes_equipe()
  to authenticated;
grant execute on function public.importar_semana(jsonb) to service_role;
