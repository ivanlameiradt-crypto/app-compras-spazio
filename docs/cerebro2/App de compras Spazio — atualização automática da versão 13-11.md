Assunto: [[10 Assuntos/App de compras Spazio]]

# App de compras Spazio — atualização automática da versão: nunca recarrega sozinho em uso (13/11/2026)

**Pedido do Ivan (13/11/2026):** o app não pode exigir "feche e abra a aba" a cada novidade, e também não pode recarregar sozinho e apagar o que a pessoa digita, um lançamento ou uma compra em andamento.

**Como é (PR 89, squash `49eeeaf`, no ar na versão `mwf1u66z`):**
- O app confere pela rede qual versão está no ar (`version.json`): na abertura, a cada 1 minuto com a aba visível, ao voltar do fundo e quando a internet volta.
- **Com o app em uso:** só aparece a faixa "Tem uma versão nova do app." com o botão "Atualizar" (botão de 44 px, margens seguras do celular, `role="status"`). Nunca recarrega sozinho. Isso inclui voltar do fundo (antes recarregava depois de 30 s fora).
- **Só na abertura do app:** troca sozinha UMA vez, mas só se a internet responder em até 3 s e a pessoa ainda não tiver tocado nem digitado nada; senão aparece a faixa.
- **O plugin de PWA (`registerType: 'autoUpdate'`) recarregava a página sozinho quando o service worker novo assumia;** agora o `registerSW` recebe `onNeedReload: aoServiceWorkerNovoAssumir`, que só confere a versão e mostra a faixa. Um teste (`tests/unit/mainSemRecargaSozinha.test.ts`) falha se essa ligação sumir.
- Não há tela só de exibição no Comprar.

**Como desfazer:** reverter o commit `49eeeaf` na `main` (PR de reversão); o fluxo "Publicar app" publica de novo. Nada de banco.

**Revisão:** duas rodadas de revisão independente (resultado final "Sim"); mutações provadas; conferido num navegador de verdade (faixa em 38 s com o app em uso, sem recarregar; volta do fundo depois de 33 s sem recarregar; clique em Atualizar mantém a tela; abertura troca uma vez só).
