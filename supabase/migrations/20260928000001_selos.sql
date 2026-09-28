-- App de Compras Spazio — Fase 1A (robô → App): selos "conferir", custo médio, fechar compra pelo
-- admin e permissões alinhadas com o padrão do Supabase.

-- ================= Colunas novas da lista
-- selos: [{codigo, texto}] calculados pelo robô (item com selo chega desmarcado, na aba Conferir).
-- custo_medio: coluna O da planilha; 0 ou ausente = sem referência (null).
alter table public.itens_semana
  add column selos jsonb not null default '[]'::jsonb check (jsonb_typeof(selos) = 'array'),
  add column custo_medio numeric check (custo_medio is null or custo_medio > 0);

-- ================= importar_semana (robô, chave de serviço)
-- Mudanças em relação à 0002: lê selos e custo_medio (ausentes = sem selo e null, então o payload
-- antigo continua valendo); preço e custo 0 viram null em vez de derrubar a importação; selo fora do
-- formato recusa tudo; item com selo chega fora da lista (o "Incluir" do App repõe qtd_sugerida).
-- Toda resposta (criada, substituida e também ja_aprovada) traz "selos": true: o importar_semana da 0002
-- ignora selos e custo_medio em silêncio e responde sem essa chave, então o robô sabe, pela falta dela,
-- que está falando com o banco antigo (a lista teria entrado sem a aba Conferir). Vai também no
-- ja_aprovada para a resposta do banco novo ser uniforme: a chave identifica o banco, não o resultado.
create or replace function public.importar_semana(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_data   date := (p ->> 'data_referencia')::date;
  v_id     bigint;
  v_status text;
  v_item   jsonb;
  v_selo   jsonb;
begin
  if v_data is null then
    raise exception 'data_referencia obrigatória';
  end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'lista de itens vazia';
  end if;

  -- selos: lista (ou ausente/null = sem selo) de objetos {codigo conhecido, texto de 1 a 200 caracteres}.
  -- Qualquer selo fora disso recusa a importação inteira (tudo ou nada, como o resto do payload).
  for v_item in select e from jsonb_array_elements(p -> 'itens') as e loop
    if coalesce(jsonb_typeof(v_item -> 'selos'), 'null') not in ('array', 'null') then
      raise exception 'selos do produto % precisam ser uma lista', v_item ->> 'produto_id';
    end if;
    for v_selo in
      select s from jsonb_array_elements(case when jsonb_typeof(v_item -> 'selos') = 'array'
                                              then v_item -> 'selos' else '[]'::jsonb end) as s
    loop
      if jsonb_typeof(v_selo) is distinct from 'object'
         or jsonb_typeof(v_selo -> 'codigo') is distinct from 'string'
         or (v_selo ->> 'codigo') not in ('linha_alta', 'bebida_negativa', 'preco_fora', 'fracao_un')
         or jsonb_typeof(v_selo -> 'texto') is distinct from 'string'
         or char_length(v_selo ->> 'texto') not between 1 and 200 then
        raise exception 'selo inválido no produto %: %', v_item ->> 'produto_id', left(v_selo::text, 120);
      end if;
    end loop;
  end loop;

  select id, status into v_id, v_status from semanas where data_referencia = v_data for update;
  if v_id is not null and v_status <> 'rascunho' then
    return jsonb_build_object('resultado', 'ja_aprovada', 'semana_id', v_id, 'selos', true);
  end if;

  if v_id is null then
    insert into semanas (data_referencia) values (v_data) returning id into v_id;
  else
    delete from itens_semana where semana_id = v_id;
    update semanas set gerada_em = now() where id = v_id;
  end if;

  insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, estoque_minimo,
                            qtd_sugerida, qtd_aprovada, preco_estimado, custo_medio, data_ultima_compra,
                            fornecedor_ultima, situacao, negativo, incluido, selos)
  select v_id, x.produto_id, x.produto, x.bebida,
         case when x.produto ~* '\(\s*KG\s*\)' then 'kg' else 'un' end,
         x.estoque, coalesce(x.estoque_minimo, 0), x.qtd_sugerida,
         case when i.incluido then x.qtd_sugerida else 0 end,
         case when x.preco_estimado > 0 then x.preco_estimado end,
         case when x.custo_medio > 0 then x.custo_medio end,
         x.data_ultima_compra, x.fornecedor_ultima, x.situacao,
         n.negativo, i.incluido, n.selos
    from jsonb_to_recordset(p -> 'itens') as x(
           produto_id bigint, produto text, bebida boolean, estoque numeric, estoque_minimo numeric,
           qtd_sugerida numeric, preco_estimado numeric, custo_medio numeric, data_ultima_compra date,
           fornecedor_ultima text, situacao text, selos jsonb)
    cross join lateral (
      select (not x.bebida and x.situacao = 'ESTOQUE NEGATIVO') as negativo, -- insumo negativo: aba Negativos
             case when jsonb_typeof(x.selos) = 'array' then x.selos else '[]'::jsonb end as selos
    ) n
    cross join lateral (
      select (x.qtd_sugerida > 0 and not n.negativo and jsonb_array_length(n.selos) = 0) as incluido
    ) i;

  return jsonb_build_object('resultado', case when v_status is null then 'criada' else 'substituida' end,
                            'semana_id', v_id, 'itens', jsonb_array_length(p -> 'itens'), 'selos', true);
end $$;

-- ================= admin_fechar_compra: compra aberta esquecida por um comprador trava o encerrar
-- (e, sem encerrar, a aprovação da semana nova). cancelar_compra recusa compra com item marcado e
-- fechar_compra só aceita o próprio comprador; aqui o admin fecha a compra de outra pessoa com os itens
-- já marcados, com as mesmas exigências do fechar_compra (0004), e ela segue para a fila de lançamento.
-- Devolve true quando esta chamada fechou a compra; false quando ela já estava fechada (o comprador fechou
-- entre o admin abrir a tela e confirmar, ou reenvio): aí nada muda e a tela avisa que valem os valores dele.
create or replace function public.admin_fechar_compra(p_compra uuid, p_com_nota boolean, p_total numeric)
returns boolean
language plpgsql security definer set search_path = public as $$
declare c compras; v_antes jsonb; v_depois jsonb;
begin
  perform exigir_admin();
  select * into c from compras where id = p_compra for update;
  if not found then
    raise exception 'compra não encontrada';
  end if;
  if c.status <> 'aberta' then
    return false; -- já fechada (reenvio, ou o comprador fechou antes): idempotente, nada muda
  end if;
  if not exists (select 1 from compras_itens where compra_id = p_compra) then
    raise exception 'compra sem itens: use Cancelar';
  end if;
  if p_com_nota is null then
    raise exception 'informe se a compra foi com nota ou sem nota';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'informe o total pago';
  end if;
  v_antes := to_jsonb(c);
  -- foto_cupom fica como está (em geral vazia): o App não tem como o admin anexar a foto do cupom, e o
  -- corrigir_compra de Lançamentos só corrige o com/sem nota e o total, não a foto
  update compras x set status = 'fechada', com_nota = p_com_nota, total_pago = p_total, fechada_em = now()
   where x.id = p_compra
  returning to_jsonb(x) into v_depois;
  -- historico_alteracoes não tem coluna de observação: o motivo vai dentro de 'depois'
  insert into historico_alteracoes (quem, tabela, registro, antes, depois)
  values (email_atual(), 'compras', p_compra::text, v_antes,
          v_depois || jsonb_build_object('motivo', 'fechada pelo admin: compra aberta impedia encerrar a semana'));
  return true;
end $$;

-- ================= Permissões
-- Tabelas: o Supabase dá por padrão a anon e authenticated todos os privilégios em toda tabela e
-- sequência nova de public (a 0001 só revogava de anon). Leitura continua pela RLS; escrita, só pelas
-- funções. A única tabela gravada direto pelo App é usuarios (tela Pessoas; a RLS exige admin).
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
-- MAINTAIN (VACUUM, ANALYZE, CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE) só existe do Postgres 17 em
-- diante, e lá o 'grant all' padrão o inclui; no 15 'revoke maintain' daria erro, daí o bloco condicional.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- Funções (reaplica tudo: o Supabase libera funções novas por padrão). exigir_ativo, exigir_admin e
-- minha_compra_aberta ficam sem grant: só são chamadas de dentro das funções security definer.
revoke execute on all functions in schema public from public, anon, authenticated;
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
  public.admin_fechar_compra(uuid, boolean, numeric)
  to authenticated;
grant execute on function public.importar_semana(jsonb) to service_role;
