-- App de Compras Spazio — Fase 3, Passo 4 (lançar a NF-e): trava de idempotência.
-- A cot_nfe não tinha um estado "lançando". A coluna lancamento_em marca a tentativa em curso, para o
-- disparo (Edge Function lancar-nfe, service_role) não lançar a MESMA nota 2× — claim atômico: a função
-- só pega uma nota 'na_fila' cujo lancamento_em seja nulo ou antigo (> 30 min, tentativa que não concluiu).
-- O claim é escrito pela Edge Function (service_role passa pela RLS); NENHUMA função nova granted a anon,
-- de propósito, para não mexer nas travas de permissão (permissoes/nfe/cotacao-seguranca/fase2-base).
alter table public.cot_nfe add column if not exists lancamento_em timestamptz;
