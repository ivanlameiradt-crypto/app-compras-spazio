-- DESFAZER 20261231000002_cardapio_levantamentos_sugestoes.sql
-- ATENÇÃO: APAGA as duas tabelas e TODAS as linhas delas (levantamento de cardápio de concorrente e as sugestões). Só rodar se esse levantamento
-- não for mais necessário, e depois de um backup (o backup diário já leva as duas). Se só quiser tirar a leitura do backup:
--   revoke select on public.cardapio_levantamentos, public.cardapio_sugestoes from service_role;   (o backup volta a sair INCOMPLETO)
drop table if exists public.cardapio_sugestoes;
drop table if exists public.cardapio_levantamentos;
