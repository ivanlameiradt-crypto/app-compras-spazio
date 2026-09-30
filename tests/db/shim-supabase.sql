create schema if not exists auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
-- Privilégios padrão do Supabase: toda tabela, sequência e função nova de public já nasce liberada
-- para anon, authenticated e service_role. As migrations precisam revogar o que não vale; um revoke
-- esquecido aparece nos testes de permissão (como apareceria em produção).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- Vault do Supabase (Fase 2, D1): o segredo do robô de NF-e (cot_nfe_robo) vive aqui. Só as funções
-- security definer (dono = postgres) leem; nenhum papel da API tem usage no schema. Os testes inserem o
-- segredo direto na tabela (em produção, quem cria é vault.create_secret pelo conector).
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  id uuid default gen_random_uuid(),
  name text,
  decrypted_secret text
);
