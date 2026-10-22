// 22/10/2026 (revisão independente do suporte a CT/PCT): a caixa "Editar" de um item JÁ associado no SisChef lê a unidade do produto antes de sugerir a embalagem pelo nome
// ("C/ 100 UND" → 100). A unidade lida só vale para o produto de que foi lida: se a mesma caixa passa a outro item, a sugestão volta a ficar escondida até a leitura nova.
import { render, screen, waitFor } from '@testing-library/react'
import { ConversaoItemAssociado } from '../../src/admin/ConversaoItemAssociado'
import type { ItemNotaSefaz } from '../../src/lib/tipos'

const item = (produto_id: number): ItemNotaSefaz & { n: number } => ({
  n: 1, descricao: 'SACO PEAD 1/2KG C/ 100 UND', qtd: 10, unidade_sischef: 'UN', produto_id, produto_nome: 'SACO', associacao: 'sischef',
})
const base = { atual: null, pede: true, desabilitado: false, salvar: async () => undefined }
const sugestao = () => screen.queryByTestId('conversao-item-sugestao')

describe('ConversaoItemAssociado — a unidade lida vale só para o produto de que foi lida', () => {
  it('trocar o item da caixa para outro produto esconde a sugestão até a leitura nova (não herda "un" do produto anterior)', async () => {
    let liberarDoDois: (u: string | null) => void = () => undefined
    const doDois = new Promise<string | null>((r) => { liberarDoDois = r })
    const buscarUnidade = vi.fn(async (id: number | string) => (Number(id) === 1 ? 'un' : doDois))
    const { rerender } = render(<ConversaoItemAssociado {...base} item={item(1)} buscarUnidade={buscarUnidade} />)
    await waitFor(() => expect(sugestao()).toBeInTheDocument())                                    // produto 1 é UN: a sugestão aparece
    rerender(<ConversaoItemAssociado {...base} item={item(2)} buscarUnidade={buscarUnidade} />)
    expect(sugestao()).not.toBeInTheDocument()                                                     // produto 2: ainda lendo — sem herdar o "un" do 1
    await waitFor(() => expect(buscarUnidade).toHaveBeenCalledWith('2'))
    liberarDoDois('ct')
    await waitFor(() => expect(buscarUnidade).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 30))
    expect(sugestao()).not.toBeInTheDocument()                                                     // produto 2 é CT: sem sugestão
    rerender(<ConversaoItemAssociado {...base} item={item(1)} buscarUnidade={buscarUnidade} />)
    await waitFor(() => expect(sugestao()).toBeInTheDocument())                                    // voltando ao produto 1 (UN), a sugestão volta
  })

  it('sem a função de leitura (como nos testes antigos e fora da tela da nota) a sugestão aparece como sempre', () => {
    render(<ConversaoItemAssociado {...base} item={item(1)} />)
    expect(sugestao()).toHaveTextContent('usar 100')
  })

  it('item sem código de produto: não lê nada e a sugestão aparece como sempre', () => {
    const buscarUnidade = vi.fn(async () => 'ct')
    render(<ConversaoItemAssociado {...base} item={{ ...item(1), produto_id: null }} buscarUnidade={buscarUnidade} />)
    expect(buscarUnidade).not.toHaveBeenCalled()
    expect(sugestao()).toHaveTextContent('usar 100')
  })
})
