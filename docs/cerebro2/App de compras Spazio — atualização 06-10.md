# App de compras Spazio — atualização de 06/10/2026

> Para colar em **40 Notas próprias** do Cérebro 2. Atualiza a nota "App de compras Spazio" (que estava em 30/09).
> Fonte: código do app (GitHub `app-compras-spazio`), robô `sischef-monitor-notas` e banco Supabase, conferidos em 06/10.

## O que vale hoje
- O app tem **3 abas**: Compra em grade · Lançamento de cupom · **Lançamento de fiscal** (desde 03/10; até 06/10 chamava-se "Lançamento de nota SEFAZ").
- **Lançamento de cupom** (desde 02/10): lança no Sischef a compra feita com cupom fiscal, pelo robô na nuvem.
- **Lançamento de fiscal** (desde 05–06/10): lista as notas de fornecedor que estão na fila do Sischef.
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
- **Provado ao vivo em 06/10** com a MATEUS 000089282 (R$ 430,20, 3 parcelas digitadas). Parcelas de valores diferentes ainda não foram provadas.

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
- Ajuste de 06/10: o app e a função aceitavam 1 centavo de diferença e o robô recusava depois; agora os três são exatos. **No ar desde 06/10** (app + função do servidor v5).
- 2º lançamento real (06/10, 19h05): MATEUS 000089282, R$ 430,20, 3 parcelas digitadas de R$ 143,40 (27/10, 06/11, 16/11), NF 89282. Parcelas de valores desiguais ainda não foram provadas ao vivo.
- A aba "Lançamento de nota SEFAZ" passou a se chamar **"Lançamento de fiscal"** (pedido seu). No ar.
- No painel "Conferir itens e financeiro", o texto "associado no SisChef" saiu: o produto já associado agora leva um **✓ verde na frente do nome**. Item sem produto continua com o aviso escrito.
  Você aprovou a prévia e já está no ar.

## Um robô por vez
- Cada nota leva uns 3 minutos para lançar. Enquanto uma está lançando, o app bloqueia o Lançar das outras (o GitHub guarda só 1 lançamento esperando e cancelaria o resto). Fila automática fica para depois.

## Regras
- **No lançamento real, use só Boleto** até as outras formas serem testadas ao vivo.
- **REGRA (Ivan, 06/10/2026): nota que você revisou no app, com a forma de pagamento escolhida e confirmada (Lançar → Confirmar), é para ser lançada de verdade.** Não pedir nova autorização. A trava `MOTOR_NFE_LIGADO` fica **ligada**.
- O robô ainda para a nota quando algo não bate (item sem produto, conta especial, total diferente, nota que já saiu da fila). Isso protege você, não é falta de autorização.
- Nota "pela metade" (erro) **nunca** se lança de novo pelo app: conferir no Sischef.
- Item sem produto no Sischef ou conta especial (KONDO, Mercado Livre) bloqueia o Lançar.

## Pedidos de 06/10 à noite — NO AR (3ª publicação do dia)
- A aba passa a se chamar **"Lançamento fiscal"** (sem o "de"; "Lançamento de cupom" não muda).
- **Últimos lançamentos:** cada item mostra o **número do produto no SisChef** (o código do fornecedor, "CÓD. FOR", saiu) e o detalhe mostra **"Lançada em dia/mês às hora"**. A quantidade vem só como número e unidade ("3,09 kg", "180 un"), sem "qtd" (no cupom ainda aparece "qtd").
- **Caixa de associação de produto (etapa 1):** em cada item sem produto você digita o produto (lista de insumos que já está no app), escolhe, toca em **Confirmar** e o item ganha o **✓ verde
  "confirmado no app"** (dá para Trocar ou Desfazer). Se a unidade da nota difere da do produto (UN × KG) o app avisa que a conversão será pedida na etapa do robô.
- **Atenção: a etapa 1 só guarda a sua escolha.** O Lançar dessas notas continua travado até a **etapa 2** (o robô aplicar a associação no SisChef), que precisa do seu OK e de um teste acompanhado.
  Cuidado: o SisChef guarda a associação para as próximas notas do fornecedor, então uma associação errada se repete.
- A busca digitada acha os produtos da lista de insumos do app (renovada toda segunda-feira). **Produto novo criado no SisChef no meio da semana** (ex.: CHOCOLATE BIS ORIGINAL, cód. 3476455, que você
  ajustou em 06/10) aparece pela **"Sugestão do robô"** do item, marcado "produto novo no SisChef": o robô já enxerga o produto no SisChef. A unidade desse produto fica em branco.

- **Ajuste (06/10, noite):** o editor das parcelas do boleto (MATEUS) e o "Como pagar" não abriam enquanto a nota esperava produto no SisChef. Agora abrem; o Lançar continua travado até os produtos
  estarem associados. O que você digita fica guardado neste aparelho e sobrevive a recarregar a página.

## Noite de 06/10 — sua planilha de palavras-chave (no banco) e o que está pronto para publicar
- **Planilha carregada no banco** (230 produtos: 227 com palavras-chave, 35 com nome corrigido), como você escreveu. Dois ajustes meus: "FARINHA DESÊMOLA" virou **"FARINHA DE SÊMOLA - INSUMOS (KG)"**
  (parecia "de sêmola" sem espaço) e o queijo muçarela ganhou **"queijo muss"** (pedido seu). As duas linhas de MAIONESE que você apagou continuam na lista; me diga se é para escondê-las da busca.
- **Pronto, mas AINDA NÃO publicado (espera o seu "pode publicar"):** a caixa de associação acha por palavra-chave e pelo nome corrigido, e **sugere** o produto pelas suas palavras ("queijo muss" = mussarela);
  quando nada bate com todas as palavras mostra os mais parecidos (não termina em "nada"); a opção **"Lembrar esta descrição"** (marcada) guarda a descrição da nota como palavra-chave do produto para a próxima vez;
  o painel de itens abre sozinho; o **botão Lançar apagado agora diz o motivo logo embaixo e qual produto associar no SisChef**; e, no cupom, cada envio parado mostra **"O que está errado" e "Como resolver"**.
- **Por que o Lançar das 4 notas está apagado:** todas têm item sem produto **no SisChef**. Confirmar no app só guarda a sua escolha; o robô ainda **não aplica** a escolha no SisChef (etapa 2). Para lançar hoje:
  associar os 6 itens no SisChef (e me avisar para eu atualizar a leitura).
- **Cupom do ATACADAO (R$ 35,27) parado:** 2 itens (LIMAO SICILIANO, PEPINO JAPONES) sem produto **confirmado**; o robô nunca chuta. Falta você confirmar os 2 casamentos e dizer os pesos (kg) deles (o
  sistema não guardou). Reenviar a foto não resolve.
- **Seu pedido "confirmou → o robô lança" (nota e cupom)** é a **etapa 2**: ainda não existe. A primeira vez tem de ser **acompanhada por você, numa nota de valor baixo** (o SisChef guarda a associação para as
  próximas notas do fornecedor). A planilha só **sugere**: ela não tem a conversão (UN×KG, caixa×kg).

## Pendências
1. **Já no ar (06/10):** a correção da nota presa, o botão "Descartar nota", a quantidade com vírgula e a nota sem itens travada. Feche e reabra o app para pegar a versão nova.
   **Também no ar (2ª publicação de 06/10):** a Regra 4 (soma exata das parcelas), a aba "Lançamento de fiscal" (depois trocada por "Lançamento fiscal", 3ª publicação) e o ✓ verde no painel de conferir.
2. Fila de 06/10 (conferida no banco às 19h35). **Já lançadas:** MERCURIO 002270842 e MATEUS 000089282. **Ainda a lançar, todas com item sem produto** (o app trava o Lançar):
   MERCURIO 002270833 (1 item, LAGARTO RESF) · MATEUS 000089284 (3 de 8 itens: CHOC LACTA BIS, LEITE COND TIROL, ÓLEO SOJA) · MATEUS 000089283 (1 item, queijo muçarela, R$ 5.417,31) · SEARA 000187105 (1 item).
   Saída: associar no SisChef, ou a caixa de associação no app (item 3). **MC CONTENTE 000002278**: chegou sem nenhum item ("xml resumido": a SEFAZ só entregou o resumo; o XML completo só vem
   depois da ciência da operação). Decisão sua: nota com informação faltando não é lançada; você a descartou (descartar só a tira do app; a compra segue pendente no SisChef).
3. **Caixa de associação de itens no app:** etapa 1 no ar (seção acima). Falta a **etapa 2: o robô aplicar a decisão no SisChef** (ordem combinada:
   associação no app → o robô aplica → teste acompanhado numa nota de valor baixo; a conversão UN × KG precisará de um campo "quanto vale 1 UN em KG").
4. **FEITO em 06/10 (18h49 Belém): 1º lançamento real pela nuvem** — MERCURIO NF 002270842, R$ 2.922,28, Boleto, 3 parcelas; NF 2270842 no SisChef; conferido por você. A trava `MOTOR_NFE_LIGADO` está `ON`
   (não confundir com `MOTOR_CUPOM_LIGADO`, que é a do cupom). Todo "Confirmar" no app agora lança de verdade.
   2º lançamento real também feito: MATEUS 000089282, 3 parcelas digitadas de R$ 143,40. Próximo teste: uma nota com parcelas de VALORES DIFERENTES (prova a escrita do valor da parcela no SisChef).
5. `git pull` do robô no PC (pasta OneDrive/claude nuvem/sischef-monitor-notas).
6. **Renovar o GITHUB_PAT antes de 27/10.**
7. Cotação com vendedores: ensaio 09/10 e piloto 19/10 (sem mudança no app desde 30/09).
