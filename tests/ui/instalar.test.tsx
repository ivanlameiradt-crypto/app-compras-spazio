import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Instalar from '../../src/auth/Instalar'
import type { Aparelho } from '../../src/lib/instalar'

const abrir = (aparelho: Aparelho) =>
  render(
    <MemoryRouter>
      <Instalar aparelho={aparelho} endereco="https://exemplo.test/app/" />
    </MemoryRouter>,
  )

const cartao = (nome: RegExp) => screen.getByRole('group', { name: nome })

describe('Instalar o app', () => {
  it('explica o que é e mostra o endereço do app', () => {
    abrir('computador')
    expect(screen.getByRole('heading', { level: 1, name: 'Instalar o app' })).toBeInTheDocument()
    expect(screen.getByText(/funciona em celular, tablet, notebook e computador/i)).toBeInTheDocument()
    expect(screen.getByText('https://exemplo.test/app/')).toBeInTheDocument()
  })

  it('no iPhone, abre o passo a passo do iPhone e deixa os outros fechados', () => {
    abrir('iphone')
    expect(cartao(/iPhone/)).toHaveAttribute('open')
    expect(within(cartao(/iPhone/)).getByText(/Adicionar à Tela de Início/)).toBeInTheDocument()
    expect(cartao(/Android/)).not.toHaveAttribute('open')
    expect(cartao(/Computador/)).not.toHaveAttribute('open')
    expect(within(cartao(/iPhone/)).getByText('Este aparelho')).toBeInTheDocument()
  })

  it('no Android e no computador, abre o passo a passo certo', () => {
    abrir('android')
    expect(cartao(/Android/)).toHaveAttribute('open')
    expect(cartao(/iPhone/)).not.toHaveAttribute('open')
    expect(within(cartao(/Android/)).getByText(/Instalar app/)).toBeInTheDocument()
  })

  it('no computador, fala do ícone de instalar na barra do endereço', () => {
    abrir('computador')
    expect(cartao(/Computador/)).toHaveAttribute('open')
    expect(within(cartao(/Computador/)).getByText(/ícone de instalar/)).toBeInTheDocument()
  })

  it('link aberto dentro do WhatsApp ou do Instagram: avisa para abrir no navegador', () => {
    abrir('dentro_de_outro_app')
    expect(screen.getByText(/dentro de outro aplicativo/i)).toBeInTheDocument()
    expect(screen.getByText(/Abrir no navegador/)).toBeInTheDocument()
  })

  it('app já instalado: diz que já está instalado', () => {
    abrir('instalado')
    expect(screen.getByText(/já está instalado neste aparelho/i)).toBeInTheDocument()
  })

  it('o botão Voltar leva para a tela inicial', () => {
    abrir('computador')
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', '/')
  })

  it('o convite do navegador vira o botão "Instalar agora" e abre a pergunta do navegador uma vez só', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    abrir('android')
    expect(screen.queryByRole('button', { name: 'Instalar agora' })).not.toBeInTheDocument()
    const convite = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
    window.dispatchEvent(convite)
    const botao = await screen.findByRole('button', { name: 'Instalar agora' })
    await userEvent.click(botao)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Instalar agora' })).not.toBeInTheDocument()
  })
})
