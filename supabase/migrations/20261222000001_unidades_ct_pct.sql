-- App de Compras Spazio — a lista de produtos do app passa a aceitar produtos em CT (cento) e PCT (pacote), além de KG e UN (pedido do Ivan, 22/10/2026).
--
-- O caso (cupom da A. N. DA SILVA DESCARTAVEIS, R$ 606,40): os sacos de 1/2 kg e de chope e o garfo JÁ existem no SisChef, mas em CT ("SACO 1/2 KG - C/ 100 UND")
-- e PCT ("GARFO PARA BATATA - PCT 50 UND"). O robô do cadastro lia a unidade no SisChef, e a função produto_cadastro_concluir mandava REVISAR ("a lista do app só
-- aceita KG ou UN"): o produto nunca entrava na lista e o cupom não lançava. O robô do cupom não depende da unidade (só usa a quantidade que entra no estoque e o
-- preço), então só o banco, a função de confirmação do cupom e as telas precisavam aprender CT e PCT.
--
-- O que muda (e só isto):
--   1. produto_planilha.unidade aceita 'KG', 'UN', 'CT' e 'PCT' (era KG e UN).
--   2. produto_cadastro_concluir: o produto que JÁ existia no SisChef em CT ou PCT entra na lista com essa unidade (era REVISAR). Produto CRIADO agora continua tendo
--      de sair do SisChef com a unidade escolhida (KG ou UN: a escolha do app não muda), e qualquer outra unidade (CX, L, FD…) continua REVISAR, com o texto novo.
-- O que NÃO muda: itens_semana (a lista semanal de compra segue em kg/un), produto_cadastro.unidade (a unidade ESCOLHIDA ao cadastrar um produto novo segue KG ou UN)
-- e as permissões. Pode ser reaplicada sem efeito (drop constraint if exists + create or replace).
--
-- COMO DESFAZER: voltar o check para ('KG','UN') (antes, apagar ou corrigir as linhas de produto_planilha com CT/PCT, senão o banco recusa) e reaplicar a função da
-- 20261221000001_produto_cadastro_correcoes.sql.

alter table public.produto_planilha drop constraint if exists produto_planilha_unidade_check;
alter table public.produto_planilha add constraint produto_planilha_unidade_check check (unidade in ('KG', 'UN', 'CT', 'PCT'));

-- A gravação final do cadastro (só o robô, com a service_role): a MESMA da 20261221000001, com a unidade lida aceitando CT e PCT. Devolve o estado em que o pedido ficou.
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
    -- vale sempre a unidade LIDA de volta no SisChef (KG, UN, CT e PCT servem à lista do app); produto criado agora: tem de ser a escolhida (KG ou UN). Sem a
    -- unidade lida não há o que conferir (M6): nunca se confia na escolhida.
    v_un := upper(btrim(coalesce(p_unidade_lida, '')));
    if v_un = '' then
      v_estado := 'REVISAR'; v_motivo := format('unidade lida ausente: confira no SisChef a unidade do produto %s', p_produto_id);
    elsif v_un not in ('KG', 'UN', 'CT', 'PCT') then
      v_estado := 'REVISAR'; v_motivo := format('a unidade do produto no SisChef é %s; a lista do app só aceita KG, UN, CT ou PCT — confira o produto %s no SisChef', v_un, p_produto_id);
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
