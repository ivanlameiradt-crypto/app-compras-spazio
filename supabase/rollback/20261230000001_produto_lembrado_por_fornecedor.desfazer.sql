-- DESFAZER 20261230000001_produto_lembrado_por_fornecedor.sql: apaga só a função (nenhum dado se perde; o app volta a perguntar o produto como antes).
drop function if exists public.cot_nfe_produto_lembrado(text);
