# Passagem — lançar NF-e pelo app (Fase 3) · 06/10/2026

Para a sessão que continua este trabalho (nuvem). O dono é o Ivan (Spazio Gourmet / Kūkan): **não é técnico** — fale simples,
relatórios em HTML com 1–2 linhas no chat, e nunca peça para ele colar segredos no chat.

## Contexto
- **App:** `ivanlameiradt-crypto/app-compras-spazio` (React/TS/Vite PWA; push na `main` publica no GitHub Pages pelo
  `publicar.yml`, que roda `npm test`). Supabase: projeto `ebghyejkwqebwhxcnlqx`.
- **Robô:** `ivanlameiradt-crypto/sischef-monitor-notas` (privado, Python, GitHub Actions, branch padrão `master`).
- **1º lançamento real (OLINDA, 05-06/10):** o robô gerou a compra (estoque 30 KG + 3 boletos certos) mas deu ERRO "falso"
  na leitura do sucesso; a NF foi gerada à mão. **Fato corrigido:** o "Forma pagamento --" da tela era o rótulo atrasado da
  conta — o pagamento estava certo; o único bug era a leitura do sucesso (nessa tela aparece "já foi gerado uma Compra").
- Revisão de código de 06/10 (15 achados confirmados) virou o Bloco 1.

## Onde está cada coisa
### Robô — Bloco 1: PR #28 (`fase3-bloco1-robo-seguro`) — CI verde, pronto para juntar
Sucesso reconhecido até Gerar NF + Finalizar; travas ANTES do SisChef (forma de pagamento escolhida — nunca o padrão
"dinheiro"; conta especial KONDO/MERCADO LIVRE; todo item associado no SisChef; CÓD. FOR legível); snapshot do de-para
um por item (leitor `app_merge.extrair_cod_forn`), nunca vindo do disparo; marca "lançada" durável (falha = ERRO alto);
aviso do desfecho (e-mail sempre, WhatsApp quando precisa de ação); cliente que confere o segredo antes do SisChef;
vigia do PC espera `lancar-cupom.yml`/`lancar-nfe.yml`; passo com limite de 15 min. 2374 testes verdes.
- **Falta:** uma revisão independente final (a 1ª travou) e então **juntar no master**.
- **Depois de juntar:** a pasta do robô no PC do Ivan (`OneDrive/claude nuvem/sischef-monitor-notas`, no `master`) precisa de
  `git pull` — o populador do PC roda dela (vigia novo). Só dá para fazer no PC. **Nunca trocar de branch nessa pasta.**

### App — Blocos 2+3: branch `fase3-bloco2-lancar` (feita a partir de `fase3-passo4`)
- `20261205000001_nfe_lancamento.sql` — coluna `lancamento_em` (**já aplicada em produção**).
- `20261206000001_nfe_lancar.sql` — **NÃO aplicada ainda**: colunas `forma_pagamento`, `lancamento_estado`
  ('lancando'|'revisar'|'erro'|'ensaio_ok'), `lancamento_motivo`, `lancamento_estado_em`; função do robô
  `cot_nfe_marcar_estado(p_segredo, p jsonb)` (anon + segredo `cot_nfe_robo`, como as outras 3), com a lista completa de
  grants reaplicada no fim. Testes: `nfe.test.ts` 38 verdes; `permissoes` e `fase2-base` verdes (as 2 migrações da Fase 3
  registradas em `ORDEM_ESPERADA`; `DO_ROBO_NFE` com 4).
- `supabase/functions/lancar-nfe/` — `logica.ts` (admin, forma, reserva compara-e-troca: livre/'revisar'/'ensaio_ok' ou
  'lancando' preso > 30 min; **'erro' nunca**; solta a reserva se o disparo falhar) + `index.ts` (dispara `lancar-nfe.yml`
  com `{nota_json, modo:'real'}`; a trava `MOTOR_NFE_LIGADO` do robô decide se é real) — 25 testes verdes.
- A suíte inteira do app leva mais de 20 min no Windows; rodar por arquivo ou deixar o CI rodar.

## O que falta, em ordem
1. **Robô — informar o estado no fim do disparo** (`ClienteCotNfe.marcar_estado` → `cot_nfe_marcar_estado`):
   REVISAR/PULADA → 'revisar'; ERRO → 'erro'; ENSAIO_OK → 'ensaio_ok' (motivo = o que faria); FALHA (antes do resultado =
   nada criado) → 'revisar'. Também no ENSAIO (é o que a aba mostra antes de ligar o real). Best-effort: nunca derruba o run
   (a função só existe depois da migração). Motivo com espaços colapsados, até 2000 caracteres. Testes. (Pode entrar no
   PR #28 antes de juntar, ou num PR novo.)
2. **App — a aba** (`src/admin/NotaSefaz.tsx`, `src/lib/api.ts`, `src/lib/tipos.ts`, `tests/ui/nota-sefaz.test.tsx`):
   por nota a lançar, "Como pagar" (Boleto **marcado por padrão** / Dinheiro / Tesouraria / PIX — as 7 contas de
   `src/cupom/formasPagamento.ts` no formato `pix:<banco>|<empresa>` / Cartão = só estoque); botão **Lançar**
   (`supabase.functions.invoke('lancar-nfe', {body:{chave, forma}})`); status: lançando… / precisa de você (motivo) /
   pela metade (erro — **não deixa lançar**) / ensaio ok (o que faria). Bloquear com aviso claro: item sem produto no
   SisChef (`produto_id` vazio ou `associacao = 'painel'`) e conta especial (emitente com KONDO ou MERCADO LIVRE).
   Traduzir "sem boletos na nota — pagamento manual" → "A nota não tem boleto: escolha como pagar". Recarregar a cada
   ~15 s enquanto houver 'lancando'. `COLUNAS_NOTA` e os tipos com os campos novos e `itens[].associacao`.
3. **Publicar:** aplicar `20261206000001` no Supabase; publicar a Edge Function `lancar-nfe` (o `GITHUB_PAT` já existe nos
   secrets das Edge Functions — o da `enviar-cupom`; conferir que alcança o repo do robô). PR do app → `main`. Avisar o Ivan
   para fechar e reabrir o app (PWA).
4. **Teste com o Ivan olhando (Bloco 4):** com a trava `MOTOR_NFE_LIGADO` **desligada**, apertar Lançar numa nota boa → roda
   ENSAIO → a aba mostra "ensaio ok". Depois, com o Ivan acompanhando: ligar a trava
   (`gh secret set MOTOR_NFE_LIGADO --body ON`), lançar **uma** nota real, conferir no SisChef (estoque, boletos, NF) e
   **desligar a trava** logo depois. Hoje a única nota na fila é a **SEARA**, com o item **sem associação** — o Ivan precisa
   associar no SisChef antes, ou esperar uma nota nova.
5. **Manutenção (Bloco 5):** ligar o horário automático do `sincronizar-nfe.yml` (hoje só manual; o grupo `sischef-session`
   guarda só 1 run pendente); renovar o `GITHUB_PAT` antes de **27/10** (o Ivan faz, guiado).

## Regras que não podem ser quebradas
- O robô da NF-e **nunca** usa a service_role — só a chave anônima + o segredo `cot_nfe_robo`. A reserva é feita pela Edge
  Function com a service_role.
- Lançamento real só com a **trava dupla** (`modo=real` E `MOTOR_NFE_LIGADO=ON`); fora do teste supervisionado ela fica OFF.
- Nunca adivinhar forma de pagamento nem unidade.
- Função nova no Supabase: reaplicar a lista completa de grants no fim da migração e declará-la nos testes
  (`permissoes`/`nfe`).
- Mudança em produção (migração, Edge Function, merge) só dentro do plano que o Ivan aprovou ("execute as etapas").
