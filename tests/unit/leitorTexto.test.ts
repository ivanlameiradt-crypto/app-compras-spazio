// Leitor do "Colar resposta" (spec 8.2 item 6; contrato 8.3): colagens INVENTADAS no formato do WhatsApp.
import { lerColagem } from '../../src/cotacao/leitorTexto'
import type { ItemCotacao } from '../../src/lib/tipos'
import { itemCotacao } from '../fabricas'

const NOMES: [string, 'un' | 'kg', Partial<ItemCotacao>?][] = [
  ['AGUA MINERAL 500ML', 'un'],
  ['REFRIGERANTE COLA 350 ML', 'un', { qtd: 104, embalagem: 'fardo', fator: 12, fator_confirmado: true }],
  ['GELO ESCAMA', 'un', { qtd: 3, rotulo: 'saco' }],
  ['FERMENTO SECO', 'kg', { qtd: 0.5 }],
  ['LEITE LIQUIDO INTEGRAL', 'kg', { qtd: 19.9, vende_por_litro: true }],
  ['MOSTARDA', 'kg', { qtd: 1.2 }],
  ['LIMAO SICILIANO', 'kg', { qtd: 2 }],
  ['OVO', 'un', { qtd: 30 }],
  ['CEBOLA', 'kg', { qtd: 5 }],
  ['VINAGRE BRANCO', 'kg', { qtd: 2, vende_por_litro: true }],
  ['ACUCAR REFINADO', 'kg', { qtd: 10 }],
  ['GUARDANAPO', 'un', { qtd: 20 }],
  ['PAO BRIOCHE', 'un', { qtd: 40 }],
]
const ITENS: ItemCotacao[] = NOMES.map(([nome, unidade, extra], k) => itemCotacao({
  id: 100 + k, numero: k + 1, produto_id: 10 + k, nome, unidade, rotulo: unidade, qtd: 10, rev: k % 3, ...extra,
}))
/** a mesma lista com um item em kg sem referência (sem o aviso de "preço alto" contra a semana passada) */
const COM_QUEIJO: ItemCotacao[] = [...ITENS, itemCotacao({
  id: 113, numero: 14, produto_id: 23, nome: 'QUEIJO PARMESAO', unidade: 'kg', rotulo: 'kg', qtd: 3, rev: 0,
  ref_preco: null, ref_data: null, ref_situacao: 'sem_referencia',
})]
const porNumero = (r: ReturnType<typeof lerColagem>, n: number) => r.reconhecidos.find((x) => x.numero === n)
/** colagem sem nenhum item reconhecido (só as "não entendidas" dadas) */
const nada = (naoEntendidas: string[] = []) => ({ reconhecidos: [], naoEntendidas, foraDaVersao: [], linhas: {}, horas: {} })

const COLAGEM = [
  '[05/10, 09:14] Fulano: bom dia Ivan, segue',
  '[05/10, 09:14] Fulano: 1. AGUA MINERAL 500ML – 10 un – R$ 2,50',
  '2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) – R$ 42,00 fd c/12',
  '3. GELO ESCAMA – 3 sacos – R$ falta',
  // fora de ordem: vale o número, nunca a posição da linha
  '5. LEITE LIQUIDO INTEGRAL – 19,9 kg – R$ 6,00 1 L',
  '4. FERMENTO SECO – 0,5 kg – R$ 12,40 pct 500 g',
  '[05/10 09:15] 6 - 18,50',
  '7) 9,90 o kg',
  '8. OVO – 30 un – R$ 0',
  '9. CEBOLA – 5 kg – não tenho',
  '10. VINAGRE BRANCO – 2 kg – R$ 8,00 cx 1000 ml',
  '11. ACUCAR REFINADO – 10 kg – R$ 4.50',
  'item 20 - 5,00',
  '12. GUARDANAPO – 20 un – R$',
  '13. PAO BRIOCHE – 40 un – R$ 42,00 12 un vence 30/10',
].join('\n')

describe('lerColagem', () => {
  const r = lerColagem(COLAGEM, ITENS)

  it('reconhece 11 de 13 itens pelo número (cabeçalhos do WhatsApp tirados)', () => {
    expect(r.reconhecidos.map((x) => x.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('rev_lida = rev do item (nunca a ordem das linhas)', () => {
    for (const x of r.reconhecidos) expect(x.rev_lida).toBe(ITENS.find((i) => i.numero === x.numero)!.rev)
  })

  it('"R$", vírgula ou ponto; "fd c/12"; "pct 500 g"; "1 L"; "cx 1000 ml"; "o kg"', () => {
    expect(porNumero(r, 1)).toMatchObject({ estado: 'tem', preco: 2.5, base: 'un' })
    expect(porNumero(r, 2)).toMatchObject({ estado: 'tem', preco: 42, base: 'embalagem', emb_unidades: 12 })
    expect(porNumero(r, 4)).toMatchObject({ estado: 'tem', preco: 12.4, base: 'embalagem', emb_gramas: 500 })
    expect(porNumero(r, 5)).toMatchObject({ estado: 'tem', preco: 6, base: 'litro' })
    expect(porNumero(r, 6)).toMatchObject({ estado: 'tem', preco: 18.5, base: 'kg' })
    expect(porNumero(r, 7)).toMatchObject({ estado: 'tem', preco: 9.9, base: 'kg' })
    expect(porNumero(r, 10)).toMatchObject({ estado: 'tem', preco: 8, base: 'embalagem', emb_ml: 1000 })
    expect(porNumero(r, 11)).toMatchObject({ estado: 'tem', preco: 4.5, base: 'kg' })
  })

  it('"falta", "não tenho" e "0" viram "não tem"', () => {
    expect(porNumero(r, 3)?.estado).toBe('nao_tem')
    expect(porNumero(r, 8)?.estado).toBe('nao_tem')
    expect(porNumero(r, 9)?.estado).toBe('nao_tem')
  })

  it('número que não existe na versão vai à parte ("item 20 não está na v2")', () => {
    expect(r.foraDaVersao).toEqual([20])
  })

  it('linha sem preço é "não respondido"; linha ambígua e conversa vão para "não entendidas"', () => {
    expect(porNumero(r, 12)).toBeUndefined()
    expect(porNumero(r, 13)).toBeUndefined()
    expect(r.naoEntendidas).toEqual(['bom dia Ivan, segue', '13. PAO BRIOCHE – 40 un – R$ 42,00 12 un vence 30/10'])
  })

  it('não lê marca (o Ivan digita a marca em "Digitar preços")', () => {
    const x = lerColagem('1. AGUA MINERAL 500ML – R$ 2,50 marca Cristal', ITENS)
    expect(x.reconhecidos).toHaveLength(1)
    expect(x.reconhecidos[0].marca).toBeUndefined()
  })

  it('só o preço num item com fardo confirmado vale o fardo (como a página, que já vem com ele marcado)', () => {
    expect(lerColagem('2 - 42,00', ITENS).reconhecidos[0]).toMatchObject({ base: 'embalagem', emb_unidades: 12, preco: 42 })
  })

  it('preço escrito antes do "R$" ("1,80 R$") é lido; a linha da lista com "R$" vazio continua "não respondido"', () => {
    expect(lerColagem('1 - 1,80 R$', ITENS).reconhecidos).toMatchObject([{ numero: 1, estado: 'tem', preco: 1.8, base: 'un' }])
    expect(lerColagem('1. AGUA MINERAL 500ML – 10 un – 1,80 R$', ITENS).reconhecidos).toMatchObject([{ numero: 1, preco: 1.8, base: 'un' }])
    expect(lerColagem('1. AGUA MINERAL 500ML 1,80 R$', ITENS).reconhecidos).toMatchObject([{ numero: 1, preco: 1.8 }])
    expect(lerColagem('4. FERMENTO SECO – 0,5 kg – 12,40 pct 500 g R$', ITENS).reconhecidos)
      .toMatchObject([{ numero: 4, preco: 12.4, base: 'embalagem', emb_gramas: 500 }])
    // antes do "R$" com o que não dá para ler com segurança: vai para "não entendidas", nunca some
    expect(lerColagem('13. PAO BRIOCHE – 40 un – 42,00 12 un R$', ITENS).naoEntendidas).toEqual(['13. PAO BRIOCHE – 40 un – 42,00 12 un R$'])
    for (const vazia of ['1. AGUA MINERAL 500ML – 10 un – R$', '1. AGUA MINERAL 500ML – R$', '1. AGUA MINERAL 500ML R$', '1 - R$']) {
      expect(lerColagem(vazia, ITENS)).toEqual(nada())
    }
  })

  it('o mesmo item duas vezes com a mesma resposta: vale uma vez', () => {
    const x = lerColagem('1. 2,50\n1. AGUA MINERAL 500ML – 10 un – R$ 2,50', ITENS)
    expect(x.reconhecidos).toMatchObject([{ numero: 1, preco: 2.5 }])
    expect(x.naoEntendidas).toEqual([])
  })

  it('o mesmo item em duas linhas com respostas diferentes: nenhuma vale em silêncio, as duas vão para "não entendidas"', () => {
    const x = lerColagem('1. 2,50\n2 - 42,00\n1. 2,60', ITENS)
    expect(x.reconhecidos.map((e) => e.numero)).toEqual([2])
    expect(x.naoEntendidas).toEqual(['1. 2,50', '1. 2,60'])
    // "não tenho" depois de um preço também é resposta diferente
    expect(lerColagem('9 - 3,20\n9 - não tenho', ITENS).naoEntendidas).toEqual(['9 - 3,20', '9 - não tenho'])
  })

  it('linha que cita dois itens não vira preço do primeiro ("3 e 5 não tenho")', () => {
    for (const linha of ['3 e 5 não tenho', '3) e 5 não tenho', '3 - 5 não tenho', '3 / 5 falta', '3 & 5 não tenho']) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
  })

  it('conversa que começa com número não vira preço ("2 dias pra entregar", "12 un 3,50", "mínimo R$ 300")', () => {
    for (const linha of [
      '2 dias pra entregar, pedido mínimo 300', '1 dia útil, mínimo R$ 300', '12 un 3,50', '1 - 2,50 no pix',
      '6 - frete R$ 30', '4. FERMENTO SECO – 0,5 kg – R$ 12,40 boleto', '30 dias no boleto',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
  })

  it('a conversa no fim não apaga o preço que o vendedor mandou antes para o mesmo item', () => {
    const x = lerColagem('1. AGUA MINERAL 500ML – 10 un – R$ 2,50\n1 dia útil, mínimo R$ 300', ITENS)
    expect(x.reconhecidos).toMatchObject([{ numero: 1, preco: 2.5, base: 'un' }])
    expect(x.naoEntendidas).toEqual(['1 dia útil, mínimo R$ 300'])
  })

  it('separado só por espaço, vale quando o resto começa pelo nome, por "R$", pelo preço ou por "não tenho"', () => {
    const x = lerColagem('1 AGUA MINERAL 500ML 2,50\n6 R$ 18,50\n7 9,90 o kg\n9 não tenho', ITENS)
    expect(x.reconhecidos.map((e) => [e.numero, e.estado, e.preco ?? null])).toEqual([
      [1, 'tem', 2.5], [6, 'tem', 18.5], [7, 'tem', 9.9], [9, 'nao_tem', null],
    ])
    expect(x.naoEntendidas).toEqual([])
  })

  it('a própria mensagem devolvida sem preços não vira resposta nem "não entendida"', () => {
    const devolvida = [
      'Oi, Fulano! Aqui é o Ivan, da Spazio Gourmet.',
      '*É COTAÇÃO, ainda não é pedido.* Pode me passar seus preços para os itens abaixo?',
      'Para responder pelo link (sem cadastro):',
      'https://spaziogourmet.github.io/cotacao/#c=q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG',
      'Ou copie a lista, escreva o preço no fim de cada linha e me mande de volta:',
      '1. AGUA MINERAL 500ML – 10 un – R$',
      'Preço de fardo ou caixa: diga quantas unidades vêm (ex.: R$ 31,50 fd c/6).',
      'Itens em kg: preço do kg ou da embalagem, com o peso (ex.: R$ 12,40 pct 400 g).',
      'Itens 5 e 10 (líquidos): pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).',
      'Não tem? Escreva "não tenho".',
      'Prazo: terça, 20/10, até 12h.',
      'Cotação v2 — substitui a v1; números iguais, itens novos no fim · Obrigado!',
    ].join('\n')
    expect(lerColagem(devolvida, ITENS)).toEqual(nada())
    // as outras formas das linhas da mensagem: um líquido só, três líquidos, v1, complementar, sem o negrito
    for (const linha of [
      'Item 5 (líquido): pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).',
      'Itens 5, 10 e 12 (líquidos): pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).',
      'Cotação v1 · Obrigado!', 'Cotação complementar — itens novos desta semana · Obrigado!',
      'É COTAÇÃO, ainda não é pedido. Pode me passar seus preços para os itens abaixo?',
      'Não tem? Escreva “não tenho”.',
    ]) {
      expect(lerColagem(linha, COM_QUEIJO), linha).toEqual(nada())
    }
  })

  it('a linha que só COMEÇA como uma da mensagem é do vendedor: vai para "não entendidas", nunca some', () => {
    for (const linha of [
      'Itens em kg: preço da caixa fechada de 10 kg', 'Preço de fardo ou caixa: todos fardo c/6', 'Não tem? 6 e 11',
      'Cotação v2 respondida, só mudou o 7 pra 10,50', 'Para responder pelo link não abriu, segue: 1 - 2,50',
      'Itens 5 e 10 (líquidos): preço da caixa de 12 L', 'Item 5 (líquido): 6,10 o litro',
      'Ou copie a lista? Segue: 1 - 2,50', 'https://exemplo.com.br/catalogo.pdf',
      // o exemplo da mensagem com o preço mudado pelo vendedor também é dele
      'Preço de fardo ou caixa: diga quantas unidades vêm (ex.: R$ 45,00 fd c/12).',
    ]) {
      expect(lerColagem(linha, COM_QUEIJO).naoEntendidas, linha).toEqual([linha])
    }
    // a explicação que o vendedor pôs no lugar da linha do modelo aparece ao lado dos preços que ela explica
    const x = lerColagem('Itens em kg: preço da caixa fechada de 10 kg\n7 - 95,00\n9 - 64,00', COM_QUEIJO)
    expect(x.naoEntendidas).toEqual(['Itens em kg: preço da caixa fechada de 10 kg'])
  })

  it('dois "R$" com preço antes do último: não vale nenhum dos dois, a linha vai para "não entendidas"', () => {
    for (const linha of [
      '2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) – R$ 42,00 – R$ 3,50',
      '1) R$ 1,80 cx c/12 R$ 21,00',
      '4. FERMENTO SECO – 0,5 kg – R$ 45 R$ 22,50 500g',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // "R$" repetido sem outro preço antes continua valendo
    expect(lerColagem('1. AGUA MINERAL 500ML – 10 un – R$ R$ 2,50', ITENS).reconhecidos).toMatchObject([{ numero: 1, preco: 2.5 }])
  })

  it('ressalva ao lado do preço ou do "não tenho" ("só tenho 1 kg", "mas acabou", "tenho similar"): "não entendidas"', () => {
    for (const linha of [
      '7 - 12,00 (só tenho 1 kg)', '8 - 0,90 só tenho 1 un', '7 - 12,00 mas acabou', '7 - 12,00 tenho similar',
      '7 - 12,00 outra marca', '6 - 18,50 chega amanhã', '1 - 2,50 gelada', '9 - não tenho, mas tenho similar',
      '9 - falta, chega amanhã',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // unidade, embalagem e ligação ao lado do preço continuam valendo
    expect(lerColagem('1 - 2,50 cada\n7 - 9,90 reais o kg\n9 - não tenho no momento', ITENS).reconhecidos.map((e) => [e.numero, e.estado]))
      .toEqual([[1, 'tem'], [7, 'tem'], [9, 'nao_tem']])
  })

  it('"linhas": a linha colada de cada item reconhecido, para a conferência', () => {
    const x = lerColagem('[05/10, 09:14] Fulano: 1 - 2,50\n7) 9,90 o kg\n1. AGUA MINERAL 500ML – 10 un – R$ 2,50\n2 - 3,00\n2 - 4,00', ITENS)
    expect(x.linhas).toEqual({ 1: ['1 - 2,50', '1. AGUA MINERAL 500ML – 10 un – R$ 2,50'], 7: ['7) 9,90 o kg'] })
    expect(x.naoEntendidas).toEqual(['2 - 3,00', '2 - 4,00'])
    // a hora do cabeçalho vale para as linhas seguintes da mesma mensagem (só a primeira linha tem o cabeçalho)
    expect(x.horas).toEqual({ 1: ['05/10, 09:14', '05/10, 09:14'], 7: ['05/10, 09:14'] })
  })

  it('"horas": a data e a hora do cabeçalho do WhatsApp de cada linha, como vieram; sem cabeçalho acima, null', () => {
    const x = lerColagem([
      '1 - 2,50', '[05/10, 09:14] Fulano: 7 - 9,90', '9 - 3,20', '[09:15, 05/10/2026] Fulano: 6 - 18,50',
      '05/10/2026 16:02 - Fulano: 11 - 4,50',
    ].join('\n'), ITENS)
    expect(x.horas).toEqual({ 1: [null], 6: ['09:15, 05/10/2026'], 7: ['05/10, 09:14'], 9: ['05/10, 09:14'], 11: ['05/10/2026 16:02'] })
  })

  it('"Oi," e "Prazo:" que não são as linhas da mensagem vão para "não entendidas", nunca somem', () => {
    for (const linha of ['Oi, Ivan, item 12 R$ 12,00', 'Oi, Ivan! O 12 não tenho, o resto segue', 'Prazo: 28 dias no boleto']) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
  })

  it('cabeçalho do WhatsApp Web/Desktop, com a hora antes da data, é tirado', () => {
    const x = lerColagem('[09:14, 05/10/2026] Fulano: 1 - 1,80\n[9:14 AM, 10/5/2026] Fulano: 7 - 9,90', ITENS)
    expect(x.reconhecidos).toMatchObject([{ numero: 1, preco: 1.8 }, { numero: 7, preco: 9.9 }])
    expect(x.naoEntendidas).toEqual([])
  })

  it('o que vem antes do único "R$" não some: a embalagem é lida com o preço (nunca vira o preço da unidade ou do kg)', () => {
    for (const [linha, esperado] of [
      ['1 - cx c/12 R$ 45', { numero: 1, preco: 45, base: 'embalagem', emb_unidades: 12 }],
      ['1. AGUA MINERAL 500ML – 10 un – fd c/12 R$ 21,00', { numero: 1, preco: 21, base: 'embalagem', emb_unidades: 12 }],
      ['4 - pct 500g R$ 22,50', { numero: 4, preco: 22.5, base: 'embalagem', emb_gramas: 500 }],
      ['4. FERMENTO SECO – 0,5 kg – pct 500 g R$ 22,50', { numero: 4, preco: 22.5, base: 'embalagem', emb_gramas: 500 }],
      ['2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) – fd c/6 R$ 21,00', { numero: 2, preco: 21, base: 'embalagem', emb_unidades: 6 }],
      ['5 - cx 200ml R$ 2,00', { numero: 5, preco: 2, base: 'embalagem', emb_ml: 200 }],
      // "marca" antes do "R$" não é lida nem impede o preço
      ['1 - marca Cristal R$ 2,50', { numero: 1, preco: 2.5, base: 'un' }],
    ] as const) {
      const x = lerColagem(linha, ITENS)
      expect(x.reconhecidos, linha).toMatchObject([{ estado: 'tem', ...esperado }])
      expect(x.naoEntendidas, linha).toEqual([])
    }
  })

  it('ressalva, "não tenho" ou outro produto antes do único "R$": "não entendidas", nunca o preço cheio', () => {
    for (const linha of [
      '7 - só tenho 1 kg R$ 12,00', '7 - similar marca X R$ 9,90', '7 - tenho similar R$ 9,90', '1 - outra marca R$ 2,10',
      '1 - não tenho, similar R$ 2,30', '7 - limão tahiti R$ 5,00', '1 - 2,50 R$ 3,00',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // o preço antes do "R$" com a unidade depois dele continua valendo
    expect(lerColagem('1 - 2,50 R$ cada', ITENS).reconhecidos).toMatchObject([{ numero: 1, preco: 2.5, base: 'un' }])
  })

  it('com os travessões da mensagem, só o nome e a quantidade exatos da mensagem saem; o resto é lido ou vai para "não entendidas"', () => {
    // a embalagem no lugar do nome ou da quantidade é lida
    for (const [linha, esperado] of [
      ['1 – cx c/12 – R$ 45', { numero: 1, preco: 45, base: 'embalagem', emb_unidades: 12 }],
      ['1 – cx c/12 – 45', { numero: 1, preco: 45, base: 'embalagem', emb_unidades: 12 }],
      ['1. AGUA MINERAL 500ML – fd c/12 – R$ 21,00', { numero: 1, preco: 21, base: 'embalagem', emb_unidades: 12 }],
      // sem o nome, com a quantidade da mensagem
      ['1 – 10 un – R$ 2,50', { numero: 1, preco: 2.5, base: 'un' }],
      ['1. – 10 un – R$ 2,50', { numero: 1, preco: 2.5, base: 'un' }],
    ] as const) {
      const x = lerColagem(linha, ITENS)
      expect(x.reconhecidos, linha).toMatchObject([{ estado: 'tem', ...esperado }])
      expect(x.naoEntendidas, linha).toEqual([])
    }
    // quantidade mexida, ressalva no lugar da quantidade, nome de outro item (lista de outra semana): nunca o preço cheio
    for (const linha of [
      '1. AGUA MINERAL 500ML – 5 un – R$ 2,50', '1. AGUA MINERAL 500ML – 10 un (só tenho 5) – R$ 2,50',
      '1. CEBOLA – 5 kg – R$ 3,20', '1. CEBOLA – 5 kg – 3,20', '7. OVO – 30 un – R$ 0,80',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // a nota do Ivan depois da quantidade faz parte da linha da mensagem
    const comNota = ITENS.map((i) => (i.numero === 2 ? { ...i, nota_vendedor: 'Lata, não PET' } : i))
    expect(lerColagem('2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) (Lata, não PET) – R$ 42,00', comNota).reconhecidos)
      .toMatchObject([{ numero: 2, preco: 42, base: 'embalagem', emb_unidades: 12 }])
    expect(lerColagem('2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) (Lata, não PET) – R$', comNota)).toEqual(nada())
  })

  it('unidade dita E embalagem na mesma linha ("45,00 o kg pct 500g", "2,50 un fd c/12"): "não entendidas", nunca o preço dividido pela embalagem', () => {
    for (const linha of [
      '4 - 45,00 o kg pct 500g', '4 - R$ 45,00 kg (pct 500 g)', '7 - 9,90 o kg (cx 10kg)', '7 - 9,90/kg cx c/ 10kg',
      '11 - 4,50 kg fardo 10 kg', '1 - 2,50 un fd c/12', '1 - R$ 2,50 a unidade, fardo com 12', '1 - 2,50 cada (cx c/12)',
      '13 - 3,50 cada pct c/ 12', '10 - 8,00 o litro garrafa 750ml',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // a embalagem com a própria quantidade escrita ("fd 12 un", "c/12 un", "pct 1 kg", "cx 1 L") continua valendo
    const x = lerColagem('1 - 42,00 fd 12 un\n13 - 42,00 fd c/12 un\n4 - 12,40 pct 1 kg\n5 - 6,00 cx 1 L', ITENS)
    expect(x.reconhecidos).toMatchObject([
      { numero: 1, base: 'embalagem', emb_unidades: 12 }, { numero: 4, base: 'embalagem', emb_gramas: 1000 },
      { numero: 5, base: 'embalagem', emb_ml: 1000 }, { numero: 13, base: 'embalagem', emb_unidades: 12 },
    ])
    expect(x.naoEntendidas).toEqual([])
  })

  it('a lista de outra versão ou semana devolvida sem preço (outra quantidade): "não entendidas", nunca preço = quantidade', () => {
    for (const linha of [
      '7. LIMAO SICILIANO – 10 kg – R$', '1. AGUA MINERAL 500ML – 5 un – R$', '3. GELO ESCAMA – 5 sacos – R$',
      '9. CEBOLA – 8 kg – R$', '12. GUARDANAPO – 30 un – R$', '9 – 8 kg – R$', '9. – 8 kg – R$',
      // com hífen no lugar do travessão, e a linha que termina no travessão (sem o "R$")
      '9. CEBOLA - 8 kg - R$', '9 - 8 kg - R$', '1. AGUA MINERAL 500ML – 5 un –', '1. AGUA MINERAL 500ML - 5 un -',
      // a quantidade com a embalagem da mensagem de outra semana
      '2. REFRIGERANTE COLA 350 ML – 96 un (8 fd c/12) – R$',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // a quantidade desta versão continua saindo (linha em branco = não respondido; com preço = lido)
    expect(lerColagem('9. CEBOLA - 5 kg - R$', ITENS)).toEqual(nada())
    expect(lerColagem('7. LIMAO SICILIANO - 2 kg - R$ 9,90', ITENS).reconhecidos).toMatchObject([{ numero: 7, preco: 9.9, base: 'kg' }])
    // sem o nome e sem hífen depois, número + unidade é o preço com a unidade
    expect(lerColagem('7 - 9,90 kg\n1 - 1,80 un R$', ITENS).reconhecidos).toMatchObject([
      { numero: 1, preco: 1.8, base: 'un' }, { numero: 7, preco: 9.9, base: 'kg' },
    ])
  })

  it('a quantidade mexida para 1 ("– 1 kg –", "– 1 un –") não some junto com a unidade (o "1 kg" não vira "o kg")', () => {
    for (const linha of [
      '7. LIMAO SICILIANO – 1 kg – R$ 9,90', '1. AGUA MINERAL 500ML – 1 un – R$ 2,50', '9. CEBOLA – 1 kg – 3,20',
      '7. LIMAO SICILIANO - 1 kg - R$ 9,90', '7 – 1 kg – R$ 9,90',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
  })

  it('a conversa colada com a mensagem de outra versão: os itens em branco não ganham a quantidade como preço', () => {
    const conversa = [
      '[05/10, 15:00] Ivan: Oi, Fulano! Aqui é o Ivan, da Spazio Gourmet.',
      '1. AGUA MINERAL 500ML – 12 un – R$',
      '9. CEBOLA – 8 kg – R$',
      'Cotação v1 · Obrigado!',
      '[05/10, 16:10] Fulano: 9 - 3,20',
    ].join('\n')
    const x = lerColagem(conversa, ITENS)
    expect(x.reconhecidos).toMatchObject([{ numero: 9, estado: 'tem', preco: 3.2, base: 'kg' }])
    expect(x.naoEntendidas).toEqual(['1. AGUA MINERAL 500ML – 12 un – R$', '9. CEBOLA – 8 kg – R$'])
  })

  it('preço com a vírgula ou o ponto na frente (",80", ".80", "O,50", "l,50") não vira 80 ou 50', () => {
    for (const linha of ['1 - R$ ,80', '1 - .80', '1 - R$ .99', '1 - R$ O,50', '5 - R$ l,50', '7 - R$ ,90 o kg']) {
      expect(lerColagem(linha, ITENS).reconhecidos, linha).toEqual([])
      expect(lerColagem(linha, ITENS).naoEntendidas, linha).toEqual([linha])
    }
    // milhar e decimal com ponto continuam valendo
    expect(lerColagem('11 - R$ 1.250,00\n1 - R$ 2.50', ITENS).reconhecidos).toMatchObject([
      { numero: 1, preco: 2.5 }, { numero: 11, preco: 1250 },
    ])
  })

  it('só a palavra depois de "marca" fica de fora: a variação do produto depois dela vai para "não entendidas"', () => {
    for (const linha of [
      '5 - 6,00 marca Italac desnatado', '1 - R$ 2,50 marca Crystal com gás', '7 - 9,90 marca X congelado',
      '8 - 0,80 marca X caipira', '1 - 2,50 marca X vencendo', '1 - 2,50 marca Santa Clara',
    ]) {
      expect(lerColagem(linha, ITENS), linha).toEqual(nada([linha]))
    }
    // a marca de uma palavra continua valendo (e não é lida)
    for (const linha of ['1 - 2,50 marca Cristal', '1 - 2,50 marca: Cristal', '7 - 9,90 o kg marca X']) {
      expect(lerColagem(linha, ITENS).reconhecidos, linha).toHaveLength(1)
    }
  })

  it('horário no começo da linha ("09:14", "10:00", "14:00 às 18:00") vai para "não entendidas", nunca vira item', () => {
    for (const [colada, linha] of [
      ['09:14', '09:14'], ['10:00', '10:00'], ['9:00', '9:00'], ['12:30', '12:30'], ['14:00 às 18:00', '14:00 às 18:00'],
      ['[05/10, 09:14] Fulano: 10:00', '10:00'], ['10:00h', '10:00h'],
    ]) {
      expect(lerColagem(colada, ITENS), colada).toEqual(nada([linha]))
    }
    // "1: 2,50", "1:2,50" e "1:25,00" continuam sendo o item 1
    for (const linha of ['1: 2,50', '1:2,50']) {
      expect(lerColagem(linha, ITENS).reconhecidos, linha).toMatchObject([{ numero: 1, preco: 2.5 }])
    }
    expect(lerColagem('1:25,00', ITENS).reconhecidos).toMatchObject([{ numero: 1, preco: 25 }])
    // a hora numa linha própria no meio da colagem não atrapalha as outras
    const x = lerColagem('1 - 2,50\n10:00\n7 - 9,90', ITENS)
    expect(x.reconhecidos.map((e) => e.numero)).toEqual([1, 7])
    expect(x.naoEntendidas).toEqual(['10:00'])
  })

  it('preço com uma casa decimal terminada em 1 e a unidade logo depois ("2,1 kg", "3,1 un", "6,1 L", "0,1 un") não perde o 1', () => {
    for (const [linha, esperado] of [
      ['7 - 2,1 kg', { numero: 7, estado: 'tem', preco: 2.1, base: 'kg' }],
      ['7 - 2.1 kg', { numero: 7, estado: 'tem', preco: 2.1, base: 'kg' }],
      ['14 - 45,1 kg', { numero: 14, estado: 'tem', preco: 45.1, base: 'kg' }],
      ['14 - R$ 1,1 kg', { numero: 14, estado: 'tem', preco: 1.1, base: 'kg' }],
      ['1 - 3,1 un', { numero: 1, estado: 'tem', preco: 3.1, base: 'un' }],
      ['5 - 6,1 L', { numero: 5, estado: 'tem', preco: 6.1, base: 'litro' }],
      ['5 - 6,1l', { numero: 5, estado: 'tem', preco: 6.1, base: 'litro' }],
      // "0,1" não vira "0," (= não tem)
      ['12 - 0,1 un', { numero: 12, estado: 'tem', preco: 0.1, base: 'un' }],
      ['12 - 0.1 un', { numero: 12, estado: 'tem', preco: 0.1, base: 'un' }],
      // o "1" solto antes da unidade continua sendo a base ("1kg" = o kg, "1 L" = o litro, "1 un" = a unidade)
      ['7 - 9,90 1kg', { numero: 7, estado: 'tem', preco: 9.9, base: 'kg' }],
      ['5 - 6,00 1 L', { numero: 5, estado: 'tem', preco: 6, base: 'litro' }],
      ['1 - 1 un 2,50', { numero: 1, estado: 'tem', preco: 2.5, base: 'un' }],
      ['7 - 11 kg', { numero: 7, estado: 'tem', preco: 11, base: 'kg' }],
    ] as const) {
      const x = lerColagem(linha, COM_QUEIJO)
      expect(x.reconhecidos, linha).toEqual([expect.objectContaining(esperado)])
      expect(x.naoEntendidas, linha).toEqual([])
    }
  })

  it('a quantidade da mensagem seguida de "=" ou "por" e do preço é o total dela, não o preço da unidade ou do kg: "não entendidas"', () => {
    for (const linha of [
      '1 - 10 un = 18,90', '1 - 10 un=18,90', '7 - 2 kg = 19,80', '14 - 3 kg = 269,70', '12 - 20 un = 2,00',
      '9 - 5 kg por 17,45', '1. AGUA MINERAL 500ML 10 un = R$ 18,90', '9. CEBOLA - 5 kg = 17,45', '9. CEBOLA 5 kg por R$ 17,45',
      '9. CEBOLA - 5 kg - por 17,45', '9. CEBOLA – 5 kg – por 17,45', '9. CEBOLA – 5 kg – por R$ 17,45', '1 – 10 un – = 18,90',
    ]) {
      expect(lerColagem(linha, COM_QUEIJO), linha).toEqual(nada([linha]))
    }
    // a quantidade da mensagem seguida só do preço (ou de hífen/travessão e o preço), ou "por kg" depois do preço, continua valendo
    const x = lerColagem('1 - 10 un 1,89\n12 - 20 un - 0,15\n9. CEBOLA – 5 kg – 3,20 por kg\n7 - 2 kg - 9,90 o kg', COM_QUEIJO)
    expect(x.reconhecidos).toMatchObject([
      { numero: 1, preco: 1.89, base: 'un' }, { numero: 7, preco: 9.9, base: 'kg' },
      { numero: 9, preco: 3.2, base: 'kg' }, { numero: 12, preco: 0.15, base: 'un' },
    ])
    expect(x.naoEntendidas).toEqual([])
  })

  it('"pç", "pc", "pcs" e "peça" são a unidade: num item em kg vão para "não entendidas", nunca viram o preço do kg', () => {
    for (const linha of [
      '14 - R$ 180,00 a pç', '14 - 45,00 pç', '14 - 45,00 pcs', '14. QUEIJO PARMESAO – 3 kg – R$ 89,90 pç',
      '14 - 45,00 a peça', '7 - 2,50 pc', '14 - 22,00 pç 500 g',
    ]) {
      expect(lerColagem(linha, COM_QUEIJO), linha).toEqual(nada([linha]))
    }
    // num item em un, a peça é a unidade; o fardo ou a caixa com as peças contadas continua valendo
    const x = lerColagem('8 - 0,80 pc\n13 - 1,50 a peça\n1 - 42,00 cx 12 pcs\n12 - 42,00 cx c/12 peças', COM_QUEIJO)
    expect(x.reconhecidos).toMatchObject([
      { numero: 1, preco: 42, base: 'embalagem', emb_unidades: 12 }, { numero: 8, preco: 0.8, base: 'un' },
      { numero: 12, preco: 42, base: 'embalagem', emb_unidades: 12 }, { numero: 13, preco: 1.5, base: 'un' },
    ])
    expect(x.naoEntendidas).toEqual([])
  })
  it('unidade ou embalagem grudada no preço nunca vale na base padrão do item', () => {
    for (const linha of [
      '7 - 2,50un', '7 - R$ 1,20und', '7 - 1,20unid', '14 - 45,00pç', '14 - R$ 180,00pç', '14 - 45,00pcs', '7 - 2,50cada',
      '9 - 64,00sc', '6 - 18,90pct', '1 - 42,00fd', '13 - 150,00cx', '7 - 2,50 unidades', '7 - 2,50unidades', '14 - 45,00peça',
    ]) {
      expect(lerColagem(linha, COM_QUEIJO), linha).toEqual(nada([linha]))
    }
    // grudada ou com espaço, a mesma leitura ("6,10lt" num item em kg é o litro, com o aviso de confirmar o kg por litro,
    // como "6,10 lt"; nunca R$ 6,10 o kg)
    for (const linha of ['7 - 2,50un', '14 - 45,00pç', '9 - 64,00sc', '4 - 6,10lt', '4 - 6,10litro', '1 - 42,00fd', '3 - 20,00sc']) {
      const comEspaco = linha.replace(/(\d)([a-zç]+)$/, '$1 $2')
      expect(lerColagem(linha, COM_QUEIJO).reconhecidos, linha).toEqual(lerColagem(comEspaco, COM_QUEIJO).reconhecidos)
    }
    expect(lerColagem('4 - 6,10lt\n4 - 6,10litro', COM_QUEIJO).reconhecidos).toMatchObject([{ numero: 4, preco: 6.1, base: 'litro' }])
    // grudada no preço, a unidade do item continua valendo; e as embalagens com a quantidade grudada também
    for (const [linha, esperado] of [
      ['1 - 2,50un', { numero: 1, preco: 2.5, base: 'un' }],
      ['1 - 2,50unidades', { numero: 1, preco: 2.5, base: 'un' }],
      ['8 - 0,80cada', { numero: 8, preco: 0.8, base: 'un' }],
      ['7 - 9,90kg', { numero: 7, preco: 9.9, base: 'kg' }],
      ['5 - 6,1l', { numero: 5, preco: 6.1, base: 'litro' }],
      ['10 - 6,10lt', { numero: 10, preco: 6.1, base: 'litro' }],
      ['3 - 20,00sc', { numero: 3, preco: 20, base: 'un' }],
      ['1 - 42,00fd c/12un', { numero: 1, preco: 42, base: 'embalagem', emb_unidades: 12 }],
      ['1 - 42,00 cx 12un', { numero: 1, preco: 42, base: 'embalagem', emb_unidades: 12 }],
      ['4 - 12,40pct 500g', { numero: 4, preco: 12.4, base: 'embalagem', emb_gramas: 500 }],
      ['10 - 8,00cx 1l', { numero: 10, preco: 8, base: 'embalagem', emb_ml: 1000 }],
      ['10 - 8,00 cx 1000ml', { numero: 10, preco: 8, base: 'embalagem', emb_ml: 1000 }],
    ] as const) {
      const x = lerColagem(linha, COM_QUEIJO)
      expect(x.reconhecidos, linha).toEqual([expect.objectContaining({ estado: 'tem', ...esperado })])
      expect(x.naoEntendidas, linha).toEqual([])
    }
  })
})
