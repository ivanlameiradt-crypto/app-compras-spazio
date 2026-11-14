// Regras puras da tela "Lançar cupom": por que um envio ficou parado ("precisa de você") e o que fazer para o robô poder lançá-lo.
// Pedido do Ivan (06/10, à noite): em vez de "confira no Code", dizer o que está errado e qual é a solução. Sem rede nem React.
//
// As causas vêm de quem marca REVISAR: a Edge Function enviar-cupom (foto ilegível, item sem produto confirmado, total não lido), o robô
// (cupom_lancar / lancar_cupom_nuvem: validação, forma de pagamento, falha no SisChef) e o reaper (cupom preso). O roteiro de correção, que é o
// que o "Claude" segue quando o Ivan pede, está em docs/corrigir-cupom.md do repositório do robô (sischef-monitor-notas).
import { formatarReais } from '../lib/regras'
import type { CupomRecente, ItemCupomRecente } from '../lib/tipos'

export interface ItemComProblema { descricao: string; preco: string | null }
/** O motivo que o envio grava quando o cupom está todo casado e só espera o Ivan confirmar (o mesmo texto das Edge Functions enviar-cupom e confirmar-cupom). */
export const CONFIRMAR_PREFIXO = 'CONFIRMAR:'

export interface DiagnosticoCupom {
  /** O que está errado, em uma frase que o Ivan entende. */
  problema: string
  /** Os itens que travam o cupom (só quando o problema é de produto): o que o cupom diz de cada um. */
  itens: ItemComProblema[]
  /** O que o Ivan precisa INFORMAR, item a item ("LIMAO SICILIANO: confirmar que é LIMÃO SICILIANO - INSUMOS (cód. 3484974) e dizer o peso (kg) que está no cupom."). */
  pedidos: string[]
  /** Para ele conferir a própria resposta: quanto os itens sem peso devem somar (total do cupom − itens já confirmados), ou null se não dá para calcular. */
  conferencia: string | null
  /** O que fazer para o cupom ficar apto a ser lançado pelo robô. */
  solucao: string
  /**
   * A correção pode ser feita na própria tela (item sem produto confirmado, com o total lido): o Ivan escolhe o produto e digita a quantidade,
   * e a Edge Function confirmar-cupom refaz e reenvia. Nos outros casos o caminho continua sendo o Claude/SisChef.
   */
  corrigivel: boolean
  /** Só quando o próprio texto do robô PROVA que nada foi criado no SisChef (falha passageira antes de "Gerar compra"): repetir é seguro. Ausente = nunca oferecer repetir. */
  tentarDeNovo?: true
}

const semProdutoConfirmado = (it: ItemCupomRecente): boolean => String(it.sugestao_produto?.id ?? '').trim() === ''
/** Nem a entrada no estoque nem a quantidade lida no cupom existem: o peso só está na foto/no papel. */
const semQuantidade = (it: ItemCupomRecente): boolean => it.entrada_estoque == null && it.quantidade_cupom == null

/** O que o cupom pede ao Ivan sobre UM item: confirmar o produto (a proposta do sistema, ou dizer qual é) e, se o peso não ficou guardado, dizer o peso. */
const GRANDEZA_PESO = /^(kg|g|gr|l|lt|ml)$/i
function pedidoDe(it: ItemCupomRecente): string {
  const desc = (it.descricao_cupom ?? '').trim() || 'item'
  const id = String(it.proposta?.insumo_id ?? '').trim()
  const nome = (it.proposta?.insumo_nome ?? '').trim()
  const produto = id === '' ? 'dizer qual é o produto do SisChef' : `confirmar que é ${nome !== '' ? `${nome} (cód. ${id})` : `o produto de cód. ${id}`}`
  const un = (it.unidade_cupom ?? '').trim().toLowerCase()
  // a quantidade só é pedida quando NINGUÉM a tem: nem a entrada no estoque nem a quantidade lida no cupom (envios a partir da v2 a guardam)
  const falta = semQuantidade(it) ? ` e dizer ${GRANDEZA_PESO.test(un) ? 'o peso' : 'a quantidade'}${un !== '' ? ` (${un})` : ''} que está no cupom` : ''
  return `${desc}: ${produto}${falta}.`
}

/** Pedaço da resposta de exemplo para UM item ("LIMAO SICILIANO: confirmo, __ kg"). */
function exemploDe(it: ItemCupomRecente): string {
  const desc = (it.descricao_cupom ?? '').trim() || 'item'
  const un = (it.unidade_cupom ?? '').trim().toLowerCase()
  const resposta = String(it.proposta?.insumo_id ?? '').trim() === '' ? 'é <produto>' : 'confirmo'
  return `${desc}: ${resposta}${semQuantidade(it) ? `, __ ${un || 'quantidade'}` : ''}`
}

/**
 * Quanto os itens pendentes devem somar para o cupom fechar: total do cupom − o que os itens já confirmados valem (entrada × preço − desconto, a mesma conta
 * do robô). Só quando NENHUM item pendente tem quantidade conhecida (nem entrada no estoque nem a lida no cupom — senão a conta mistura o que já se sabe) e o total foi lido.
 */
function conferenciaDaSoma(c: CupomRecente, itens: ItemCupomRecente[], travando: ItemCupomRecente[]): string | null {
  const total = c.valor_a_pagar
  if (total == null || !(total > 0) || !travando.every(semQuantidade)) return null
  let confirmados = 0
  for (const it of itens) {
    if (semProdutoConfirmado(it)) continue
    const q = Number(it.entrada_estoque)
    const v = Number(it.valor_unitario)
    if (!Number.isFinite(q) || !Number.isFinite(v)) return null
    const d = Number(it.desconto_item ?? 0)
    confirmados += q * v - (Number.isFinite(d) ? d : 0)
  }
  confirmados = Math.round(confirmados * 100) / 100
  const resto = Math.round((total - confirmados) * 100) / 100
  if (!(resto > 0)) return null
  const n = travando.length
  return `O cupom é ${formatarReais(total)}${confirmados > 0 ? ` e os itens já confirmados somam ${formatarReais(confirmados)}` : ''}: ${n === 1 ? 'este item deve dar' : 'estes itens devem somar'} ${formatarReais(resto)} (peso × preço, com até 2 centavos de diferença).`
}

/** "R$ 13,90 por KG": o valor_unitario do cupom é o preço de UMA unidade (kg, un). */
function precoDe(it: ItemCupomRecente): string | null {
  if (it.valor_unitario == null || !Number.isFinite(Number(it.valor_unitario))) return null
  const un = (it.unidade_cupom ?? '').trim()
  return `${formatarReais(Number(it.valor_unitario))}${un !== '' ? ` por ${un.toUpperCase()}` : ''}`
}

const CLAUDE = 'Peça ao Claude'

/**
 * Envio REPETIDO de um cupom que já foi lançado em outro envio (o robô marca REVISAR com "JÁ LANÇADO em outro envio"): a compra já está no
 * SisChef, então não há nada a corrigir — a tela o mostra como concluído, sem o bloco "precisa de você" (pedido do Ivan, 07/10: "não precisa
 * relatar algo que já foi feito").
 */
export const envioRepetido = (c: CupomRecente): boolean => c.estado === 'REVISAR' && /já lançado em outro envio/i.test(c.motivo ?? '')

// ---------- compra repetida (E5, pedido do Ivan de 04/11/2026)
/** O que o servidor (enviar-cupom e confirmar-cupom) e o robô gravam no começo do aviso, sempre no FIM do motivo: "CONFIRMAR: …; POSSÍVEL REPETIDA: …". Igual ao de parecida.ts das três funções (supabase/functions). */
export const REPETIDA_PREFIXO = 'POSSÍVEL REPETIDA: '
/** O trecho do aviso (do prefixo até o fim do motivo), ou null. */
export function trechoDaRepetida(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(REPETIDA_PREFIXO)
  return i < 0 ? null : m.slice(i)
}
/** O motivo sem o aviso (e sem o "; " que o separava); vazio quando o aviso era o motivo inteiro (o caso do robô). */
export function motivoSemRepetida(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(REPETIDA_PREFIXO)
  return i < 0 ? m : m.slice(0, i).replace(/[;\s]+$/, '').trim()
}
/**
 * O aviso "parece repetida" deste envio, para o cartão mostrar com os dois botões. Só no REVISAR que ainda NÃO tem pedido no SisChef e não parou no meio dele (aí a compra PODE existir lá e a decisão
 * é conferir no SisChef, não um botão). `texto` é a frase sem o prefixo; `sobraMotivo` diz se há outro motivo além do aviso (então "É outra compra" só anota e o cupom segue pelos botões de sempre).
 */
export function repetidaDoCupom(c: CupomRecente): { texto: string; sobraMotivo: boolean } | null {
  if (c.estado !== 'REVISAR' || c.pedido_sischef != null || parouNoMeioDoSischef(c)) return null
  const trecho = trechoDaRepetida(c.motivo)
  if (trecho === null) return null
  return { texto: trecho.slice(REPETIDA_PREFIXO.length).trim(), sobraMotivo: motivoSemRepetida(c.motivo) !== '' }
}

/** O erro que uma tela recebeu é o aviso de repetida do servidor? Pelo TEXTO (começa pelo prefixo), não pela classe: vale com qualquer cópia do módulo e com o corpo da resposta já lido. */
export const ehErroRepetida = (e: unknown): e is Error => e instanceof Error && e.message.startsWith(REPETIDA_PREFIXO)

// ---------- "não consegui conferir" (E5, ajuste 2 da revisão do código, 05/11/2026)
/** O que o robô grava, SOZINHO como motivo, quando NÃO conseguiu conferir se a compra é repetida (falha passageira do banco; nada foi feito no SisChef). Igual ao de parecida.ts das três funções e ao do robô (cupom_repetida.py). */
export const FALHA_PREFIXO = 'CONFERÊNCIA DE REPETIDA FALHOU: '
/** O trecho da falha (do prefixo até o fim do motivo), ou null. */
export function trechoDaFalha(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(FALHA_PREFIXO)
  return i < 0 ? null : m.slice(i)
}
/** O motivo sem o trecho da falha (e sem o "; " que o separava); vazio quando a falha era o motivo inteiro (o caso do robô). */
export function motivoSemFalha(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(FALHA_PREFIXO)
  return i < 0 ? m : m.slice(0, i).replace(/[;\s]+$/, '').trim()
}
/**
 * O aviso "não consegui conferir" deste envio, para o cartão mostrar com "Tentar de novo" (o servidor confere DE NOVO e só então solta). Só no REVISAR que ainda NÃO tem pedido no SisChef, não parou no meio dele e cujo
 * motivo é SÓ a falha: o servidor só aceita a falha sozinha (com outro motivo junto, os botões de sempre já refazem a conferência). `texto` é a frase sem o prefixo.
 */
export function falhaDeConferirDoCupom(c: CupomRecente): { texto: string } | null {
  if (c.estado !== 'REVISAR' || c.pedido_sischef != null || parouNoMeioDoSischef(c)) return null
  if (trechoDaRepetida(c.motivo) !== null) return null
  const trecho = trechoDaFalha(c.motivo)
  if (trecho === null || motivoSemFalha(c.motivo) !== '') return null
  return { texto: trecho.slice(FALHA_PREFIXO.length).trim() }
}

// ---------- falhas PASSAGEIRAS do robô (etapa 8 do inventário de 14/11/2026): nada foi criado no SisChef, dá para tentar de novo
// Os moldes são os textos que o robô grava ANTES de clicar "Gerar compra" (cupom_navegador.py: `_preencher` e `montar_pedido`; cupom_lancar.py: `ensaiar_cupom`; lancar_cupom_nuvem.py e reaper_cupom.py: só
// cupom de TESTE, que nunca cria compra). Cada molde é ancorado no INÍCIO do texto, que é onde o robô põe o prefixo. O motivo é cortado em ~2000 caracteres no banco: por isso só se reconhece texto CURTO e
// nunca se conclui "é seguro" pela AUSÊNCIA de um aviso no fim (ele pode ter sido cortado). Todas as partes de um motivo composto ("; ") têm de ser reconhecidas.
const MOTIVO_CURTO_MAX = 1500
const MOLDE_NAO_COLOCOU = /^item (\d+): o Sischef não colocou o produto \(código [^)]*\) na lista em ~\d+ s \(demora do Sischef ou produto fora do catálogo\)$/
const MOLDE_GRADE = /^(?:item \d+: )?a grade do Sischef tem \d+ linha\(s\), esperava \d+: uma linha pode ter entrado duas vezes \(nada foi gerado\)$/
const MOLDE_MONTAR = /^(?:item \d+: )?falha ao montar o pedido no Sischef(?: ao preencher a linha \(código [^)]*\))?: \S/
const MOLDE_TESTE = /^erro inesperado no teste \(dry-run, nada foi criado no Sischef\): \S|^PROCESSANDO preso há mais de \d+ min \(cupom de teste: o dry-run nunca cria compra\)$/
/** Qualquer sinal de que a compra PODE existir: se aparecer em QUALQUER ponto do texto, não se oferece repetir (cinto e suspensório; o servidor também recusa). */
const SINAL_DE_COMPRA = /CONFERIR NO SISCHEF|conferir no sischef|_CLICADO|pedido criado|pedido gerado|Gerar compra|Finalizar compra|pagamento no Sischef|preso há mais de \d+ min(?! \(cupom de teste)|nunca lançado/i

/**
 * Liga o botão "Tentar de novo" dos motivos passageiros. LIGADO em 14/11/2026, com o modo `tentar_de_novo` da função confirmar-cupom publicado (passageiro.ts da função tem os mesmos moldes;
 * tests/unit/passageiroParidade.test.ts garante que os dois reconhecem os mesmos textos). Para desligar de novo: `false`.
 */
export const BOTAO_TENTAR_DE_NOVO_LIGADO = true

const FRASE_MONTAR = 'O SisChef demorou ou falhou ao montar o pedido. Nada foi lançado.'
const FRASE_TESTE = 'O teste deste cupom falhou. Nada foi criado.'
const SOLUCAO_PASSAGEIRO = 'Nada foi criado no SisChef, então repetir é seguro. Se falhar de novo no mesmo item, o produto pode estar desativado no SisChef: avise o Claude.'

function fraseDaParte(parte: string): string | null {
  const n = MOLDE_NAO_COLOCOU.exec(parte)
  if (n) return `O SisChef demorou para mostrar o produto do item ${n[1]}. Nada foi lançado.`
  if (MOLDE_GRADE.test(parte)) return 'O SisChef mostrou uma linha a mais ao montar o pedido. Nada foi lançado.'
  if (MOLDE_MONTAR.test(parte)) return FRASE_MONTAR
  if (MOLDE_TESTE.test(parte)) return FRASE_TESTE
  return null
}

/**
 * O envio parou por falha PASSAGEIRA do robô e o próprio texto prova que nada foi criado no SisChef: devolve a frase curta e o que fazer; senão null (nunca oferece repetir na dúvida).
 * Só vale para REVISAR sem pedido no SisChef, com itens e todos com produto (o resto é outro caso), e sem o aviso de repetida/falha de conferência misturado.
 */
export function motivoPassageiroDoCupom(c: CupomRecente): { problema: string; solucao: string } | null {
  if (c.estado !== 'REVISAR' || c.pedido_sischef != null) return null
  const itens = Array.isArray(c.itens) ? c.itens : []
  if (itens.length === 0 || itens.some(semProdutoConfirmado)) return null
  const motivo = (c.motivo ?? '').trim()
  if (motivo === '' || motivo.length >= MOTIVO_CURTO_MAX) return null
  if (SINAL_DE_COMPRA.test(motivo) || trechoDaRepetida(motivo) !== null || trechoDaFalha(motivo) !== null) return null
  const frases: string[] = []
  // o '; ' de dentro do molde do teste ('(dry-run; nada foi criado…)') não separa partes
  for (const parte of motivo.replace('(dry-run; nada', '(dry-run, nada').split('; ')) {
    const f = fraseDaParte(parte.trim())
    if (f === null) return null
    frases.push(f)
  }
  return { problema: frases.length === 1 ? frases[0] : FRASE_MONTAR, solucao: SOLUCAO_PASSAGEIRO }
}


/**
 * O diagnóstico de um envio que está em REVISAR (null para os outros estados). A ordem importa: primeiro o que pode ter chegado ao SisChef
 * (conferir antes de qualquer coisa), depois o que é só dado do cupom. Texto que ninguém reconhece vira o motivo cru + o pedido genérico.
 */
export function diagnosticoDoCupom(c: CupomRecente): DiagnosticoCupom | null {
  if (c.estado !== 'REVISAR') return null
  // o aviso de repetida (E5) e o de "não consegui conferir" vêm JUNTO do resto, nunca no lugar: o diagnóstico lê o motivo SEM eles
  const motivo = motivoSemFalha(motivoSemRepetida(c.motivo))
  const sem = (problema: string, solucao: string): DiagnosticoCupom => ({ problema, itens: [], pedidos: [], conferencia: null, solucao, corrigivel: false })
  // parou SÓ pelo aviso (o do robô, antes de abrir o SisChef): não há o que corrigir, a decisão é do Ivan, nos dois botões do aviso
  if (motivo === '' && trechoDaRepetida(c.motivo) !== null) {
    return sem('Parece que esta compra já foi lançada: já existe uma compra do mesmo fornecedor com o mesmo total.',
      'Decida nos botões do aviso: se é a mesma compra, toque em “É o mesmo: excluir este envio”; se é outra compra de verdade, toque em “É outra compra: lançar mesmo assim”.')
  }
  // parou SÓ porque o robô não conseguiu conferir se a compra é repetida (falha passageira; nada foi feito no SisChef): o botão "Tentar de novo" confere de novo
  if (motivo === '' && trechoDaFalha(c.motivo) !== null) {
    return sem('Não consegui conferir se esta compra já foi lançada (a conferência falhou na hora). Nada foi feito no SisChef.',
      'Toque em “Tentar de novo”: eu confiro de novo e, se não houver compra igual, o robô lança. Se você sabe que é a mesma compra, exclua este envio (dá para desfazer).')
  }

  // Pode já existir compra no SisChef: nunca reenviar sem conferir.
  if (/^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO/i.test(motivo)) {
    return sem('O robô começou a lançar no SisChef e parou no meio: a compra PODE já existir lá.',
      `Não envie de novo (duplicaria a compra). Confira no SisChef se a compra aparece (só olhe, não clique em nada) e ${CLAUDE.toLowerCase()}: ele confere e libera.`)
  }
  if (/^falha ao preencher o pagamento no Sischef/i.test(motivo)) {
    return sem('O robô abriu o pedido no SisChef, mas não conseguiu preencher o pagamento: ficou um pedido ABERTO e nada foi pago.',
      `${CLAUDE}: ele confere o pedido aberto, cancela com o seu OK e lança de novo.`)
  }
  if (/já lançado em outro envio/i.test(motivo)) {
    return sem('Este cupom já foi lançado em outro envio.', 'Nada a fazer: não envie de novo (duplicaria a compra no SisChef).')
  }
  if (/não consegui ler a foto/i.test(motivo)) {
    return sem('A foto não ficou legível (ou não mostra os itens do cupom).',
      'Tire outra foto, com o cupom inteiro, esticado e com boa luz, e envie de novo.')
  }

  // falha PASSAGEIRA antes de "Gerar compra" (etapa 8 do inventário de 14/11): nada foi criado no SisChef, então dá para tentar de novo
  const passageiro = motivoPassageiroDoCupom(c)
  if (passageiro) return { problema: passageiro.problema, itens: [], pedidos: [], conferencia: null, solucao: passageiro.solucao, corrigivel: false, tentarDeNovo: true }

  // O SisChef não tem o fornecedor (o robô não cadastra sozinho): o app deixa o Ivan cadastrar (caixa "Cadastrar fornecedor") e reenviar o cupom
  if (/^fornecedor não encontrado no Sischef/i.test(motivo)) {
    return sem('O SisChef não tem este fornecedor cadastrado, então o robô não lançou nada.',
      'Confira o CNPJ na caixa abaixo, toque em “Cadastrar no SisChef” e, quando aparecer “cadastrado”, toque em “Reenviar este cupom”.')
  }
  // Todo casado, esperando só a confirmação do Ivan (pedido dele, 08/10): o envio deixa o cupom em REVISAR com o motivo CONFIRMAR:
  if (motivo.startsWith(CONFIRMAR_PREFIXO)) {
    const total = c.valor_a_pagar != null && Number(c.valor_a_pagar) > 0
    return {
      problema: 'Todos os itens já são conhecidos (você os confirmou em cupons anteriores deste fornecedor). Falta só você conferir e confirmar.',
      itens: [], pedidos: [], conferencia: null,
      solucao: 'Confira os itens abaixo (produto, quantidade e valor) e toque em “Confirmar e lançar”. Se algo estiver errado, toque em “Editar” no item.',
      corrigivel: total && c.pedido_sischef == null,
    }
  }

  // Itens sem produto confirmado: o robô nunca chuta; só lança item que o Ivan já confirmou uma vez para o fornecedor.
  const itens = Array.isArray(c.itens) ? c.itens : []
  const travando = itens.filter(semProdutoConfirmado)
  if (travando.length > 0) {
    const n = travando.length
    const semTotal = /não consegui ler o total/i.test(motivo)
    // Só dá para corrigir na tela com o total lido: sem ele nem a tela nem a Edge Function confirmar-cupom conseguem conferir a soma (ela recusa).
    // a mesma trava do servidor (confirmar-cupom): com pedido já aberto no SisChef, reenviar poderia duplicar a compra — não se corrige pelo app
    const corrigivel = !semTotal && c.valor_a_pagar != null && Number(c.valor_a_pagar) > 0 && c.pedido_sischef == null
    // item sem produto confirmado chega sem `entrada_estoque` (a quantidade do estoque só se calcula depois do casamento) e o envio não guarda a
    // quantidade lida: ela só existe na foto/no cupom de papel
    return {
      problema: `${n === 1 ? '1 item ainda não tem' : `${n} itens ainda não têm`} produto confirmado no SisChef (o robô nunca chuta: só lança item que você já confirmou uma vez para este fornecedor).${semTotal ? ' Além disso, o total do cupom não foi lido.' : ''}`,
      itens: travando.map((it) => ({ descricao: (it.descricao_cupom ?? '').trim() || 'item', preco: precoDe(it) })),
      pedidos: travando.map(pedidoDe),
      conferencia: conferenciaDaSoma(c, itens, travando),
      solucao: corrigivel
        ? 'Confirme cada item abaixo (o produto do SisChef e o peso que está no cupom) e toque em “Reenviar para lançar”. O app guarda a confirmação (nos próximos cupons desse fornecedor o item passa direto), confere a soma e o robô lança.'
        : `${CLAUDE} e responda, por exemplo: “${travando.map(exemploDe).join('; ')}”. Ele grava a confirmação (nos próximos cupons desse fornecedor o item passa direto), refaz o cupom, confere a soma e o robô lança.`,
      corrigivel,
    }
  }

  if (/não consegui ler o total/i.test(motivo)) {
    return sem('O total do cupom não foi lido, e sem ele o robô não consegue conferir a soma dos itens.',
      `${CLAUDE}: ele lê o total na foto, confere a soma dos itens e libera o lançamento.`)
  }
  if (/forma de pagamento não suportada/i.test(motivo)) {
    return sem('O robô não paga com esta forma de pagamento (ele paga só dinheiro, tesouraria, PIX e sem cartão).',
      'Lance este cupom à mão no SisChef.')
  }
  if (/forma de pagamento ausente|sem a conta/i.test(motivo)) {
    return sem('Faltou a forma de pagamento (ou a conta) do cupom.', `${CLAUDE}: ele corrige o pagamento e libera o lançamento.`)
  }
  if (/sem produto associado|sem quantidade|quantidade inválida|cupom sem itens|dados numéricos inválidos/i.test(motivo)) {
    return sem('O cupom chegou ao robô com dados incompletos (produto ou quantidade de algum item).',
      `${CLAUDE}: ele confere os itens com a foto, corrige e libera.`)
  }

  // motivo que ninguém reconhece: não repete o texto aqui (a tela já o mostra, em letra pequena, como "Motivo registrado")
  return sem(motivo !== '' ? 'O sistema parou este cupom por um motivo que ainda não sei explicar (veja o motivo registrado abaixo).' : 'O robô não conseguiu lançar este cupom.',
    `${CLAUDE}: ele confere este cupom, segue o roteiro de correção e diz o que falta da sua parte.`)
}

// ---------- excluir um envio (pedido do Ivan, 03/11/2026)
/** O robô começou a lançar no SisChef e parou no meio (a compra PODE existir lá, ou ficou um pedido aberto): as mesmas palavras da diagnosticoDoCupom e da função cupom_excluir do banco. */
const NO_MEIO_DO_SISCHEF = /^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO|^falha ao preencher o pagamento no Sischef/i
/** A frase EXATA que o reaper grava num PENDENTE parado: o robô nunca pegou o cupom, então não há nada a conferir no SisChef (a exceção da trava, que o banco também tem). */
const PENDENTE_PARADO_DO_REAPER = /^CONFERIR NO SISCHEF antes de repetir: PENDENTE nunca lançado há mais de \d+ min$/
export function parouNoMeioDoSischef(c: CupomRecente): boolean {
  const motivo = (c.motivo ?? '').trim()
  // a exceção só vale se o robô NUNCA reivindicou o cupom (processando_desde nulo; ausente = não se sabe, continua travado): a escrita atrasada do reaper pode pôr essa frase num cupom que o robô já tocou
  const nuncaPegoPeloRobo = c.processando_desde === null
  return c.estado === 'REVISAR' && NO_MEIO_DO_SISCHEF.test(motivo) && !(nuncaPegoPeloRobo && PENDENTE_PARADO_DO_REAPER.test(motivo))
}

/**
 * O envio pode ser EXCLUÍDO (botão "Excluir"): ainda não foi lançado e precisa do Ivan (REVISAR) ou é de teste (TESTE), sem pedido no SisChef e sem ter parado no meio dele — aí o aviso tem
 * de ficar à vista até alguém conferir lá. Nunca o LANCADO (a compra já está no SisChef: quem cancela é o Ivan lá), nem o PROCESSANDO (o robô está lançando), nem o PENDENTE (na fila: o robô
 * vai lançá-lo; se travar, o reaper o põe em REVISAR em 60 min e aí pode — a revisão de 04/11 mostrou que excluir um PENDENTE só traz problema). O banco (cupom_excluir) confere tudo de novo.
 */
export function podeExcluirCupom(c: CupomRecente): boolean {
  if (c.estado !== 'REVISAR' && c.estado !== 'TESTE') return false
  if (c.pedido_sischef != null) return false
  return !parouNoMeioDoSischef(c)
}

/** O motivo que o Ivan escreveu na exclusão: espaços sobrando somem e cabe nos 300 do banco. */
export const motivoEscrito = (texto: string): string => texto.replace(/\s+/g, ' ').trim().slice(0, 300)
