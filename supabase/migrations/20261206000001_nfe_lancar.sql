-- App de Compras Spazio — Fase 3, Blocos 2/3: lançar a NF-e pelo app (aba "Lançamento de nota SEFAZ").
--
-- 1) "Como pagar": a forma de pagamento escolhida no app vai junto com o "Lançar" e fica gravada na nota —
--    boleto | dinheiro | tesouraria | cartao | pix:<banco>|<empresa> (as contas do cupom_formas_pagamento.MAPA_PIX;
--    a lista exata é conferida pela Edge Function e pelo robô, aqui só o formato). O robô nunca adivinha a forma.
-- 2) Estado do último disparo, para a aba mostrar e TRAVAR: 'lancando' (a Edge Function lancar-nfe reservou a nota
--    e chamou o robô), 'revisar' (o robô parou ANTES de gerar o pedido: nada foi lançado, com o motivo), 'erro'
--    (pedido JÁ gerado e o robô parou no meio = meio-lançamento: a aba NÃO deixa lançar de novo) e 'ensaio_ok' (o
--    disparo rodou em ensaio porque a trava do real está desligada, com o que o robô faria). Lançada de verdade
--    continua sendo situacao = 'lancada' (cot_nfe_marcar_lancadas).
-- 3) cot_nfe_marcar_estado: o robô (chave anônima + segredo cot_nfe_robo, como as outras 3) grava 'revisar' | 'erro'
--    | 'ensaio_ok' no fim do disparo. É a 4ª função do robô de NF-e para anon — de propósito (testes permissoes/nfe
--    atualizados). A reserva ('lancando' + lancamento_em) continua escrita pela Edge Function com a service_role
--    (passa pela RLS), sem função nova.

alter table public.cot_nfe
  add column if not exists forma_pagamento text
    check (forma_pagamento is null or forma_pagamento ~ '^(boleto|dinheiro|tesouraria|cartao|pix:[a-z]+\|[a-z]+)$'),
  add column if not exists lancamento_estado text
    check (lancamento_estado is null or lancamento_estado in ('lancando', 'revisar', 'erro', 'ensaio_ok')),
  add column if not exists lancamento_motivo text
    check (lancamento_motivo is null or char_length(lancamento_motivo) <= 2000),
  add column if not exists lancamento_estado_em timestamptz;

-- O robô grava o estado do FIM do disparo. Idempotente; ignora chave desconhecida e nota já lançada; devolve quantas
-- mudaram. Só 'revisar' | 'erro' | 'ensaio_ok' ('lancando' é da Edge Function; 'lancada' é cot_nfe_marcar_lancadas).
create or replace function public.cot_nfe_marcar_estado(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  if coalesce(p ->> 'estado', '') not in ('revisar', 'erro', 'ensaio_ok') then
    raise exception 'estado inválido';
  end if;
  update cot_nfe set lancamento_estado = p ->> 'estado',
                     lancamento_motivo = left(nullif(p ->> 'motivo', ''), 2000),
                     lancamento_estado_em = cot_agora(),
                     atualizado_em = cot_agora()
   where chave = p ->> 'chave' and situacao <> 'lancada';
  get diagnostics v = row_count;
  return v;
end $$;

-- Funções: lista completa (igual à da 20261126000001_cadastros_regras + cot_nfe_marcar_estado para anon).
revoke execute on all functions in schema public from public, anon, authenticated;
-- internas sem grant nem para o service_role (§2.2 regra 6a) e a virada (cot_aplicar_cadastros).
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
revoke execute on function public.cot_ia_uso_json(cot_ia_config), public.cot_ia_inteiro_nn(jsonb) from service_role;
revoke execute on function public.cot_nfe_exigir_robo(text), public.cot_nfe_vendedor(text, text),
  public.cot_nfe_casar(text), public.cot_nfe_conferir(text), public.cot_nfe_cnpj_trocar(text, bigint),
  public.cot_nfe_email(text), public.cot_pedido_antes_de_apagar() from service_role;
revoke execute on function public.cot_registrar_mudanca(text, text, jsonb, jsonb),
  public.cot_whatsapp_normalizar(text), public.cot_codigo_novo(text),
  public.cot_contar_aguardando(bigint, bigint), public.lista_incluido(numeric, boolean, jsonb, text) from service_role;
revoke execute on function public.cot_aplicar_cadastros(jsonb) from service_role;
grant execute on function
  public.email_atual(), public.eh_ativo(), public.eh_admin(),
  public.ajustar_item(bigint, numeric, boolean), public.aprovar_semana(bigint), public.encerrar_semana(bigint),
  public.abrir_compra(uuid, bigint, text),
  public.registrar_item(uuid, uuid, bigint, numeric, numeric, text),
  public.desmarcar_item(uuid, bigint),
  public.fechar_compra(uuid, boolean, numeric, text),
  public.cancelar_compra(uuid),
  public.aprovar_compra(uuid), public.marcar_lancada(uuid),
  public.corrigir_item_compra(uuid, numeric, numeric), public.corrigir_compra(uuid, boolean, numeric),
  public.nomes_equipe(),
  public.admin_fechar_compra(uuid, boolean, numeric),
  public.cot_cancelar(bigint), public.cot_confirmar_envio(bigint), public.cot_congelar(bigint),
  public.cot_dados_envio(bigint), public.cot_definir_nota(bigint, text), public.cot_definir_vendedor(bigint, bigint),
  public.cot_descongelar(bigint), public.cot_desfazer_pedido(bigint),
  public.cot_dispensar(bigint), public.cot_gravar_pedido(bigint, jsonb), public.cot_liberar_loja(bigint),
  public.cot_marcar_item(bigint, boolean), public.cot_marcas_semana(bigint), public.cot_nova_versao(bigint),
  public.cot_preparar(bigint), public.cot_responder_admin(bigint, uuid, jsonb, jsonb, text),
  public.cot_trocar_codigo(bigint), public.cot_voltar_a_cotar(bigint),
  public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  public.cot_painel_economia(date, date), public.cot_historico_item(bigint, date, date),
  public.cot_ia_iniciar(bigint, integer, integer, boolean), public.cot_ia_concluir(bigint, jsonb),
  public.cot_ia_gravada(bigint, uuid, jsonb), public.cot_ia_status(), public.cot_ia_ligar(boolean),
  public.cot_pedidos_a_receber(), public.cot_registrar_recebimento(bigint, uuid, timestamptz, jsonb, text, text),
  public.cot_desfazer_recebimento(bigint), public.cot_definir_entrega(bigint, date),
  public.cot_marcar_entrada(bigint, boolean), public.cot_nfe_vincular(text, bigint), public.cot_nfe_desvincular(text),
  public.cot_desempenho_vendedores(), public.cot_cnpj_mover(text, bigint), public.cot_cnpj_remover(text),
  -- Fase 2, C1: cadastros no App (admin)
  public.cot_vendedor_salvar(jsonb), public.cot_vendedor_excluir(bigint),
  public.cot_grafia_salvar(text, bigint), public.cot_grafia_remover(text),
  public.cot_feriado_salvar(date, text), public.cot_feriado_remover(date),
  public.cot_definir_nome(bigint, text), public.cot_definir_litro(bigint, boolean),
  public.cot_confirmar_kg_por_litro(bigint, numeric),
  public.cot_confirmar_fator(bigint, bigint, text, numeric, text, text),
  public.cot_tirar_fator(bigint), public.cot_catalogo_soltar_vendedor(bigint),
  public.cot_produtos_cadastro(), public.cot_fornecedores_sem_vendedor(integer),
  -- Fase 2, C2: regras da lista e fatores a confirmar (admin)
  public.lista_regra_salvar(bigint, text, text), public.lista_regra_remover(bigint),
  public.cot_fatores_a_confirmar(), public.cot_descartar_fator(bigint, bigint, numeric)
  to authenticated;
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  public.cot_nfe_sincronizar(text, jsonb), public.cot_nfe_marcar_notificado(text, text, text, text),
  public.cot_nfe_marcar_lancadas(text, jsonb), public.cot_nfe_marcar_estado(text, jsonb)
  to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_exportar_cadastros()
  to service_role;

-- e_admin() NÃO nasceu em migração do repo (foi criada à mão em produção, junto com as tabelas do cupom) e as policies
-- cupom_sel_admin / cupom_aprend_sel_admin dependem dela. O `revoke ... on all functions` lá em cima a tiraria do
-- authenticated e a tela "Últimos envios" do cupom quebraria ("permission denied for function e_admin"). Devolve o grant
-- só se a função existir (no banco de teste/CI ela não existe — um grant seco falharia).
do $$
begin
  if to_regprocedure('public.e_admin()') is not null then
    grant execute on function public.e_admin() to authenticated;
  end if;
end $$;
