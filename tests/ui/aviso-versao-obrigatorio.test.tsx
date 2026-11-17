import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AvisoNovaVersao from '../../src/components/AvisoNovaVersao'
import * as atualizacao from '../../src/lib/atualizacao'
import { marcarNaoEnviado } from '../../src/lib/naoEnviado'

// Pedido do Ivan (16/11/2026): o aviso de versão nova passa a ser uma JANELA OBRIGATÓRIA no meio da tela (igual à do app Delivery, commit 19a5209, e à do
// Tiquei). Os apps ficam abertos o dia todo nos computadores da loja e a faixa do topo passava despercebida. Sem "Depois": só segue quem toca em Atualizar.
// O app continua NUNCA recarregando sozinho (regra do dono de 13/11): só o toque troca. Única diferença do modelo: com dados digitados e ainda não enviados
// (compra avulsa, correção de cupom) a janela espera a pessoa enviar, porque Atualizar joga fora o que foi digitado.
vi.mock('../../src/lib/atualizacao')
const a = vi.mocked(atualizacao)

beforeEach(() => {
  vi.resetAllMocks()
  a.useNovaVersao.mockReturnValue(null)
  a.aplicarNovaVersao.mockResolvedValue(undefined)
  marcarNaoEnviado('teste-a', false)
  marcarNaoEnviado('teste-b', false)
})

describe('Janela obrigatória "Tem uma versão nova do app."', () => {
  it('sem versão nova não desenha nada e a página de trás rola normalmente', () => {
    render(<AvisoNovaVersao />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('com versão nova: janela modal no meio da tela, com o texto, o ícone e o botão grande "Atualizar agora" já com o foco', () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    render(<AvisoNovaVersao />)
    const janela = screen.getByRole('alertdialog')
    expect(janela).toHaveAttribute('aria-modal', 'true')
    expect(janela).toHaveAccessibleName('Tem uma versão nova do app.')
    expect(janela).toHaveAccessibleDescription('Toque em Atualizar para continuar usando.')
    const botao = screen.getByRole('button', { name: 'Atualizar agora' })
    expect(botao).toHaveFocus()
    expect(janela.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('aviso-nova-versao')).toContainElement(janela)
  })

  it('ao aparecer NÃO troca nem recarrega nada: o app nunca recarrega sozinho', () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    render(<AvisoNovaVersao />)
    expect(a.aplicarNovaVersao).not.toHaveBeenCalled()
    expect(a.recarregarPagina).not.toHaveBeenCalled()
  })

  it('não tem como fechar: sem "Depois", Esc não fecha, Tab não sai do botão, clicar fora não fecha nem atualiza', () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    render(<AvisoNovaVersao />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /depois|agora não|fechar|cancelar/i })).not.toBeInTheDocument()

    const botao = screen.getByRole('button', { name: 'Atualizar agora' })
    // fireEvent devolve false quando alguém chamou preventDefault
    expect(fireEvent.keyDown(botao, { key: 'Escape' })).toBe(false)
    expect(fireEvent.keyDown(botao, { key: 'Tab' })).toBe(false)
    expect(fireEvent.keyDown(botao, { key: 'Tab', shiftKey: true })).toBe(false)

    fireEvent.mouseDown(screen.getByTestId('aviso-nova-versao'))
    fireEvent.click(screen.getByTestId('aviso-nova-versao'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(a.aplicarNovaVersao).not.toHaveBeenCalled()
  })

  it('enquanto a janela está na tela a página de trás não rola; ao sumir, volta ao que era', () => {
    document.body.style.overflow = 'auto'
    a.useNovaVersao.mockReturnValue('v-nova')
    const { rerender } = render(<AvisoNovaVersao />)
    expect(document.body.style.overflow).toBe('hidden')
    a.useNovaVersao.mockReturnValue(null)
    rerender(<AvisoNovaVersao />)
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('só o toque em "Atualizar agora" troca para a versão nova, uma vez só, e o botão mostra que está atualizando', async () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    render(<AvisoNovaVersao />)
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(a.aplicarNovaVersao).toHaveBeenCalledTimes(1)
    expect(a.aplicarNovaVersao).toHaveBeenCalledWith('v-nova')
    const botao = screen.getByRole('button', { name: 'Atualizando…' })
    expect(botao).toBeDisabled()
    await userEvent.click(botao)
    expect(a.aplicarNovaVersao).toHaveBeenCalledTimes(1)
  })
})

describe('Com dados digitados e ainda não enviados a janela espera (Atualizar os jogaria fora)', () => {
  it('não aparece enquanto há dados não enviados e aparece sozinha quando a pessoa envia ou limpa', () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    marcarNaoEnviado('teste-a', true)
    render(<AvisoNovaVersao />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')

    act(() => { marcarNaoEnviado('teste-a', false) })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar agora' })).toHaveFocus()
  })

  it('com duas telas marcadas só aparece quando as duas terminam', () => {
    a.useNovaVersao.mockReturnValue('v-nova')
    marcarNaoEnviado('teste-a', true)
    marcarNaoEnviado('teste-b', true)
    render(<AvisoNovaVersao />)
    act(() => { marcarNaoEnviado('teste-a', false) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    act(() => { marcarNaoEnviado('teste-b', false) })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
