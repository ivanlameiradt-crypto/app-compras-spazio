-- DESFAZER 20261231000004_cupom_aviso_parado.sql: apaga a marca de "dono já avisado do cupom parado".
-- Antes, desligar o aviso no robô (variável do repositório sischef-monitor-notas AVISO_CUPOM_PARADO=OFF) ou deixar como está: sem a coluna o robô só escreve no log que a
-- migração falta e não avisa. As marcas gravadas se perdem; se a migração for aplicada de novo, os cupons parados naquele momento voltam a nascer marcados (sem aviso).
alter table public.cupom drop column if exists aviso_parado_em;
