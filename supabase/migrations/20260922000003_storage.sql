-- Fotos de cupom: bucket privado. Qualquer usuário ativo envia; só o admin vê.
insert into storage.buckets (id, name, public) values ('cupons', 'cupons', false)
on conflict (id) do nothing;

create policy cupons_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'cupons' and public.eh_ativo());

create policy cupons_ler on storage.objects for select to authenticated
  using (bucket_id = 'cupons' and public.eh_admin());
