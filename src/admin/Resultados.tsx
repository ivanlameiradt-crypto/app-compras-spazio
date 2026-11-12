// Aba "Resultados" do menu Compra (etapa 5 do redesenho, 12/11/2026): junta as telas Resumo (a semana, com o "Encerrar semana") e Economia
// (o painel de economia dos pedidos) numa só. A aba vem da URL (/resultados?aba=economia), então as rotas antigas /resumo e /economia
// só redirecionam para cá. Resumo e Economia não escrevem título próprio: o único título é o "Resultados" daqui.
import { useSearchParams } from 'react-router-dom'
import TituloDaTela from '../components/TituloDaTela'
import Resumo from './Resumo'
import Economia from './Economia'

type Aba = 'semana' | 'economia'
const ABAS: readonly { chave: Aba; rotulo: string }[] = [
  { chave: 'semana', rotulo: 'Semana' },
  { chave: 'economia', rotulo: 'Economia' },
]

export default function Resultados() {
  const [params, setParams] = useSearchParams()
  // qualquer valor que não seja "economia" (inclusive nenhum) abre a Semana
  const aba: Aba = params.get('aba') === 'economia' ? 'economia' : 'semana'
  // replace: trocar de aba não enche o histórico; "voltar" sai da tela
  const escolher = (a: Aba) => setParams(a === 'economia' ? { aba: 'economia' } : {}, { replace: true })
  return (
    <section>
      <TituloDaTela>Resultados</TituloDaTela>
      <div className="chips abas-resultados" role="tablist" aria-label="Resultados">
        {ABAS.map((a) => (
          <button key={a.chave} type="button" role="tab" aria-selected={aba === a.chave}
            className={`chip${aba === a.chave ? ' ativo' : ''}`} onClick={() => escolher(a.chave)}>{a.rotulo}</button>
        ))}
      </div>
      {aba === 'economia' ? <Economia /> : <Resumo />}
    </section>
  )
}
