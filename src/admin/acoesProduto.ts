// As ações da caixa "Cadastrar produto novo" (rede pelo api): as mesmas no cupom, na nota fiscal e na compra avulsa.
import * as api from '../lib/api'
import type { AcoesProduto } from './CadastrarProduto'

export const ACOES_PRODUTO: AcoesProduto = {
  cadastrar: (p) => api.pedirCadastroProduto(p),
  status: (q) => api.statusDoCadastroProduto(q),
}
