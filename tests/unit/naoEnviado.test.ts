import { PERGUNTA_NAO_ENVIADO, marcarNaoEnviado, podeSair, temNaoEnviado } from '../../src/lib/naoEnviado'

// Reanálise de 13/11 (B4): a tela avisa "tenho dados não enviados"; o botão Atualizar do topo e as abas perguntam antes de sair.
describe('naoEnviado: quem tem dados digitados e ainda não enviados', () => {
  afterEach(() => { marcarNaoEnviado('a', false); marcarNaoEnviado('b', false); vi.restoreAllMocks() })

  it('ninguém marcou: não há nada pendente e sair não pergunta nada', () => {
    const confirmar = vi.spyOn(window, 'confirm')
    expect(temNaoEnviado()).toBe(false)
    expect(podeSair()).toBe(true)
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('cada tela marca e desmarca a sua parte; só fica limpo quando todas desmarcam', () => {
    marcarNaoEnviado('a', true)
    marcarNaoEnviado('b', true)
    marcarNaoEnviado('a', false)
    expect(temNaoEnviado()).toBe(true)
    marcarNaoEnviado('b', false)
    expect(temNaoEnviado()).toBe(false)
  })

  it('com dados pendentes pergunta em português simples; Cancelar segura a saída e OK libera', () => {
    marcarNaoEnviado('a', true)
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(podeSair()).toBe(false)
    expect(podeSair()).toBe(true)
    expect(confirmar).toHaveBeenCalledWith('Você tem dados não enviados nesta tela. Sair mesmo assim?')
    expect(PERGUNTA_NAO_ENVIADO).toBe('Você tem dados não enviados nesta tela. Sair mesmo assim?')
  })
})
