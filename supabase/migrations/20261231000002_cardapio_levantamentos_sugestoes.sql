-- App de Compras Spazio — levantamento de cardápio de concorrente (tabelas cardapio_levantamentos e cardapio_sugestoes).
--
-- POR QUE ESTE ARQUIVO EXISTE (16/11/2026): estas duas tabelas e a leitura do backup foram aplicadas NA PRODUÇÃO pelo Supabase em 12/11 e 13/11
-- (versões 20261112023824 "cardapio_sugestoes_concorrente" e 20261113172208 "backup_leitura_cardapio_levantamentos_sugestoes") sem que o arquivo
-- entrasse neste repositório. O ensaio mensal de restauração monta o esquema SÓ a partir dos arquivos daqui; sem este, ele falhava com
-- "o banco de destino não tem estas tabelas/visões do backup: cardapio_levantamentos, cardapio_sugestoes" (ensaio de 15/11/2026).
-- Conteúdo = o que a produção já tem (idempotente: `if not exists`; rodar de novo não muda nada). Única diferença: o comentário da tabela
-- cardapio_levantamentos aqui não cita o nome do concorrente (o do banco cita); comentário não afeta nada.
-- Nenhuma política de acesso: RLS ligada e sem política = só o service_role (robô e backup) lê e grava; o app (anon/authenticated) não enxerga.
-- DESFAZER: supabase/rollback/20261231000002_cardapio_levantamentos_sugestoes.desfazer.sql

create table if not exists public.cardapio_levantamentos (
  id uuid primary key default gen_random_uuid(),
  loja text not null default 'kukan',
  concorrente text not null,
  concorrente_url text,
  data_levantamento date not null,
  cadastro_lido_em date,
  relatorio_url text,
  resumo text,
  atencoes jsonb not null default '[]'::jsonb,
  analise jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);
comment on table public.cardapio_levantamentos is 'Um levantamento de cardápio de concorrente comparado ao cardápio de uma loja nossa (hoje: um concorrente x Kūkan, 05/11/2026). Guarda o resumo, as atenções do relatório e a análise crítica. Nada aqui cadastra produto no Sischef/iFood.';

create table if not exists public.cardapio_sugestoes (
  id uuid primary key default gen_random_uuid(),
  levantamento_id uuid not null references public.cardapio_levantamentos(id) on delete cascade,
  numero int not null,
  slug text not null,
  grupo_sugerido text not null check (grupo_sugerido in ('comecar','depois','deixar')),
  decisao text not null default 'a_definir' check (decisao in ('a_definir','cadastrar_agora','depois','nao_cadastrar')),
  decisao_obs text,
  decidido_em timestamptz,
  decidido_por text,
  cadastrado_sischef boolean not null default false,
  cadastrado_ifood boolean not null default false,
  concorrente_nome text,
  concorrente_categoria text,
  concorrente_descricao text,
  concorrente_preco numeric(10,2),
  concorrente_qtd int,
  concorrente_url text,
  kukan_nome text,
  kukan_descricao text,
  preco_sugerido numeric(10,2),
  preco_ifood_estimado numeric(10,2),
  preco_justificativa text,
  combo boolean not null default false,
  ingrediente_novo boolean not null default false,
  ingrediente_nota text,
  depende_de int[],
  saiu_do_concorrente boolean not null default false,
  ncm text,
  cest text,
  produto_irmao text,
  onde_entra text,
  atencao text,
  antes_de_cadastrar text,
  foto_status text,
  criado_em timestamptz not null default now(),
  unique (levantamento_id, numero)
);
comment on table public.cardapio_sugestoes is 'Uma linha por ficha do relatório (produto do concorrente que a loja ainda não tem). decisao nasce a_definir: a equipe/Ivan decide depois. cadastrado_* só vira true quando o Ivan autorizar e o produto for de fato criado — nenhuma linha foi cadastrada.';
comment on column public.cardapio_sugestoes.preco_sugerido is 'Proposta do relatório, ancorada nos produtos irmãos da Kūkan. Não há custo/margem calculados (preço de compra = 0 no cadastro).';

create index if not exists cardapio_sugestoes_decisao_idx on public.cardapio_sugestoes (decisao);
alter table public.cardapio_levantamentos enable row level security;
alter table public.cardapio_sugestoes enable row level security;

-- Regra de 13/11/2026: tabela nova precisa de leitura para o service_role, senão o backup diário sai INCOMPLETO sem avisar (HTTP 403).
grant select on public.cardapio_levantamentos, public.cardapio_sugestoes to service_role;
