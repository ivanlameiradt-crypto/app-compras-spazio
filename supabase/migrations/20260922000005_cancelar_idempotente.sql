-- App de Compras Spazio — M-e: cancelar_compra idempotente no reenvio da fila.
-- Se a resposta do primeiro envio se perde depois do commit, a fila do celular manda de novo; a
-- compra já foi apagada e "compra não encontrada" (P0001, erro definitivo) apareceria como erro
-- falso na lista do comprador. Compra que não existe mais: nada a fazer.
-- (Nova migration porque a 0004 já foi aplicada no projeto de teste.)
create or replace function public.cancelar_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  perform exigir_ativo();
  select * into c from compras where id = p_compra for update;
  if not found then
    return; -- já cancelada (reenvio da fila): idempotente
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

-- create or replace mantém as permissões; reaplicadas aqui só para ficarem explícitas (como na 0004).
revoke execute on function public.cancelar_compra(uuid) from public, anon;
grant execute on function public.cancelar_compra(uuid) to authenticated;
