import { CADASTRO_CONCLUIDO, cnpjDaChave, cnpjValido, formatarCnpj, fornecedorNaoEncontrado, nomeDoFornecedor, problemaDoFormulario, soDigitos } from '../../src/admin/fornecedorRegras'

describe('fornecedorNaoEncontrado — lê o motivo que o robô grava', () => {
  it('nome e CNPJ do cupom', () => {
    expect(fornecedorNaoEncontrado('fornecedor não encontrado no Sischef (A. N. DA SILVA DESCARTAVEIS LTDA, CNPJ 63540861000182)'))
      .toEqual({ nome: 'A. N. DA SILVA DESCARTAVEIS LTDA', cnpj: '63540861000182' })
  })
  it('sem nome ou sem CNPJ lido ("sem nome", "?")', () => {
    expect(fornecedorNaoEncontrado('fornecedor não encontrado no Sischef (sem nome, CNPJ ?)')).toEqual({ nome: '', cnpj: '' })
  })
  it('outro motivo, vazio ou nulo: null', () => {
    expect(fornecedorNaoEncontrado('2 item(ns) sem casamento confirmado')).toBeNull()
    expect(fornecedorNaoEncontrado('')).toBeNull()
    expect(fornecedorNaoEncontrado(null)).toBeNull()
  })
})

describe('CNPJ', () => {
  it('soDigitos, formatarCnpj e cnpjValido', () => {
    expect(soDigitos('63.540.861/0001-82')).toBe('63540861000182')
    expect(formatarCnpj('63540861000182')).toBe('63.540.861/0001-82')
    expect(formatarCnpj('123')).toBe('123')
    expect(cnpjValido('63.540.861/0001-82')).toBe(true)
    expect(cnpjValido('63540861000183')).toBe(false)
    expect(cnpjValido('11111111111111')).toBe(false)
  })
})

describe('nomeDoFornecedor — a fantasia só existe no app e é o nome que o app mostra', () => {
  it('mostra a fantasia quando há; sem fantasia, a razão social', () => {
    expect(nomeDoFornecedor('ATACADAO S.A.', 'ATACADÃO')).toBe('ATACADÃO')
    expect(nomeDoFornecedor('A. N. DA SILVA DESCARTAVEIS LTDA', '')).toBe('A. N. DA SILVA DESCARTAVEIS LTDA')
    expect(nomeDoFornecedor('A. N. DA SILVA DESCARTAVEIS LTDA', undefined)).toBe('A. N. DA SILVA DESCARTAVEIS LTDA')
    expect(nomeDoFornecedor('A. N. DA SILVA DESCARTAVEIS LTDA', '   ')).toBe('A. N. DA SILVA DESCARTAVEIS LTDA')
    expect(nomeDoFornecedor('', 'SÓ FANTASIA')).toBe('SÓ FANTASIA')
    expect(nomeDoFornecedor(null, null)).toBe('')
  })
})

describe('problemaDoFormulario', () => {
  const ok = { cnpj: '63540861000182', razao: 'A. N. DA SILVA DESCARTAVEIS LTDA', uf: 'PA', municipio: 'Abaetetuba' }
  it('pronto = null; cada falta tem o seu texto', () => {
    expect(problemaDoFormulario(ok)).toBeNull()
    expect(problemaDoFormulario({ ...ok, cnpj: '63540861000183' })).toMatch(/CNPJ/)
    expect(problemaDoFormulario({ ...ok, razao: ' ' })).toMatch(/razão social/)
    expect(problemaDoFormulario({ ...ok, uf: '' })).toMatch(/estado/)
    expect(problemaDoFormulario({ ...ok, municipio: '' })).toMatch(/município/)
  })
})

describe('CADASTRO_CONCLUIDO', () => {
  it('só CADASTRADO e JA_EXISTIA', () => {
    expect(CADASTRO_CONCLUIDO('CADASTRADO')).toBe(true)
    expect(CADASTRO_CONCLUIDO('JA_EXISTIA')).toBe(true)
    for (const e of ['PENDENTE', 'PROCESSANDO', 'REVISAR', null, undefined] as const) expect(CADASTRO_CONCLUIDO(e)).toBe(false)
  })
})

describe('cnpjDaChave — o CNPJ do emitente dentro da chave da NF-e', () => {
  it('posições 7 a 20 da chave de 44 dígitos; chave que não tem 44 dígitos = vazio', () => {
    expect(cnpjDaChave('15261003995515011363550010000892841000000017')).toBe('03995515011363')
    expect(cnpjDaChave('1526 1003995515011363 550010000892841000000017')).toBe('03995515011363')
    expect(cnpjDaChave('123')).toBe('')
    expect(cnpjDaChave(null)).toBe('')
  })
})
