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
  (correção de 06/10, já publicada).

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

## Regra 3 (Ivan, 06/10/2026): nota que não dá para lançar pode ser descartada
- Nota sem itens ("xml resumido"), com item sem produto, conta especial ou parada pelo robô ganha o botão **Descartar nota** (2 toques).
- Descartar **só tira a nota da lista do app**: nada muda no SisChef nem na SEFAZ, a compra continua pendente lá e **sem entrada no estoque nem no financeiro**.
- Desfaz em **Notas descartadas → Voltar para a fila**. Se o XML completo chegar depois, o app avisa.
- Nunca vale para nota "pela metade" (erro) nem para a que o robô está lançando.
- Decisão do Ivan: nota com informação faltando (XML incompleto, feita errada pelo fornecedor) **não é lançada no sistema**: ele descarta.
  (Alternativa que ele dispensou: pedir a ciência da operação no SisChef ou o XML ao fornecedor.)

## Regra 4 (Ivan, 06/10/2026): parcelas digitadas — a soma tem de ser igual ao valor da nota
- Nas parcelas que você digita no app, os valores **podem ser iguais ou diferentes**. O que importa: **a soma das parcelas é igual ao valor da nota, ao centavo**. Se for diferente, dá erro
  (o app trava o Lançar e diz quanto falta ou passou; a função e o robô também recusam).
- Ajuste de 06/10: o app e a função aceitavam 1 centavo de diferença e o robô recusava depois; agora os três são exatos. Falta publicar.
- 2º lançamento real (06/10, 19h05): MATEUS 000089282, R$ 430,20, 3 parcelas digitadas de R$ 143,40 (27/10, 06/11, 16/11), NF 89282. Parcelas de valores desiguais ainda não foram provadas ao vivo.
- A aba "Lançamento de nota SEFAZ" passou a se chamar **"Lançamento de fiscal"** (pedido seu). Falta publicar.

## Um robô por vez
- Cada nota leva uns 3 minutos para lançar. Enquanto uma está lançando, o app bloqueia o Lançar das outras (o GitHub guarda só 1 lançamento esperando e cancelaria o resto). Fila automática fica para depois.

## Regras
- **No lançamento real, use só Boleto** até as outras formas serem testadas ao vivo.
- **REGRA (Ivan, 06/10/2026): nota que você revisou no app, com a forma de pagamento escolhida e confirmada (Lançar → Confirmar), é para ser lançada de verdade.** Não pedir nova autorização. A trava `MOTOR_NFE_LIGADO` fica **ligada**.
- O robô ainda para a nota quando algo não bate (item sem produto, conta especial, total diferente, nota que já saiu da fila). Isso protege você, não é falta de autorização.
- Nota "pela metade" (erro) **nunca** se lança de novo pelo app: conferir no Sischef.
- Item sem produto no Sischef ou conta especial (KONDO, Mercado Livre) bloqueia o Lançar.

## Pendências
1. **Já no ar (06/10):** a correção da nota presa, o botão "Descartar nota", a quantidade com vírgula e a nota sem itens travada. Feche e reabra o app para pegar a versão nova.
2. Fila de 06/10 (7 notas, leitura das 15h55). **Só 2 estão com todos os itens associados**: MERCURIO 002270842 (3 boletos do XML:
   pronta, só Lançar) e MATEUS 000089282 (itens ok, mas o XML não traz boletos: você digita a parcela).
   Precisam de associação (item sem produto): SEARA 000187105, MERCURIO 002270833, MATEUS 000089283 e 000089284.
   **MC CONTENTE 000002278 NÃO está pronta**: chegou sem nenhum item e sem XML lido. Causa (print do SisChef, 06/10): a nota está como
   **"xml resumido"** — a SEFAZ só entregou o resumo; o XML completo só vem depois da ciência da operação. Não é XML corrompido.
   O app trava o Lançar dela e oferece "Descartar nota" (decisão sua: nota com informação faltando não é lançada; quem descarta é você).
   (Uma versão anterior deste texto listava a MC CONTENTE como pronta: errado, "todos os itens têm produto" era verdade só porque a lista veio vazia.)
3. **Próxima etapa de desenvolvimento: caixa de associação de itens no app** (ordem combinada: associação no app → o robô aplica a decisão no SisChef → teste acompanhado). Ainda NÃO existe: só a prévia.
4. **FEITO em 06/10 (18h49 Belém): 1º lançamento real pela nuvem** — MERCURIO NF 002270842, R$ 2.922,28, Boleto, 3 parcelas; NF 2270842 no SisChef; conferido por você. A trava `MOTOR_NFE_LIGADO` está `ON`
   (não confundir com `MOTOR_CUPOM_LIGADO`, que é a do cupom). Todo "Confirmar" no app agora lança de verdade.
   Próximo teste: MATEUS 000089282 (R$ 430,20) com UMA parcela de R$ 430,20 (você digita o vencimento).
5. `git pull` do robô no PC (pasta OneDrive/claude nuvem/sischef-monitor-notas).
6. **Renovar o GITHUB_PAT antes de 27/10.**
7. Cotação com vendedores: ensaio 09/10 e piloto 19/10 (sem mudança no app desde 30/09).
