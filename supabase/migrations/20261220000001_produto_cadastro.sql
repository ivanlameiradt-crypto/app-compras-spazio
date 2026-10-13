-- App de Compras Spazio — cadastro de PRODUTO novo pelo app (pedido do Ivan, 13/10/2026).
--
-- O produto de um cupom, de uma nota fiscal ou de uma compra avulsa não existe na lista do app nem no SisChef: o Ivan confere o nome, escolhe o grupo e a unidade (KG ou UN, as
-- únicas que a planilha do app aceita) e toca em "Cadastrar no SisChef e no app". O robô cria o produto no SisChef (Produtos/Taxas › Produtos › Novo) e grava o resultado AQUI.
--
-- produto_cadastro: um pedido por toque (estado PENDENTE -> PROCESSANDO -> CADASTRADO | JA_EXISTIA | REVISAR). No máximo UM pedido em andamento por nome normalizado (toque duplo,
-- duas abas, retry). Só o admin LÊ (RLS); quem escreve é o servidor (Edge Function cadastrar-produto e o robô, com a service_role).
-- produto_cadastro_concluir: a gravação final, ATÔMICA e idempotente: o produto entra na planilha de produtos (a lista do app) e as palavras-chave são mescladas, na MESMA transação
-- em que o pedido vira CADASTRADO/JA_EXISTIA; nunca sobrescreve a unidade nem as palavras que já existiam (divergência vira REVISAR).

create table public.produto_cadastro (
  id            uuid primary key default gen_random_uuid(),
  descricao     text not null check (char_length(btrim(descricao)) between 1 and 200),
  chave_nome    text not null check (char_length(chave_nome) between 1 and 200),
  grupo         text not null check (char_length(btrim(grupo)) between 1 and 120),
  unidade       text not null check (unidade in ('KG', 'UN')),
  palavras      text check (palavras is null or char_length(palavras) <= 500),
  origem        text not null check (origem in ('cupom', 'nota', 'avulsa')),
  origem_id     text check (origem_id is null or char_length(origem_id) <= 80),
  origem_item   integer check (origem_item is null or origem_item >= 0),
  forcar        boolean not null default false,
  existente_id  bigint check (existente_id is null or existente_id > 0),
  estado        text not null default 'PENDENTE' check (estado in ('PENDENTE', 'PROCESSANDO', 'CADASTRADO', 'JA_EXISTIA', 'REVISAR')),
  motivo        text check (motivo is null or char_length(motivo) <= 1000),
  produto_id    bigint check (produto_id is null or produto_id > 0),
  candidatos    jsonb check (candidatos is null or jsonb_typeof(candidatos) = 'array'),
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- nunca "pronto" sem o código do produto (a tela precisa dele para o "Usar este produto")
  constraint produto_cadastro_pronto_com_id check (estado not in ('CADASTRADO', 'JA_EXISTIA') or produto_id is not null)
);

create unique index produto_cadastro_em_andamento on public.produto_cadastro (chave_nome) where estado in ('PENDENTE', 'PROCESSANDO');
create index produto_cadastro_nome on public.produto_cadastro (chave_nome, criado_em desc);

alter table public.produto_cadastro enable row level security;
create policy produto_cadastro_ler on public.produto_cadastro for select to authenticated using (eh_admin());

revoke all on public.produto_cadastro from public, anon, authenticated;
grant select on public.produto_cadastro to authenticated;
grant all on public.produto_cadastro to service_role;

-- A gravação final (só o robô, com a service_role). Devolve o estado em que o pedido ficou.
--   p_estado 'CADASTRADO' | 'JA_EXISTIA' + p_produto_id: grava o produto na planilha (a lista do app) e mescla as palavras-chave.
--   p_estado 'REVISAR' (+ p_motivo e, se houver, p_candidatos): só registra.
-- Idempotente: pedido que já saiu de PENDENTE/PROCESSANDO não muda (devolve o estado atual).
-- Divergências viram REVISAR (nada é sobrescrito): unidade lida no SisChef que não é KG/UN ou é diferente da escolhida (produto criado agora), produto que a planilha já tem
-- com outra unidade.
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
begin
  if p_estado not in ('CADASTRADO', 'JA_EXISTIA', 'REVISAR') then raise exception 'estado inválido'; end if;
  select * into r from public.produto_cadastro where id = p_id for update;
  if not found then raise exception 'pedido não existe'; end if;
  if r.estado not in ('PENDENTE', 'PROCESSANDO') then return r.estado; end if;   -- já concluído: não muda nada

  if v_estado in ('CADASTRADO', 'JA_EXISTIA') then
    if p_produto_id is null or p_produto_id <= 0 then raise exception 'produto sem código'; end if;
    -- produto criado agora: a unidade lida de volta no SisChef tem de ser a escolhida; produto que já existia: vale a do SisChef (só KG/UN servem à lista do app)
    v_un := upper(btrim(coalesce(p_unidade_lida, case when v_estado = 'CADASTRADO' then r.unidade else '' end)));
    if v_un not in ('KG', 'UN') then
      v_estado := 'REVISAR'; v_motivo := format('a unidade do produto no SisChef é %s; a lista do app só aceita KG ou UN — confira o produto %s no SisChef', coalesce(nullif(v_un, ''), '?'), p_produto_id);
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
    v_desc := left(regexp_replace(btrim(coalesce(nullif(btrim(p_descricao_lida), ''), r.descricao)), '\s+', ' ', 'g'), 200);
    insert into public.produto_planilha (produto_id, descricao, unidade) values (p_produto_id, v_desc, v_un) on conflict (produto_id) do nothing;
    if btrim(coalesce(r.palavras, '')) <> '' then
      select palavras into v_atual from public.cot_produto_busca where produto_id = p_produto_id for update;
      if v_atual is null or position(lower(btrim(r.palavras)) in lower(v_atual)) = 0 then
        v_novo := case when coalesce(btrim(v_atual), '') = '' then btrim(r.palavras) else btrim(v_atual) || ' OU ' || btrim(r.palavras) end;
        if char_length(v_novo) <= 500 then
          insert into public.cot_produto_busca (produto_id, palavras) values (p_produto_id, v_novo)
            on conflict (produto_id) do update set palavras = excluded.palavras, atualizado_em = now();
          perform public.cot_registrar_mudanca('cot_produto_busca', p_produto_id::text, jsonb_build_object('palavras', v_atual), jsonb_build_object('palavras', v_novo));
        end if;   -- não coube nos 500 caracteres: o Ivan edita as palavras do produto (o produto em si já entrou)
      end if;
    end if;
    v_motivo := null;
  end if;

  update public.produto_cadastro
     set estado = v_estado, produto_id = case when v_estado = 'REVISAR' then produto_id else p_produto_id end,
         motivo = v_motivo, candidatos = case when v_estado = 'REVISAR' then p_candidatos else null end, atualizado_em = now()
   where id = p_id;
  return v_estado;
end $$;

revoke execute on function public.produto_cadastro_concluir(uuid, text, bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.produto_cadastro_concluir(uuid, text, bigint, text, text, text, jsonb) to service_role;
