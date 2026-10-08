-- App de Compras Spazio — cadastro de fornecedor pelo app (pedido do Ivan, 08/10/2026).
--
-- Cupom que para em "fornecedor não encontrado no Sischef": o Ivan confere o CNPJ, o app consulta os dados públicos e ele toca em "Cadastrar no SisChef"; o
-- robô cadastra pelo formulário (Cadastros › Pessoas › Novo › Fornecedor) e grava o resultado aqui.
--
-- fornecedor_cadastro: um pedido por toque (estado PENDENTE -> PROCESSANDO -> CADASTRADO | JA_EXISTIA | REVISAR; `motivo` quando REVISAR). O Sischef recebe só
-- CNPJ + razão social + estado + município; a FANTASIA nunca vai ao Sischef (regra do Ivan).
-- fornecedor_app: o nome fantasia por CNPJ, só do app (aparece nas informações do lançamento).
-- Só o admin LÊ (RLS); quem escreve é o servidor (Edge Function cadastrar-fornecedor e o robô, com a service_role).

create table public.fornecedor_cadastro (
  id            uuid primary key default gen_random_uuid(),
  cnpj          text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social  text not null check (char_length(btrim(razao_social)) between 1 and 200),
  nome_fantasia text check (nome_fantasia is null or char_length(nome_fantasia) <= 200),
  uf            text not null check (uf ~ '^[A-Z]{2}$'),
  municipio     text not null check (char_length(btrim(municipio)) between 1 and 120),
  cupom_id      uuid,
  estado        text not null default 'PENDENTE' check (estado in ('PENDENTE', 'PROCESSANDO', 'CADASTRADO', 'JA_EXISTIA', 'REVISAR')),
  motivo        text,
  pessoa_id     text,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- no máximo UM pedido em andamento por CNPJ (toque duplo, duas abas): o segundo recebe o já existente
create unique index fornecedor_cadastro_em_andamento on public.fornecedor_cadastro (cnpj) where estado in ('PENDENTE', 'PROCESSANDO');
create index fornecedor_cadastro_cnpj on public.fornecedor_cadastro (cnpj, criado_em desc);

create table public.fornecedor_app (
  cnpj          text primary key check (cnpj ~ '^[0-9]{14}$'),
  razao_social  text not null,
  nome_fantasia text,
  atualizado_em timestamptz not null default now()
);

alter table public.fornecedor_cadastro enable row level security;
alter table public.fornecedor_app enable row level security;
create policy fornecedor_cadastro_ler on public.fornecedor_cadastro for select to authenticated using (eh_admin());
create policy fornecedor_app_ler on public.fornecedor_app for select to authenticated using (eh_admin());

revoke all on public.fornecedor_cadastro, public.fornecedor_app from public, anon, authenticated;
grant select on public.fornecedor_cadastro, public.fornecedor_app to authenticated;
grant all on public.fornecedor_cadastro, public.fornecedor_app to service_role;
