import { cnpjValido, deBrasilApi, deCnpjWs, deReceitaWs, tratar, type Deps, type Fonte } from './logica'

const CNPJ = '63540861000182'
const DADOS = { cnpj: CNPJ, razao_social: 'A. N. DA SILVA DESCARTAVEIS LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Abaetetuba', situacao: 'Ativa' }
const admin = async () => ({ papel: 'admin', ativo: true })
const deps = (fontes: Fonte[], usuario: Deps['buscarUsuario'] = admin): Deps => ({ buscarUsuario: usuario, fontes })

describe('cnpjValido', () => {
  it('aceita os com dígitos verificadores certos e recusa o resto', () => {
    expect(cnpjValido('63.540.861/0001-82')).toBe(true)
    expect(cnpjValido('11831785000160')).toBe(true)
    expect(cnpjValido('63540861000183')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
    expect(cnpjValido('123')).toBe(false)
  })
})

describe('adaptadores das fontes públicas', () => {
  it('BrasilAPI, CNPJ.ws e ReceitaWS viram o mesmo formato', () => {
    expect(deBrasilApi({ razao_social: ' A. N. DA SILVA  DESCARTAVEIS LTDA ', nome_fantasia: null, uf: 'pa', municipio: 'Abaetetuba', descricao_situacao_cadastral: 'ATIVA' }, CNPJ))
      .toEqual({ ...DADOS, situacao: 'ATIVA' })
    expect(deCnpjWs({ razao_social: DADOS.razao_social, estabelecimento: { nome_fantasia: null, estado: { sigla: 'PA' }, cidade: { nome: 'Abaetetuba' }, situacao_cadastral: 'Ativa' } }, CNPJ)).toEqual(DADOS)
    expect(deReceitaWs({ status: 'OK', nome: DADOS.razao_social, fantasia: '', uf: 'PA', municipio: 'ABAETETUBA', situacao: 'ATIVA' }, CNPJ)).toMatchObject({ razao_social: DADOS.razao_social, municipio: 'ABAETETUBA' })
  })
  it('resposta sem razão social (ou erro da fonte) vira null', () => {
    expect(deBrasilApi({ message: 'CNPJ não encontrado' }, CNPJ)).toBeNull()
    expect(deCnpjWs({}, CNPJ)).toBeNull()
    expect(deReceitaWs({ status: 'ERROR', message: 'CNPJ inválido' }, CNPJ)).toBeNull()
  })
})

describe('tratar', () => {
  it('só o admin consulta', async () => {
    const r = await tratar({ cnpj: CNPJ }, 'joao@spazio.com', deps([async () => DADOS], async () => ({ papel: 'comprador', ativo: true })))
    expect(r.status).toBe(403)
  })
  it('CNPJ errado: 400, sem consultar ninguém', async () => {
    let chamadas = 0
    const r = await tratar({ cnpj: '63540861000183' }, 'ivan@spazio.com', deps([async () => { chamadas += 1; return DADOS }]))
    expect(r.status).toBe(400)
    expect(chamadas).toBe(0)
  })
  it('a primeira fonte que responde vale; aceita o CNPJ formatado', async () => {
    const r = await tratar({ cnpj: '63.540.861/0001-82' }, 'ivan@spazio.com', deps([async () => DADOS, async () => { throw new Error('não devia chamar') }]))
    expect(r).toEqual({ status: 200, corpo: DADOS })
  })
  it('fonte fora do ar (503) ou lenta: tenta a próxima', async () => {
    const r = await tratar({ cnpj: CNPJ }, 'ivan@spazio.com', deps([async () => { throw new Error('HTTP 503') }, async () => DADOS]))
    expect(r.status).toBe(200)
  })
  it('todas fora do ar: 502 pedindo para preencher à mão', async () => {
    const r = await tratar({ cnpj: CNPJ }, 'ivan@spazio.com', deps([async () => { throw new Error('x') }, async () => { throw new Error('y') }]))
    expect(r.status).toBe(502)
    expect(String(r.corpo.erro)).toMatch(/à mão/)
  })
  it('todas dizem que o CNPJ não existe: 404; uma fora do ar e outra "não existe": 502 (não afirma que não existe)', async () => {
    expect((await tratar({ cnpj: CNPJ }, 'ivan@spazio.com', deps([async () => null, async () => null]))).status).toBe(404)
    expect((await tratar({ cnpj: CNPJ }, 'ivan@spazio.com', deps([async () => null, async () => { throw new Error('x') }]))).status).toBe(502)
  })
  it('resposta sem UF ou sem município não serve: tenta a próxima', async () => {
    const r = await tratar({ cnpj: CNPJ }, 'ivan@spazio.com', deps([async () => ({ ...DADOS, uf: '' }), async () => DADOS]))
    expect(r.status).toBe(200)
  })
})
