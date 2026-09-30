// Um cartão por vendedor (spec 8.2, bloco 4), com as cotações dele na semana (da versão mais nova para a mais velha):
// rascunho (marcar itens, trocar vendedor, nota, Preparar), "Comprar na loja nesta semana", e as vivas/fechadas com a
// tabela de respostas e as ações. Tudo que grava e depois abre o WhatsApp é em dois toques: o segundo é um
// <a href="wa.me">. Ao lado de todo link do WhatsApp, "Copiar mensagem" (e "Copiar link" onde há link aberto).
import { useState } from 'react'
import * as api from '../../lib/api'
import type { CartaoPreparo, Cotacao, ItemCotacao, Vendedor } from '../../lib/tipos'
import {
  ddmm, diaLongo, horaBr, horaDoTexto, LIMITE_MENSAGEM, linhaCondicoes, linkCotacao, mensagemCobranca, mensagemCotacao,
  mensagemLinkNovo, mensagemObrigado, mensagemPedido, numeroBr, reais, rotuloVendedor,
} from '../../cotacao/mensagens'
import { chaveCot, useCotacoes } from './contexto'
import { BotoesCopiar, LinkWhatsApp } from './Copiar'
import { ehAberta, ehViva } from './estado'
import {
  comoCotou, cotadoSisChef, delta, dicaEmbalagem, perguntaCancelar, quando, referencia, rotuloStatus, situacaoCotacao,
  telefoneCurto, textoAvisoIvan, textoAvisoVendedor, textoOrigem, textoPrazo,
} from './formato'
import ColarResposta from './ColarResposta'
import ConfirmarPedido from './ConfirmarPedido'
import EntregaNfe from './EntregaNfe'
import DigitarPrecos from './DigitarPrecos'
import LimparRespostas from './LimparRespostas'

/** Nota com "R$" ou número com vírgula: o vendedor vai ver, e preço nunca vaza para ele (D49). */
export const NOTA_SUSPEITA = /R\$|\d,\d/
export const PERGUNTA_NOTA = "A nota tem 'R$' ou número com vírgula e o vendedor vai ver. Gravar assim mesmo?"

export default function CartaoVendedor({ v, cartao, cotacoes, daSemana }: {
  v: Vendedor; cartao?: CartaoPreparo; cotacoes: Cotacao[]; daSemana: boolean
}) {
  return (
    <div className="cartao" data-testid={`vendedor-${v.id}`}>
      <div className="nome">{v.empresa} · {v.nome} · {telefoneCurto(v.whatsapp)}</div>
      {cartao && <div className="sub">{cartao.itens} {cartao.itens === 1 ? 'item' : 'itens'} · ≈ {reais(cartao.estimado)}</div>}
      {cotacoes.length === 0 && <p className="sub">Nenhuma cotação para este vendedor ainda.</p>}
      {cotacoes.map((c) => <SecaoCotacao key={c.id} c={c} v={v} irmas={cotacoes} daSemana={daSemana} />)}
    </div>
  )
}

function SecaoCotacao({ c, v, irmas, daSemana }: { c: Cotacao; v: Vendedor; irmas: Cotacao[]; daSemana: boolean }) {
  if (c.status === 'rascunho') return <SecaoRascunho c={c} v={v} irmas={irmas} />
  if (c.status === 'liberada') return <SecaoLiberada c={c} />
  if (c.status === 'cancelada' || c.status === 'substituida') return null
  return <SecaoViva c={c} v={v} daSemana={daSemana} />
}

function Cabeca({ c }: { c: Cotacao }) {
  return (
    <div className="linha">
      <b>v{c.versao}{c.complementar ? ' · complementar' : ''}</b>
      <span className={c.status === 'respondida' || c.resultado === 'pedido' ? 'pill ok' : 'pill'}>{rotuloStatus(c)}</span>
    </div>
  )
}

function Erro({ c }: { c: Cotacao }) {
  const ctx = useCotacoes()
  const e = ctx.erro(chaveCot(c))
  return e ? <p className="erro" role="alert">{e}</p> : null
}

/** A nota do Ivan para o vendedor, abaixo do nome do item, em todos os estados do cartão. */
function Nota({ nota }: { nota: string | null }) {
  return nota ? <div className="nota-item">Nota: {nota}</div> : null
}

/** Aviso amarelo da mensagem longa (D52): não bloqueia; "Copiar mensagem" é o plano B. */
export function AvisoTamanho({ texto }: { texto: string }) {
  if (texto.length <= LIMITE_MENSAGEM) return null
  return (
    <p className="amarelo" data-testid="aviso-tamanho">
      Mensagem com {texto.length} caracteres: o WhatsApp pode não abrir. Encurte as notas ou use Copiar mensagem.
    </p>
  )
}

// ---------- rascunho
function SecaoRascunho({ c, v, irmas }: { c: Cotacao; v: Vendedor; irmas: Cotacao[] }) {
  const ctx = useCotacoes()
  const itens = ctx.itensDe(c.id)
  const incluidos = itens.filter((i) => i.incluido).length
  const viva = irmas.find((x) => x.id !== c.id && ehViva(x))
  return (
    <div className="secao" data-testid={`cotacao-${c.id}`}>
      <Cabeca c={c} />
      {viva && (
        <p className="aviso">Ao preparar, a v{viva.versao} vira substituída: as respostas dela vêm junto e o link antigo leva a esta.</p>
      )}
      {itens.map((i) => <ItemRascunho key={i.id} i={i} v={v} />)}
      <div className="sub">{incluidos} de {itens.length} itens marcados para cotar</div>
      <Erro c={c} />
      <div className="acoes">
        <button className="botao" disabled={ctx.ocupado || incluidos === 0} onClick={() => ctx.preparar(c)}>
          Preparar mensagem para {v.nome}
        </button>
        {!viva && (
          <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chaveCot(c), () => api.liberarLoja(c.id))}>
            Comprar na loja nesta semana
          </button>
        )}
      </div>
    </div>
  )
}

function ItemRascunho({ i, v }: { i: ItemCotacao; v: Vendedor }) {
  const ctx = useCotacoes()
  const selos = ctx.itemSemana(i.item_semana_id)?.selos ?? []
  const info = ctx.preparo?.itens.find((x) => x.item_semana_id === i.item_semana_id)
  const outro = info?.ultima_com_outro
  const vendedorOutro = outro ? ctx.vendedor(outro.vendedor_id) : undefined
  const outroNome = outro ? (vendedorOutro ? rotuloVendedor(vendedorOutro.empresa) : outro.fornecedor) : ''
  const chave = `c${i.cotacao_id}`
  // Nota (ajuste Foozi 3): grava no catálogo e vale nas semanas seguintes; o cot_preparar da releitura a traz ao rascunho
  const editarNota = () => {
    const texto = window.prompt(`Nota para o vendedor sobre ${i.nome} (até 80 caracteres; vazio apaga):`, i.nota_vendedor ?? '')
    if (texto === null) return
    const nota = texto.trim()
    if (NOTA_SUSPEITA.test(nota) && !window.confirm(PERGUNTA_NOTA)) return
    void ctx.acao(chave, () => api.definirNota(i.produto_id, nota || null))
  }
  return (
    <div className="item-cot" data-testid={`rascunho-item-${i.produto_id}`}>
      <label className="marcar">
        <input type="checkbox" checked={i.incluido} disabled={ctx.ocupado} aria-label={`Cotar ${i.nome}`}
          onChange={() => ctx.acao(chave, () => api.marcarItemCotacao(i.id, !i.incluido))} />
        <span className="nome">{i.nome}</span>
      </label>
      <Nota nota={i.nota_vendedor} />
      <div className="sub">Sugerido {numeroBr(i.qtd_sugerida)} · Aprovado {dicaEmbalagem(i)}</div>
      <div className="sub">Último {referencia(i)}</div>
      {outro && <div className="sub">última compra foi com {outroNome} em {ddmm(outro.data)}</div>}
      {selos.length > 0 && <div className="etiquetas">{selos.map((s, n) => <span key={n} className="pill">{s.texto}</span>)}</div>}
      <div className="linha-acoes">
        <select aria-label={`Trocar vendedor de ${i.nome}`} value="" disabled={ctx.ocupado}
          onChange={(e) => {
            const novo = Number(e.target.value)
            if (novo) void ctx.acao(chave, () => api.definirVendedor(i.produto_id, novo))
          }}>
          <option value="">Trocar vendedor…</option>
          {ctx.vendedoresAtivos.filter((x) => x.id !== v.id).map((x) => <option key={x.id} value={x.id}>{x.empresa}</option>)}
        </select>
        <button className="link" disabled={ctx.ocupado} aria-label={`Nota de ${i.nome}`} onClick={editarNota}>Nota</button>
      </div>
    </div>
  )
}

// ---------- liberada ("Comprar na loja nesta semana")
function SecaoLiberada({ c }: { c: Cotacao }) {
  const ctx = useCotacoes()
  const daSemana = ctx.semanaEmCompra?.id === c.semana_id
  return (
    <div className="secao" data-testid={`cotacao-${c.id}`}>
      <Cabeca c={c} />
      <p className="aviso">Sem cotação nesta semana: os compradores não veem "Aguardando cotação" para os itens deste vendedor.</p>
      <Erro c={c} />
      {daSemana && (
        <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chaveCot(c), () => api.voltarACotar(c.id))}>
          Voltar a cotar
        </button>
      )}
    </div>
  )
}

// ---------- preparada nesta sessão: mensagem, prazo e o segundo toque (Abrir WhatsApp / Copiar)
function EnvioPreparado({ c, v }: { c: Cotacao; v: Vendedor }) {
  const ctx = useCotacoes()
  const s = ctx.sessao(c.id)
  const d = s.dados!
  const texto = mensagemCotacao(d)
  const prazo = horaDoTexto(d.prazo_local)
  const fecha = horaDoTexto(d.fechamento_local)
  const abriu = !!s.abriu
  // a versão que substituiu outra já está com o vendedor (o link antigo leva a ela): o banco recusa o Desfazer
  const substituiu = d.substitui_versao ?? ctx.substituiVersao(c.id)
  const semDesfazer = substituiu != null && (
    <p className="sub" data-testid="sem-desfazer">Esta versão já substituiu a v{substituiu}: para mudar, use Nova versão.</p>
  )
  const marcarAbriu = () => ctx.mudarSessao(c.id, { abriu: true })
  const desfazer = () => {
    if (!window.confirm(`Se você mandou a mensagem, o link que o ${v.nome} recebeu deixa de funcionar.\n\nDesfazer (não enviei)?`)) return
    void ctx.acao(chaveCot(c), async () => {
      await api.descongelarCotacao(c.id)
      ctx.mudarSessao(c.id, { dados: undefined, saude: undefined, abriu: false })
    })
  }
  if (s.saude !== 'ok') {
    return (
      <div className="bloco-envio" data-testid="envio">
        <p className="erro" role="alert">A checagem do link falhou: {s.saude}. Não mande a mensagem ainda.</p>
        {semDesfazer}
        <div className="acoes">
          <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.checarDeNovo(c)}>Checar o link de novo</button>
          {substituiu == null && <button className="botao secundario" disabled={ctx.ocupado} onClick={desfazer}>Desfazer (não enviei)</button>}
        </div>
      </div>
    )
  }
  // a ordem dos filhos é fixa (os condicionais guardam o lugar): o "Copiar" não perde o texto para copiar à mão
  return (
    <div className="bloco-envio" data-testid="envio">
      <div className="sub">
        Prazo: {diaLongo(prazo.data)}, {ddmm(prazo.data)}, até {horaBr(prazo)} · fecha às {horaBr(fecha)}
      </div>
      <pre className="mensagem">{texto}</pre>
      <AvisoTamanho texto={texto} />
      {abriu && <p className="nome">Enviou no WhatsApp?</p>}
      {abriu && semDesfazer}
      <div className="acoes">
        {abriu && (
          <button className="botao" disabled={ctx.ocupado} onClick={() => ctx.acao(chaveCot(c), async () => {
            await api.confirmarEnvio(c.id)
            ctx.mudarSessao(c.id, { dados: undefined, saude: undefined, abriu: false })
          })}>Já enviei</button>
        )}
        <LinkWhatsApp numero={v.whatsapp} texto={texto} secundario={abriu} onClick={marcarAbriu}>
          {abriu ? 'Abrir o WhatsApp de novo' : 'Abrir WhatsApp'}
        </LinkWhatsApp>
        <BotoesCopiar mensagem={texto} link={d.codigo ? linkCotacao(d.codigo) : null} onCopiarMensagem={marcarAbriu} />
        {abriu && substituiu == null && <button className="botao secundario" disabled={ctx.ocupado} onClick={desfazer}>Desfazer (não enviei)</button>}
      </div>
    </div>
  )
}

// ---------- pronta, enviada, respondida e fechada
function SecaoViva({ c, v, daSemana }: { c: Cotacao; v: Vendedor; daSemana: boolean }) {
  const ctx = useCotacoes()
  const [aberto, setAberto] = useState<null | 'digitar' | 'colar' | 'pedido'>(null)
  const s = ctx.sessao(c.id)
  const itens = ctx.itensDe(c.id).filter((i) => i.incluido)
  const r = ctx.resumo(c.id)
  const codigo = ctx.codigo(c.id)
  const d = ctx.dadosDe(c)
  const agora = ctx.agora
  const semResultado = c.resultado == null
  const aberta = ehAberta(c)
  const semSinal = ctx.semSinal(c)
  const semResposta = r ? r.respondidos === 0 && !r.gerais_respondidas : !itens.some((i) => i.estado !== 'sem_resposta')
  const entrePrazoEFechamento = !!c.prazo && !!c.fechamento && new Date(c.prazo) <= agora && agora < new Date(c.fechamento)
  const podeCobrar = (c.status === 'pronta' || c.status === 'enviada') && entrePrazoEFechamento && semResposta
  const depoisDoFechamento = c.status === 'fechada' || (!!c.fechamento && agora >= new Date(c.fechamento))
  const temPreco = itens.some((i) => i.estado === 'tem')
  const preparadaAgora = ctx.preparadaAqui(c)
  // preparada neste aparelho, mas o código relido é outro (Trocar link, ou Desfazer e Preparar, em outro aparelho): a
  // mensagem guardada aqui leva um link morto e sai da tela; a de agora está em "Não enviada?" ou em "Abrir de novo".
  // (Passado o fechamento, a mensagem daqui também sai, mas sem este aviso: o cartão manda ao "Não enviada?".)
  const refeitaFora = c.status === 'pronta' && s.dados != null && s.dados.codigo !== codigo
  const pedido = s.pedido ?? ctx.pedido(c.id)
  const presos = ctx.preparo?.presos.filter((p) => p.cotacao_id === c.id) ?? []
  const complementar = ctx.preparo?.depois_do_resultado.some((x) => x.cotacao_id === c.id) ?? false
  const temCondicoes = r?.gerais_respondidas ?? [c.pagamento, c.validade, c.pedido_minimo, c.frete, c.entrega, c.observacao].some((x) => x != null)
  const chave = chaveCot(c)
  const link = codigo ? linkCotacao(codigo) : null

  const confirmar = (pergunta: string, f: () => Promise<void>) => { if (window.confirm(pergunta)) void ctx.acao(chave, f) }

  return (
    <div className="secao" data-testid={`cotacao-${c.id}`}>
      <Cabeca c={c} />
      {refeitaFora && (
        <p className="aviso" data-testid="refeita">
          A mensagem foi refeita em outro aparelho: a que estava aqui leva um link que não vale mais
          {semSinal ? '. Use a de "Não enviada?", acima.' : '. Use "Abrir o WhatsApp de novo".'}
        </p>
      )}
      {preparadaAgora ? <EnvioPreparado c={c} v={v} /> : (
        <>
          {semSinal
            ? <div className="sub">{preparadaEm(c, agora)} e sem sinal de envio: veja "Não enviada?" acima.</div>
            : <div className="sub">{situacaoCotacao(c, r, agora)}</div>}
          <div className="sub">{textoPrazo(c)}</div>
        </>
      )}
      {temCondicoes && <Condicoes c={c} />}
      <TabelaRespostas itens={itens} presos={presos} rotulo={rotuloVendedor(v.empresa)} />
      {s.resultado && <p className="aviso" data-testid="resultado">{s.resultado}</p>}
      <Erro c={c} />

      {s.linkNovo && s.linkNovo.codigo && (
        <div className="bloco-envio" data-testid="link-novo">
          <pre className="mensagem">{mensagemLinkNovo(v.nome, s.linkNovo.codigo)}</pre>
          <div className="acoes">
            <LinkWhatsApp numero={v.whatsapp} texto={mensagemLinkNovo(v.nome, s.linkNovo.codigo)}>Abrir WhatsApp com o link novo</LinkWhatsApp>
            <BotoesCopiar mensagem={mensagemLinkNovo(v.nome, s.linkNovo.codigo)} link={linkCotacao(s.linkNovo.codigo)} />
          </div>
        </div>
      )}
      {s.limpar && <LimparRespostas c={c} />}
      {s.obrigado && (
        <div className="bloco-envio" data-testid="obrigado">
          <pre className="mensagem">{mensagemObrigado(v.nome)}</pre>
          <div className="acoes">
            <LinkWhatsApp numero={v.whatsapp} texto={mensagemObrigado(v.nome)}>Abrir WhatsApp com o agradecimento</LinkWhatsApp>
            <BotoesCopiar mensagem={mensagemObrigado(v.nome)} />
          </div>
        </div>
      )}
      {c.resultado === 'pedido' && pedido && d && (
        <div className="bloco-envio" data-testid="mensagem-pedido">
          <pre className="mensagem">{mensagemPedido(d, pedido, c, s.entrega ?? c.entrega)}</pre>
          <div className="acoes">
            <LinkWhatsApp numero={v.whatsapp} texto={mensagemPedido(d, pedido, c, s.entrega ?? c.entrega)}>Abrir WhatsApp com o pedido</LinkWhatsApp>
            <BotoesCopiar mensagem={mensagemPedido(d, pedido, c, s.entrega ?? c.entrega)} />
          </div>
        </div>
      )}
      {c.resultado === 'pedido' && <EntregaNfe cotacao={c.id} vendedor={v} />}

      {aberto === 'digitar' && <DigitarPrecos c={c} onFechar={() => setAberto(null)} />}
      {aberto === 'colar' && <ColarResposta c={c} onFechar={() => setAberto(null)} />}
      {aberto === 'pedido' && <ConfirmarPedido c={c} v={v} onFechar={() => setAberto(null)} />}

      {semResultado && aberto === null && (
        <div className="acoes">
          <button className="botao secundario" disabled={ctx.ocupado} onClick={() => setAberto('digitar')}>Digitar preços</button>
          <button className="botao secundario" disabled={ctx.ocupado} onClick={() => setAberto('colar')}>Colar resposta</button>
          {podeCobrar && (
            <>
              <LinkWhatsApp numero={v.whatsapp} texto={mensagemCobranca(v.nome, c.fechamento!, agora)} secundario>Cobrar no WhatsApp</LinkWhatsApp>
              <BotoesCopiar mensagem={mensagemCobranca(v.nome, c.fechamento!, agora)} link={link} />
            </>
          )}
          {aberta && !semSinal && !preparadaAgora && d && codigo && (
            <>
              <LinkWhatsApp numero={v.whatsapp} texto={mensagemCotacao(d)} secundario>Abrir o WhatsApp de novo</LinkWhatsApp>
              <BotoesCopiar mensagem={mensagemCotacao(d)} link={link} />
            </>
          )}
          {aberta && codigo && (
            <a className="botao secundario" href={linkCotacao(codigo, true)} target="_blank" rel="noopener">Ver como o vendedor vê</a>
          )}
          {/* recém-preparada: a mensagem na tela leva o código do Preparar e o Trocar link o mataria sem trocá-la (o
              caminho ali é "Desfazer (não enviei)" e Preparar de novo); depois do "Já enviei" o Trocar link volta */}
          {aberta && !preparadaAgora && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => confirmar(
              `Trocar o link? O link que o ${v.nome} tem deixa de funcionar (e o de versões anteriores também).`,
              async () => {
                // a mensagem de um Preparar refeito em outro aparelho (se havia) sai de vez, com o aviso dela
                const linkNovo = await api.trocarCodigo(c.id)
                ctx.mudarSessao(c.id, { linkNovo, limpar: true, dados: undefined, saude: undefined, abriu: false })
              })}>Trocar link</button>
          )}
          {daSemana && !semSinal && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chave, async () => { await api.novaVersao(c.id) })}>
              {depoisDoFechamento ? 'Nova versão (prazo novo)' : 'Nova versão'}
            </button>
          )}
          {aberta && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => confirmar(
              perguntaCancelar(c.versao, rotuloVendedor(v.empresa), {
                respondidos: r ? r.respondidos : itens.filter((i) => i.estado !== 'sem_resposta').length,
                condicoes: temCondicoes, substituiVersao: ctx.substituiVersao(c.id), novaVersao: daSemana && !semSinal,
              }),
              () => api.cancelarCotacao(c.id))}>Cancelar cotação</button>
          )}
          {temPreco && (
            <button className="botao" disabled={ctx.ocupado} onClick={() => setAberto('pedido')}>Confirmar pedido com {v.nome}</button>
          )}
          {!semSinal && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => confirmar(
              `Encerrar a cotação com ${v.nome} sem pedido? Ele deixa de conseguir mandar preços pelo link.`,
              async () => { await api.dispensarCotacao(c.id); ctx.mudarSessao(c.id, { obrigado: true }) })}>
              Obrigado, desta vez não
            </button>
          )}
        </div>
      )}
      {!semResultado && daSemana && (complementar || c.resultado === 'pedido') && (
        <div className="acoes">
          {complementar && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chave, async () => { await api.novaVersao(c.id) })}>
              Cotação complementar
            </button>
          )}
          {/* D67: o pedido é gravado antes de o vendedor confirmar; se ele não confirma (ou a quantidade estava errada),
              o pedido volta a ser cotação, e o Ivan refaz o mapa ou toca "Obrigado, desta vez não" */}
          {c.resultado === 'pedido' && (
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => confirmar(
              `Desfazer o pedido com ${v.nome}? Use quando ele não confirmou ou a quantidade estava errada. ` +
              'O pedido some da tela Comprar e da economia, e a cotação volta para você refazer o pedido ou tocar ' +
              `"Obrigado, desta vez não". Se já mandou o pedido no WhatsApp, avise o ${v.nome}.`,
              async () => {
                await api.desfazerPedido(c.id)
                ctx.mudarSessao(c.id, { pedido: undefined, entrega: undefined })
              })}>
              O vendedor não confirmou — desfazer pedido
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function TabelaRespostas({ itens, presos, rotulo }: {
  itens: ItemCotacao[]; presos: { item_semana_id: number; vendedor_novo_id: number | null }[]; rotulo: string
}) {
  const ctx = useCotacoes()
  if (itens.length === 0) return null
  return (
    <div className="rolagem">
      <table className="tabela-cot">
        <thead>
          <tr>
            <th>nº</th><th>Item</th><th>Qtd</th><th>Último R$</th><th>Cotado R$</th><th>Δ%</th><th>Como cotou</th>
            <th>Marca</th><th>Origem</th><th>Avisos</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => {
            const dl = delta(i)
            const preso = presos.find((p) => p.item_semana_id === i.item_semana_id)
            const novo = preso?.vendedor_novo_id != null ? ctx.vendedor(preso.vendedor_novo_id) : undefined
            return (
              <tr key={i.id} data-testid={`item-${i.numero}`}>
                <td>{i.numero}</td>
                <td>
                  {i.nome}
                  <Nota nota={i.nota_vendedor} />
                  {preso && (
                    <div className="sub">
                      {`já está na cotação enviada ao ${rotulo}; nesta semana continua com ele; a partir da próxima vai `}
                      {novo ? `ao ${rotuloVendedor(novo.empresa)}` : 'para Sem vendedor'}
                      {'. Para mudar já, cancele, ou faça Nova versão e desmarque esse item antes de Preparar.'}
                    </div>
                  )}
                </td>
                <td>{dicaEmbalagem(i)}</td>
                <td>{referencia(i)}</td>
                <td>{cotadoSisChef(i)}</td>
                <td className={dl.classe}>{dl.texto}</td>
                <td>{comoCotou(i)}</td>
                <td>{i.marca_informada ?? ''}</td>
                <td>{textoOrigem(i.origem, i.copiada_da_versao)}</td>
                <td>
                  {i.avisos_ivan.map((a) => <span key={a} className="pill">{textoAvisoIvan(a, i)}</span>)}
                  {i.avisos_vendedor.map((a) => <span key={a} className="pill">{textoAvisoVendedor(a)}</span>)}
                  {i.confirmado_pelo_vendedor && <span className="pill ok">vendedor confirmou</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** "boleto 28 d · mín. R$ 300,00 · frete R$ 30,00 · entrega 1 dia · válido até qua 23/09" + a observação, como texto. */
function Condicoes({ c }: { c: Cotacao }) {
  const ctx = useCotacoes()
  const linha = linhaCondicoes(c, ctx.hoje)
  if (!linha && !c.observacao) return null
  return (
    <div className="condicoes" data-testid="condicoes">
      {linha && <div className="sub">{linha}{c.gerais_origem ? ` (${textoOrigem(c.gerais_origem, null)})` : ''}</div>}
      {c.observacao && <div className="observacao">{c.observacao}</div>}
    </div>
  )
}

/** "Preparada às 15h02" (ou "em 23/09 às 15h02"). */
export const preparadaEm = (c: Cotacao, agora: Date) => (c.congelada_em ? `Preparada ${quando(c.congelada_em, agora)}` : 'Preparada')
