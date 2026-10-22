import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

// 21/10/2026: o Ivan viu "Precisa de você: parou antes de gerar o pedido (nada lançado): item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão
// do painel)" e pediu: "essa informação tem que ser mais clara quando houve o problema por que não foi lançado". A tela agora diz o produto pelo nome, o que aconteceu e o que fazer.
const MOTIVO_SHOYU = 'parou antes de gerar o pedido (nada lançado): item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)'
const MOTIVO_FRETE = 'nota com frete (R$ 492,82): o lançamento com frete ainda não está ligado (secret NFE_FRETE_LIGADO) — nada foi lançado; lance esta nota à mão no SisChef ou ligue o frete com o Claude acompanhando'

const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '1'.repeat(44), emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089465', emissao: '2026-10-21', valor_nf: 1308.19, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [
    { n: 1, descricao: 'CÓD. FOR: 14192 AÇUCAR CRISTAL - INSUMOS', qtd: 60, unidade_sischef: 'KG', produto_id: 1874466, associacao: 'sischef', produto_nome: 'AÇUCAR CRISTAL - INSUMOS' },
    { n: 5, descricao: 'CÓD. FOR: 263230 SHOYU TRADICIONAL - INSUMOS', qtd: 3, unidade_sischef: 'KG', produto_id: 3644178, associacao: 'sischef', produto_nome: 'SHOYU TRADICIONAL - INSUMOS' },
  ],
  parcelas: [], forma_pagamento: 'cartao', lancamento_estado: 'revisar', lancamento_motivo: MOTIVO_SHOYU, ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
})

describe('NotaSefaz — o aviso de por que a nota não foi lançada, em português claro', () => {
  it('a conta de unidades que não bate: nada foi lançado, por quê (o produto pelo nome) e o que fazer, em 3 linhas', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const aviso = screen.getByTestId('status-nota')
    const linhas = (aviso.textContent ?? '').split('\n')
    expect(linhas).toHaveLength(3)
    expect(linhas[0]).toBe('Precisa de você — nada foi lançado.')
    expect(linhas[1]).toBe('Por quê: No SHOYU TRADICIONAL a conta não bate: a nota traz 1 unidade e o SisChef converte isso para 3 kg, mas no app a conversão está em 1 kg por unidade.')
    expect(linhas[2]).toContain('O que fazer: Veja qual é o certo. Se cada unidade tem 3 kg, toque em Editar no SHOYU TRADICIONAL e informe 3.')
    expect(aviso.textContent).not.toContain('CÓD. FOR 263230')
    expect(aviso.textContent).not.toContain('parou antes de gerar o pedido')
  })

  it('o aviso respeita as quebras de linha (a regra de estilo está na folha de estilos do app)', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')       // o teste roda na pasta do projeto
    expect(css).toMatch(/\.nota-lancar \[data-testid="status-nota"\] \{[^}]*white-space: pre-line/)
  })

  it('a nota com frete (R&C): diz o motivo e as duas saídas', async () => {
    m.notasALancar.mockResolvedValue([mateus({ emitente: 'R&C IMPRESSOS GRAFICOS EM GERAL LTDA', numero: '000011031', lancamento_motivo: MOTIVO_FRETE })])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const aviso = screen.getByTestId('status-nota').textContent ?? ''
    expect(aviso).toContain('Por quê: Esta nota tem frete (R$ 492,82) e o robô ainda não lança nota com frete sozinho.')
    expect(aviso).toContain('O que fazer: Lance esta nota à mão no SisChef, ou peça o teste acompanhado do frete.')
    expect(aviso).not.toContain('NFE_FRETE_LIGADO')
  })

  it('motivo que a regra não conhece: o texto do robô continua aparecendo, só sem o começo técnico', async () => {
    m.notasALancar.mockResolvedValue([mateus({ lancamento_motivo: 'parou antes de gerar o pedido (nada lançado): o SisChef pediu outra coisa' })])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: Nada foi lançado. o SisChef pediu outra coisa')
  })
})
