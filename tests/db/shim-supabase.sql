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
-- Tabela do robô do cupom (em produção vem das migrations do repositório sischef-monitor-notas: db/migrations/20260930090000_cupom.sql, 20261001120000_cupom_subfase3.sql
-- e 20261219000001_cupom_origem.sql). Copiada AQUI, no formato de produção, para as migrations do app que mexem nela (cupom_excluir / cupom_restaurar, 03/11/2026) serem testadas.
-- Os privilégios seguem o modelo dos testes de permissão (anon nada; authenticated só lê); em produção quem limita a leitura ao admin é a RLS cupom_sel_admin.
create table public.cupom (
  id uuid primary key default gen_random_uuid(),
  chave text,
  emitente_cnpj text,
  emitente_nome text,
  itens jsonb not null,
  pagamento jsonb not null,
  valor_a_pagar numeric(12,2) not null,
  estado text not null default 'PENDENTE'
    constraint cupom_estado_check check (estado in ('PENDENTE', 'PROCESSANDO', 'LANCADO', 'REVISAR', 'TESTE')),
  pedido_sischef text,
  motivo text,
  processando_desde timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foto_path text,
  teste boolean not null default false,
  origem text not null default 'cupom' check (origem in ('cupom', 'avulsa'))
);
create unique index cupom_chave_uniq on public.cupom (chave) where chave is not null;
create unique index cupom_foto_path_uniq on public.cupom (foto_path) where foto_path is not null;
revoke all on public.cupom from anon, authenticated;
grant select on public.cupom to authenticated;
