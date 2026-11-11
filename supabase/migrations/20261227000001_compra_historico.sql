-- App de Compras Spazio — histórico de compras do SisChef no banco do app (11/11/2026).
--
-- O QUE MUDA (só cria objetos novos; nada que já existe é alterado)
--   1) Tabela compra_historico_produto: um produto do SisChef (produto_id) com nome, unidade, grupo e o dia em que o robô o viu (visto_em).
--   2) Tabela compra_historico: as últimas compras de cada produto como o SisChef mostra (até ~17): data, fornecedor, referência do pedido, quantidade,
--      preço unitário e custo líquido ("Custo unt. total"); pos = a ordem da linha dentro do produto (1 = a primeira que o robô mandou).
--   3) compra_historico_exigir_robo(segredo): interna; confere o segredo PRÓPRIO do Vault 'compra_historico_robo' (não é o cot_nfe_robo).
--   4) compra_historico_gravar(segredo, produtos): o robô grava um lote de produtos em ESPELHO (para cada produto do lote, as linhas antigas saem e entram
--      as do lote). Devolve quantos produtos gravou.
--
-- POR QUÊ
--   Um robô externo já lê o histórico de compras de cada produto no SisChef. Guardado aqui, o app calcula quanto comprar (src/lib/sugestaoCompra.ts) sem
--   abrir o SisChef. O SisChef mostra só as últimas compras: por isso cada leitura SUBSTITUI as linhas do produto (espelho), em vez de acumular.
--
-- REGRAS DE GRAVAÇÃO (compra_historico_gravar)
--   • p_produtos = lista de {produto_id, nome, unidade, grupo, visto_em, linhas}; linhas = lista de [data, fornecedor, referência, qtd, preço unitário,
--     custo líquido]. Só produto_id e linhas são obrigatórios (linhas pode vir vazia: o produto fica sem compras).
--   • Confere TUDO antes de gravar (tudo ou nada): item inválido derruba o lote INTEIRO com mensagem em português. Produto repetido no lote também derruba.
--   • Limites por chamada: 200 produtos e 60 linhas por produto. Lote vazio ('[]') devolve 0 e só confere o segredo.
--   • Produto que não vem no lote não é tocado.
--
-- QUEM FAZ O QUÊ
--   compra_historico_gravar é do robô: chave anônima + segredo compra_historico_robo; executa só para anon (authenticated e o público não).
--   As 2 tabelas: só o admin LÊ (RLS, eh_admin()); anon e authenticated NÃO escrevem direto; a chave de serviço pode tudo.
--   Antes do 1º uso, alguém cria o segredo no Vault (vault.create_secret(<valor>, 'compra_historico_robo')) e põe o MESMO valor no robô. Sem o segredo,
--   a função recusa tudo ("não autorizado").
--
-- COMO DESFAZER (as funções primeiro, depois as tabelas; apagar as tabelas PERDE o histórico guardado — o robô consegue ler de novo no SisChef)
--   drop function if exists public.compra_historico_gravar(text, jsonb), public.compra_historico_exigir_robo(text);
--   drop table if exists public.compra_historico, public.compra_historico_produto;

create table public.compra_historico_produto (
  produto_id    bigint primary key check (produto_id > 0),
  nome          text check (nome is null or char_length(nome) <= 200),
  unidade       text check (unidade is null or char_length(unidade) <= 10),
  grupo         text check (grupo is null or char_length(grupo) <= 120),
  visto_em      date,
  atualizado_em timestamptz not null default now()
);

create table public.compra_historico (
  id            uuid primary key default gen_random_uuid(),
  produto_id    bigint not null references public.compra_historico_produto (produto_id) on delete cascade,
  data          date not null,
  fornecedor    text not null check (char_length(fornecedor) between 1 and 200),
  referencia    text check (referencia is null or char_length(referencia) <= 200),
  qtd           numeric not null check (qtd > 0),
  preco_unit    numeric not null check (preco_unit >= 0),
  custo_liquido numeric not null check (custo_liquido >= 0),
  pos           integer not null check (pos >= 1),
  constraint compra_historico_pos_unica unique (produto_id, pos)
);
create index compra_historico_produto_data on public.compra_historico (produto_id, data);

alter table public.compra_historico_produto enable row level security;
alter table public.compra_historico enable row level security;
create policy compra_historico_produto_sel_admin on public.compra_historico_produto for select to authenticated using (eh_admin());
create policy compra_historico_sel_admin on public.compra_historico for select to authenticated using (eh_admin());

-- Só leitura para o admin logado (a RLS acima restringe a eh_admin()); anon nada; escrita só pela função abaixo e pela chave de serviço.
revoke all on public.compra_historico_produto, public.compra_historico from public, anon, authenticated;
grant select on public.compra_historico_produto, public.compra_historico to authenticated;
grant all on public.compra_historico_produto, public.compra_historico to service_role;

-- Interna: igual à cot_nfe_exigir_robo, com o segredo próprio deste robô. Nunca aceita vazio = vazio.
create or replace function public.compra_historico_exigir_robo(p_segredo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_segredo text;
begin
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'compra_historico_robo';
  if v_segredo is null or v_segredo = '' or p_segredo is null or p_segredo = '' or p_segredo <> v_segredo then
    raise exception 'não autorizado';
  end if;
end $$;

-- Lê uma data 'AAAA-MM-DD' de verdade (31/02 não passa); devolve null se não for. Interna.
create or replace function public.compra_historico_data(p jsonb) returns date
language plpgsql immutable set search_path = public as $$
declare v text; d date;
begin
  if jsonb_typeof(p) is distinct from 'string' then return null; end if;
  v := p #>> '{}';
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  begin
    d := v::date;
  exception when others then
    return null;
  end;
  if to_char(d, 'YYYY-MM-DD') <> v then return null; end if;
  return d;
end $$;

-- Lê um número JSON (não texto) >= 0; devolve null se não for. Interna.
create or replace function public.compra_historico_numero(p jsonb) returns numeric
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric >= 0 then (p #>> '{}')::numeric end
$$;

-- O robô grava um lote de produtos em espelho (ver o cabeçalho). Devolve quantos produtos gravou.
create or replace function public.compra_historico_gravar(p_segredo text, p_produtos jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it     jsonb;
  ln     jsonb;
  i      int := 0;
  j      int;
  v_ids  bigint[] := '{}';
  v_prod bigint;
  v_txt  text;
  v_data date;
  v_forn text;
  v_ref  text;
  v_qtd  numeric;
  v_preco numeric;
  v_custo numeric;
  v_linhas jsonb;
  v_lote jsonb := '[]'::jsonb;   -- produtos já conferidos e normalizados
begin
  perform compra_historico_exigir_robo(p_segredo);
  if jsonb_typeof(p_produtos) is distinct from 'array' then
    raise exception 'histórico de compras inválido: esperava uma lista (array) de produtos';
  end if;
  if jsonb_array_length(p_produtos) > 200 then
    raise exception 'histórico de compras inválido: lote com mais de 200 produtos';
  end if;

  -- 1) conferência de TODOS os produtos e linhas (nada é gravado se algum estiver fora do formato)
  for it in select value from jsonb_array_elements(p_produtos) loop
    i := i + 1;
    if jsonb_typeof(it) is distinct from 'object' then
      raise exception 'histórico de compras inválido (produto %): o produto precisa ser um objeto', i;
    end if;
    v_txt := case when jsonb_typeof(it -> 'produto_id') = 'number' then it ->> 'produto_id' else '' end;
    v_prod := case when v_txt ~ '^[0-9]{1,18}$' then v_txt::bigint end;
    if v_prod is null or v_prod < 1 then
      raise exception 'histórico de compras inválido (produto %): produto_id precisa ser um número inteiro maior que 0', i;
    end if;
    if v_prod = any(v_ids) then
      raise exception 'histórico de compras inválido (produto %): produto_id % repetido no lote', i, v_prod;
    end if;
    v_ids := v_ids || v_prod;
    if it ? 'visto_em' and jsonb_typeof(it -> 'visto_em') <> 'null' and compra_historico_data(it -> 'visto_em') is null then
      raise exception 'histórico de compras inválido (produto %): visto_em precisa ser uma data AAAA-MM-DD', i;
    end if;
    foreach v_txt in array array['nome', 'unidade', 'grupo'] loop
      if it ? v_txt and jsonb_typeof(it -> v_txt) not in ('string', 'null') then
        raise exception 'histórico de compras inválido (produto %): % precisa ser texto', i, v_txt;
      end if;
    end loop;
    if char_length(coalesce(it ->> 'nome', '')) > 200 or char_length(btrim(coalesce(it ->> 'unidade', ''))) > 10
       or char_length(coalesce(it ->> 'grupo', '')) > 120 then
      raise exception 'histórico de compras inválido (produto %): nome, unidade ou grupo grande demais', i;
    end if;
    if jsonb_typeof(it -> 'linhas') is distinct from 'array' then
      raise exception 'histórico de compras inválido (produto %): linhas precisa ser uma lista', i;
    end if;
    if jsonb_array_length(it -> 'linhas') > 60 then
      raise exception 'histórico de compras inválido (produto %): mais de 60 linhas', i;
    end if;

    j := 0;
    v_linhas := '[]'::jsonb;
    for ln in select value from jsonb_array_elements(it -> 'linhas') loop
      j := j + 1;
      if jsonb_typeof(ln) is distinct from 'array' or jsonb_array_length(ln) <> 6 then
        raise exception 'histórico de compras inválido (produto %, linha %): a linha precisa ter 6 campos', i, j;
      end if;
      v_data := compra_historico_data(ln -> 0);
      if v_data is null then
        raise exception 'histórico de compras inválido (produto %, linha %): data precisa ser AAAA-MM-DD', i, j;
      end if;
      v_forn := case when jsonb_typeof(ln -> 1) = 'string' then btrim(ln ->> 1, E' \t\r\n') else '' end;
      if v_forn = '' or char_length(v_forn) > 200 then
        raise exception 'histórico de compras inválido (produto %, linha %): fornecedor é obrigatório (até 200 caracteres)', i, j;
      end if;
      if jsonb_typeof(ln -> 2) not in ('string', 'null') or char_length(coalesce(ln ->> 2, '')) > 200 then
        raise exception 'histórico de compras inválido (produto %, linha %): referência precisa ser texto (até 200 caracteres)', i, j;
      end if;
      v_ref := nullif(btrim(coalesce(ln ->> 2, ''), E' \t\r\n'), '');
      v_qtd := compra_historico_numero(ln -> 3);
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'histórico de compras inválido (produto %, linha %): quantidade precisa ser um número maior que 0', i, j;
      end if;
      v_preco := compra_historico_numero(ln -> 4);
      if v_preco is null then
        raise exception 'histórico de compras inválido (produto %, linha %): preço unitário precisa ser um número (0 ou mais)', i, j;
      end if;
      v_custo := compra_historico_numero(ln -> 5);
      if v_custo is null then
        raise exception 'histórico de compras inválido (produto %, linha %): custo líquido precisa ser um número (0 ou mais)', i, j;
      end if;
      v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('data', v_data, 'fornecedor', v_forn, 'referencia', v_ref,
        'qtd', v_qtd, 'preco_unit', v_preco, 'custo_liquido', v_custo, 'pos', j));
    end loop;

    v_lote := v_lote || jsonb_build_array(jsonb_build_object(
      'produto_id', v_prod,
      'nome', nullif(btrim(coalesce(it ->> 'nome', ''), E' \t\r\n'), ''),
      'unidade', nullif(upper(btrim(coalesce(it ->> 'unidade', ''), E' \t\r\n')), ''),
      'grupo', nullif(btrim(coalesce(it ->> 'grupo', ''), E' \t\r\n'), ''),
      'visto_em', compra_historico_data(it -> 'visto_em'),
      'linhas', v_linhas));
  end loop;

  -- 2) gravação em espelho, produto a produto
  for it in select value from jsonb_array_elements(v_lote) loop
    v_prod := (it ->> 'produto_id')::bigint;
    insert into compra_historico_produto as p (produto_id, nome, unidade, grupo, visto_em, atualizado_em)
    values (v_prod, it ->> 'nome', it ->> 'unidade', it ->> 'grupo', (it ->> 'visto_em')::date, cot_agora())
    on conflict (produto_id) do update set
      nome = excluded.nome, unidade = excluded.unidade, grupo = excluded.grupo, visto_em = excluded.visto_em, atualizado_em = excluded.atualizado_em;
    delete from compra_historico where produto_id = v_prod;
    insert into compra_historico (produto_id, data, fornecedor, referencia, qtd, preco_unit, custo_liquido, pos)
    select v_prod, (l ->> 'data')::date, l ->> 'fornecedor', l ->> 'referencia', (l ->> 'qtd')::numeric, (l ->> 'preco_unit')::numeric,
           (l ->> 'custo_liquido')::numeric, (l ->> 'pos')::int
      from jsonb_array_elements(it -> 'linhas') as l;
  end loop;
  return jsonb_array_length(v_lote);
end $$;

-- Só o robô (anon + segredo) executa a gravação; as internas, ninguém de fora.
revoke execute on function public.compra_historico_gravar(text, jsonb), public.compra_historico_exigir_robo(text),
  public.compra_historico_data(jsonb), public.compra_historico_numero(jsonb) from public, anon, authenticated;
grant execute on function public.compra_historico_gravar(text, jsonb) to anon;
