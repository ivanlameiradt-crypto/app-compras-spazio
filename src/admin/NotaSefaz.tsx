// Aba "Lançamento de nota SEFAZ" — casca da Fase 3. A parte funcional (listar as notas pendentes da SEFAZ,
// botão "Lançar" uma/todas, status e aprendizado dos itens) vem depois, reusando o monitor de notas e o motor.
export default function NotaSefaz() {
  return (
    <section className="coluna">
      <h2>Lançamento de nota SEFAZ</h2>
      <div className="cartao">
        <p className="nome">Em breve</p>
        <p className="sub">
          Aqui vão aparecer as notas de compra que chegam da SEFAZ, prontas pra lançar no SisChef — cada uma
          com um botão “Lançar” (e um “Lançar todas”), mais o status de cada lançamento, igual ao cupom.
        </p>
        <p className="sub">Esta parte está sendo construída na próxima fase.</p>
      </div>
    </section>
  )
}
