-- App de Compras Spazio — E5, compra repetida nos 3 tipos (pedido do Ivan em 04/11/2026): "o robô tem que identificar que uma nota já lançada, ele tem que informar se for querer ser
-- lançado novamente".
--
-- O app AVISA ("POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total…") e o Ivan decide: "É o mesmo: excluir este envio" ou "É outra compra: lançar mesmo assim".
-- Esta migração guarda a segunda resposta. Quando o Ivan diz "é outra compra", a função confirmar-cupom (ou enviar-compra-avulsa) grava QUANDO e QUEM na própria linha do cupom, e
-- nenhum cadeado confere aquele cupom de novo (as funções, no momento de soltar o cupom para o robô, e o próprio robô, antes de abrir o SisChef). O `motivo` NÃO serve de marca: ele é
-- limpo quando o cupom volta a PENDENTE; o `pagamento` não é lugar de decisão.
--   outra_compra_ok_em  — preenchida = o Ivan já decidiu que esta compra NÃO é repetida.
--   outra_compra_ok_por — o e-mail de quem decidiu (o admin que chamou a função).
-- Nulas por padrão (cupom antigo e cupom novo sem decisão). Só o servidor (service_role) escreve; o admin lê pela RLS que `cupom` já tem (nenhuma política nova). O backup e o robô leem
-- `select *` (pegam as colunas sozinhos).
--
-- ORDEM DE PUBLICAÇÃO (cada passo com a frase do Ivan): ESTA migração primeiro, depois as funções enviar-cupom/confirmar-cupom/enviar-compra-avulsa, depois o app, por último o robô.
-- Função nova sem estas colunas quebra TODA confirmação de cupom (o `lerCupom` do confirmar-cupom já pede `outra_compra_ok_em`), não só o UPDATE: antes de publicar as funções, CONFERIR no banco que as colunas existem. Depois de aplicar, recarregar o cache do PostgREST: `notify pgrst, 'reload schema';` (o Supabase já o faz sozinho a cada alteração de tabela).
-- Idempotente. Para desfazer (só se nenhuma função nova estiver no ar): alter table public.cupom drop column outra_compra_ok_em, drop column outra_compra_ok_por;

alter table public.cupom
  add column if not exists outra_compra_ok_em timestamptz,
  add column if not exists outra_compra_ok_por text;
