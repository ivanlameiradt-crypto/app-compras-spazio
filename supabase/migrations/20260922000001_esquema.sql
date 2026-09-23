-- App de Compras Spazio — tabelas, funções de apoio e regras de acesso (RLS).
-- Escritas acontecem só pelas funções da migration _rpc; aqui ficam as leituras.

create table public.usuarios (
  email      text primary key check (email = lower(email)),
  nome       text not null,
  papel      text not null check (papel in ('admin', 'comprador')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table public.semanas (
  id               bigint generated always as identity primary key,
  data_referencia  date not null unique,
  status           text not null default 'rascunho' check (status in ('rascunho', 'em_compra', 'encerrada')),
  gerada_em        timestamptz not null default now(),
  aprovada_por     text references public.usuarios (email),
  aprovada_em      timestamptz,
  encerrada_em     timestamptz
);

create table public.itens_semana (
  id                  bigint generated always as identity primary key,
  semana_id           bigint not null references public.semanas (id) on delete cascade,
  produto_id          bigint not null,
  produto             text not null,
  bebida              boolean not null,
  unidade             text not null check (unidade in ('kg', 'un')),
  estoque             numeric not null,
  estoque_minimo      numeric not null default 0,
  qtd_sugerida        numeric not null default 0,
  qtd_aprovada        numeric not null default 0 check (qtd_aprovada >= 0),
  preco_estimado      numeric,
  data_ultima_compra  date,
  fornecedor_ultima   text,
  situacao            text not null,
  negativo            boolean not null default false,
  incluido            boolean not null default false,
  unique (semana_id, produto_id)
);

create table public.compras (
  id           uuid primary key,  -- gerado no celular, para a fila offline não duplicar
  semana_id    bigint not null references public.semanas (id),
  loja         text not null check (length(trim(loja)) > 0),
  comprador    text not null references public.usuarios (email),
  com_nota     boolean,
  foto_cupom   text,
  total_pago   numeric check (total_pago >= 0),
  status       text not null default 'aberta' check (status in ('aberta', 'fechada', 'aprovada', 'lancada')),
  aberta_em    timestamptz not null default now(),
  fechada_em   timestamptz,
  aprovada_por text references public.usuarios (email),
  aprovada_em  timestamptz,
  lancada_por  text references public.usuarios (email),
  lancada_em   timestamptz
);

create table public.compras_itens (
  id              uuid primary key,
  compra_id       uuid not null references public.compras (id) on delete cascade,
  item_semana_id  bigint not null references public.itens_semana (id),
  qtd             numeric not null check (qtd >= 0),
  preco_unit      numeric check (preco_unit >= 0),
  resultado       text not null check (resultado in ('comprado', 'parcial', 'nao_achei')),
  marcado_por     text not null references public.usuarios (email),
  marcado_em      timestamptz not null default now(),
  unique (compra_id, item_semana_id)
);

create table public.historico_alteracoes (
  id        bigint generated always as identity primary key,
  quem      text not null,
  quando    timestamptz not null default now(),
  tabela    text not null,
  registro  text not null,
  antes     jsonb,
  depois    jsonb
);

create index on public.itens_semana (semana_id);
create index on public.compras (semana_id);
create index on public.compras (status);
create index on public.compras_itens (compra_id);
create index on public.compras_itens (item_semana_id);

-- ---------- quem está chamando
create or replace function public.email_atual() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.eh_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = email_atual() and ativo)
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = email_atual() and ativo and papel = 'admin')
$$;

create or replace function public.exigir_ativo() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_ativo() then
    raise exception 'usuário sem acesso ao app' using errcode = '42501';
  end if;
end $$;

create or replace function public.exigir_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_admin() then
    raise exception 'apenas o administrador pode fazer isso' using errcode = '42501';
  end if;
end $$;

-- ---------- RLS (leitura)
alter table public.usuarios enable row level security;
alter table public.semanas enable row level security;
alter table public.itens_semana enable row level security;
alter table public.compras enable row level security;
alter table public.compras_itens enable row level security;
alter table public.historico_alteracoes enable row level security;

create policy usuarios_ler on public.usuarios for select to authenticated
  using (email = email_atual() or eh_admin());
create policy usuarios_incluir on public.usuarios for insert to authenticated
  with check (eh_admin());
create policy usuarios_alterar on public.usuarios for update to authenticated
  using (eh_admin()) with check (eh_admin());

create policy semanas_ler on public.semanas for select to authenticated
  using (eh_admin() or (eh_ativo() and status = 'em_compra'));

create policy itens_ler on public.itens_semana for select to authenticated
  using (eh_admin() or (eh_ativo() and incluido and exists (
    select 1 from semanas s where s.id = semana_id and s.status = 'em_compra')));

create policy compras_ler on public.compras for select to authenticated
  using (eh_admin() or (eh_ativo() and exists (
    select 1 from semanas s where s.id = semana_id and s.status = 'em_compra')));

create policy compras_itens_ler on public.compras_itens for select to authenticated
  using (eh_admin() or (eh_ativo() and exists (
    select 1 from compras c join semanas s on s.id = c.semana_id
     where c.id = compra_id and s.status = 'em_compra')));

create policy historico_ler on public.historico_alteracoes for select to authenticated
  using (eh_admin());

-- ---------- permissões
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update on public.usuarios to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.email_atual(), public.eh_ativo(), public.eh_admin() to authenticated;
