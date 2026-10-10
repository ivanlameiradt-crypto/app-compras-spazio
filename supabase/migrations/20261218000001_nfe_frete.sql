-- App de Compras Spazio — frete da nota fiscal (pedido do Ivan, 09/10/2026).
--
-- Nota de fora do Pará traz um frete que NÃO está na nota (é pago a outra empresa, num boleto lançado à mão no SisChef por um funcionário). O Ivan marca "Com frete" na nota,
-- digita o valor e o tipo (os mesmos do campo "Tipo do frete" do SisChef) e confirma; o valor segue com o "Lançar" (Edge Function lancar-nfe) e o robô o põe no Complemento do pedido
-- ("Valor do Frete" + "Distribuir entre os itens"). O frete só forma o preço do produto: NUNCA entra no financeiro da nota.
-- Os dois campos vêm juntos ou não vêm; sem frete = os dois nulos. Quem grava é só a função (service_role), na reserva da nota.

alter table public.cot_nfe
  add column frete_valor numeric(12, 2) check (frete_valor is null or (frete_valor > 0 and frete_valor <= 1000000)),
  add column frete_tipo  text check (frete_tipo is null or frete_tipo in ('0', '1', '2', '3', '4', '9')),
  add constraint cot_nfe_frete_junto check ((frete_valor is null) = (frete_tipo is null));
