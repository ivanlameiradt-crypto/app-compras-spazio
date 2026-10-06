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

## Regra 2 (Ivan, 06/10/2026): nota pronta = só Lançar
- Nota toda correta (itens associados conforme o XML, pagamento em boleto, financeiro batendo) vem com **só o botão Lançar**, mais uma área para **abrir e conferir** itens associados e financeiro.
- Quando você tiver certeza de que um fornecedor já "aprendeu", só confirma. Critério combinado: 3 notas seguidas do fornecedor lançadas sem erro e sem você mudar nada.
- **No ar desde 06/10 (18h).** A leitura baixa o XML de todas as notas e grava os boletos. Nota pronta mostra o selo e só o Lançar; o painel "Conferir itens e financeiro" abre itens e parcelas. Notas de supermercado (MATEUS) vêm sem boleto (à vista): você escolhe como pagar.

## Regra provisória: MATEUS SUPERMERCADOS (CNPJ 03995515011363)
- O XML da MATEUS vem **sem forma de pagamento e sem duplicatas**: falha do fornecedor. Nas 3 notas de 06/10 era **boleto**, mas você também compra da MATEUS no **cartão de crédito** e em outras formas. **Não é regra fixa.**
- Até corrigirem: o app não assume forma nenhuma para essas notas e você **informa o pagamento nota a nota**. Nunca viram "pronta" nem "fornecedor aprendido".
- Quando a MATEUS corrigir o XML, você me avisa e a regra é encerrada.
- **Como informar o boleto:** na nota aparece um editor para você digitar as parcelas (vencimento e valor). O Lançar só libera quando a soma fecha com o valor da nota. O robô escreve essas parcelas na tela de pagamento do Sischef e confere antes de gravar.
- **Ainda não foi provado ao vivo.** O primeiro teste deve ser a menor nota da MATEUS (000089282, R$ 430,20).

## Um robô por vez
- Cada nota leva uns 3 minutos para lançar. Enquanto uma está lançando, o app bloqueia o Lançar das outras (o GitHub guarda só 1 lançamento esperando e cancelaria o resto). Fila automática fica para depois.

## Regras
- **No lançamento real, use só Boleto** até as outras formas serem testadas ao vivo.
- **REGRA (Ivan, 06/10/2026): nota que você revisou no app, com a forma de pagamento escolhida e confirmada (Lançar → Confirmar), é para ser lançada de verdade.** Não pedir nova autorização. A trava `MOTOR_NFE_LIGADO` fica **ligada**.
- O robô ainda para a nota quando algo não bate (item sem produto, conta especial, total diferente, nota que já saiu da fila). Isso protege você, não é falta de autorização.
- Nota "pela metade" (erro) **nunca** se lança de novo pelo app: conferir no Sischef.
- Item sem produto no Sischef ou conta especial (KONDO, Mercado Livre) bloqueia o Lançar.

## Pendências
1. Publicar a correção da nota presa.
2. Fila de 06/10 (7 notas, leitura das 15h55). **Só 2 estão com todos os itens associados**: MERCURIO 002270842 (3 boletos do XML:
   pronta, só Lançar) e MATEUS 000089282 (itens ok, mas o XML não traz boletos: você digita a parcela).
   Precisam de associação (item sem produto): SEARA 000187105, MERCURIO 002270833, MATEUS 000089283 e 000089284.
   **MC CONTENTE 000002278 NÃO está pronta**: chegou sem nenhum item e sem XML lido (o robô não conseguiu ler essa nota no SisChef;
   causa ainda não confirmada — hipótese: fornecedor novo, não cadastrado no SisChef). O app trava o Lançar dela.
   (Uma versão anterior deste texto listava a MC CONTENTE como pronta: errado, "todos os itens têm produto" era verdade só porque a lista veio vazia.)
3. Ligar `MOTOR_NFE_LIGADO=ON` (só você consegue, é secret do GitHub) e lançar a 1ª nota real em Boleto.
4. `git pull` do robô no PC (pasta OneDrive/claude nuvem/sischef-monitor-notas).
5. **Renovar o GITHUB_PAT antes de 27/10.**
6. Cotação com vendedores: ensaio 09/10 e piloto 19/10 (sem mudança no app desde 30/09).
