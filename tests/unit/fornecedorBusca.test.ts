import { buscarFornecedores, juntarFornecedores, nomeDoConhecido } from '../../src/admin/fornecedorBusca'

const ATACADAO = { cnpj: '75.315.333/0326-55', razao: 'ATACADAO S.A.', fantasia: 'ATACADÃO' }
const MATEUS = { cnpj: '03995515011363', razao: 'MATEUS SUPERMERCADOS S.A.', fantasia: '' }
const COPLAST = { cnpj: '63540861000182', razao: 'A. N. DA SILVA DESCARTAVEIS LTDA', fantasia: 'COPLAST DESCARTÁVEIS' }

describe('juntarFornecedores', () => {
  it('um fornecedor por CNPJ: junta a razão da nota/cupom com a fantasia do cadastro do app; descarta CNPJ inválido e linha sem nome', () => {
    const lista = juntarFornecedores(
      [{ cnpj: '63540861000182', razao: null, fantasia: 'COPLAST DESCARTÁVEIS' }],
      [{ cnpj: '63.540.861/0001-82', razao: ' A. N. DA SILVA  DESCARTAVEIS LTDA ' }, { cnpj: '123', razao: 'CNPJ CURTO' }, { cnpj: '11111111000191', razao: null }],
    )
    expect(lista).toEqual([COPLAST])
  })
})

describe('buscarFornecedores', () => {
  const lista = juntarFornecedores([ATACADAO, MATEUS, COPLAST].map((f) => ({ cnpj: f.cnpj, razao: f.razao, fantasia: f.fantasia })))
  it('acha por pedaço do nome, sem acento nem maiúscula, na fantasia ou na razão', () => {
    expect(buscarFornecedores(lista, 'atacadão').map(nomeDoConhecido)).toEqual(['ATACADÃO'])
    expect(buscarFornecedores(lista, 'ATACADAO').map(nomeDoConhecido)).toEqual(['ATACADÃO'])
    expect(buscarFornecedores(lista, 'descartaveis').map(nomeDoConhecido)).toEqual(['COPLAST DESCARTÁVEIS'])   // pela razão, que traz "DESCARTAVEIS"
    expect(buscarFornecedores(lista, 'mateus super').map(nomeDoConhecido)).toEqual(['MATEUS SUPERMERCADOS S.A.'])
  })
  it('acha pelo CNPJ (a partir de 3 dígitos, com ou sem pontuação)', () => {
    expect(buscarFornecedores(lista, '63540861').map(nomeDoConhecido)).toEqual(['COPLAST DESCARTÁVEIS'])
    expect(buscarFornecedores(lista, '03995').map(nomeDoConhecido)).toEqual(['MATEUS SUPERMERCADOS S.A.'])
  })
  it('texto vazio ou sem resultado: lista vazia; "nome fantasia" aparece no lugar da razão', () => {
    expect(buscarFornecedores(lista, '   ')).toEqual([])
    expect(buscarFornecedores(lista, 'fornecedor que não existe')).toEqual([])
    expect(nomeDoConhecido(ATACADAO)).toBe('ATACADÃO')
    expect(nomeDoConhecido(MATEUS)).toBe('MATEUS SUPERMERCADOS S.A.')
  })
})
