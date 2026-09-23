# App de Compras Spazio

Lista de compra da semana no celular: o administrador revisa e aprova, os funcionários compram item a item
por loja, e cada compra fechada entra na fila de lançamento no SisChef.

- Spec: `docs/superpowers/specs/2026-09-22-app-compras-design.md`
- Dados: Supabase (migrations em `supabase/migrations`). A lista chega toda segunda pelo robô `compra-semanal`.
- Rodar local: copiar `.env.example` para `.env.local`, `npm install`, `npm run dev`.
- Testes: `npm test` (inclui SQL/RLS num Postgres em memória).
- Publicação: push na `main` → GitHub Actions → GitHub Pages. Variáveis do repositório:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (chave pública; a segurança está nas regras do banco).
  `npm run build` falha se alguma faltar (só em modo produção — dev e testes funcionam sem elas), pra
  não publicar por engano um build apontando pro `localhost` do dev.
- Primeiro administrador (uma vez só, no painel do Supabase — a tela Pessoas só funciona quando já
  existe um administrador):
  1. Authentication → Users → Add user: e-mail `ivan@spazio.invalid`, com uma senha (marcar
     "Auto Confirm User").
  2. SQL Editor:
     `insert into usuarios (email, nome, papel) values ('ivan@spazio.invalid', 'Ivan', 'admin');`

  Ele entra no app com o usuário `ivan`. Todos os demais acessos são criados pela tela Pessoas.
- **Login com usuário + senha (P1):** cadastro público fica desligado no Supabase (Authentication →
  Providers → Email → "Allow new users to sign up" desmarcado). Criar acesso e redefinir senha
  passam pela Edge Function `gerenciar-usuarios`, que precisa estar publicada:
  `supabase functions deploy gerenciar-usuarios --project-ref <ref>`. Ela usa a `service_role` key
  só no servidor (nunca no celular) e confere que quem chama é um administrador ativo.
  Senha inicial padrão: `123456` (o app obriga a pessoa a trocar no primeiro acesso).
