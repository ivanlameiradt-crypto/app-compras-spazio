// CNPJ lido errado na foto do cupom, a TELA (pedido do Ivan, 29/10/2026): quando o CNPJ que a leitura trouxe NÃO fecha as contas dos dígitos verificadores, o app avisa em
// amarelo e em português simples (a leitura trocou algum número), para o Ivan olhar a foto e digitar o certo ANTES de confirmar os itens. Dois lugares: o detalhe do cupom em
// "Últimos envios" e a caixa "Fornecedor não cadastrado no SisChef". Com CNPJ que fecha, ou sem CNPJ, tudo igual a hoje. Tudo INVENTADO (repositório público).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import * as foto from '../../src/lib/foto'
import Cupom from '../../src/admin/Cupom'
import CadastrarFornecedor, { type AcoesFornecedor } from '../../src/admin/CadastrarFornecedor'
import type { CupomRecente } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/foto')
const m = vi.mocked(api)
const mf = vi.mocked(foto)

const CERTO = '63540861000182'
const ERRADO = '63540861000102' // o "8" virou "0" (o caso real de 22/10)
const NOME = 'A. N. DA SILVA DESCARTAVEIS LTDA'
const TEXTO_DO_AVISO = 'O CNPJ que li na foto (63.540.861/0001-02) não fecha nas contas dos números: algum número foi lido errado. Confira na foto.'
const MOTIVO_NAO_ACHOU = `fornecedor não encontrado no Sischef (${NOME}, CNPJ ${ERRADO})`

const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'c1', estado: 'LANCADO', emitente_nome: NOME, emitente_cnpj: ERRADO, valor_a_pagar: 45.2, pedido_sischef: '163812710',
  criado_em: '2026-10-22T16:21:44Z', atualizado_em: '2026-10-22T16:30:00Z', motivo: null, teste: false,
  itens: [{ descricao_cupom: 'SACO 1/2 KG', unidade_cupom: 'CT', quantidade_cupom: 2, entrada_estoque: 2, valor_unitario: 22.6, desconto_item: 0, sugestao_produto: { id: '3476481' }, casado_por: 'descricao', proposta: null }],
  ...extra,
})
/** a linha do cupom é o 1º botão do cartão */
const abrir = async () => userEvent.click(within(await screen.findByTestId('cupom-recente')).getAllByRole('button')[0])
const mostrar = async (...cupons: CupomRecente[]) => {
  m.cuponsRecentes.mockResolvedValue(cupons)
  render(<Cupom />)
  await screen.findAllByTestId('cupom-recente')
}

beforeEach(() => {
  vi.resetAllMocks()
  mf.reduzirFoto.mockImplementation(async (a) => a)
  m.cuponsRecentes.mockResolvedValue([])
  m.statusDoCadastroFornecedor.mockResolvedValue(null) // a caixa de cadastro olha se já existe um pedido para o CNPJ
})

describe('Cupom — aviso de CNPJ lido errado no detalhe do cupom', () => {
  it('detalhe aberto de um cupom com CNPJ que não fecha as contas: aviso amarelo com o CNPJ lido e o que fazer; a linha do fornecedor segue igual', async () => {
    await mostrar(cupom())
    await abrir()
    const aviso = await screen.findByTestId('cnpj-suspeito')
    expect(aviso).toHaveTextContent(TEXTO_DO_AVISO)
    expect(aviso).toHaveClass('amarelo')
    expect(screen.getByTestId('detalhe-fornecedor')).toHaveTextContent(`Fornecedor: ${NOME} · CNPJ 63.540.861/0001-02`)
  })

  it('o aviso fica DENTRO do detalhe: fechado não aparece (cupom lançado), abrir mostra, fechar de novo esconde', async () => {
    await mostrar(cupom())
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
    await abrir()
    expect(await screen.findByTestId('cnpj-suspeito')).toBeInTheDocument()
    await abrir()
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
  })

  it('o aviso vem logo antes da linha do fornecedor (na frente do detalhe), não perdido no fim da lista de itens', async () => {
    await mostrar(cupom())
    await abrir()
    const aviso = await screen.findByTestId('cnpj-suspeito')
    const fornecedor = screen.getByTestId('detalhe-fornecedor')
    expect(aviso.compareDocumentPosition(fornecedor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('CNPJ que FECHA as contas: nenhum aviso, e o detalhe é o de sempre', async () => {
    await mostrar(cupom({ emitente_cnpj: CERTO }))
    await abrir()
    expect(await screen.findByTestId('detalhe-fornecedor')).toHaveTextContent(`Fornecedor: ${NOME} · CNPJ 63.540.861/0001-82`)
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
  })

  it('sem CNPJ (nulo ou ausente): nenhum aviso e a linha do fornecedor sem "· CNPJ"', async () => {
    for (const semCnpj of [null, undefined]) {
      m.cuponsRecentes.mockResolvedValue([cupom({ emitente_cnpj: semCnpj })])
      const { unmount } = render(<Cupom />)
      await userEvent.click(within(await screen.findByTestId('cupom-recente')).getAllByRole('button')[0])
      expect(await screen.findByTestId('detalhe-fornecedor')).toHaveTextContent(`Fornecedor: ${NOME}`)
      expect(screen.getByTestId('detalhe-fornecedor')).not.toHaveTextContent('CNPJ')
      expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('o aviso não muda a linha do cupom: rótulo, fornecedor e valor seguem como sempre', async () => {
    await mostrar(cupom())
    expect(within(screen.getByTestId('cupom-recente')).getAllByRole('button')[0]).toHaveTextContent(/lançado ✓ · A\. N\. DA SILVA DESCARTAVEIS LTDA · R\$\s*45,20/)
  })

  it('só o cupom com CNPJ suspeito leva o aviso: numa lista com um bom e um suspeito, é um aviso só', async () => {
    await mostrar(cupom({ id: 'bom', emitente_cnpj: CERTO }), cupom({ id: 'ruim' }))
    const cartoes = screen.getAllByTestId('cupom-recente')
    await userEvent.click(within(cartoes[0]).getAllByRole('button')[0])
    await userEvent.click(within(cartoes[1]).getAllByRole('button')[0])
    expect(await within(cartoes[1]).findByTestId('cnpj-suspeito')).toBeInTheDocument()
    expect(within(cartoes[0]).queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('cnpj-suspeito')).toHaveLength(1)
  })
})

describe('Cupom — cupom parado (precisa de você) com CNPJ lido errado: o aviso aparece SEM abrir o detalhe, para o Ivan ver antes de confirmar os itens', () => {
  const parado = (extra: Partial<CupomRecente> = {}) => cupom({ estado: 'REVISAR', pedido_sischef: null, atualizado_em: null, motivo: '1 item(ns) sem casamento confirmado — confira no Code', ...extra })

  it('REVISAR fechado: o aviso já está na tela', async () => {
    await mostrar(parado())
    expect(await screen.findByTestId('cnpj-suspeito')).toHaveTextContent(TEXTO_DO_AVISO)
  })

  it('abrindo o detalhe o aviso NÃO dobra: continua um só', async () => {
    await mostrar(parado())
    await abrir()
    await screen.findByTestId('detalhe-fornecedor')
    expect(screen.getAllByTestId('cnpj-suspeito')).toHaveLength(1)
  })

  it('REVISAR com CNPJ que fecha as contas ou sem CNPJ: nenhum aviso', async () => {
    await mostrar(parado({ id: 'a', emitente_cnpj: CERTO }), parado({ id: 'b', emitente_cnpj: null }))
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
  })

  it('"já lançado em outro envio": nada a fazer, então fechado não leva o aviso (aberto, o detalhe leva, como em qualquer cupom)', async () => {
    await mostrar(parado({ motivo: 'já lançado em outro envio (pedido 163812710)' }))
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument()
    await abrir()
    expect(await screen.findByTestId('cnpj-suspeito')).toBeInTheDocument()
  })

  it('"fornecedor não encontrado": fechado, quem avisa é a caixa de cadastro (com o passo a passo) — o aviso geral não repete', async () => {
    await mostrar(parado({ motivo: MOTIVO_NAO_ACHOU }))
    expect(await screen.findByTestId('cadastrar-fornecedor')).toBeInTheDocument()
    expect(screen.getByTestId('cnpj-lido-errado')).toBeInTheDocument()   // o da caixa
    expect(screen.queryByTestId('cnpj-suspeito')).not.toBeInTheDocument() // o do detalhe, fechado, não
  })
})

describe('CadastrarFornecedor — aviso de CNPJ lido errado no começo da caixa', () => {
  const DADOS = { cnpj: CERTO, razao_social: NOME, nome_fantasia: '', uf: 'PA', municipio: 'Abaetetuba' }
  function acoes(over: Partial<AcoesFornecedor> = {}): AcoesFornecedor {
    return {
      consultarCnpj: vi.fn().mockResolvedValue(DADOS), cadastrar: vi.fn().mockResolvedValue(undefined),
      statusDoCadastro: vi.fn().mockResolvedValue(null), reenviarCupom: vi.fn().mockResolvedValue(undefined), ...over,
    }
  }
  const caixa = (c: { motivo: string | null; emitente_cnpj?: string | null }, a = acoes(), extra: { aoUsar?: () => void } = {}) =>
    render(<CadastrarFornecedor cupom={{ id: 'c1', emitente_nome: NOME, ...c }} acoes={a} aoReenviar={vi.fn()} intervaloMs={20} {...extra} />)
  const TEXTO_DA_CAIXA = 'O CNPJ que li na foto (63.540.861/0001-02) parece errado: é provável que seja só um número trocado. Olhe a foto, digite o CNPJ certo no campo abaixo e toque em “Buscar dados do CNPJ”.'

  it('CNPJ do motivo do robô que não fecha as contas: aviso amarelo no começo da caixa, antes do texto e do campo', async () => {
    caixa({ motivo: MOTIVO_NAO_ACHOU, emitente_cnpj: ERRADO })
    const aviso = screen.getByTestId('cnpj-lido-errado')
    expect(aviso).toHaveTextContent(TEXTO_DA_CAIXA)
    expect(aviso).toHaveClass('amarelo')
    const caixaToda = screen.getByTestId('cadastrar-fornecedor')
    expect(caixaToda.textContent!.indexOf('Fornecedor não cadastrado no SisChef')).toBeLessThan(caixaToda.textContent!.indexOf('O CNPJ que li na foto'))
    expect(caixaToda.textContent!.indexOf('O CNPJ que li na foto')).toBeLessThan(caixaToda.textContent!.indexOf('O robô não achou'))
    expect(screen.getByLabelText('CNPJ')).toHaveValue('63.540.861/0001-02') // o campo segue com o número lido, como hoje
  })

  it('o CNPJ vem só do cupom (o motivo do robô não trouxe o número, "CNPJ ?"): também avisa', async () => {
    caixa({ motivo: 'fornecedor não encontrado no Sischef (sem nome, CNPJ ?)', emitente_cnpj: ERRADO })
    expect(screen.getByTestId('cnpj-lido-errado')).toHaveTextContent(TEXTO_DA_CAIXA)
  })

  it('CNPJ que fecha as contas: a caixa é a de sempre, sem aviso', async () => {
    caixa({ motivo: `fornecedor não encontrado no Sischef (${NOME}, CNPJ ${CERTO})`, emitente_cnpj: CERTO })
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CNPJ')).toHaveValue('63.540.861/0001-82')
  })

  it('sem CNPJ lido (nem no motivo nem no cupom): sem aviso', async () => {
    caixa({ motivo: 'fornecedor não encontrado no Sischef (sem nome, CNPJ ?)', emitente_cnpj: null })
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CNPJ')).toHaveValue('')
  })

  it('aba "Compras avulsas" (sem cupom para ler): sem aviso', async () => {
    caixa({ motivo: null, emitente_cnpj: null }, acoes(), { aoUsar: vi.fn() })
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument()
  })

  it('o Ivan digita o CNPJ certo: o aviso some (já foi atendido) e "Buscar dados do CNPJ" consulta o número certo', async () => {
    const a = acoes()
    caixa({ motivo: MOTIVO_NAO_ACHOU, emitente_cnpj: ERRADO }, a)
    expect(screen.getByTestId('cnpj-lido-errado')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('CNPJ'))
    await userEvent.type(screen.getByLabelText('CNPJ'), '63.540.861/0001-82')
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(a.consultarCnpj).toHaveBeenCalledWith(CERTO)
    expect(await screen.findByLabelText(/Razão social/)).toHaveValue(NOME)
  })

  it('o Ivan mexe no campo mas o número continua errado (ou ainda está pela metade): o aviso do número lido sai de cena e o erro de sempre aparece ao buscar', async () => {
    const a = acoes()
    caixa({ motivo: MOTIVO_NAO_ACHOU, emitente_cnpj: ERRADO }, a)
    await userEvent.clear(screen.getByLabelText('CNPJ'))
    await userEvent.type(screen.getByLabelText('CNPJ'), '6354086100018') // 13 dígitos
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument() // o texto fala "o CNPJ que li": não é mais o que está no campo
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(await screen.findByTestId('erro-fornecedor')).toHaveTextContent('O CNPJ não está certo')
    expect(a.consultarCnpj).not.toHaveBeenCalled()
  })

  it('o aviso não muda o resto da caixa: texto do robô, campo, botão e a regra da fantasia continuam', async () => {
    caixa({ motivo: MOTIVO_NAO_ACHOU, emitente_cnpj: ERRADO })
    expect(screen.getByText(/O robô não achou/)).toHaveTextContent(`O robô não achou ${NOME} (CNPJ 63.540.861/0001-02) no SisChef.`)
    expect(screen.getByTestId('buscar-cnpj')).toHaveTextContent('Buscar dados do CNPJ')
    expect(screen.queryByLabelText(/Razão social/)).not.toBeInTheDocument()
  })
})
