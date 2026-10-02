import { validarSaidaCupom } from './esquema'

const base = {
  legivel: true, chave: null, emitente_cnpj: '12345678000190', emitente_nome: 'ATACADAO',
  valor_total: 42.9,
  itens: [{ descricao: 'ACUCAR CRISTAL 1KG', quantidade: 2, unidade: 'UN', valor_unitario: 4.5, desconto: null, codigo_barras: '7891234567890' }],
}

describe('validarSaidaCupom', () => {
  it('aceita uma leitura bem formada', () => {
    expect(validarSaidaCupom(base)).toBeNull()
  })
  it('aceita legivel=false com itens vazios', () => {
    expect(validarSaidaCupom({ ...base, legivel: false, itens: [] })).toBeNull()
  })
  it('recusa chave a mais, tipo errado e item incompleto', () => {
    expect(validarSaidaCupom({ ...base, extra: 1 })).not.toBeNull()
    expect(validarSaidaCupom({ ...base, valor_total: 'x' })).not.toBeNull()
    expect(validarSaidaCupom({ ...base, itens: [{ descricao: 'X' }] })).not.toBeNull()
    expect(validarSaidaCupom(null)).not.toBeNull()
  })
})
