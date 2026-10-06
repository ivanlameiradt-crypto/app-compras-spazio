-- App de Compras Spazio — Fase 3: parcelas que o Ivan DIGITA quando o XML não traz as duplicatas (falha do fornecedor).
--
-- Caso real de 06/10/2026: o XML da MATEUS SUPERMERCADOS não traz a forma de pagamento nem as duplicatas (cobr/dup), mas a compra é
-- em boleto. A aba "Lançamento de nota SEFAZ" deixa o Ivan digitar as parcelas (vencimento e valor) e a Edge Function lancar-nfe
-- grava aqui o que foi mandado ao robô, para a tela mostrar de novo se a nota voltar para revisão (nada de digitar tudo outra vez)
-- e para auditoria. É DIFERENTE de cot_nfe.parcelas, que é só o que veio do XML e que a leitura da SEFAZ reescreve a cada rodada.
--
-- parcelas_manuais: jsonb array de {vencimento 'aaaa-mm-dd', valor}, 1 a 60 itens, ou NULL (nada digitado). Só a Edge Function grava
-- (service_role, passa pela RLS); authenticated só lê, pelo SELECT que o admin já tem na tabela. Sem função nova.

alter table public.cot_nfe
  add column if not exists parcelas_manuais jsonb
    check (parcelas_manuais is null
           or (jsonb_typeof(parcelas_manuais) = 'array' and jsonb_array_length(parcelas_manuais) between 1 and 60));
