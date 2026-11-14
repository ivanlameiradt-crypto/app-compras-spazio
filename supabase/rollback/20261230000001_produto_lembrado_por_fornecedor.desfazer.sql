-- DESFAZER 20261230000001_produto_lembrado_por_fornecedor.sql: apaga as três funções e a coluna lembrado_recusado (perde-se só a lista de recusas; as decisões
-- gravadas com origem 'lembrado' continuam em associacoes_app e o robô as trata como decisão normal). O app volta a perguntar o produto como antes.
drop function if exists public.cot_nfe_produto_lembrado(text);
drop function if exists public.cot_nfe_associar_lembrado(text, integer, bigint, numeric);
drop function if exists public.cot_nfe_recusar_lembrado(text, integer);
drop function if exists public.cot_nfe_lembrado_calcular(text);
alter table public.cot_nfe drop constraint if exists cot_nfe_lembrado_recusado_forma;
alter table public.cot_nfe drop column if exists lembrado_recusado;
