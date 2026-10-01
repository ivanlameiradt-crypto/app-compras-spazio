import { useEffect, useState } from 'react'
import type { AvisoConfirmar, CnpjAprendido, FornecedorSemVendedor, Grafia, Vendedor } from '../../lib/tipos'
import { mensagemDeErro } from '../../lib/regras'
import * as cad from '../../cadastros/api'
import { formatarWhatsapp, mascararWhatsapp, normalizarWhatsapp, whatsappValido } from '../../cadastros/regras'
import { ligarAguardando, desligarCotacaoViva, whatsappRepetido, NOVO_VENDEDOR } from '../../cadastros/textos'

const rotuloDe = (empresa: string) => empresa.split('(')[0].trim()
/** minúsculas e sem acento, para a busca casar "João" com "joao". */
const semAcento = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Um aviso pendente que precisa de segundo toque (C.4.2). */
interface Pendente { vendedorId: number; ativo?: boolean; texto: string; codigos: string[] }

export default function Vendedores({ grafiaInicial }: { grafiaInicial?: string | null }) {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [grafias, setGrafias] = useState<Grafia[]>([])
  const [cnpjs, setCnpjs] = useState<CnpjAprendido[]>([])
  const [semVendedor, setSemVendedor] = useState<FornecedorSemVendedor[]>([])
  const [erro, setErro] = useState('')
  const [pendente, setPendente] = useState<Pendente | null>(null)
  // formulário de novo vendedor
  const [empresa, setEmpresa] = useState('')
  const [nome, setNome] = useState('')
  const [whats, setWhats] = useState(grafiaInicial ? '' : '')
  const [grafiaNovo, setGrafiaNovo] = useState(grafiaInicial ?? '')
  // edição de um vendedor já cadastrado (C.5): abre um formulário no próprio cartão, já preenchido
  const [editId, setEditId] = useState<number | null>(null)
  const [edEmpresa, setEdEmpresa] = useState('')
  const [edNome, setEdNome] = useState('')
  const [edWhats, setEdWhats] = useState('')
  // achar rápido sem rolar: busca no topo e seções ("novo" / "sem vendedor") recolhidas por padrão
  const [busca, setBusca] = useState('')
  const [cadAberto, setCadAberto] = useState(false)
  const [novoAberto, setNovoAberto] = useState(!!grafiaInicial)
  const [semAberto, setSemAberto] = useState(false)

  async function carregar() {
    try {
      const [v, g, c, s] = await Promise.all([
        cad.listarVendedores(), cad.listarGrafias(), cad.listarCnpjs(), cad.fornecedoresSemVendedor(),
      ])
      setVendedores(v); setGrafias(g); setCnpjs(c); setSemVendedor(s)
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  useEffect(() => { carregar() }, [])

  const rotulo = (id: number | null | undefined) => {
    const v = vendedores.find((x) => x.id === id)
    return v ? rotuloDe(v.empresa) : ''
  }

  async function salvarNovo(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const wpp = normalizarWhatsapp(whats)
    if (!whatsappValido(wpp)) { setErro('WhatsApp inválido: use DDD + número, ex.: (91) 90000-1234'); return }
    try {
      const r = await cad.salvarVendedor({ nome: nome.trim(), empresa: empresa.trim(), whatsapp: wpp })
      if (!r.ok && r.confirmar) {
        const a = r.confirmar[0]
        if (a.codigo === 'whatsapp_repetido' && !window.confirm(whatsappRepetido(a))) return
        await cad.salvarVendedor({ nome: nome.trim(), empresa: empresa.trim(), whatsapp: wpp, confirmar: r.confirmar.map((x) => x.codigo) })
      }
      // se veio uma grafia junto (atalho da aba Cotações), atribui ao vendedor novo
      const id = (r.id ?? (await cad.listarVendedores()).find((v) => v.empresa.trim() === empresa.trim())?.id) as number | undefined
      if (grafiaNovo.trim() && id) await cad.salvarGrafia(grafiaNovo.trim(), id)
      setEmpresa(''); setNome(''); setWhats(''); setGrafiaNovo('')
      await carregar()
    } catch (err) { setErro(mensagemDeErro(err)) }
  }

  function abrirEdicao(v: Vendedor) {
    setErro('')
    setEditId(v.id)
    setEdEmpresa(v.empresa)
    setEdNome(v.nome)
    setEdWhats(formatarWhatsapp(v.whatsapp))
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const wpp = normalizarWhatsapp(edWhats)
    if (!whatsappValido(wpp)) { setErro('WhatsApp inválido: use DDD + número, ex.: (91) 90000-1234'); return }
    const p = { id: editId!, nome: edNome.trim(), empresa: edEmpresa.trim(), whatsapp: wpp }
    try {
      const r = await cad.salvarVendedor(p)
      if (!r.ok && r.confirmar) {
        const a = r.confirmar[0]
        if (a.codigo === 'whatsapp_repetido' && !window.confirm(whatsappRepetido(a))) return
        await cad.salvarVendedor({ ...p, confirmar: r.confirmar.map((x) => x.codigo) })
      }
      setEditId(null)
      await carregar()
    } catch (err) { setErro(mensagemDeErro(err)) }
  }

  async function ligarDesligar(v: Vendedor, ativo: boolean) {
    setErro('')
    try {
      const r = await cad.salvarVendedor({ id: v.id, ativo })
      if (!r.ok && r.confirmar) {
        const a: AvisoConfirmar = r.confirmar[0]
        const texto = a.codigo === 'aguardando' ? ligarAguardando(rotuloDe(v.empresa), a)
          : a.codigo === 'cotacao_viva' ? desligarCotacaoViva(rotuloDe(v.empresa), a)
          : whatsappRepetido(a)
        setPendente({ vendedorId: v.id, ativo, texto, codigos: r.confirmar.map((x) => x.codigo) })
        return
      }
      await carregar()
    } catch (err) { setErro(mensagemDeErro(err)) }
  }

  async function confirmarPendente() {
    if (!pendente) return
    try {
      await cad.salvarVendedor({ id: pendente.vendedorId, ativo: pendente.ativo, confirmar: pendente.codigos })
      setPendente(null)
      await carregar()
    } catch (err) { setErro(mensagemDeErro(err)) }
  }

  async function atribuir(f: FornecedorSemVendedor, vendedorId: number) {
    try { await cad.salvarGrafia(f.nome_original, vendedorId); await carregar() }
    catch (err) { setErro(mensagemDeErro(err)) }
  }

  async function excluir(v: Vendedor) {
    if (!window.confirm(`Excluir ${rotuloDe(v.empresa)}?`)) return
    try { await cad.excluirVendedor(v.id); await carregar() }
    catch (err) { setErro(mensagemDeErro(err)) }
  }

  const filtrados = vendedores.filter((v) => {
    const q = semAcento(busca.trim())
    return !q || semAcento(v.empresa).includes(q) || semAcento(v.nome).includes(q)
  })

  return (
    <div className="coluna">
      {erro && <p className="erro">{erro}</p>}
      {pendente && (
        <div className="cartao aviso-confirmar">
          <p>{pendente.texto}</p>
          <button className="botao" onClick={confirmarPendente}>{pendente.ativo ? 'Ligar mesmo assim' : 'Desligar'}</button>{' '}
          <button className="link" onClick={() => setPendente(null)}>Agora não</button>
        </div>
      )}

      <button type="button" className="secao" aria-expanded={cadAberto} onClick={() => setCadAberto((a) => !a)}>
        <span>Fornecedores cadastrados</span><span className="conta">{vendedores.length}{' '}{cadAberto ? '−' : '+'}</span>
      </button>
      {cadAberto && (
        <>
          <input
            className="busca"
            aria-label="Procurar fornecedor"
            placeholder="Procurar fornecedor pelo nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {filtrados.length === 0 && (
            <p className="sub">{vendedores.length === 0 ? 'Nenhum fornecedor cadastrado ainda.' : 'Nenhum fornecedor com esse nome.'}</p>
          )}
          {filtrados.map((v) => (
        <div key={v.id} className="cartao" data-vendedor={v.id}>
          {editId === v.id ? (
            <form className="coluna" onSubmit={salvarEdicao}>
              <h3>Editar fornecedor</h3>
              <label>Empresa<input aria-label="Editar empresa" required value={edEmpresa} onChange={(e) => setEdEmpresa(e.target.value)} /></label>
              <label>Nome para o vendedor<input aria-label="Editar nome" required value={edNome} onChange={(e) => setEdNome(e.target.value)} /></label>
              <label>WhatsApp<input aria-label="Editar WhatsApp" required value={edWhats} onChange={(e) => setEdWhats(e.target.value)} /></label>
              {normalizarWhatsapp(edWhats) && whatsappValido(normalizarWhatsapp(edWhats)) && <p className="sub">Vai gravar: {formatarWhatsapp(normalizarWhatsapp(edWhats))}</p>}
              <div className="acoes">
                <button className="botao" type="submit">Salvar</button>{' '}
                <button className="link" type="button" onClick={() => setEditId(null)}>Cancelar</button>
              </div>
            </form>
          ) : (
            <>
              <strong>{rotuloDe(v.empresa)}</strong> · {v.nome} · {mascararWhatsapp(v.whatsapp)} · <span className={v.ativo ? 'ligado' : 'desligado'}>{v.ativo ? 'Ligado' : 'Desligado'}</span>
              <div className="grafias">
                {grafias.filter((g) => g.vendedor_id === v.id).map((g) => (
                  <span key={g.nome_normalizado} className="pilula">{g.nome_original}
                    <button className="link" onClick={async () => { if (window.confirm(`Tirar a grafia ${g.nome_original}?`)) { await cad.removerGrafia(g.nome_normalizado); await carregar() } }}>tirar</button>
                  </span>
                ))}
              </div>
              {cnpjs.filter((c) => c.vendedor_id === v.id).map((c) => (
                <div key={c.cnpj} className="sub">{c.cnpj} · pela grafia da NF
                  <button className="link" onClick={async () => { if (window.confirm(`Tirar o CNPJ ${c.cnpj}?`)) { await cad.removerCnpj(c.cnpj); await carregar() } }}>tirar</button>
                </div>
              ))}
              <div className="acoes">
                <button className="link" onClick={() => abrirEdicao(v)}>Editar</button>{' '}
                <button className={v.ativo ? 'link perigo' : 'botao'} onClick={() => ligarDesligar(v, !v.ativo)}>{v.ativo ? 'Desligar' : 'Ligar'}</button>{' '}
                <a className="link" href={`https://wa.me/${v.whatsapp}`} target="_blank" rel="noopener">Testar número</a>{' '}
                <button className="link perigo" onClick={() => excluir(v)}>Excluir</button>
              </div>
            </>
          )}
        </div>
      ))}
        </>
      )}

      <button type="button" className="secao" aria-expanded={novoAberto} onClick={() => setNovoAberto((a) => !a)}>
        <span>Cadastrar novo fornecedor</span><span className="conta">{novoAberto ? '−' : '+'}</span>
      </button>
      {novoAberto && (
        <form className="coluna cartao" onSubmit={salvarNovo}>
          <p className="sub">{NOVO_VENDEDOR}</p>
          <label>Empresa<input aria-label="Empresa" required value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></label>
          <label>Nome para o vendedor<input aria-label="Nome para o vendedor" required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label>WhatsApp<input aria-label="WhatsApp" required value={whats} onChange={(e) => setWhats(e.target.value)} /></label>
          {normalizarWhatsapp(whats) && whatsappValido(normalizarWhatsapp(whats)) && <p className="sub">Vai gravar: {formatarWhatsapp(normalizarWhatsapp(whats))}</p>}
          {grafiaNovo.trim() && <p className="sub">Grafia junto: {grafiaNovo}</p>}
          <button className="botao" type="submit">Cadastrar vendedor</button>
        </form>
      )}

      {semVendedor.length > 0 && (
        <>
          <button type="button" className="secao" aria-expanded={semAberto} onClick={() => setSemAberto((a) => !a)}>
            <span>Fornecedores do SisChef sem vendedor</span><span className="conta">{semVendedor.length}{' '}{semAberto ? '−' : '+'}</span>
          </button>
          {semAberto && (
            <div className="cartao">
              {semVendedor.map((f) => (
                <div key={f.nome_normalizado} className="linha-sem-vendedor">
                  <span>{f.nome_original} — {f.produtos} produtos{f.ultima_compra && ` (última compra ${f.ultima_compra})`}</span>
                  <select aria-label={`Atribuir a ${f.nome_original}`} defaultValue="" onChange={(e) => e.target.value && atribuir(f, Number(e.target.value))}>
                    <option value="" disabled>Atribuir a…</option>
                    {vendedores.map((v) => <option key={v.id} value={v.id}>{rotuloDe(v.empresa)}</option>)}
                  </select>
                  <button className="link" onClick={() => { setGrafiaNovo(f.nome_original); setNovoAberto(true) }}>Novo vendedor para este</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
