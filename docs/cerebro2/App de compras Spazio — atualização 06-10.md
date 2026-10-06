# App de compras Spazio — atualização de 06/10/2026

> Para colar em **40 Notas próprias** do Cérebro 2. Atualiza a nota "App de compras Spazio" (que estava em 30/09).
> Fonte: código do app (GitHub `app-compras-spazio`), robô `sischef-monitor-notas` e banco Supabase, conferidos em 06/10.

## O que vale hoje
- O app tem **3 abas**: Compra em grade · Lançamento de cupom · Lançamento de nota SEFAZ (desde 03/10).
- **Lançamento de cupom** (desde 02/10): lança no Sischef a compra feita com cupom fiscal, pelo robô na nuvem.
- **Lançamento de nota SEFAZ** (desde 05–06/10): lista as notas de fornecedor que estão na fila do Sischef.
  Em cada nota: **Como pagar** (Boleto já vem marcado) e o botão **Lançar** (dois toques). O robô lança na nuvem.
- O app **se atualiza sozinho** ao reabrir (desde 03/10).
- As notas novas chegam ao app **sozinhas 3x por dia: 07h40, 12h40 e 17h40** (desde 06/10). Antes era só à mão.
- Se uma nota ficar "Lançando…" por mais de 30 min, o app avisa para conferir no Sischef e deixa tentar de novo
  (correção de 06/10, falta publicar).

## Pagamento da nota (decisão de 06/10)
- O app pré-marca a forma da **última nota lançada** do fornecedor (guardada no banco, vale em qualquer celular). Sem histórico: Boleto.
- **PIX e cartão nunca são pré-marcados nem lembrados**: a conta/forma é escolhida a cada nota.
- Nota sem boleto: o robô para e você escolhe. Cartão = só estoque, sem pagamento no Sischef.
- Próxima forma a provar depois do Boleto: Dinheiro à vista.

## Regras
- **No lançamento real, use só Boleto** até as outras formas serem testadas ao vivo.
- O lançamento real só acontece com a **trava dupla** ligada (`MOTOR_NFE_LIGADO`). Fora do teste acompanhado ela fica desligada.
- Nota "pela metade" (erro) **nunca** se lança de novo pelo app: conferir no Sischef.
- Item sem produto no Sischef ou conta especial (KONDO, Mercado Livre) bloqueia o Lançar.

## Pendências
1. Publicar a correção da nota presa.
2. Fila de 06/10: 7 notas. Prontas para lançar: MERCURIO 002270842, MATEUS 000089282, MC CONTENTE 000002278.
   Precisam de associação no Sischef: SEARA 000187105, MERCURIO 002270833, MATEUS 000089284 e 000089283.
3. Teste acompanhado: primeiro o ensaio, depois 1 nota real em Boleto.
4. `git pull` do robô no PC (pasta OneDrive/claude nuvem/sischef-monitor-notas).
5. **Renovar o GITHUB_PAT antes de 27/10.**
6. Cotação com vendedores: ensaio 09/10 e piloto 19/10 (sem mudança no app desde 30/09).
