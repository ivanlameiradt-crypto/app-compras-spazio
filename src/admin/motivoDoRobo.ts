// O que o robô de lançamento escreve no "motivo" de uma nota que ele NÃO lançou, dito em português simples: o produto pelo NOME, o que aconteceu e o que fazer.
// Pedido do Ivan (21/10/2026, depois de ver "item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)"): "essa informação tem que
// ser mais clara quando houve o problema por que não foi lançado". Só regras puras (sem rede nem React). O texto original do robô continua guardado na nota e
// nada é apagado: quando nenhuma regra daqui reconhece o motivo, a tela mostra o texto dele como sempre (só trocando o começo técnico por "nada foi lançado").
import type { ItemNotaSefaz } from '../lib/tipos'
import { fornecedorNovoNaNota } from './fornecedorRegras'

export interface ExplicacaoDoRobo {
  /** O que aconteceu, em uma ou duas frases. */
  porque: string
  /** O que o Ivan faz agora. */
  fazer: string
}

/** Começo técnico que o robô põe quando para antes de gerar o pedido (motor.MSG_ANTES_DO_PEDIDO). */
const PREFIXO_ANTES_DO_PEDIDO = /^parou antes de gerar o pedido \(nada lançado\):\s*/i

/** Número como o robô escreve ("3", "9,6", "0,395", às vezes "1.680") → número; fora do formato → null. */
export function numeroDoRobo(texto: string): number | null {
  const t = texto.trim()
  let limpo: string | null = null
  if (/^\d+(,\d+)?$/.test(t)) limpo = t.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) limpo = t.replace(/\./g, '').replace(',', '.')
  if (limpo == null) return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/** Quantidade no jeito brasileiro, até 4 casas ("3", "0,395", "1.680"). */
const formatar = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

const codDoItem = (it: ItemNotaSefaz): string | null => /C[OÓ]D\.?\s*FOR:?\s*(\S+)/i.exec(it.descricao ?? '')?.[1] ?? null

/** O nome do produto do item com este CÓD. FOR ("SHOYU TRADICIONAL"), como a nota mostra, sem o "- INSUMOS" do cadastro; sem o item na nota, null. */
export function nomeDoItem(itens: ItemNotaSefaz[] | undefined, cod: string): string | null {
  const it = (itens ?? []).find((x) => codDoItem(x) === cod)
  if (!it) return null
  const bruto = (it.produto_nome ?? '').trim() || (it.descricao ?? '').replace(/^\s*C[OÓ]D\.?\s*FOR:?\s*\S+\s*(?:##)?\s*/i, '').trim()
  return bruto.replace(/\s*-\s*INSUMOS\s*$/i, '').replace(/\s+/g, ' ').trim() || null
}
/** Como chamar o item numa frase: o nome do produto, ou "item 263230" quando a nota não tem o item. */
const rotuloDoItem = (itens: ItemNotaSefaz[] | undefined, cod: string): string => nomeDoItem(itens, cod) ?? `item ${cod}`

/** A unidade do item como se lê numa frase ("kg", "un"), ou '' quando a nota não a trouxe. */
function unidadeDoItem(itens: ItemNotaSefaz[] | undefined, cod: string): string {
  const it = (itens ?? []).find((x) => codDoItem(x) === cod)
  return (it?.unidade_sischef ?? '').replace(/[^A-Za-z]/g, '').toLowerCase()
}
const comUnidade = (n: number, un: string): string => (un ? `${formatar(n)} ${un}` : formatar(n))

// "item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)" — a conta do SisChef e a do app brigam (motor._conferir_na_tela)
const RE_CONTA_NAO_BATE = /item C[OÓ]D\.? FOR (\S+) já associado: Qtde Conver\. na tela ([\d.,]+) ≠ ([\d.,]+) x ([\d.,]+) \(conversão do painel\)/i
// "nota com frete (R$ 492,82): o lançamento com frete ainda não está ligado (secret NFE_FRETE_LIGADO) — nada foi lançado; ..." (lancar_nfe_nuvem.validar_nota)
const RE_FRETE_DESLIGADO = /nota com frete \(R\$ ([\d.,]+)\): o lançamento com frete ainda não está ligado/i
// "UN DIFERE sem conversão na tela: CÓD. FOR 17253; 999 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)" (motor._conferir_na_tela)
const RE_UN_DIFERE = /UN DIFERE sem convers[ãa]o na tela: C[OÓ]D\.? FOR ([^()]+?)\s*\(/i
// "item CÓD. FOR 17898647163635 (PAPEL HIGIENICO…): o SisChef converteu por conta própria — a tela mostra 8 UN para 1 FD da nota (8 por unidade) — e o painel decidiu 18 por unidade (18 UN). Nada foi gerado: …"
// (motor.conversoes_do_plano_sem_conferir; a JAMES 128432 parou assim em 31/10/2026: a ficha do produto tinha a linha do mesmo CNPJ para OUTRO código do fornecedor)
// O trecho entre parênteses (o nome do produto) não pode atravessar para o item seguinte ("; item CÓD. FOR …"): o robô junta um motivo por item com "; " e, sem esta trava,
// o nome de um item sairia com os números de outro (revisão independente de 31/10/2026, A1). E só se explica quando o texto tem UM item: com mais de um, a tela mostra o texto do robô inteiro.
const RE_CONVERTEU_SOZINHO = /item C[OÓ]D\.? FOR (\S+) \((?:(?!item C[OÓ]D\.? FOR).)*?\): o SisChef converteu por conta própria — a tela mostra ([\d.,]+)(?: (\S+))? para ([\d.,]+)(?: (\S+))? da nota \(([\d.,]+) por unidade\) — e o painel decidiu ([\d.,]+) por unidade/i
const RE_ITEM_NO_TEXTO = /item C[OÓ]D\.? FOR/gi
// "não consegui ler o XML da nota (Ações → Baixar documento na lista de não importadas não trouxe o XML desta chave (...))" (motor.motivo_xml). Em 31/10/2026 (De Marchi 113752) a causa
// era o SisChef só ter o RESUMO da nota (a SEFAZ entrega o XML completo horas depois); digitar as parcelas NÃO resolve (testado 2×), o robô não lança com o resumo.
const RE_XML_NAO_LIDO = /não consegui ler o XML da nota/i

// "item 5 (CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G): a nota e o produto estão na mesma unidade (UN) no SisChef e o número informado (0,24) não é de embalagem (embalagem é maior
// que 1 e vale para UN, PCT, CX ou FD): no app, toque em Editar neste item, deixe a conversão vazia e lance de novo (ou associe no SisChef)" (nfe_decisoes_app.conferir_conversoes).
// O Ivan digitou um número de conversão que não precisava (14/11/2026: o peso do pacote, 0,24). O "item 5" é o número do item na nota, o mesmo `n` da decisão do app.
// O nome entre parênteses não pode atravessar para outro item ("; item 7 (…"): o robô junta um motivo por item com "; ".
const RE_CONVERSAO_DESNECESSARIA = /item (\d+) \(((?:(?!; item \d+ \().)*?)\): a nota e o produto estão na mesma unidade \(([^()]*)\) no SisChef e o número informado \(([\d.,]+)\) não é de embalagem(?: \(embalagem é maior que 1[^()]*\))?(?:: no app, toque em Editar neste item, deixe a conversão vazia e lance de novo(?: \(ou associe no SisChef\))?)?/gi

/** Um item em que o número informado na conversão não serve (a nota e o produto já estão na mesma unidade). */
export interface ConversaoDesnecessaria {
  /** Número do item na nota (o `n` da decisão do app). */
  n: number
  /** O nome como a nota o traz, sem o "CÓD. FOR: N" e sem o "- INSUMOS". */
  nome: string
  /** A unidade que o robô leu no SisChef ("UN"). */
  unidade: string
  /** O número informado, como o robô o escreveu ("0,24"). */
  numero: string
}
export interface MotivoConversaoDesnecessaria {
  itens: ConversaoDesnecessaria[]
  /** O que o motivo do robô diz ALÉM disto (outro problema na mesma nota), sem o começo técnico; '' = o motivo é só este. */
  resto: string
}
/** Reconhece no motivo do robô os itens com "o número informado não é de embalagem" (um ou vários, separados por "; "). Sem nenhum, null. */
export function conversoesDesnecessarias(motivo: string | null | undefined): MotivoConversaoDesnecessaria | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const itens: ConversaoDesnecessaria[] = []
  for (const a of t.matchAll(RE_CONVERSAO_DESNECESSARIA)) {
    const n = Number(a[1])
    if (!Number.isInteger(n) || n <= 0 || itens.some((x) => x.n === n)) continue
    const nome = a[2].replace(/^\s*C[OÓ]D\.?\s*FOR:?\s*\S+\s*(?:##)?\s*/i, '').replace(/\s*-\s*INSUMOS\s*$/i, '').replace(/\s+/g, ' ').trim()
    itens.push({ n, nome: nome || `item ${n}`, unidade: a[3].trim(), numero: a[4] })
  }
  if (itens.length === 0) return null
  const resto = t.replace(RE_CONVERSAO_DESNECESSARIA, '').replace(PREFIXO_ANTES_DO_PEDIDO, '').replace(/(?:\s*;\s*)+/g, '; ').replace(/^[;\s]+|[;\s]+$/g, '')
  return { itens, resto }
}
/** O porquê em uma frase curta, sem termo técnico. */
const porqueConversaoDesnecessaria = (c: ConversaoDesnecessaria): string =>
  `Item ${c.n} (${c.nome}): o número ${c.numero} que foi informado não serve como conversão, porque a nota e o produto já estão na mesma unidade.`
/** A frase da faixa da nota: o porquê e a recomendação (o botão "Tirar a conversão e lançar de novo" fica logo abaixo). */
export const fraseConversaoDesnecessaria = (c: ConversaoDesnecessaria): string => `${porqueConversaoDesnecessaria(c)} Recomendo tirar esse número.`
/** A frase depois de o número ter sido tirado (falta só lançar). */
export const fraseConversaoTirada = (c: ConversaoDesnecessaria): string => `Item ${c.n} (${c.nome}): o número ${c.numero} já foi tirado. Agora toque em Lançar.`

/**
 * O motivo do robô explicado ao Ivan, ou null quando nenhuma regra reconhece o texto (a tela então mostra o texto do robô). Cada explicação diz o produto pelo
 * nome (com `itens` da nota), o que aconteceu e o que fazer. Sempre que o robô para antes de gerar o pedido, nada foi lançado: a explicação começa por aí na tela.
 */
export function explicarMotivoDoRobo(motivo: string | null | undefined, itens?: ItemNotaSefaz[]): ExplicacaoDoRobo | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  const conta = RE_CONTA_NAO_BATE.exec(t)
  if (conta) {
    const cod = conta[1]
    const tela = numeroDoRobo(conta[2]); const xml = numeroDoRobo(conta[3]); const noApp = numeroDoRobo(conta[4])
    if (tela != null && xml != null && xml > 0 && noApp != null) {
      const nome = rotuloDoItem(itens, cod)
      const un = unidadeDoItem(itens, cod)
      const porUnidade = Math.round((tela / xml) * 10000) / 10000
      const unidades = xml === 1 ? '1 unidade' : `${formatar(xml)} unidades`
      const sisChef = xml === 1
        ? `o SisChef converte isso para ${comUnidade(tela, un)}`
        : `o SisChef converte isso para ${comUnidade(tela, un)} (${comUnidade(porUnidade, un)} por unidade)`
      return {
        porque: `No ${nome} a conta não bate: a nota traz ${unidades} e ${sisChef}, mas no app a conversão está em ${comUnidade(noApp, un)} por unidade.`,
        fazer: `Veja qual é o certo. Se cada unidade tem ${comUnidade(porUnidade, un)}, toque em Editar no ${nome} e informe ${formatar(porUnidade)}. `
          + `Se o certo é ${comUnidade(noApp, un)}, corrija a conversão do produto no SisChef. Depois lance de novo.`,
      }
    }
  }

  const semPrecisar = conversoesDesnecessarias(t)
  if (semPrecisar && semPrecisar.resto === '') {
    const um = semPrecisar.itens.length === 1
    return {
      porque: semPrecisar.itens.map(porqueConversaoDesnecessaria).join(' '),
      fazer: um ? 'Tire esse número (deixe a conversão vazia) e lance de novo.' : 'Tire esses números (deixe a conversão vazia em cada item) e lance de novo.',
    }
  }

  const frete = RE_FRETE_DESLIGADO.exec(t)
  if (frete) {
    return {
      porque: `Esta nota tem frete (R$ ${frete[1]}) e o robô ainda não lança nota com frete sozinho.`,
      fazer: 'Lance esta nota à mão no SisChef, ou peça o teste acompanhado do frete.',
    }
  }

  const difere = RE_UN_DIFERE.exec(t)
  if (difere) {
    const cods = difere[1].split(/\s*;\s*/).map((c) => c.trim()).filter(Boolean)
    const nomes = cods.map((c) => rotuloDoItem(itens, c))
    const um = nomes.length === 1
    const lista = um ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
    // Primeiro MANDA CONFERIR o produto: o SisChef liga o código do fornecedor a um produto sozinho e, se essa ligação está errada (SEARA 190347, 27/10/2026:
    // o código da linguiça estava ligado ao produto-marcador "LANCAMENTO DE BOLETO NF"), pedir a conversão leva o Ivan a informar um número para o produto errado.
    return {
      porque: `O SisChef pede a conversão de unidade de ${lista}: a nota vem numa unidade, o produto está em outra, e o app ainda não tem o número.`,
      fazer: `Confira se ${um ? `o produto que o SisChef ligou a este código está certo (aqui: ${lista})` : 'os produtos que o SisChef ligou a estes códigos estão certos'}. `
        + `Se ${um ? 'está certo' : 'estão certos'}, toque em Editar ${um ? 'nesse item' : 'em cada um desses itens'} e informe quanto vale 1 unidade da nota. `
        + `Se ${um ? 'NÃO está certo' : 'algum NÃO está certo'}, a ligação do SisChef está errada e o app ainda não troca o produto de um item já ligado: peça ao Claude para corrigir no SisChef. Depois lance de novo.`,
    }
  }

  const sozinho = (t.match(RE_ITEM_NO_TEXTO) ?? []).length === 1 ? RE_CONVERTEU_SOZINHO.exec(t) : null
  if (sozinho) {
    const cod = sozinho[1]
    const tela = numeroDoRobo(sozinho[2]); const noSisChef = numeroDoRobo(sozinho[4]); const porUnidade = numeroDoRobo(sozinho[6]); const noApp = numeroDoRobo(sozinho[7])
    if (tela != null && noSisChef != null && noSisChef > 0 && porUnidade != null && noApp != null) {
      const nome = rotuloDoItem(itens, cod)
      const unEstoque = (sozinho[3] ?? '').toLowerCase(); const unNota = (sozinho[5] ?? '').toLowerCase()
      const doSisChef = `${formatar(porUnidade)}${unEstoque ? ` ${unEstoque}` : ''}`
      const doApp = `${formatar(noApp)}${unEstoque ? ` ${unEstoque}` : ''}`
      return {
        porque: `No ${nome} o SisChef converteu sozinho, pela conversão que ele já tinha guardada: ${formatar(noSisChef)}${unNota ? ` ${unNota}` : ''} da nota viram ${formatar(tela)}${unEstoque ? ` ${unEstoque}` : ''} `
          + `(${doSisChef} por unidade). Mas no app a conversão está em ${doApp} por unidade.`,
        fazer: `Veja qual é a certa. Se a do SisChef (${doSisChef}) está certa, toque em Editar no ${nome} e informe ${formatar(porUnidade)}. `
          + `Se a certa é a do app (${doApp}), o SisChef está com a conversão antiga para este código do fornecedor: peça ao Claude para corrigir no SisChef (ficha do produto, conversão por fornecedor). Depois lance de novo.`,
      }
    }
  }

  if (RE_XML_NAO_LIDO.test(t)) {
    return {
      porque: 'O robô não conseguiu ler o XML completo desta nota. O motivo mais comum: o SisChef só recebeu da SEFAZ o resumo da nota, e o XML completo (com os itens, os valores e os boletos) costuma levar algumas horas para chegar. Também pode ter sido uma falha passageira na leitura.',
      fazer: 'Não digite as parcelas ainda: enquanto só existe o resumo, o robô não lança, nem assim. O XML completo chega ao SisChef em algumas horas (de 1 hora até quase um dia): quando o aviso “O XML desta nota ainda não foi lido” sumir da nota, ou daqui a umas horas, toque em Lançar de novo. Se passar de um dia, chame o Claude.',
    }
  }

  if (fornecedorNovoNaNota(t)) {
    return {
      porque: 'O fornecedor desta nota ainda não está cadastrado no SisChef, e o robô só cadastra fornecedor novo com a sua autorização.',
      fazer: 'Use a caixa “Fornecedor não cadastrado no SisChef” logo abaixo: confira o CNPJ, toque em “Buscar dados do CNPJ” e depois em “Cadastrar no SisChef”. Quando aparecer ✓, toque em Lançar.',
    }
  }

  return null
}

/** O robô parou porque NÃO conseguiu ler o XML da nota (o SisChef só tinha o resumo): digitar parcelas não o faz lançar (De Marchi 113752, 31/10/2026). */
export const motivoXmlNaoLido = (motivo: string | null | undefined): boolean => RE_XML_NAO_LIDO.test((motivo ?? '').replace(/\s+/g, ' '))

/** O motivo sem o começo técnico "parou antes de gerar o pedido (nada lançado):" — que vira "Nada foi lançado." na frente do resto. Sem o começo, igual. */
export function motivoSemPrefixoTecnico(motivo: string): string {
  const t = motivo.replace(/\s+/g, ' ').trim()
  return PREFIXO_ANTES_DO_PEDIDO.test(t) ? `Nada foi lançado. ${t.replace(PREFIXO_ANTES_DO_PEDIDO, '')}` : t
}

// ---------- motivos PASSAGEIROS da nota fiscal (etapa 3 do inventário de 14/11/2026; pedido do Ivan, leigo)
// O robô devolve a nota ("revisar") por coisas que passam sozinhas: o SisChef demorou, a conexão caiu, o login não entrou, uma tela não abriu, uma leitura veio vazia. O texto dele é
// técnico ("Timeout 90000ms exceeded", "item 17253: 3 linhas na tela (esperava 1)"). Aqui cada molde ganha uma frase curta, que COMEÇA dizendo se algo foi lançado, e diz se repetir é seguro.
// REGRA DURA: "Tentar de novo" (`repetir`) só quando o próprio texto prova que NADA foi criado no SisChef. Quem prova:
//  - o começo "parou antes de gerar o pedido (nada lançado):" (motor._lancar_uma: a exceção veio antes de gerar o pedido e o robô cancelou a importação);
//  - o "o robô parou antes de terminar: …" SEM o "— confira no SisChef se algo foi criado" (lancar_nfe_nuvem.estado_do_desfecho só põe esse aviso quando o robô já tinha começado);
//  - os moldes que o robô devolve direto da leitura (`_preparar`, `nfe_decisoes_app`, `ler_memoria_de_embalagem`): só leitura, antes de qualquer escrita; e a verificação da função lancar-nfe
//    ("Nada foi criado no SisChef; pode lançar de novo").
// Uma exceção de tela SEM esse começo não sabe dizer em que ponto parou: fica como está (texto do robô). E o que PODE ter lançado em parte só manda conferir, nunca oferece repetir.

/** Uma explicação curta de um motivo passageiro. `repetir` = é seguro o botão "Tentar de novo" (nada foi criado no SisChef). */
export interface MotivoPassageiro {
  /** Duas frases no máximo: se algo foi lançado e o que fazer; sem termo técnico. */
  frase: string
  repetir: boolean
}

type SituacaoDoMotivo = 'nada' | 'desconhecida'
interface MoldePassageiro {
  /** O que o robô escreve. */
  re: RegExp
  /** Só vale quando o texto prova que nada foi criado (exceção de tela/rede: sem isso não se sabe em que ponto parou). */
  exigeNada: boolean
  /** O que aconteceu, em uma frase simples (entra depois de "Nada foi lançado."). */
  corpo: string
  /** O que fazer (padrão: tocar em "Tentar de novo"). */
  fim?: string
}

const FIM_PADRAO = 'Toque em Tentar de novo.'
const SEM_CONFERIR = /confira no SisChef se algo foi criado antes de lançar de novo/i
const CLIQUE_PODE_TER_SIDO_DADO = /o clique no botão estourou o prazo DEPOIS de começar|NÃO cliquei de novo — confira no SisChef/i
const QUEDA_DO_ROBO = /^o robô parou antes de terminar:/i
const LEGITIMO_ANTES_DO_SISCHEF = /^o robô parou antes de terminar: (?:lançamento real sem o cliente do app|não consegui falar com o app \(Supabase\) antes de começar)/i
/** Abaixo disto o aviso de conferir não foi cortado (o banco guarda 2.000 letras; sobra folga para o resto do texto). */
const LIMITE_TEXTO_CURTO = 1500
/** Pedaços que o próprio robô põe depois de um "; " dentro do mesmo item e que não são outro problema (inclusive as tentativas "…"; "…" de "nenhuma opção com Cód. Interno"). */
const CONTINUACAO_CONHECIDA = /^(?:"|parecidos na tela:|pode lançar de novo|tente de novo|atualize a lista de notas)/i
const NAO_E_DESTE_TEXTO = /pedido JÁ gerado|pela metade|FINALIZADA no SisChef|RETOMADA/i

const TEMPO_OU_REDE = /Timeout \d+ ?ms|TimeoutError|net::ERR_|Target (?:page, context or browser has been )?closed|TargetClosedError|Execution context was destroyed|ECONN(?:RESET|REFUSED)|browser has been closed|Connection (?:closed|refused|reset)|Navigation (?:failed|timeout)/i

// Ordem importa: o primeiro molde que reconhece a parte vence.
const MOLDES_PASSAGEIROS: MoldePassageiro[] = [
  // login (analisar.py: "Login no Sischef não foi concluído (senha, 2FA ou bloqueio).")
  { re: /Login no Sischef não foi concluído/i, exigeNada: true, corpo: 'O robô não conseguiu entrar no SisChef.', fim: 'Toque em Tentar de novo; se repetir, avise o Claude (a senha pode ter mudado).' },
  // os DOIS únicos textos de "o robô parou antes de terminar:" que o robô grava sem o aviso de conferir porque nada foi tocado no SisChef (lancar_nfe_nuvem.py:545 e :867, `antes_do_sischef`)
  { re: /^o robô parou antes de terminar: (?:lançamento real sem o cliente do app|não consegui falar com o app \(Supabase\) antes de começar)/i, exigeNada: false, corpo: 'O robô não conseguiu falar com o banco do app antes de começar.' },
  // tela de importação que o SisChef não abriu (analisar.py/motor.py:1878)
  { re: /não foi possível ler a tela de importação desta nota/i, exigeNada: false, corpo: 'O SisChef não abriu a tela desta nota.' },
  // outra importação aberta no SisChef (motor.MSG_OUTRA_ABERTA)
  { re: /há outra importação aberta no Sischef/i, exigeNada: false, corpo: 'Há outra nota aberta no SisChef (alguém começou e não terminou).', fim: 'Espere uns minutos e toque em Tentar de novo.' },
  // o XML completo ainda não chegou ao SisChef (motor.motivo_xml; o resumo da SEFAZ vem antes do XML, horas depois)
  { re: /não consegui ler o XML da nota/i, exigeNada: false, corpo: 'A nota ainda não chegou completa ao SisChef (o XML pode levar algumas horas).', fim: 'Não digite as parcelas ainda; toque em Tentar de novo mais tarde.' },
  // leituras do cadastro do SisChef / do app (nfe_decisoes_app, lancar_nfe_nuvem.ler_memoria_de_embalagem)
  { re: /não consegui ler a memória de embalagens do app/i, exigeNada: false, corpo: 'O robô não conseguiu ler a memória de embalagens do app.' },
  { re: /catálogo vivo vazio/i, exigeNada: false, corpo: 'O robô não conseguiu ler a lista de produtos do SisChef.' },
  { re: /item \S+: o produto \S+ não está no cadastro do SisChef \(ou está sem unidade\)/i, exigeNada: false, corpo: 'O robô não achou, na lista do SisChef, um produto escolhido (a leitura pode ter vindo incompleta).' },
  { re: /a leitura do SisChef não trouxe a unidade deste item na nota/i, exigeNada: false, corpo: 'O robô não leu a unidade de um item da nota.', fim: 'Toque em Tentar de novo; se repetir, associe o item direto no SisChef.' },
  // a tela do SisChef não bate com o que o app leu da nota (motor.py: total da importação, snapshot, itens do painel)
  { re: /não li o total da tela de importação|total da importação [^≠]*≠|associação por ID divergiu do snapshot|item\(ns\) do painel que não estão na tela/i, exigeNada: false,
    corpo: 'O SisChef mostrou valores diferentes dos da nota.', fim: 'Toque em Tentar de novo; se repetir, lance esta nota à mão.' },
  // a verificação da função lancar-nfe: a execução no GitHub morreu antes de abrir o SisChef
  { re: /O robô não chegou a começar/i, exigeNada: false, corpo: 'O robô não chegou a começar.' },
  // o robô não conseguiu ligar um produto da nota na tela do SisChef (motor.py: linhas na tela, opção, modal de conversão, campo da conversão)
  { re: /item \S+: (?:\d+ linhas? na tela \(esperava 1\)|nenhuma opção com Cód\. Interno|cliquei em UN DIFERE e o modal de conversão não abriu|depois da escolha a linha ficou|o campo da conversão ficou|o modal de conversão não fechou)/i, exigeNada: true,
    corpo: 'O robô não conseguiu ligar um produto da nota na tela do SisChef.' },
  // a tela do SisChef demorou, mudou ou a conexão caiu (motor.ir_para/_esperar_url/_achar/_clicar e erros de tempo do navegador)
  { re: new RegExp(`a tela não foi para|não achei o botão/link|esperava exatamente 1 botão/link|o clique no botão não chegou|${TEMPO_OU_REDE.source}`, 'i'), exigeNada: true,
    corpo: 'O SisChef demorou ou a conexão caiu e o robô parou.' },
]
export const FRASE_PODE_TER_LANCADO = 'Pode ter sido lançado em parte: o robô parou no meio do trabalho. Confira no SisChef se a nota entrou antes de repetir.'

/**
 * O motivo da nota fiscal é um problema passageiro? Devolve a frase curta e se o botão "Tentar de novo" é seguro, ou null quando nenhuma regra reconhece o texto inteiro
 * (aí a tela mostra o que mostrava antes). O motivo pode juntar vários itens separados por "; item …": todos precisam ser reconhecidos, senão null.
 * Qualquer sinal de que a nota PODE ter entrado (queda depois de começar, clique que estourou o prazo depois de dado) vence tudo: sem botão, só conferir.
 */
export function motivoPassageiro(motivo: string | null | undefined): MotivoPassageiro | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const talvez: MotivoPassageiro = { frase: FRASE_PODE_TER_LANCADO, repetir: false }
  // o robô avisa que PODE ter lançado: confere, nunca repete (vale antes de qualquer outra regra, mesmo com outras partes reconhecidas)
  if (SEM_CONFERIR.test(t) || CLIQUE_PODE_TER_SIDO_DADO.test(t)) return talvez
  if (NAO_E_DESTE_TEXTO.test(t)) return null // pedido já gerado, pela metade, retomada: é outro estado e tem a sua própria orientação
  const legitimo = LEGITIMO_ANTES_DO_SISCHEF.test(t)
  // "o robô parou antes de terminar: <erro>": o aviso de conferir vai no FIM e o motivo é cortado em 2.000 letras (cot_nfe_estado_supabase.py:138), então um erro longo PERDE o aviso.
  // Só os dois textos curtos de antes_do_sischef provam que nada foi tocado; qualquer outra queda do robô pode ter lançado em parte.
  if (QUEDA_DO_ROBO.test(t) && (!legitimo || t.length >= LIMITE_TEXTO_CURTO)) return talvez
  const comPrefixo = PREFIXO_ANTES_DO_PEDIDO.test(t)
  const situacao: SituacaoDoMotivo = comPrefixo ? 'nada' : 'desconhecida'
  // o que vem depois de " | " (fornecedor já cadastrado, "por cima do botão"…) é complemento do robô, não outro problema
  const corpo = t.replace(PREFIXO_ANTES_DO_PEDIDO, '').split(' | ')[0]
  const corpos: string[] = []
  let fim = FIM_PADRAO
  let sobrou = false
  // cada item do robô vem separado por "; item …"; dentro de um item, os pedaços separados por "; " precisam ser moldes conhecidos ou continuações conhecidas
  for (const parte of corpo.split(/;\s+(?=item\b)/i)) {
    const molde = MOLDES_PASSAGEIROS.find((x) => x.re.test(parte) && (!x.exigeNada || situacao === 'nada'))
    if (!molde) { sobrou = true; continue }
    if (!corpos.includes(molde.corpo)) corpos.push(molde.corpo)
    if (molde.fim) fim = molde.fim
    const [, ...resto] = parte.split(/;\s+/)
    if (resto.some((r) => !CONTINUACAO_CONHECIDA.test(r) && !MOLDES_PASSAGEIROS.some((x) => x.re.test(r) && (!x.exigeNada || situacao === 'nada')))) sobrou = true
  }
  if (corpos.length === 0) return null
  // com o começo "nada lançado" mas sobrou um trecho que nenhuma regra explica (ex.: "…; Gerar compra: pedido criado"): não dá para garantir que nada entrou
  if (sobrou) return comPrefixo ? talvez : null
  // dois problemas diferentes: a frase do fim volta ao padrão (os "fins" especiais falam de UM problema só)
  if (corpos.length > 1) fim = FIM_PADRAO
  return { frase: `Nada foi lançado. ${corpos.join(' ')} ${fim}`, repetir: true }
}

// ---------- sugestões com NÚMERO PRONTO (etapas 4 a 6 do inventário dos erros do robô, 14/11/2026; pedido do Ivan, leigo)
// Quando o robô para porque falta ou está errado um número que o app consegue tirar de uma fonte certa — o NOME do produto na nota ("168UN", "395G"), os boletos que a PRÓPRIA nota traz ou a forma de pagamento que o app
// lembra deste fornecedor —, a faixa amarela mostra a sugestão com a conta e um botão que a aceita. REGRA DURA: só quando o número vem de uma fonte determinística e sem dúvida entre dois valores; senão, o texto de hoje.
// Aqui ficam só a leitura do texto do robô e as frases; a decisão de sugerir (com a nota na mão) mora em notaSefazRegras.

/** O texto não tem nenhum sinal de que algo foi criado no SisChef (pedido já gerado, pela metade, retomada, queda do robô depois de começar, clique que pode ter sido dado)? Só então se sugere. */
export function semSinalDeLancamento(texto: string): boolean {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length >= LIMITE_TEXTO_CURTO) return false // o banco corta o motivo em 2.000 letras e um texto longo pode ter perdido o aviso de conferir
  return !(SEM_CONFERIR.test(t) || CLIQUE_PODE_TER_SIDO_DADO.test(t) || NAO_E_DESTE_TEXTO.test(t) || QUEDA_DO_ROBO.test(t))
}
/** O que sobra do motivo depois de tirar os trechos já reconhecidos e o começo técnico; '' = o motivo era só isto. */
function restoDoMotivo(texto: string, trechos: RegExp[]): string {
  let r = texto
  for (const re of trechos) r = r.replace(re, '')
  return r.replace(PREFIXO_ANTES_DO_PEDIDO, '').replace(/(?:\s*;\s*)+/g, '; ').replace(/^[;\s]+|[;\s]+$/g, '')
}

// "UN DIFERE sem conversão na tela: CÓD. FOR 17253; 999 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)" (motor._conferir_na_tela)
const RE_TRECHO_UN_DIFERE = /UN DIFERE sem convers[ãa]o na tela: C[OÓ]D\.? FOR ([^()]+?)\s*\([^()]*\)/gi
// "ketchup sachê: o nome diz 168 un por caixa e o app tem 1 UN = 12: no app, toque em Editar neste item e informe 168 (ou acerte no SisChef) e lance de novo" (regra_ketchup.problemas_ketchup)
const RE_TRECHO_KETCHUP_NOME = /ketchup sachê: o nome diz (\d+) un por caixa e o app tem 1 UN = [\d.,]+: no app, toque em Editar neste item e informe (\d+)(?: \(ou acerte no SisChef\))?(?: e lance de novo)?/gi
// "ketchup sachê: a nota traz 10 caixa(s) de 168 un e a tela mostra 10 un; o certo é 1.680 un — no app, toque em Editar neste item e informe 1 UN = 168 (ou acerte a quantidade no SisChef) e lance de novo"
const RE_TRECHO_KETCHUP_CONTA = /ketchup sachê: a nota traz [\d.,]+ caixa\(s\) de (\d+) un e a tela mostra [\d.,]+ un; o certo é [\d.,]+ un — no app, toque em Editar neste item e informe 1 UN = (\d+)(?: \(ou acerte a quantidade no SisChef\))?(?: e lance de novo)?/gi

/** O que o robô pediu em matéria de conversão: os CÓD. FOR com UN DIFERE sem conversão e os fatores do ketchup sachê (o número que o próprio robô diz ser o do nome). */
export interface ConversoesPedidas { cods: string[]; fatores: number[]; resto: string }
/**
 * Reconhece no motivo do robô "UN DIFERE sem conversão" e/ou os dois avisos do ketchup sachê com o fator certo. Do ketchup só vale o trecho em que o número do nome e o número do "informe"
 * são o MESMO (senão fica no `resto`, e sem nenhum trecho reconhecido o resultado é null).
 */
export function conversoesPedidasPeloRobo(motivo: string | null | undefined): ConversoesPedidas | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const cods: string[] = []
  const fatores: number[] = []
  let sobra = t.replace(RE_TRECHO_UN_DIFERE, (_todo, lista: string) => {
    for (const c of lista.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean)) if (!cods.includes(c)) cods.push(c)
    return ''
  })
  const doKetchup = (todo: string, nome: string, informado: string): string => {
    if (nome !== informado) return todo
    const f = Number(nome)
    if (Number.isInteger(f) && f > 0 && !fatores.includes(f)) fatores.push(f)
    return ''
  }
  sobra = sobra.replace(RE_TRECHO_KETCHUP_NOME, doKetchup).replace(RE_TRECHO_KETCHUP_CONTA, doKetchup)
  if (cods.length === 0 && fatores.length === 0) return null
  return { cods, fatores, resto: restoDoMotivo(sobra, []) }
}

/** O que a frase da conversão sugerida precisa saber de cada item. */
export interface FraseConversao {
  n: number
  /** O nome como a nota o traz, sem o "CÓD. FOR" e sem o "- INSUMOS". */
  nome: string
  /** O produto a que o SisChef ligou o item. */
  produtoNome: string
  numero: number
  /** O pedaço do nome que gerou o número ("168UN", "395G"). */
  trecho: string
  /** "10 × 168 = 1.680 UN". */
  conta: string
  /** O número que o app tinha antes (diferente do sugerido), ou null. */
  antes: number | null
}
const semInsumos = (nome: string): string => nome.replace(/\s*-\s*INSUMOS\s*$/i, '').trim()
/** A sugestão de um item, em poucas frases: o número tirado do nome e a conta à vista. */
export const fraseConversaoSugerida = (s: FraseConversao): string =>
  `Item ${s.n} (${s.nome}): falta a conversão de unidade. Sugestão: 1 unidade da nota = ${formatar(s.numero)} (o nome diz ${s.trecho}). Conta: ${s.conta}. Produto no SisChef: ${semInsumos(s.produtoNome)}.`
  + (s.antes != null ? ` Hoje o app tem ${formatar(s.antes)}.` : '')
/** Depois de gravar o número: falta só lançar. */
export const fraseConversaoGravada = (s: Pick<FraseConversao, 'n' | 'nome' | 'numero' | 'conta'>): string =>
  `Item ${s.n} (${s.nome}): conversão ${formatar(s.numero)} gravada (${s.conta}). Agora toque em Lançar.`

// "o XML desta nota já traz boletos (R$ 60,00 em 05/11/2026 + R$ 40,00 em 12/11/2026) e as parcelas digitadas são outras: o XML prevalece e não uso as digitadas — no app, toque em Atualizar e lance de novo sem digitar parcelas — REVISAR"
const RE_TRECHO_BOLETOS = /o XML desta nota já traz boletos \(([^()]*)\) e as parcelas digitadas são outras: o XML prevalece e não uso as digitadas — no app, toque em Atualizar e lance de novo sem digitar parcelas(?: — REVISAR)?/gi
const RE_UM_BOLETO = /^R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2}) em (\d{2})\/(\d{2})\/(\d{4})$/
export interface BoletoDoRobo { valor: number; vencimento: string }
export interface BoletosPrevalecem { boletos: BoletoDoRobo[]; resto: string }
/** O robô devolveu a nota porque o XML já traz boletos e o Ivan tinha digitado outras parcelas: os boletos que ele listou (valor e vencimento aaaa-mm-dd). Lista que não se lê inteira = null. */
export function boletosDaNotaPrevalecem(motivo: string | null | undefined): BoletosPrevalecem | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const boletos: BoletoDoRobo[] = []
  let ilegivel = false
  let achou = false
  const sobra = t.replace(RE_TRECHO_BOLETOS, (_todo, lista: string) => {
    achou = true
    for (const parte of lista.split(/\s+\+\s+/)) {
      const m = RE_UM_BOLETO.exec(parte.trim())
      if (!m) { ilegivel = true; continue }
      boletos.push({ valor: Number(`${m[1].replace(/\./g, '')}.${m[2]}`), vencimento: `${m[5]}-${m[4]}-${m[3]}` })
    }
    return ''
  })
  return achou && !ilegivel && boletos.length > 0 ? { boletos, resto: restoDoMotivo(sobra, []) } : null
}
const reais = (v: number): string => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dataBrDoIso = (iso: string): string => iso.split('-').reverse().join('/')
/** A sugestão de usar os boletos da nota, com a conta: a soma dos boletos é o valor da nota. */
export const fraseBoletosDaNota = (boletos: BoletoDoRobo[], total: number): string =>
  'A nota já traz os boletos e eles valem mais do que as parcelas digitadas. Sugestão: usar os boletos da nota. '
  + `Conta: ${boletos.map((b) => `${reais(b.valor)} (${dataBrDoIso(b.vencimento)})`).join(' + ')} = ${reais(total)}, o valor da nota.`

// "falta a forma de pagamento — escolha "como pagar" no app" / "forma de pagamento desconhecida: 'x'" / "forma de pagamento inválida: 'x'" / "conta PIX 'itau|ij' não existe (esperado …)" (lancar_nfe_nuvem._forma_invalida, formas_pagamento)
const RE_TRECHOS_FORMA = [
  /falta a forma de pagamento — escolha [“"”]como pagar[“"”] no app/gi,
  /forma de pagamento (?:desconhecida|inválida): ('[^']*'|"[^"]*"|\S+)/gi,
  /conta PIX ('[^']*'|"[^"]*"|\S+) não existe \([^()]*\)/gi,
]
/** O robô devolveu a nota por falta de uma forma de pagamento que ele aceite; `resto` = o que o motivo diz além disto. */
export function formaRecusadaPeloRobo(motivo: string | null | undefined): { resto: string } | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t || !RE_TRECHOS_FORMA.some((re) => { re.lastIndex = 0; return re.test(t) })) return null
  return { resto: restoDoMotivo(t, RE_TRECHOS_FORMA) }
}
/** A forma sugerida e de onde vem: o padrão do fornecedor no banco (a da última nota lançada dele) ou o que este aparelho lembra. */
export interface FormaLembrada { forma: string; rotulo: string; origem: 'banco' | 'aparelho'; resto: string }
export const fraseFormaLembrada = (p: FormaLembrada): string =>
  `Falta uma forma de pagamento que o robô aceite. Sugestão: ${p.rotulo}, a forma ${p.origem === 'banco' ? 'da última nota lançada deste fornecedor' : 'que este aparelho lembra para este fornecedor'}.`
