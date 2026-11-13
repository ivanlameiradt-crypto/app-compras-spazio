// Aba "Compras avulsas" (pedido do Ivan, 10/10/2026): compra feita SEM cupom e SEM nota fiscal. Passos: (1) como foi pago (as mesmas 4 formas do cupom), (2) fornecedor (igual ao
// cupom e à nota: busca entre os que o app conhece; se for novo, cadastra pelo CNPJ), (3) os itens: produto (da lista do app/planilha), quantidade NA UNIDADE DO BANCO e preço por
// essa unidade. "Lançar compra" pede uma confirmação e envia: a função enviar-compra-avulsa grava a linha `cupom` (origem 'avulsa') e o MESMO robô do cupom lança no SisChef
// (estoque e, conforme a forma, financeiro à vista). Embaixo, "Últimas compras avulsas" (a lista se atualiza sozinha enquanto há compra na fila).
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { formatarDataHora, formatarReais } from '../lib/regras'
import { CONTAS_PIX, CONTA_DINHEIRO, CONTA_TESOURARIA, FORMAS } from '../cupom/formasPagamento'
import type { CupomRecente, EstadoCupom, FormaCupom, PagamentoCupom, ProdutoCatalogo } from '../lib/tipos'
import DetalheLancamento from '../components/DetalheLancamento'
import { buscarProdutos, rotuloUnidade } from './associacaoRegras'
import CadastrarFornecedor from './CadastrarFornecedor'
import { ProdutoNaoCadastrado } from './CadastrarProduto'
import { ACOES_PRODUTO } from './acoesProduto'
import { buscarFornecedores, nomeDoConhecido, type FornecedorConhecido } from './fornecedorBusca'
import { formatarCnpj, nomeDoFornecedor } from './fornecedorRegras'
import { faltaNaLinha, lerPreco, lerQuantidade, problemaDaCompra, totalDaLinha, totalGeral, type LinhaAvulsa } from './compraAvulsaRegras'
import { unidadeDoProduto } from './unidadeEstoque'
import { REPETIDA_PREFIXO, ehErroRepetida, falhaDeConferirDoCupom, motivoSemRepetida, podeExcluirCupom, repetidaDoCupom } from './cupomRegras'
import ExcluirCupom from './ExcluirCupom'
import AvisoRepetida from './AvisoRepetida'
import AvisoFalhaConferir from './AvisoFalhaConferir'
import CuponsExcluidos from './CuponsExcluidos'
import TituloDaTela from '../components/TituloDaTela'
import { Icone } from '../components/Icones'
import { useNaoEnviado } from '../lib/naoEnviado'

/** As ações da caixa "Cadastrar fornecedor" (rede pelo api): as mesmas do cupom. Sem cupom para reenviar (a caixa usa `aoUsar`). */
const ACOES_FORNECEDOR = {
  consultarCnpj: (cnpj: string) => api.consultarCnpj(cnpj),
  cadastrar: (p: Parameters<typeof api.pedirCadastroFornecedor>[0]) => api.pedirCadastroFornecedor(p),
  statusDoCadastro: (cnpj: string) => api.statusDoCadastroFornecedor(cnpj),
  reenviarCupom: async () => undefined,
}
/** Identificador de UMA compra (o servidor deduplica por ele; o pedido de cadastro do fornecedor também o leva). */
const novoId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16))

const ROTULO_ESTADO: Record<EstadoCupom, string> = {
  PENDENTE: 'na fila', PROCESSANDO: 'na fila', LANCADO: 'lançada ✓', REVISAR: 'precisa de você', TESTE: 'teste ✓', EXCLUIDO: 'excluída',
}
const INTERVALO_RECENTES_MS = 30_000

/** Monta o pagamento a partir dos botões; null = ainda incompleto (PIX sem banco/empresa). */
function montarPagamento(forma: FormaCupom | null, contaPix: string | null): PagamentoCupom | null {
  if (forma === 'sem_cartao') return { forma: 'sem_cartao' }
  if (forma === 'dinheiro') return { forma: 'dinheiro', conta: CONTA_DINHEIRO }
  if (forma === 'tesouraria') return { forma: 'tesouraria', conta: CONTA_TESOURARIA }
  if (forma === 'pix') return contaPix ? { forma: 'pix', conta: contaPix } : null
  return null
}
const rotuloForma = (p: PagamentoCupom): string =>
  p.forma === 'sem_cartao' ? 'sem cartão (só estoque, sem financeiro)' : p.forma === 'pix' ? 'PIX' : p.forma === 'dinheiro' ? 'dinheiro à vista' : 'tesouraria à vista'

interface Linha extends LinhaAvulsa { chave: number; busca: string }
const linhaVazia = (chave: number): Linha => ({ chave, produtoId: null, quantidade: '', preco: '', busca: '' })
const mensagem = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Não consegui enviar agora. Tente de novo.')

export default function CompraAvulsa() {
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [catalogoFalhou, setCatalogoFalhou] = useState(false) // sem a lista não dá para dizer "produto não cadastrado": nada de oferecer cadastro
  const [forma, setForma] = useState<FormaCupom | null>(null)
  const [contaPix, setContaPix] = useState<string | null>(null)
  // a forma foi escolhida NESTA compra? (depois de um envio a forma fica marcada para a próxima, mas aí não há nada digitado a perder)
  const [formaMexida, setFormaMexida] = useState(false)
  const [conhecidos, setConhecidos] = useState<FornecedorConhecido[] | null>(null)
  const [buscaForn, setBuscaForn] = useState('')
  const [fornecedor, setFornecedor] = useState<FornecedorConhecido | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia(1)])
  const [proxima, setProxima] = useState(2)
  const [envioId, setEnvioId] = useState(novoId)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  // E5: o servidor recusou porque JÁ EXISTE compra igual (a frase, sem o prefixo): o Ivan responde "é outra compra" ou cancela
  const [repetida, setRepetida] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ classe: 'ok' | 'amarelo'; texto: string } | null>(null)
  const [recentes, setRecentes] = useState<CupomRecente[]>([])
  const [excluidos, setExcluidos] = useState<CupomRecente[]>([]) // as que o Ivan excluiu (a lista de onde ele desfaz)
  const [falhaRecentes, setFalhaRecentes] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)

  const carregarRecentes = useCallback(() => {
    api.comprasAvulsasRecentes(10).then((r) => { setRecentes(r); setFalhaRecentes(false) }).catch(() => setFalhaRecentes(true))
    // as excluídas são só um complemento: se a leitura delas falhar, a lista de compras segue normal
    Promise.resolve(api.cuponsExcluidos('avulsa')).then((l) => setExcluidos(l ?? [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    let vivo = true
    api.catalogoProdutos().then((c) => { if (vivo) setCatalogo(c) }).catch(() => { if (vivo) setCatalogoFalhou(true) })
    api.fornecedoresConhecidos().then((f) => { if (vivo) setConhecidos(f) }).catch(() => { if (vivo) setConhecidos([]) })
    carregarRecentes()
    return () => { vivo = false }
  }, [carregarRecentes])

  // enquanto há compra na fila, olha de novo a cada 30 s (o robô leva de 2 a 3 minutos)
  const naFila = recentes.some((c) => c.estado === 'PENDENTE' || c.estado === 'PROCESSANDO')
  useEffect(() => {
    if (!naFila) return
    const t = setInterval(carregarRecentes, INTERVALO_RECENTES_MS)
    return () => clearInterval(t)
  }, [naFila, carregarRecentes])

  useEffect(() => { setRepetida(null) }, [linhas, forma, contaPix, fornecedor])

  // Dados não enviados (13/11/2026): com forma escolhida, fornecedor ou algo digitado num item, o "Atualizar" do topo e as abas perguntam antes de sair
  const algoDigitado = formaMexida || fornecedor !== null || linhas.some((l) => l.produtoId !== null || l.busca.trim() !== '' || l.quantidade.trim() !== '' || l.preco.trim() !== '')
  useNaoEnviado('compra-avulsa', algoDigitado)

  const pagamento = montarPagamento(forma, contaPix)
  const problema = useMemo(() => problemaDaCompra(linhas), [linhas])
  const total = totalGeral(linhas)
  const pronta = pagamento !== null && fornecedor !== null && problema === ''
  const produtoDe = (id: number | null) => (id === null ? null : catalogo?.find((p) => p.produto_id === id) ?? null)
  const nomeNaLista = (cnpj: string | null | undefined, razao: string | null): string => {
    const f = conhecidos?.find((x) => x.cnpj === (cnpj ?? ''))
    return f ? nomeDoConhecido(f) : nomeDoFornecedor(razao, null) || 'fornecedor'
  }

  function mudar(chave: number, parte: Partial<Linha>) {
    setConfirmando(false); setResultado(null)
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...parte } : l)))
  }
  function adicionar() { setConfirmando(false); setLinhas((ls) => [...ls, linhaVazia(proxima)]); setProxima((n) => n + 1) }
  function remover(chave: number) { setConfirmando(false); setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l.chave !== chave) : [linhaVazia(chave)])) }

  /** `outraCompra`: o Ivan viu o aviso de repetida e disse que É outra compra (E5): reenvia o MESMO envio com a decisão; o servidor a grava com a marca. */
  async function enviar(outraCompra = false) {
    if (!pronta || !pagamento || !fornecedor) return
    setEnviando(true); setErro('')
    try {
      const r = await api.enviarCompraAvulsa({
        envio_id: envioId,
        fornecedor: { cnpj: fornecedor.cnpj, nome: fornecedor.razao || nomeDoConhecido(fornecedor) },
        pagamento,
        itens: linhas.map((l) => ({ produto_id: l.produtoId as number, quantidade: lerQuantidade(l.quantidade, l.unidade) as number, preco: lerPreco(l.preco) as number, descricao: produtoDe(l.produtoId)?.nome })),
        ...(outraCompra ? { outra_compra: true } : {}),
      })
      setResultado({
        classe: r.disparo_ok === false ? 'amarelo' : 'ok',
        texto: r.duplicado ? 'Essa compra já tinha sido enviada: nada foi duplicado.'
          : r.disparo_ok === false ? r.resumo
            : 'Compra enviada. O robô lança no SisChef em 2 ou 3 minutos; acompanhe em “Últimas compras avulsas”.',
      })
      // pronta para a próxima compra: itens e fornecedor limpos (a forma de pagamento fica, é comum repetir), identificador novo
      setLinhas([linhaVazia(1)]); setProxima(2); setFornecedor(null); setBuscaForn(''); setConfirmando(false); setEnvioId(novoId()); setFormaMexida(false)
      setRepetida(null)
      carregarRecentes()
    } catch (e) {
      if (ehErroRepetida(e)) { setRepetida(e.message.slice(REPETIDA_PREFIXO.length).trim()); setConfirmando(false) }   // nada foi gravado: o formulário fica como está
      else setErro(mensagem(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="coluna cupom compra-avulsa" data-testid="compra-avulsa">
      <TituloDaTela>Compras avulsas</TituloDaTela>
      <p className="sub">Compra feita <b>sem cupom fiscal e sem nota fiscal</b>. Você digita o produto, a quantidade e o preço; o robô lança no SisChef como um pedido de compra: entra no estoque e, conforme a forma de pagamento, no financeiro.</p>

      <div className="etapa">
        <div className="grupo">1 · Como foi pago</div>
        <div className="chips" role="group" aria-label="Forma de pagamento">
          {FORMAS.map((f) => (
            <button key={f.forma} type="button" className={`chip${forma === f.forma ? ' ativo' : ''}`} aria-pressed={forma === f.forma} disabled={enviando}
              onClick={() => { setForma(f.forma); setContaPix(null); setConfirmando(false); setFormaMexida(true) }}>{f.rotulo}</button>
          ))}
        </div>
        {forma === 'pix' && (
          <>
            <p className="sub">Banco e empresa do PIX</p>
            <div className="chips" role="group" aria-label="Banco e empresa do PIX">
              {CONTAS_PIX.map((c) => (
                <button key={c.conta} type="button" className={`chip${contaPix === c.conta ? ' ativo' : ''}`} aria-pressed={contaPix === c.conta} disabled={enviando}
                  onClick={() => { setContaPix(c.conta); setConfirmando(false); setFormaMexida(true) }}>{c.rotulo}</button>
              ))}
            </div>
          </>
        )}
        {forma === 'sem_cartao' && <p className="sub" data-testid="aviso-sem-financeiro">Só dá entrada no estoque: nada vai para o financeiro do SisChef.</p>}
        {(forma === 'dinheiro' || forma === 'tesouraria' || forma === 'pix') && <p className="sub" data-testid="aviso-com-financeiro">Entra no estoque e no financeiro, pago à vista hoje.</p>}
      </div>

      <div className="etapa">
        <div className="grupo">2 · Fornecedor</div>
        {fornecedor ? (
          <p className="escolhido" data-testid="fornecedor-escolhido"><b>{nomeDoConhecido(fornecedor)}</b>
            <span className="un"> · CNPJ {formatarCnpj(fornecedor.cnpj)}</span>{' '}
            <button type="button" className="link" disabled={enviando} onClick={() => { setFornecedor(null); setBuscaForn(''); setConfirmando(false) }}>Trocar</button>
          </p>
        ) : cadastrando ? (
          <CadastrarFornecedor cupom={{ id: envioId, motivo: null }} acoes={ACOES_FORNECEDOR} aoReenviar={() => undefined} aoVoltar={() => setCadastrando(false)}
            aoUsar={(f) => { setFornecedor({ cnpj: f.cnpj, razao: f.razao, fantasia: f.fantasia }); setCadastrando(false); setConfirmando(false) }} />
        ) : (
          <>
            <label>Digite o nome ou o CNPJ do fornecedor
              <input type="text" value={buscaForn} placeholder="ex.: atacadão" autoComplete="off" onChange={(e) => setBuscaForn(e.target.value)} data-testid="busca-fornecedor" />
            </label>
            {(() => {
              if (buscaForn.trim() === '') return null
              if (conhecidos === null) return <p className="sub">Carregando os fornecedores…</p>
              const achados = buscarFornecedores(conhecidos, buscaForn)
              return achados.length > 0 ? (
                <ul className="achados" data-testid="achados-fornecedor">
                  {achados.map((f) => (
                    <li key={f.cnpj}>
                      <button type="button" onClick={() => { setFornecedor(f); setBuscaForn(''); setConfirmando(false) }}>
                        {nomeDoConhecido(f)}{f.fantasia && f.razao ? ` — ${f.razao}` : ''} · CNPJ {formatarCnpj(f.cnpj)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="amarelo" data-testid="fornecedor-nao-achado">Não achei esse fornecedor entre os que o app conhece.</p>
            })()}
            <button type="button" className="botao secundario" onClick={() => setCadastrando(true)} data-testid="cadastrar-fornecedor-novo">Fornecedor novo: cadastrar</button>
          </>
        )}
      </div>

      <div className="etapa">
        <div className="grupo">3 · Itens</div>
        <ul className="itens-avulsa">
          {linhas.map((l, i) => {
            const p = produtoDe(l.produtoId)
            const un = p?.unidade ? rotuloUnidade(p.unidade) : ''
            const achados = l.produtoId === null && catalogo ? buscarProdutos(catalogo, l.busca).itens : []
            const t = totalDaLinha(l)
            const falta = faltaNaLinha(l)
            return (
              <li key={l.chave} data-testid="linha-avulsa">
                <div className="linha-topo"><b>Item {i + 1}</b>
                  <button type="button" className="link" disabled={enviando} onClick={() => remover(l.chave)} aria-label={`Tirar o item ${i + 1}`}>Tirar</button>
                </div>
                {l.produtoId === null ? (
                  <>
                    <label>Produto
                      <input type="text" value={l.busca} placeholder="Digite o nome do produto" autoComplete="off" onChange={(e) => mudar(l.chave, { busca: e.target.value })} data-testid="busca-produto" />
                    </label>
                    {l.busca.trim() !== '' && (
                      catalogo === null ? (
                        catalogoFalhou ? <p className="erro" role="alert">Não consegui carregar a lista de produtos. Atualize a página.</p> : <p className="sub">Carregando a lista de produtos…</p>
                      ) : (
                        <>
                          {achados.length > 0 && (
                            <ul className="achados" data-testid="achados">
                              {achados.map((a) => (
                                <li key={a.produto_id}>
                                  <button type="button" onClick={() => mudar(l.chave, { produtoId: a.produto_id, busca: '', unidade: a.unidade })}>{a.nome}{a.unidade ? ` · ${rotuloUnidade(a.unidade)}` : ''}</button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {/* sem resultado: aviso + botão; com resultados: só o botão discreto, sempre à mão (pedido do Ivan, 13/10) */}
                          <ProdutoNaoCadastrado descricaoDoItem={l.busca} acoes={ACOES_PRODUTO} origem={{ tipo: 'avulsa', item: i }} discreto={achados.length > 0}
                            aoUsar={(novo) => { setCatalogo((c) => [...(c ?? []).filter((x) => x.produto_id !== novo.produto_id), novo]); mudar(l.chave, { produtoId: novo.produto_id, busca: '', unidade: novo.unidade }) }} />
                        </>
                      )
                    )}
                  </>
                ) : (
                  <p className="escolhido" data-testid="produto-escolhido"><b>{p?.nome ?? `Produto ${l.produtoId}`}</b>{un && <span className="un"> · entra em {un}</span>}{' '}
                    <button type="button" className="link" disabled={enviando} onClick={() => mudar(l.chave, { produtoId: null })}>Trocar</button></p>
                )}
                {l.produtoId !== null && (
                  <div className="par">
                    <label>Quantidade{un ? ` (em ${un})` : ''}
                      <input type="text" inputMode="decimal" placeholder="0" value={l.quantidade} autoComplete="off" onChange={(e) => mudar(l.chave, { quantidade: e.target.value })} data-testid="quantidade-avulsa" />
                    </label>
                    <label>Preço{un ? ` por ${un} (R$)` : ' (R$)'}
                      <input type="text" inputMode="decimal" placeholder="0,00" value={l.preco} autoComplete="off" onChange={(e) => mudar(l.chave, { preco: e.target.value })} data-testid="preco-avulsa" />
                    </label>
                  </div>
                )}
                {l.produtoId !== null && (
                  <p className="sub" data-testid="total-linha">{t !== null && falta === '' ? <>Total do item: <b>{formatarReais(t)}</b></> : `Falta: ${falta}.`}</p>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="botao secundario" onClick={adicionar} disabled={enviando} data-testid="adicionar-item">+ Adicionar outro item</button>
      </div>

      <div className="etapa resumo-avulsa">
        <p data-testid="total-geral"><b>Total da compra: {formatarReais(total)}</b></p>
        {pagamento === null && <p className="amarelo" data-testid="falta-forma">Escolha como foi pago{forma === 'pix' ? ' (banco e empresa do PIX)' : ''}.</p>}
        {fornecedor === null && <p className="amarelo" data-testid="falta-fornecedor">Informe o fornecedor.</p>}
        {problema !== '' && <p className="amarelo" data-testid="problema-avulsa">{problema}</p>}
        {!confirmando ? (
          <button type="button" className="botao" disabled={!pronta || enviando} onClick={() => { setResultado(null); setErro(''); setConfirmando(true) }} data-testid="lancar-avulsa">Lançar compra</button>
        ) : (
          <div className="associar" data-testid="confirmar-avulsa">
            <p>Lançar no SisChef uma compra de <b>{formatarReais(total)}</b> de <b>{fornecedor ? nomeDoConhecido(fornecedor) : ''}</b>, paga em <b>{pagamento ? rotuloForma(pagamento) : ''}</b>, com {linhas.length} {linhas.length === 1 ? 'item' : 'itens'}?</p>
            <div className="acoes">
              <button type="button" className="botao" disabled={enviando} onClick={() => void enviar()} data-testid="confirmar-lancamento">{enviando ? 'Enviando…' : 'Confirmar e lançar'}</button>
              <button type="button" className="botao secundario" disabled={enviando} onClick={() => setConfirmando(false)}>Voltar</button>
            </div>
          </div>
        )}
        {repetida && (
          <div className="amarelo aviso-repetida" data-testid="aviso-repetida-avulsa" role="group" aria-label="Parece repetida">
            <p><b>Parece repetida.</b> {repetida.charAt(0).toUpperCase() + repetida.slice(1)}</p>
            <p className="sub">Se é a MESMA compra, não precisa lançar de novo: toque em “Cancelar”. Se é OUTRA compra de verdade, toque em “É outra compra”.</p>
            <div className="acoes">
              <button type="button" className="botao" disabled={enviando} onClick={() => void enviar(true)} data-testid="outra-compra-avulsa">{enviando ? 'Enviando…' : 'É outra compra: lançar mesmo assim'}</button>
              <button type="button" className="botao secundario" disabled={enviando} onClick={() => setRepetida(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {erro && <p className="erro" role="alert" data-testid="erro-avulsa">{erro}</p>}
        {resultado && <p className={resultado.classe} role="status" data-testid="resultado-avulsa">{resultado.texto}</p>}
      </div>

      <div className="grupo">Últimas compras avulsas</div>
      {falhaRecentes && <p className="erro" role="alert">Não consegui carregar as últimas compras.</p>}
      {recentes.length === 0 ? (!falhaRecentes && <p className="sub">Nenhuma compra avulsa ainda.</p>) : (
        <ul className="recentes">
          {recentes.map((c) => {
            const aberto = expandido === c.id
            const nome = nomeNaLista(c.emitente_cnpj, c.emitente_nome)
            const repetidaDaCompra = repetidaDoCupom(c)   // E5: parou SÓ pelo aviso do robô (ou o servidor o gravou): decisão do Ivan nos dois botões
            const motivoSemAviso = motivoSemRepetida(c.motivo)
            const falhaDaCompra = repetidaDaCompra ? null : falhaDeConferirDoCupom(c)   // E5, ajuste 2: o robô não conseguiu conferir se é repetida: "Tentar de novo" (o texto técnico não repete)
            return (
              <li key={c.id} data-testid="compra-recente">
                <button type="button" className="recente-linha" aria-expanded={aberto} onClick={() => setExpandido(aberto ? null : c.id)}>
                  <span><b>{ROTULO_ESTADO[c.estado]}{c.estado === 'REVISAR' && <Icone nome="alerta" tamanho={18} className="no-texto" />}</b> · {nome}{c.valor_a_pagar != null && ` · ${formatarReais(c.valor_a_pagar)}`}</span>
                  <span className="seta" aria-hidden="true"><Icone nome="dir" tamanho={18} className={aberto ? 'aberto' : undefined} /></span>
                </button>
                {repetidaDaCompra && (
                  <AvisoRepetida id={c.id} texto={repetidaDaCompra.texto} sobraMotivo={repetidaDaCompra.sobraMotivo} rotulo="compra avulsa" nome={nome}
                    aoDecidir={() => carregarRecentes()} aoExcluir={carregarRecentes} />
                )}
                {falhaDaCompra && <AvisoFalhaConferir id={c.id} texto={falhaDaCompra.texto} aoSoltar={() => carregarRecentes()} aoRecarregar={carregarRecentes} />}
                {c.estado === 'REVISAR' && motivoSemAviso !== '' && !falhaDaCompra && <p className="amarelo" data-testid="motivo-recente">{motivoSemAviso}</p>}
                {aberto && (
                  <DetalheLancamento pedido={c.pedido_sischef} rotuloQtd={false}
                    fornecedor={c.emitente_nome ? `${c.emitente_nome}${c.emitente_cnpj ? ` · CNPJ ${formatarCnpj(c.emitente_cnpj)}` : ''}` : null}
                    quando={formatarDataHora(c.estado === 'LANCADO' && c.atualizado_em ? c.atualizado_em : c.criado_em)} rotuloQuando={c.estado === 'LANCADO' ? 'Lançada em' : 'Enviada em'}
                    itens={c.itens.map((it) => {
                      const id = it.sugestao_produto?.id ?? ''
                      const q = it.entrada_estoque
                      const preco = it.valor_unitario
                      return {
                        codigo: id,
                        descricao: catalogo?.find((p) => String(p.produto_id) === id)?.nome ?? it.descricao_cupom ?? `Produto ${id}`,
                        quantidade: q, unidade: unidadeDoProduto(catalogo, id),
                        valor: q != null && preco != null ? Math.round(q * preco * 100) / 100 : null,
                      }
                    })} />
                )}
                {/* Excluir (03/11/2026): só a compra que ainda não foi lançada nem parou no meio do SisChef */}
                {podeExcluirCupom(c) && !repetidaDaCompra && <ExcluirCupom id={c.id} rotulo="compra avulsa" aoExcluir={carregarRecentes} nome={nome} />}
              </li>
            )
          })}
        </ul>
      )}
      <CuponsExcluidos lista={excluidos} titulo="Compras excluídas" aoMudar={carregarRecentes} nomeDe={(c) => nomeNaLista(c.emitente_cnpj, c.emitente_nome)} />
    </section>
  )
}
