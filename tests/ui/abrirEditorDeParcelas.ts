import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Espera o editor de parcelas e, se a pergunta "Quantos boletos tem esta nota?" (27/11) estiver na frente, escolhe "Prefiro digitar as parcelas". */
export async function abrirEditorDeParcelas() {
  const editor = await screen.findByTestId('editor-parcelas')
  const digitar = screen.queryByTestId('quantos-digitar')
  if (digitar) await userEvent.click(digitar)
  return editor
}
