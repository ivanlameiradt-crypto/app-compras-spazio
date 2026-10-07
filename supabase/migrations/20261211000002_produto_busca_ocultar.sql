-- App de Compras Spazio — Fase 3: esconder produto da caixa de associação ("Lançamento fiscal").
--
-- Pedido do Ivan (06/10, à noite): MAIONESE ALHO NEGRO (3661381) e MAIONESE DA CASA (3661383) são produtos que a casa PRODUZ, com receita — não são de
-- compra, então não devem aparecer como opção ao associar o item de uma nota. Eles continuam em itens_semana (a lista semanal vem do SisChef, ali já têm
-- quantidade 0 e ficam de fora da compra): o que muda é só a caixa de associação, que passa a ignorar o produto marcado `ocultar`.
--
-- A linha de cot_produto_busca agora pode existir SÓ para esconder o produto (sem palavras nem nome corrigido); fora isso continua valendo a regra de que
-- uma linha precisa dizer alguma coisa. cot_produto_lembrar não mexe em `ocultar` (só em `palavras`), e a leitura (RLS de admin) vale para a coluna nova.

alter table public.cot_produto_busca add column ocultar boolean not null default false;

alter table public.cot_produto_busca drop constraint cot_produto_busca_check;
alter table public.cot_produto_busca add constraint cot_produto_busca_vazia_check
  check (ocultar or btrim(coalesce(palavras, '')) <> '' or btrim(coalesce(nome_corrigido, '')) <> '');   -- linha sem nada para dizer (e sem esconder) não existe
