-- App de Compras Spazio — Fase 2, Bloco D2: a falta definitiva volta para a loja (D.5.6).
-- Desenho: compra-semanal/docs/DESIGN-fase-2.md, D.5.6 — a fonte da verdade.
-- Quarta migration da Fase 2 (Onda 2, depois do piloto). Só reescreve a cot_marcas (interna, sem grant),
-- partindo da versão da 1B (base abaixo), e reaplica o bloco de permissões completo. Nenhuma outra função
-- muda (teste fase2-base.test.ts, X2). É a primeira reescrita da cot_marcas; a A reescreve depois, a partir
-- desta versão, aplicando a mesma regra por vendedor.
--
-- base: cot_marcas=md5:4adae03406ea0f8379c350036c8fdb4e (prosrc da 1B, antes da D2; conferido no fase2-base.test.ts)

-- Etiquetas para Comprar e Resumo (contrato 4.15). Igual à 1B, com uma mudança na regra 1 (pedido): na semana
-- em compra, a quantidade coberta pelo pedido para o produto passa a ser a soma da qtd do pedido MENOS a
-- falta_definitiva do item (D.5.6: a última entrega que registrou falta nele disse "não vem mais"). Se o
-- resultado for 0 ou menos, o item fica sem etiqueta (o resto vai para a loja pela regra do App). É por item:
-- o item que ainda vem não muda, mesmo que outro item do mesmo pedido não venha mais. Sem item com "não vem
-- mais", o resultado é idêntico ao da 1B (falta_definitiva = 0). Fora de em_compra, nada muda (a falta
-- definitiva só vale na semana em compra).
create or replace function public.cot_marcas(p_semana bigint)
returns table(item_semana_id bigint, estado text, vendedor_id bigint, vendedor text, ate timestamptz, qtd numeric)
language sql stable set search_path = public as $$
  with s as (select x.*, x.status = 'em_compra' as em_compra, cot_aguardando_ate(x.id) as ate from semanas x where x.id = p_semana),
  m as (select * from cot_mapa(p_semana)),
  at as (select * from cot_atravessando(p_semana)),
  ped as (
    -- por (cotação, produto): a quantidade é a soma das linhas do pedido dela para o produto, menos a falta
    -- definitiva do item (na semana em compra); a falta definitiva vem da cot_conferencia (D.5.2)
    select (e ->> 'produto_id')::bigint as produto_id, c.vendedor_id, p.confirmado_em, c.id as cotacao_id,
           sum((e ->> 'qtd')::numeric) as qtd, coalesce(max(cf.falta_definitiva), 0) as falta_def
      from cot_cotacoes c join cot_pedidos p on p.cotacao_id = c.id
      cross join lateral jsonb_array_elements(p.itens) e
      left join cot_conferencia cf on cf.cotacao_id = c.id and cf.produto_id = (e ->> 'produto_id')::bigint
     where c.semana_id = p_semana and c.resultado = 'pedido'
     group by 1, 2, 3, 4
    union all
    select a.produto_id, a.vendedor_id, a.confirmado_em, a.cotacao_id, sum((e ->> 'qtd')::numeric),
           coalesce(max(cf.falta_definitiva), 0)
      from (select distinct x.produto_id, x.vendedor_id, x.confirmado_em, x.cotacao_id from at x where x.tipo = 'pedido') a
      join cot_pedidos p on p.cotacao_id = a.cotacao_id
      cross join lateral jsonb_array_elements(p.itens) e
      left join cot_conferencia cf on cf.cotacao_id = a.cotacao_id and cf.produto_id = a.produto_id
     where (e ->> 'produto_id')::bigint = a.produto_id
     group by 1, 2, 3, 4
  ),
  emc as (
    select x.item_semana_id, null::bigint as produto_id, c.id as cotacao_id, c.vendedor_id,
           case when x.estado = 'tem' and x.tenho_so < x.qtd then x.tenho_so else x.qtd end as qtd
      from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
     where c.semana_id = p_semana and x.incluido and cot_eh_viva(c) and cot_com_sinal(c)
       and x.estado <> 'nao_tem' and (cot_agora() < c.fechamento or x.estado = 'tem')
    union all
    select null::bigint, x.produto_id, c.id, c.vendedor_id,
           case when x.estado = 'tem' and x.tenho_so < x.qtd then x.tenho_so else x.qtd end
      from (select distinct a.cotacao_id from at a where a.tipo = 'em_cotacao') a
      join cot_cotacoes c on c.id = a.cotacao_id
      join cot_itens x on x.cotacao_id = c.id and x.incluido
     where x.estado <> 'nao_tem' and (cot_agora() < c.fechamento or x.estado = 'tem')
  ),
  r as (
    select m.item_semana_id, pd.vendedor_id as v_pedido, pd.qtd as q_pedido, pd.falta_def as fd_pedido,
           ec.vendedor_id as v_cotacao, ec.qtd as q_cotacao,
           case when m.dono is not null
                 and exists (select 1 from cot_vendedores v where v.id = m.dono and v.ativo)
                 and not exists (select 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = m.dono
                                    and (cot_saiu(c) or c.status = 'liberada'))
                 and not exists (select 1 from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
                                  where x.item_semana_id = m.item_semana_id and not x.incluido and c.vendedor_id = m.dono
                                    and (c.status = 'rascunho' or cot_pronta_sem_sinal(c)))
                then m.dono end as v_aguardando
      from m
      left join lateral (select p.vendedor_id, p.qtd, p.falta_def from ped p where p.produto_id = m.produto_id
                          order by p.confirmado_em desc, p.cotacao_id desc limit 1) pd on true
      left join lateral (select x.vendedor_id, x.qtd from emc x
                          where x.item_semana_id = m.item_semana_id or x.produto_id = m.produto_id
                          order by x.cotacao_id limit 1) ec on true
  ),
  e as (
    select r.item_semana_id,
           (case when s.em_compra then r.q_pedido - coalesce(r.fd_pedido, 0) else r.q_pedido end) as q_pedido_final,
           case when r.v_pedido is not null and (not s.em_compra or r.q_pedido - coalesce(r.fd_pedido, 0) > 0) then 'pedido'
                when s.em_compra and r.v_cotacao is not null then 'em_cotacao'
                when s.em_compra and r.v_aguardando is not null and s.ate is not null and cot_agora() < s.ate
                  then 'aguardando_cotacao' end as estado,
           r.v_pedido, r.v_cotacao, r.q_cotacao, r.v_aguardando, s.ate
      from r cross join s
  )
  select e.item_semana_id, e.estado, v.id, cot_rotulo(v.empresa),
         case when e.estado = 'aguardando_cotacao' then e.ate end,
         case e.estado when 'pedido' then e.q_pedido_final when 'em_cotacao' then e.q_cotacao end
    from e
    join cot_vendedores v on v.id = case e.estado when 'pedido' then e.v_pedido when 'em_cotacao' then e.v_cotacao
                                                  else e.v_aguardando end
   where e.estado is not null
   order by e.item_semana_id
$$;

-- ================= Permissões (bloco completo, reaplicado; contas iguais às da D1 — §8.6)

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
              public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
              public.cot_nfe_leituras,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
              public.cot_conferencia, public.cot_desempenho
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_categorias,
                public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
                public.cot_nfe_leituras,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
                public.cot_conferencia
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos, public.cot_categorias,
             public.cot_pedidos_acomp, public.cot_recebimentos, public.cot_fornecedores_cnpj, public.cot_nfe,
             public.cot_nfe_leituras,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia, public.cot_economia_linhas,
             public.cot_conferencia, public.cot_desempenho
  to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on function public.cot_m_json(bigint, bigint, bigint, bigint, numeric, numeric) from service_role;
revoke execute on function public.cot_nfe_exigir_robo(text) from service_role;
revoke execute on function public.cot_nfe_vendedor(text, text) from service_role;
revoke execute on function public.cot_nfe_casar(text) from service_role;
revoke execute on function public.cot_nfe_conferir(text) from service_role;
revoke execute on function public.cot_nfe_cnpj_trocar(text, bigint) from service_role;
revoke execute on function public.cot_nfe_email(text) from service_role;
revoke execute on function public.cot_pedido_antes_de_apagar() from service_role;
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
  public.cot_pedidos_a_receber(), public.cot_registrar_recebimento(bigint, uuid, timestamptz, jsonb, text, text),
  public.cot_desfazer_recebimento(bigint), public.cot_definir_entrega(bigint, date),
  public.cot_marcar_entrada(bigint, boolean), public.cot_nfe_vincular(text, bigint), public.cot_nfe_desvincular(text),
  public.cot_desempenho_vendedores(), public.cot_cnpj_mover(text, bigint), public.cot_cnpj_remover(text)
  to authenticated;
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb),
  public.cot_nfe_sincronizar(text, jsonb), public.cot_nfe_marcar_notificado(text, text, text, text),
  public.cot_nfe_marcar_lancadas(text, jsonb)
  to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_aplicar_cadastros(jsonb)
  to service_role;
