-- App de Compras Spazio — correções da gravação final do cadastro de produto pelo app (revisão independente nº 2, 14/10/2026).
--
-- A 20261220000001_produto_cadastro.sql já está aplicada em produção e NÃO é editada: esta migração só ACRESCENTA uma coluna a produto_cadastro (D3) e
-- REESCREVE a função produto_cadastro_concluir, com a MESMA assinatura e as MESMAS permissões (o revoke/grant do fim é repetido de propósito). Pode ser
-- reaplicada sem efeito (add column if not exists, create or replace).
-- O que muda (ids da revisão em v2\REVISAO-2-RELATORIO.md):
--   I3  A planilha já tinha o produto SÓ com a unidade (descrição vazia, o formato da carga de 08/10): o app, a confirmação do cupom e o cot_nfe_associar só
--       aceitam produto fora de itens_semana se a linha da planilha tem descrição, e a tela dizia "entrou na sua lista" sem ser verdade. Agora a descrição
--       vazia é preenchida. A unidade NUNCA é tocada e descrição que já existe NUNCA é sobrescrita.
--   I5  REVISAR guarda o código do produto quando o robô o informa (o produto pode ter sido criado no SisChef e a releitura não bateu): a tela mostra o código.
--   M6  CADASTRADO sem a unidade lida de volta no SisChef vira REVISAR (antes confiava na unidade escolhida, sem conferir nada).
--   M3  Palavras-chave: a mescla compara ENTRADA inteira da lista separada por " OU " (sem diferenciar maiúsculas), não pedaço de texto: "sal" entra mesmo
--       havendo "salsicha"; entrada que já está lá não entra de novo.
--   M4  A auditoria da mudança das palavras diz "via robô: cadastro de produto" (não "via app").
--   D3  produto_cadastro ganha `ultimo_disparo_em` (re-revisão de 14/10): a Edge Function só chama o robô de novo para o pedido parado na fila se o último
--       disparo tem mais de 3 min, e reserva o intervalo ANTES de disparar. Cada disparo na fila compartilhada `sischef-session` pode cancelar o run que
--       outro robô do SisChef deixou esperando; sem esta hora, toques repetidos disparariam várias vezes. Não se usa atualizado_em para isso: ele também
--       conta os 20 min do pedido preso, e mexer nele deixaria o pedido nunca expirar.
-- O resto é o mesmo: unidade só KG/UN; divergência vira REVISAR sem sobrescrever nada; idempotente; atômica; security definer com search_path = public.

-- D3: a hora do último disparo do robô para o pedido. O 1º disparo acontece logo depois do insert (Edge Function), então o default now() vale como a hora
-- dele. A tabela está vazia em produção; `if not exists` deixa a migração reaplicável. As permissões da tabela (só o admin lê; só o servidor escreve) valem
-- para a coluna nova também.
alter table public.produto_cadastro add column if not exists ultimo_disparo_em timestamptz not null default now();

-- A gravação final (só o robô, com a service_role). Devolve o estado em que o pedido ficou.
--   p_estado 'CADASTRADO' | 'JA_EXISTIA' + p_produto_id + p_unidade_lida: grava o produto na planilha (a lista do app) e mescla as palavras-chave.
--   p_estado 'REVISAR' (+ p_motivo e, se houver, p_candidatos e o código do produto): só registra.
-- Idempotente: pedido que já saiu de PENDENTE/PROCESSANDO não muda (devolve o estado atual).
-- Divergências viram REVISAR (nada é sobrescrito): unidade lida ausente, fora de KG/UN ou diferente da escolhida (produto criado agora), produto que a
-- planilha já tem com outra unidade.
create or replace function public.produto_cadastro_concluir(
  p_id uuid, p_estado text, p_produto_id bigint default null, p_motivo text default null,
  p_unidade_lida text default null, p_descricao_lida text default null, p_candidatos jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  r        public.produto_cadastro%rowtype;
  v_estado text := p_estado;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_un     text;
  v_plan   text;
  v_desc   text;
  v_atual  text;
  v_novo   text;
  v_tem    text[];          -- as entradas que o produto já tem (minúsculas, espaço simples)
  v_mais   text[] := '{}';  -- as entradas novas, na ordem e no jeito em que o Ivan as escreveu
  v_ent    text;
  v_via    text;
begin
  if p_estado not in ('CADASTRADO', 'JA_EXISTIA', 'REVISAR') then raise exception 'estado inválido'; end if;
  select * into r from public.produto_cadastro where id = p_id for update;
  if not found then raise exception 'pedido não existe'; end if;
  if r.estado not in ('PENDENTE', 'PROCESSANDO') then return r.estado; end if;   -- já concluído: não muda nada

  if v_estado in ('CADASTRADO', 'JA_EXISTIA') then
    if p_produto_id is null or p_produto_id <= 0 then raise exception 'produto sem código'; end if;
    -- vale sempre a unidade LIDA de volta no SisChef (só KG/UN servem à lista do app); produto criado agora: tem de ser a escolhida. Sem a unidade lida não
    -- há o que conferir (M6): nunca se confia na escolhida.
    v_un := upper(btrim(coalesce(p_unidade_lida, '')));
    if v_un = '' then
      v_estado := 'REVISAR'; v_motivo := format('unidade lida ausente: confira no SisChef a unidade do produto %s', p_produto_id);
    elsif v_un not in ('KG', 'UN') then
      v_estado := 'REVISAR'; v_motivo := format('a unidade do produto no SisChef é %s; a lista do app só aceita KG ou UN — confira o produto %s no SisChef', v_un, p_produto_id);
    elsif v_estado = 'CADASTRADO' and v_un <> r.unidade then
      v_estado := 'REVISAR'; v_motivo := format('o produto %s foi criado no SisChef com a unidade %s (a escolhida era %s) — confira no SisChef', p_produto_id, v_un, r.unidade);
    else
      select unidade into v_plan from public.produto_planilha where produto_id = p_produto_id;
      if found and v_plan <> v_un then
        v_estado := 'REVISAR'; v_motivo := format('a planilha do app já tem o produto %s com a unidade %s e o SisChef diz %s — nada foi alterado', p_produto_id, v_plan, v_un);
      end if;
    end if;
  end if;

  if v_estado in ('CADASTRADO', 'JA_EXISTIA') then
    -- a descrição do SisChef (a lida; sem ela, a do pedido), com espaço simples e até 200 letras
    v_desc := btrim(regexp_replace(coalesce(p_descricao_lida, ''), '\s+', ' ', 'g'));
    if v_desc = '' then v_desc := btrim(regexp_replace(r.descricao, '\s+', ' ', 'g')); end if;
    v_desc := nullif(btrim(left(v_desc, 200)), '');
    -- I3: produto que a planilha não tinha entra com descrição e unidade; o que ela já tinha SÓ com a unidade (descrição vazia para o app: nula, em branco)
    -- ganha a descrição, senão ele não aparece na lista do app. A unidade nunca muda aqui (já conferida acima: é igual) e descrição que existe fica.
    insert into public.produto_planilha as pl (produto_id, descricao, unidade) values (p_produto_id, v_desc, v_un)
      on conflict (produto_id) do update set descricao = excluded.descricao, atualizado_em = now()
      where excluded.descricao is not null and btrim(regexp_replace(coalesce(pl.descricao, ''), '\s+', ' ', 'g')) = '';
    if btrim(coalesce(r.palavras, '')) <> '' then
      select palavras into v_atual from public.cot_produto_busca where produto_id = p_produto_id for update;
      -- M3: a lista é separada por " OU " (o Ivan às vezes escreve " ou "); compara a ENTRADA inteira, sem diferenciar maiúsculas: entra cada entrada
      -- nova uma vez só ("sal" entra mesmo havendo "salsicha"); o que já existia nunca é apagado nem reescrito.
      v_tem := array(select lower(btrim(regexp_replace(e, '\s+', ' ', 'g'))) from regexp_split_to_table(coalesce(v_atual, ''), '(^|\s+)OU(\s+|$)', 'i') as e);
      for v_ent in select btrim(regexp_replace(e, '\s+', ' ', 'g')) from regexp_split_to_table(r.palavras, '(^|\s+)OU(\s+|$)', 'i') as e loop
        if v_ent <> '' and not (lower(v_ent) = any(v_tem)) then
          v_tem := v_tem || lower(v_ent);
          v_mais := v_mais || v_ent;
        end if;
      end loop;
      if cardinality(v_mais) > 0 then
        v_novo := case when coalesce(btrim(v_atual), '') = '' then array_to_string(v_mais, ' OU ') else btrim(v_atual) || ' OU ' || array_to_string(v_mais, ' OU ') end;
        if char_length(v_novo) <= 500 then
          insert into public.cot_produto_busca (produto_id, palavras) values (p_produto_id, v_novo)
            on conflict (produto_id) do update set palavras = excluded.palavras, atualizado_em = now();
          -- M4: quem muda é o robô (não há e-mail na service_role): a auditoria diz "via robô"; o app.via de antes volta logo depois (vale até o fim da transação)
          v_via := current_setting('app.via', true);
          perform set_config('app.via', 'robô: cadastro de produto', true);
          perform public.cot_registrar_mudanca('cot_produto_busca', p_produto_id::text, jsonb_build_object('palavras', v_atual), jsonb_build_object('palavras', v_novo));
          perform set_config('app.via', coalesce(v_via, ''), true);
        end if;   -- não coube nos 500 caracteres: o Ivan edita as palavras do produto (o produto em si já entrou)
      end if;
    end if;
    v_motivo := null;
  end if;

  -- I5: no REVISAR fica também o código do produto quando o robô o informa (o produto pode ter sido criado no SisChef: a tela o mostra para o Ivan
  -- conferir); código que não é positivo é ignorado, para nunca derrubar a gravação do REVISAR (o pedido ficaria PROCESSANDO).
  update public.produto_cadastro
     set estado = v_estado,
         produto_id = case when v_estado = 'REVISAR' then coalesce(case when p_produto_id > 0 then p_produto_id end, produto_id) else p_produto_id end,
         motivo = v_motivo, candidatos = case when v_estado = 'REVISAR' then p_candidatos else null end, atualizado_em = now()
   where id = p_id;
  return v_estado;
end $$;

-- As mesmas permissões da 20261220000001 (o create or replace já as mantém; repetidas para a migração valer sozinha): só a service_role executa.
revoke execute on function public.produto_cadastro_concluir(uuid, text, bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.produto_cadastro_concluir(uuid, text, bigint, text, text, text, jsonb) to service_role;
