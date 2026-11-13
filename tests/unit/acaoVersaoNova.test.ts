import { acaoParaVersaoNova } from '../../src/lib/versao'

// Pedido do Ivan (07/10): não precisar "sair e entrar" no app para ver a versão nova.
// Regra do dono (13/11): o app NUNCA recarrega sozinho com a pessoa trabalhando (ela pode estar digitando, lançando ou comprando).
// Só troca sozinho na ABERTURA (a página acabou de abrir, nada foi digitado) e quando a pessoa CLICA (botão Atualizar). Ao voltar do fundo só avisa.
describe('acaoParaVersaoNova: trocar já, só avisar ou nada', () => {
  it('sem resposta do servidor ou mesma versão: nada, de qualquer origem', () => {
    for (const origem of ['abertura', 'voltou', 'periodica', 'manual'] as const) {
      expect(acaoParaVersaoNova(origem, null, 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, undefined, 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, '', 'abc', null)).toBe('nada')
      expect(acaoParaVersaoNova(origem, 'abc', 'abc', null)).toBe('nada')
    }
  })

  it('na abertura (nada digitado a perder): troca já', () => {
    expect(acaoParaVersaoNova('abertura', 'nova', 'abc', null)).toBe('aplicar')
  })

  it('ao voltar do fundo (13/11): só AVISA com a faixa, nunca recarrega sozinho (a pessoa pode ter deixado uma compra pela metade)', () => {
    expect(acaoParaVersaoNova('voltou', 'nova', 'abc', null)).toBe('avisar')
  })

  it('com o app em uso (checagem periódica): só AVISA, não recarrega no meio do trabalho', () => {
    expect(acaoParaVersaoNova('periodica', 'nova', 'abc', null)).toBe('avisar')
  })

  it('no botão Atualizar (a pessoa clicou): troca sempre que há versão nova, até se já tinha tentado essa', () => {
    expect(acaoParaVersaoNova('manual', 'nova', 'abc', null)).toBe('aplicar')
    expect(acaoParaVersaoNova('manual', 'nova', 'abc', 'nova')).toBe('aplicar')
  })

  it('nunca manda recarregar sozinho fora da abertura e do clique: "voltou" e "periodica" não dão "aplicar"', () => {
    for (const origem of ['voltou', 'periodica'] as const) {
      expect(acaoParaVersaoNova(origem, 'nova', 'abc', null)).not.toBe('aplicar')
      expect(acaoParaVersaoNova(origem, 'nova', 'abc', 'outra')).not.toBe('aplicar')
    }
  })

  it('anti-loop: versão para a qual já se tentou trocar e não assentou não é repetida nem avisada (fora do botão)', () => {
    for (const origem of ['abertura', 'voltou', 'periodica'] as const) expect(acaoParaVersaoNova(origem, 'nova', 'abc', 'nova')).toBe('nada')
  })

  it('saiu outra versão ainda mais nova que a já tentada: volta a trocar (abertura) ou avisar (resto)', () => {
    expect(acaoParaVersaoNova('abertura', 'nova2', 'abc', 'nova')).toBe('aplicar')
    expect(acaoParaVersaoNova('voltou', 'nova2', 'abc', 'nova')).toBe('avisar')
    expect(acaoParaVersaoNova('periodica', 'nova2', 'abc', 'nova')).toBe('avisar')
  })
})
