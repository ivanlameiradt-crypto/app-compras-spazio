import { acaoParaVersaoNova } from '../../src/lib/versao'

// Pedido do Ivan (07/10): não precisar "sair e entrar" no app para ver a versão nova — mas sem apagar o que ele está digitando.
describe('acaoParaVersaoNova: trocar já, só avisar ou nada', () => {
  it('sem resposta do servidor ou mesma versão: nada, de qualquer origem', () => {
    for (const origem of ['abertura', 'voltou', 'periodica', 'manual'] as const) {
      expect(acaoParaVersaoNova(origem, null, 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, undefined, 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, '', 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, 'abc', 'abc', null)).toBe('nada')
    }
  })

  it('na abertura e ao voltar do fundo (nada digitado a perder): troca já', () => {
    expect(acaoParaVersaoNova('abertura', 'nova', 'abc', null)).toBe('aplicar')
    expect(acaoParaVersaoNova('voltou', 'nova', 'abc', null)).toBe('aplicar')
  })

  it('com o app em uso (checagem periódica): só AVISA, não recarrega no meio do trabalho', () => {
    expect(acaoParaVersaoNova('periodica', 'nova', 'abc', null)).toBe('avisar')
  })

  it('no botão Atualizar (pedido explícito): troca sempre que há versão nova — até se já tinha tentado essa', () => {
    expect(acaoParaVersaoNova('manual', 'nova', 'abc', null)).toBe('aplicar')
    expect(acaoParaVersaoNova('manual', 'nova', 'abc', 'nova')).toBe('aplicar')
  })

  it('anti-loop: versão para a qual já se tentou trocar e não assentou não é repetida nem avisada (fora do botão)', () => {
    for (const origem of ['abertura', 'voltou', 'periodica'] as const) expect(acaoParaVersaoNova(origem, 'nova', 'abc', 'nova')).toBe('nada')
  })

  it('saiu outra versão ainda mais nova que a já tentada: volta a trocar/avisar', () => {
    expect(acaoParaVersaoNova('abertura', 'nova2', 'abc', 'nova')).toBe('aplicar')
    expect(acaoParaVersaoNova('periodica', 'nova2', 'abc', 'nova')).toBe('avisar')
  })
})
