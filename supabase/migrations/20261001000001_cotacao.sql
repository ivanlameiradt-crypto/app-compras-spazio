-- App de Compras Spazio — Fase 1B: cotação com vendedores pelo WhatsApp.
-- Desenho: compra-semanal/docs/DESIGN-cotacao-fornecedores.md (v3.4), seção 7 ("a spec").
-- Nomes, formatos JSON e códigos de erro exatos: compra-semanal/docs/contrato-1b.md, versão 2, emendada em
-- 28/09 ("o contrato"; D1… são os desvios numerados na seção 12 dele).
-- Tudo em public com prefixo cot_; RLS ligado e leitura só para o admin (eh_admin()); escrita só pelas
-- funções abaixo. Relógio de negócio = cot_agora() (os testes a trocam); fuso sempre explícito
-- (America/Sao_Paulo), nunca o TimeZone da sessão (UTC no Supabase, o do computador no pglite).

-- ================= Tabelas

-- Vendedor = uma pessoa com WhatsApp comercial. O telefone fica no banco para a aba Cotações montar o
-- wa.me em qualquer aparelho do Ivan; só o admin lê a tabela e nenhuma função do vendedor o devolve.
create table public.cot_vendedores (
  id        bigint generated always as identity primary key,
  codigo    text not null unique check (codigo ~ '^[a-z0-9_]{1,30}$'),
  nome      text not null check (char_length(nome) between 1 and 60),
  empresa   text not null check (char_length(empresa) between 1 and 80),
  whatsapp  text not null check (whatsapp ~ '^55[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$'),
  ativo     boolean not null default true
);

-- Uma linha por grafia e filial do fornecedor, como vem no SisChef e na NF (nome sempre normalizado).
create table public.cot_fornecedores (
  nome_normalizado  text primary key,
  nome_original     text not null,
  vendedor_id       bigint not null references public.cot_vendedores (id)
);

-- Propriedades do produto para a cotação. vendedor_id null = a linha guarda só propriedades (nome,
-- litro); o vendedor sai da última compra (D35).
create table public.cot_catalogo (
  produto_id                  bigint primary key,
  vendedor_id                 bigint references public.cot_vendedores (id),
  origem                      text not null check (origem in ('seed', 'ivan', 'ultima_compra')),
  nome_para_vendedor          text check (nome_para_vendedor is null or char_length(nome_para_vendedor) between 1 and 80),
  embalagem                   text check (embalagem in ('fardo', 'caixa', 'pacote', 'saco')),
  fator                       numeric check (fator > 0),          -- un ou kg do SisChef por embalagem
  fator_confirmado_em         timestamptz,                        -- null = não confirmado pelo Ivan
  vende_por_litro             boolean not null default false,
  kg_por_litro                numeric check (kg_por_litro > 0),
  kg_por_litro_confirmado_em  timestamptz,
  descricao_fornecedor        text,
  codigo_fornecedor           text,
  descricao_de_fornecedor     text,                               -- nome normalizado do fornecedor da NF-e
  -- nota do Ivan ao vendedor (marca aceita, embalagem). Preferência do Ivan sobre o produto: não é zerada
  -- ao trocar o vendedor (D49)
  nota_vendedor               text check (nota_vendedor is null or (char_length(nota_vendedor) between 1 and 80
                                            and nota_vendedor !~ '[\x01-\x1F\x7F\u0080-\u009F]')),
  atualizado_em               timestamptz not null default now(),   -- data da escolha do vendedor (a nota não mexe)
  check (fator_confirmado_em is null or fator is not null),
  check (kg_por_litro_confirmado_em is null or kg_por_litro is not null)
);

create table public.cot_feriados (
  data  date primary key,
  nome  text not null
);

-- Último hash aplicado de cada linha dos CSVs: um push que não mexeu na linha nunca a reaplica por cima
-- de uma escolha feita no App.
create table public.cot_cadastros_aplicados (
  arquivo      text not null check (arquivo in ('vendedores', 'fornecedores', 'catalogo', 'feriados')),
  chave        text not null,
  hash_linha   text not null,
  aplicado_em  timestamptz not null default now(),
  primary key (arquivo, chave)
);

create table public.cot_cotacoes (
  id                        bigint generated always as identity primary key,
  semana_id                 bigint not null references public.semanas (id),
  vendedor_id               bigint not null references public.cot_vendedores (id),
  versao                    int not null check (versao >= 1),
  complementar              boolean not null default false,
  status                    text not null default 'rascunho' check (status in
                              ('rascunho', 'pronta', 'enviada', 'respondida', 'fechada', 'substituida', 'cancelada', 'liberada')),
  resultado                 text check (resultado in ('pedido', 'dispensado')),
  substituida_por           bigint references public.cot_cotacoes (id),   -- D1: a versão que a substituiu
  codigo_hash               bytea unique,                                  -- sha256 do código do link
  congelada_em              timestamptz,
  enviada_em                timestamptz,
  fechada_em                timestamptz,
  prazo                     timestamptz,
  fechamento                timestamptz,
  primeiro_acesso           timestamptz,
  ultimo_acesso             timestamptz,
  acessos                   int not null default 0,
  abrir_janela_inicio       timestamptz,
  abrir_na_janela           int not null default 0,
  envios_aceitos            int not null default 0,                        -- só envios do vendedor
  ultimo_envio_em           timestamptz,                                   -- último envio aceito do vendedor
  tentativas_janela_inicio  timestamptz,
  tentativas_na_janela      int not null default 0,
  pagamento                 text,
  validade                  date,
  pedido_minimo             numeric,                                       -- 0 = sem mínimo
  frete                     numeric,                                       -- 0 = grátis
  entrega                   text,
  observacao                text,
  gerais_rev                int not null default 0,
  gerais_origem             text check (gerais_origem in ('vendedor', 'ivan_digitou', 'ivan_colou')),
  respostas_rev             int not null default 0,                        -- +1 a cada gravação de item
  notificado_hash           text,
  notificado_em             timestamptz,                                   -- D2
  cobranca_em               timestamptz,
  consolidado_em            timestamptz,
  consolidado_rev           int,
  unique (semana_id, vendedor_id, versao),
  check (resultado is null or status = 'fechada'),
  check ((status in ('rascunho', 'liberada')) = (congelada_em is null)),
  check (status in ('rascunho', 'liberada') or (prazo is not null and fechamento is not null)),
  check (status not in ('rascunho', 'liberada') or codigo_hash is null)
);
-- No máximo um rascunho (ou "Comprar na loja", D20) e uma versão viva por semana e vendedor.
create unique index cot_cotacoes_um_rascunho on public.cot_cotacoes (semana_id, vendedor_id)
  where status in ('rascunho', 'liberada');
create unique index cot_cotacoes_uma_viva on public.cot_cotacoes (semana_id, vendedor_id)
  where status in ('pronta', 'enviada', 'respondida') or (status = 'fechada' and resultado is null);
create index on public.cot_cotacoes (semana_id);

-- Texto do código (só o admin lê: serve para remontar o link em qualquer aparelho do Ivan). O vendedor é
-- achado só pelo hash.
create table public.cot_codigos (
  cotacao_id  bigint primary key references public.cot_cotacoes (id) on delete cascade,
  codigo      text not null unique check (codigo ~ '^[A-Za-z0-9_-]{32}$')
);

create table public.cot_itens (
  id                        bigint generated always as identity primary key,
  cotacao_id                bigint not null references public.cot_cotacoes (id) on delete cascade,
  item_semana_id            bigint not null references public.itens_semana (id),
  produto_id                bigint not null,
  numero                    int check (numero >= 1),
  incluido                  boolean not null default true,
  nome                      text not null,
  unidade                   text not null check (unidade in ('kg', 'un')),
  rotulo                    text not null check (rotulo in ('un', 'kg', 'saco')),
  vende_por_litro           boolean not null default false,
  qtd                       numeric not null check (qtd > 0),
  qtd_sugerida              numeric not null default 0,
  embalagem                 text,
  fator                     numeric,
  fator_confirmado          boolean not null default false,
  kg_por_litro              numeric,                       -- só se confirmado no catálogo
  descricao_fornecedor      text,                          -- só se o fornecedor da descrição é deste vendedor
  codigo_fornecedor         text,
  nota_vendedor             text,                          -- retrato da nota do catálogo, fixo a partir do congelamento
  ref_preco                 numeric,                       -- referência: só para o Ivan
  ref_data                  date,
  ref_situacao              text check (ref_situacao in ('ok', 'antiga', 'sem_referencia')),
  estado                    text not null default 'sem_resposta' check (estado in ('sem_resposta', 'tem', 'nao_tem')),
  preco_digitado            numeric(12, 2),
  base                      text check (base in ('un', 'kg', 'litro', 'embalagem')),
  emb_unidades              int,
  emb_gramas                numeric,
  emb_ml                    numeric,
  fator_informado           numeric,                       -- un ou kg por embalagem (null para litro)
  preco_convertido          numeric(12, 4),                -- R$ por un ou kg do SisChef
  tenho_so                  numeric,
  similar_desc              text,
  similar_preco             numeric(12, 2),
  a_partir_de               numeric,
  marca_informada           text check (marca_informada is null or char_length(marca_informada) between 1 and 60), -- D50
  avisos_vendedor           text[] not null default '{}',
  avisos_ivan               text[] not null default '{}',
  confirmado_pelo_vendedor  boolean not null default false,
  origem                    text check (origem in ('vendedor', 'ivan_digitou', 'ivan_colou')),
  copiada_da_versao         int,
  respondido_em             timestamptz,
  rev                       int not null default 0,
  unique (cotacao_id, produto_id),
  unique (cotacao_id, numero),
  check (numero is null or incluido),
  check (estado <> 'tem' or (preco_digitado is not null and base is not null)),
  check (estado = 'tem' or marca_informada is null)
);
create index on public.cot_itens (item_semana_id);
create index on public.cot_itens (produto_id); -- cotação que atravessa a semana (D43) busca por produto

-- Envios aceitos (vendedor ou Ivan): o resultado devolvido, para o reenvio idempotente.
create table public.cot_envios (
  envio_id     uuid primary key,
  cotacao_id   bigint not null references public.cot_cotacoes (id) on delete cascade,
  origem       text not null check (origem in ('vendedor', 'ivan_digitou', 'ivan_colou')),
  recebido_em  timestamptz not null,
  resultado    jsonb not null
);

create table public.cot_pedidos (
  cotacao_id      bigint primary key references public.cot_cotacoes (id),
  confirmado_por  text not null references public.usuarios (email),
  confirmado_em   timestamptz not null,
  itens           jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0)
);

-- Baldes das funções anônimas (sem semente: cot_contar_limite faz upsert).
create table public.cot_limites (
  balde          text primary key check (balde in ('invalidos', 'validos')),
  janela_inicio  timestamptz not null,
  chamadas       int not null default 0
);

-- E-mail "Cotações ainda não enviadas" (D41): uma vez por vendedor e semana.
create table public.cot_avisos (
  semana_id    bigint not null references public.semanas (id),
  vendedor_id  bigint not null references public.cot_vendedores (id),
  tipo         text not null check (tipo in ('preparar')),
  enviado_em   timestamptz not null,
  primary key (semana_id, vendedor_id, tipo)
);

-- ================= Views (security_invoker: a RLS de admin das tabelas vale para quem lê)

create view public.cot_itens_admin with (security_invoker = true) as
select i.*,
       case when i.estado = 'tem' and i.preco_convertido is not null and i.ref_preco > 0
                 and i.ref_situacao in ('ok', 'antiga')
            then round(i.preco_convertido / i.ref_preco - 1, 4) end as delta
  from public.cot_itens i;

-- Totais só sobre itens "tem" com referência ok e preço convertido (D10): cotado × último no mesmo conjunto.
create view public.cot_resumo with (security_invoker = true) as
select c.id as cotacao_id,
       (count(i.id) filter (where i.incluido))::int as itens,
       (count(i.id) filter (where i.incluido and i.estado <> 'sem_resposta'))::int as respondidos,
       (count(i.id) filter (where i.incluido and i.estado = 'tem'))::int as tem,
       (count(i.id) filter (where i.incluido and i.estado = 'nao_tem'))::int as nao_tem,
       (count(i.id) filter (where i.incluido and i.estado = 'tem' and i.tenho_so is not null and i.tenho_so < i.qtd))::int as parciais,
       (count(i.id) filter (where i.incluido and i.estado = 'tem' and i.ref_situacao = 'ok'
                              and i.preco_convertido is not null and i.ref_preco > 0))::int as com_referencia,
       round(coalesce(sum(i.qtd * i.preco_convertido) filter (where i.incluido and i.estado = 'tem' and i.ref_situacao = 'ok'
                              and i.preco_convertido is not null and i.ref_preco > 0), 0), 2) as total_cotado,
       round(coalesce(sum(i.qtd * i.ref_preco) filter (where i.incluido and i.estado = 'tem' and i.ref_situacao = 'ok'
                              and i.preco_convertido is not null and i.ref_preco > 0), 0), 2) as total_ultimo,
       (c.pagamento is not null or c.validade is not null or c.pedido_minimo is not null or c.frete is not null
          or c.entrega is not null or c.observacao is not null) as gerais_respondidas
  from public.cot_cotacoes c
  left join public.cot_itens i on i.cotacao_id = c.id
 group by c.id;

-- Economia do pedido contra o último preço (ajuste Foozi 2): uma linha por semana com pedido. Linha do pedido
-- comparável = preço convertido não nulo e o item da cotação com referência ok e último preço > 0; as outras
-- (antiga, sem referência, litro sem conversão) contam à parte, fora das somas. O acumulado "desde o piloto"
-- é a soma das diferenças, feita pelo App.
create view public.cot_economia with (security_invoker = true) as
select s.id as semana_id,
       s.data_referencia,
       (count(distinct c.id))::int as pedidos,
       (count(*))::int as itens_pedido,
       (count(*) filter (where k.comparavel))::int as itens_com_referencia,
       (count(*) filter (where not k.comparavel))::int as itens_sem_comparacao,
       round(coalesce(sum(l.qtd * l.preco_convertido) filter (where k.comparavel), 0), 2) as total_pedido,
       round(coalesce(sum(l.qtd * i.ref_preco) filter (where k.comparavel), 0), 2) as total_ultimo,
       round(coalesce(sum(l.qtd * l.preco_convertido) filter (where k.comparavel), 0), 2)
         - round(coalesce(sum(l.qtd * i.ref_preco) filter (where k.comparavel), 0), 2) as diferenca
  from public.cot_pedidos p
  join public.cot_cotacoes c on c.id = p.cotacao_id
  join public.semanas s on s.id = c.semana_id
  cross join lateral jsonb_to_recordset(p.itens) as l(produto_id bigint, qtd numeric, preco_convertido numeric)
  left join public.cot_itens i on i.cotacao_id = c.id and i.produto_id = l.produto_id
  cross join lateral (
    select coalesce(l.preco_convertido is not null and i.ref_situacao = 'ok' and i.ref_preco > 0, false) as comparavel
  ) k
 group by s.id, s.data_referencia;

-- ================= RLS: leitura só do admin; nenhuma política de escrita (escrita só pelas funções)
alter table public.cot_vendedores enable row level security;
alter table public.cot_fornecedores enable row level security;
alter table public.cot_catalogo enable row level security;
alter table public.cot_feriados enable row level security;
alter table public.cot_cadastros_aplicados enable row level security;
alter table public.cot_cotacoes enable row level security;
alter table public.cot_codigos enable row level security;
alter table public.cot_itens enable row level security;
alter table public.cot_envios enable row level security;
alter table public.cot_pedidos enable row level security;
alter table public.cot_limites enable row level security;
alter table public.cot_avisos enable row level security;

create policy cot_vendedores_ler on public.cot_vendedores for select to authenticated using (eh_admin());
create policy cot_fornecedores_ler on public.cot_fornecedores for select to authenticated using (eh_admin());
create policy cot_catalogo_ler on public.cot_catalogo for select to authenticated using (eh_admin());
create policy cot_feriados_ler on public.cot_feriados for select to authenticated using (eh_admin());
create policy cot_cotacoes_ler on public.cot_cotacoes for select to authenticated using (eh_admin());
create policy cot_codigos_ler on public.cot_codigos for select to authenticated using (eh_admin());
create policy cot_itens_ler on public.cot_itens for select to authenticated using (eh_admin());
create policy cot_envios_ler on public.cot_envios for select to authenticated using (eh_admin());
create policy cot_pedidos_ler on public.cot_pedidos for select to authenticated using (eh_admin());

-- ================= Relógio, fuso e formatos (internas, sem grant)

-- Relógio de negócio. Os testes o recriam com um instante fixo (tests/db/relogio.ts); não existe
-- configuração que um cliente consiga alterar.
create or replace function public.cot_agora() returns timestamptz
language sql stable set search_path = public as $$ select now() $$;

-- Fuso de Brasília. Sem a base de fusos (nunca visto no Supabase nem no pglite), deslocamento fixo −03,
-- válido porque o Brasil não tem horário de verão desde 2019. Decidido uma vez, na migration.
do $$
declare v_fuso text := 'America/Sao_Paulo';
begin
  begin
    perform timestamptz '2026-01-01 00:00+00' at time zone v_fuso;
  exception when others then
    v_fuso := '<-03>+03'; -- POSIX: 3 h a oeste de Greenwich
  end;
  execute format($f$create or replace function public.cot_fuso() returns text
    language sql immutable set search_path = public as $c$ select %L::text $c$ $f$, v_fuso);
end $$;

-- Carimbo em JSON: ISO 8601 em UTC com microssegundos e Z (contrato 1.1).
create or replace function public.cot_iso(t timestamptz) returns text
language sql stable set search_path = public as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- 'YYYY-MM-DD HH24:MI' em Brasília (a página e os e-mails usam este, sem biblioteca de fuso).
create or replace function public.cot_local(t timestamptz) returns text
language sql stable set search_path = public as $$
  select to_char(t at time zone cot_fuso(), 'YYYY-MM-DD HH24:MI')
$$;

-- Hora curta: "17h", "9h07", "10h15" (hora de Brasília).
create or replace function public.cot_hora_br(t timestamptz) returns text
language sql stable set search_path = public as $$
  select extract(hour from l)::int::text || 'h'
         || case when extract(minute from l)::int = 0 then '' else lpad(extract(minute from l)::int::text, 2, '0') end
    from (select t at time zone cot_fuso() as l) x
$$;

-- Dia da semana curto (array explícito; nunca to_char(..., 'Dy'), que depende do idioma).
create or replace function public.cot_dia_curto(d date) returns text
language sql immutable set search_path = public as $$
  select (array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])[extract(dow from d)::int + 1]
$$;

create or replace function public.cot_ddmm(d date) returns text
language sql immutable set search_path = public as $$
  select lpad(extract(day from d)::int::text, 2, '0') || '/' || lpad(extract(month from d)::int::text, 2, '0')
$$;

create or replace function public.cot_data_txt(d date) returns text
language sql immutable set search_path = public as $$
  select to_char(d::timestamp, 'YYYY-MM-DD')
$$;

-- Data local de um instante e instante de uma data local + hora.
create or replace function public.cot_data_local(t timestamptz) returns date
language sql stable set search_path = public as $$ select (t at time zone cot_fuso())::date $$;

create or replace function public.cot_instante(d date, h time) returns timestamptz
language sql stable set search_path = public as $$ select (d + h) at time zone cot_fuso() $$;

-- Texto 'AAAA-MM-DD' → data, ou null se não for uma data válida (sem exceção para quem chama).
create or replace function public.cot_ler_data(t text) returns date
language plpgsql stable set search_path = public as $$
begin
  if t is null or t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return t::date; -- AAAA-MM-DD é lido igual em qualquer DateStyle; 2026-02-30 dá erro e vira null
exception when others then
  return null;
end $$;

-- ================= Dia útil, prazo e validade da etiqueta

create or replace function public.cot_dia_util(d date) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from d) between 1 and 5 and not exists (select 1 from cot_feriados f where f.data = d)
$$;

-- Primeiro dia útil DEPOIS de d.
create or replace function public.cot_proximo_dia_util(d date) returns date
language plpgsql stable set search_path = public as $$
declare x date := d + 1;
begin
  while not cot_dia_util(x) loop
    x := x + 1;
  end loop;
  return x;
end $$;

-- 7.3.4: D = primeiro dia útil depois da data local de t com (D 12:00) − t ≥ 16 h; prazo D 12:00,
-- fechamento D 17:00 (Brasília). Fixos a partir do congelamento.
create or replace function public.cot_calcular_prazo(t timestamptz, out prazo timestamptz, out fechamento timestamptz)
language plpgsql stable set search_path = public as $$
declare d date := cot_proximo_dia_util(cot_data_local(t));
begin
  while cot_instante(d, time '12:00') - t < interval '16 hours' loop
    d := cot_proximo_dia_util(d);
  end loop;
  prazo := cot_instante(d, time '12:00');
  fechamento := cot_instante(d, time '17:00');
end $$;

-- Validade da etiqueta "Aguardando cotação": 12:00 do primeiro dia útil depois da aprovação.
create or replace function public.cot_aguardando_ate(p_semana bigint) returns timestamptz
language sql stable set search_path = public as $$
  select case when s.aprovada_em is not null
              then cot_instante(cot_proximo_dia_util(cot_data_local(s.aprovada_em)), time '12:00') end
    from semanas s where s.id = p_semana
$$;

-- ================= Textos e nomes

-- Maiúsculas, sem acento (mapa explícito, sem a extensão unaccent), espaços simples, trim.
create or replace function public.cot_normalizar(t text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(upper(translate(t,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g'))
$$;

-- Nome que vai ao vendedor quando o catálogo não tem nome_para_vendedor (contrato 3.6). Aceita espaços dentro
-- das parênteses ("( KG )"), como a regra de unidade do importar_semana (D55).
create or replace function public.cot_nome_limpo(p text) returns text
language plpgsql immutable set search_path = public as $$
declare s text;
begin
  s := regexp_replace(p, '\s*-?\s*INSUMOS?\s*\(\s*(KG|UN|SC)\s*\)\s*$', '', 'i');
  if s = p then
    s := regexp_replace(p, '\s*\(\s*(KG|UN|SC)\s*\)\s*$', '', 'i');
  end if;
  s := regexp_replace(s, '\s*-\s*UND\s*$', '', 'i');
  s := regexp_replace(s, 'INTREGRAL|INTREGAL', 'INTEGRAL', 'g');
  return trim(regexp_replace(s, '\s+', ' ', 'g'));
end $$;

-- Rótulo curto do vendedor (etiquetas e e-mails): a empresa até o "(", sem upper (D11).
create or replace function public.cot_rotulo(empresa text) returns text
language sql immutable set search_path = public as $$ select trim(split_part(empresa, '(', 1)) $$;

-- Texto vindo de fora: sem caracteres de controle (a observação aceita quebra de linha).
create or replace function public.cot_texto_ok(t text, p_max int, p_quebra boolean default false) returns boolean
language sql immutable set search_path = public as $$
  select t is null or (char_length(t) <= p_max and case when p_quebra
           then t !~ '[\x01-\x09\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F]'
           else t !~ '[\x01-\x1F\x7F\u0080-\u009F]' end)
$$;

-- Dinheiro digitado: > 0, ≤ 1.000.000 e no máximo 2 casas (D19).
create or replace function public.cot_dinheiro_ok(v numeric) returns boolean
language sql immutable set search_path = public as $$
  select v > 0 and v <= 1000000 and v = round(v, 2)
$$;

-- Código do link: 24 bytes de dois gen_random_uuid() (≥ 180 bits aleatórios) em base64url, 32 caracteres.
create or replace function public.cot_gerar_codigo() returns text
language sql volatile set search_path = public as $$
  select translate(encode(substring(uuid_send(gen_random_uuid()) from 1 for 16)
                          || substring(uuid_send(gen_random_uuid()) from 1 for 8), 'base64'), '+/=', '-_')
$$;

-- ================= Vendedor do item e conjuntos por vendedor (contrato 3.2 e 3.3)

-- Vendedor de um item: catálogo com vendedor → esse (inativo = sem vendedor, D7); senão a última compra
-- pelo fornecedor cadastrado (também só ativo); senão sem vendedor, com o motivo.
create or replace function public.cot_vendedor_do_item(p_item bigint)
returns table(vendedor_id bigint, via text, motivo text, vendedor_motivo_id bigint, ultima_com_outro jsonb)
language sql stable set search_path = public as $$
  select case when vc.id is not null then case when vc.ativo then vc.id end
              when vf.id is not null then case when vf.ativo then vf.id end end,
         case when vc.id is not null then case when vc.ativo then 'catalogo' end
              when vf.id is not null then case when vf.ativo then 'ultima_compra' end end,
         case when vc.id is not null then case when not vc.ativo then 'vendedor_inativo' end
              when vf.id is not null then case when not vf.ativo then 'vendedor_inativo' end
              when nullif(trim(i.fornecedor_ultima), '') is null then 'nunca_comprado'
              else 'fornecedor_sem_vendedor' end,
         case when vc.id is not null then case when not vc.ativo then vc.id end
              when vf.id is not null then case when not vf.ativo then vf.id end end,
         -- só informação para a aba: "última compra foi com X em dd/mm"
         case when vc.id is not null and vf.id is not null and vf.id <> vc.id
                   and i.data_ultima_compra > cot_data_local(cat.atualizado_em)
              then jsonb_build_object('fornecedor', i.fornecedor_ultima, 'vendedor_id', vf.id,
                                      'data', cot_data_txt(i.data_ultima_compra)) end
    from itens_semana i
    left join cot_catalogo cat on cat.produto_id = i.produto_id
    left join cot_vendedores vc on vc.id = cat.vendedor_id
    left join cot_fornecedores f on f.nome_normalizado = cot_normalizar(i.fornecedor_ultima)
    left join cot_vendedores vf on vf.id = f.vendedor_id
   where i.id = p_item
$$;

-- ---------- Vocabulário (contrato 3.1)

-- Viva: pronta, enviada, respondida, ou fechada sem resultado. No máximo uma por (semana, vendedor).
create or replace function public.cot_eh_viva(c cot_cotacoes) returns boolean
language sql immutable set search_path = public as $$
  select c.status in ('pronta', 'enviada', 'respondida') or (c.status = 'fechada' and c.resultado is null)
$$;

-- Com sinal de envio (D36): qualquer status depois de pronta, ou uma pronta com "Já enviei", link aberto
-- (fora da prévia), resposta (inclusive copiada da versão anterior) ou que substituiu outra versão (quem tem
-- o link antigo já chega a ela).
create or replace function public.cot_com_sinal(c cot_cotacoes) returns boolean
language sql stable set search_path = public as $$
  select c.status <> 'pronta' or c.enviada_em is not null or c.primeiro_acesso is not null
         or c.respostas_rev > 0 or c.gerais_rev > 0
         or exists (select 1 from cot_itens x where x.cotacao_id = c.id and x.estado <> 'sem_resposta')
         or exists (select 1 from cot_cotacoes a where a.substituida_por = c.id)
$$;

-- Pronta sem sinal: a única que "Desfazer" aceita e que "Nova versão" e "Obrigado" recusam; para as
-- etiquetas vale como não enviada.
create or replace function public.cot_pronta_sem_sinal(c cot_cotacoes) returns boolean
language sql stable set search_path = public as $$
  select c.status = 'pronta' and not cot_com_sinal(c)
$$;

-- Saiu (para a etiqueta): enviada, respondida, fechada, substituída, ou pronta com sinal.
create or replace function public.cot_saiu(c cot_cotacoes) returns boolean
language sql stable set search_path = public as $$
  select c.status in ('enviada', 'respondida', 'fechada', 'substituida') or (c.status = 'pronta' and cot_com_sinal(c))
$$;

-- Cotações de semana anterior que atravessam a semana S em compra (D43) e os produtos que elas seguram:
-- viva, com sinal de envio e com fechamento depois da aprovação de S (as linhas incluídas, qualquer estado),
-- ou com pedido confirmado depois da aprovação de S (as linhas do pedido). S fora de compra: nenhuma.
create or replace function public.cot_atravessando(p_semana bigint)
returns table(cotacao_id bigint, semana_id bigint, vendedor_id bigint, versao int, produto_id bigint, tipo text,
              confirmado_em timestamptz)
language sql stable set search_path = public as $$
  with s as (select x.* from semanas x where x.id = p_semana and x.status = 'em_compra' and x.aprovada_em is not null)
  select c.id, c.semana_id, c.vendedor_id, c.versao, ci.produto_id, 'em_cotacao', null::timestamptz
    from s
    join semanas sc on sc.data_referencia < s.data_referencia
    join cot_cotacoes c on c.semana_id = sc.id
    join cot_itens ci on ci.cotacao_id = c.id and ci.incluido
   where cot_eh_viva(c) and cot_com_sinal(c) and c.fechamento >= s.aprovada_em
  union all
  select c.id, c.semana_id, c.vendedor_id, c.versao, (e ->> 'produto_id')::bigint, 'pedido', p.confirmado_em
    from s
    join semanas sc on sc.data_referencia < s.data_referencia
    join cot_cotacoes c on c.semana_id = sc.id and c.resultado = 'pedido'
    join cot_pedidos p on p.cotacao_id = c.id and p.confirmado_em >= s.aprovada_em
    cross join lateral jsonb_array_elements(p.itens) e
$$;

-- Mapa dos itens da semana (incluídos e com quantidade aprovada): vendedor (3.2), "preso" (item com linha
-- incluída numa versão considerada de um vendedor fica com ele até o fim da semana), atravessado (seguro por
-- cotação da semana anterior, D43; a regra de preso vem primeiro) e dono = o vendedor a quem o item
-- pertence (3.3): o do preso, senão o vendedor do item se não for atravessado.
create or replace function public.cot_mapa(p_semana bigint)
returns table(item_semana_id bigint, produto_id bigint, produto text, bebida boolean, unidade text,
              qtd numeric, preco_estimado numeric, fornecedor_ultima text, nome text,
              vendedor_id bigint, via text, motivo text, vendedor_motivo_id bigint, ultima_com_outro jsonb,
              preso_com bigint, preso_cotacao bigint, atravessado boolean, dono bigint)
language sql stable set search_path = public as $$
  with at as (select distinct a.produto_id from cot_atravessando(p_semana) a)
  select i.id, i.produto_id, i.produto, i.bebida, i.unidade, i.qtd_aprovada, i.preco_estimado, i.fornecedor_ultima,
         coalesce(cat.nome_para_vendedor, cot_nome_limpo(i.produto)),
         v.vendedor_id, v.via, v.motivo, v.vendedor_motivo_id, v.ultima_com_outro,
         p.vendedor_id, p.cotacao_id,
         p.vendedor_id is null and at.produto_id is not null,
         case when p.vendedor_id is not null then p.vendedor_id when at.produto_id is null then v.vendedor_id end
    from itens_semana i
    left join cot_catalogo cat on cat.produto_id = i.produto_id
    cross join lateral cot_vendedor_do_item(i.id) v
    left join lateral (
      select c.vendedor_id, c.id as cotacao_id
        from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
       where x.item_semana_id = i.id and x.incluido
         and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
       order by c.vendedor_id, c.versao desc
       limit 1
    ) p on true
    left join at on at.produto_id = i.produto_id
   where i.semana_id = p_semana and i.incluido and i.qtd_aprovada > 0
$$;

-- Elegíveis(V) = itens que pertencem a V (os presos com V inclusive; D8, D37) menos os que já têm linha
-- (incluída ou não) numa versão com resultado de V.
create or replace function public.cot_elegiveis(p_semana bigint, p_vendedor bigint)
returns table(item_semana_id bigint, produto_id bigint)
language sql stable set search_path = public as $$
  select m.item_semana_id, m.produto_id
    from cot_mapa(p_semana) m
   where m.dono = p_vendedor
     and not exists (select 1 from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
                      where x.item_semana_id = m.item_semana_id and c.semana_id = p_semana
                        and c.vendedor_id = p_vendedor and c.resultado is not null)
$$;

-- Última(V): a de maior versão que não está cancelada nem substituída.
create or replace function public.cot_ultima(p_semana bigint, p_vendedor bigint) returns cot_cotacoes
language sql stable set search_path = public as $$
  select * from cot_cotacoes c
   where c.semana_id = p_semana and c.vendedor_id = p_vendedor and c.status not in ('cancelada', 'substituida')
   order by c.versao desc limit 1
$$;

create or replace function public.cot_tem_resultado(p_semana bigint, p_vendedor bigint) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from cot_cotacoes c
                  where c.semana_id = p_semana and c.vendedor_id = p_vendedor and c.resultado is not null)
$$;

-- ================= Retrato do item, rascunho e sincronização (contrato 3.4 e 3.5)

-- Reescreve os campos de retrato de todas as linhas da cotação (nome, unidade, qtd, embalagem do catálogo
-- só se o catálogo aponta para este vendedor, descrição do fornecedor só se é deste vendedor, nota do Ivan,
-- referência).
create or replace function public.cot_retratar(p_cotacao bigint) returns void
language sql set search_path = public as $$
  update cot_itens x
     set nome = r.nome,
         unidade = r.unidade,
         rotulo = r.rotulo,
         vende_por_litro = r.vende_por_litro,
         qtd = r.qtd,
         qtd_sugerida = r.qtd_sugerida,
         embalagem = r.embalagem,
         fator = r.fator,
         fator_confirmado = r.fator_confirmado,
         kg_por_litro = r.kg_por_litro,
         descricao_fornecedor = r.descricao_fornecedor,
         codigo_fornecedor = r.codigo_fornecedor,
         nota_vendedor = r.nota_vendedor,
         ref_preco = r.ref_preco,
         ref_data = r.ref_data,
         ref_situacao = r.ref_situacao
    from (
      select x2.id,
             coalesce(cat.nome_para_vendedor, cot_nome_limpo(i.produto)) as nome,
             i.unidade,
             case when i.produto ~* '\(\s*SC\s*\)\s*$' then 'saco' else i.unidade end as rotulo,
             coalesce(cat.vende_por_litro, false) and i.unidade = 'kg' as vende_por_litro,
             i.qtd_aprovada as qtd,
             i.qtd_sugerida,
             case when cat.vendedor_id = c.vendedor_id then cat.embalagem end as embalagem,
             case when cat.vendedor_id = c.vendedor_id then cat.fator end as fator,
             coalesce(cat.vendedor_id = c.vendedor_id and cat.fator_confirmado_em is not null, false) as fator_confirmado,
             case when cat.kg_por_litro_confirmado_em is not null then cat.kg_por_litro end as kg_por_litro,
             case when f.vendedor_id = c.vendedor_id then cat.descricao_fornecedor end as descricao_fornecedor,
             case when f.vendedor_id = c.vendedor_id then cat.codigo_fornecedor end as codigo_fornecedor,
             cat.nota_vendedor, -- preferência do Ivan sobre o produto: vale para qualquer vendedor
             i.preco_estimado as ref_preco,
             i.data_ultima_compra as ref_data,
             -- 3.9: null e ≤ 0 testados antes de qualquer divisão; sem custo médio, só a coerência é pulada
             case when i.preco_estimado is null or i.preco_estimado <= 0 or i.data_ultima_compra is null then 'sem_referencia'
                  when case when i.custo_medio > 0
                            then i.preco_estimado / i.custo_medio < 0.5 or i.preco_estimado / i.custo_medio > 2
                            else false end then 'sem_referencia'
                  when s.data_referencia - i.data_ultima_compra > 90 then 'antiga'
                  else 'ok' end as ref_situacao
        from cot_itens x2
        join cot_cotacoes c on c.id = x2.cotacao_id
        join itens_semana i on i.id = x2.item_semana_id
        join semanas s on s.id = i.semana_id
        left join cot_catalogo cat on cat.produto_id = i.produto_id
        left join cot_fornecedores f on f.nome_normalizado = cot_normalizar(cat.descricao_de_fornecedor)
       where x2.cotacao_id = p_cotacao
    ) r
   where x.id = r.id
$$;

-- Acrescenta ao rascunho os elegíveis que faltam (incluido copiado da cotação de origem, quando houver).
create or replace function public.cot_acrescentar_elegiveis(p_cotacao bigint, p_origem bigint default null) returns void
language sql set search_path = public as $$
  insert into cot_itens (cotacao_id, item_semana_id, produto_id, incluido, nome, unidade, rotulo, qtd)
  select c.id, i.id, i.produto_id,
         coalesce((select o.incluido from cot_itens o where o.cotacao_id = p_origem and o.produto_id = i.produto_id), true),
         i.produto, i.unidade, i.unidade, i.qtd_aprovada
    from cot_cotacoes c
    cross join lateral cot_elegiveis(c.semana_id, c.vendedor_id) e
    join itens_semana i on i.id = e.item_semana_id
   where c.id = p_cotacao
     and not exists (select 1 from cot_itens x where x.cotacao_id = c.id and x.item_semana_id = i.id)
  on conflict do nothing
$$;

-- Cria o rascunho v(maior versão + 1) de (semana, V) com os elegíveis; devolve o id (null se nada criado).
create or replace function public.cot_criar_rascunho(p_semana bigint, p_vendedor bigint, p_origem bigint default null)
returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint;
begin
  insert into cot_cotacoes (semana_id, vendedor_id, versao, complementar, status)
  values (p_semana, p_vendedor,
          (select coalesce(max(c.versao), 0) + 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = p_vendedor),
          cot_tem_resultado(p_semana, p_vendedor), 'rascunho')
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  perform cot_acrescentar_elegiveis(v_id, p_origem);
  perform cot_retratar(v_id);
  if not exists (select 1 from cot_itens x where x.cotacao_id = v_id) then
    delete from cot_cotacoes where id = v_id;
    return null;
  end if;
  return v_id;
end $$;

-- Sincroniza o rascunho de (semana, V) com os elegíveis (3.4). Nunca escreve fora de rascunho nem em
-- itens_semana. Devolve false se não havia rascunho ou se ele ficou vazio (e foi apagado).
create or replace function public.cot_sincronizar(p_semana bigint, p_vendedor bigint) returns boolean
language plpgsql set search_path = public as $$
declare r cot_cotacoes;
begin
  select * into r from cot_cotacoes c
   where c.semana_id = p_semana and c.vendedor_id = p_vendedor and c.status = 'rascunho' for update;
  if not found then
    return false;
  end if;
  update cot_cotacoes set complementar = cot_tem_resultado(p_semana, p_vendedor) where id = r.id;
  perform cot_acrescentar_elegiveis(r.id);
  delete from cot_itens x
   where x.cotacao_id = r.id
     and x.item_semana_id not in (select e.item_semana_id from cot_elegiveis(p_semana, p_vendedor) e);
  perform cot_retratar(r.id);
  if not exists (select 1 from cot_itens x where x.cotacao_id = r.id) then
    delete from cot_cotacoes where id = r.id;
    return false;
  end if;
  return true;
end $$;

-- ================= Conversão e avisos de uma resposta (contrato 3.10)

-- Preço convertido para a unidade do SisChef (4 casas), fator informado (un ou kg por embalagem) e o
-- preço por litro quando a base é litro ou embalagem em ml.
create or replace function public.cot_converter(p_unidade text, p_base text, p_preco numeric, p_emb_unidades numeric,
  p_emb_gramas numeric, p_emb_ml numeric, p_kg_por_litro numeric,
  out fator_informado numeric, out preco_convertido numeric, out valor_litro numeric)
language plpgsql immutable set search_path = public as $$
begin
  if p_preco is null then
    return;
  end if;
  if p_unidade = 'un' and p_base = 'un' then
    preco_convertido := p_preco;
  elsif p_unidade = 'un' and p_base = 'embalagem' and p_emb_unidades > 0 then
    preco_convertido := p_preco / p_emb_unidades;
    fator_informado := p_emb_unidades;
  elsif p_unidade = 'kg' and p_base = 'kg' then
    preco_convertido := p_preco;
  elsif p_unidade = 'kg' and p_base = 'embalagem' and p_emb_gramas > 0 then
    preco_convertido := p_preco / (p_emb_gramas / 1000);
    fator_informado := trim_scale(p_emb_gramas / 1000);
  elsif p_unidade = 'kg' and p_base = 'embalagem' and p_emb_ml > 0 then
    valor_litro := round(p_preco / (p_emb_ml / 1000), 4);
    preco_convertido := (p_preco / (p_emb_ml / 1000)) / p_kg_por_litro; -- null sem kg_por_litro confirmado
  elsif p_unidade = 'kg' and p_base = 'litro' then
    valor_litro := p_preco;
    preco_convertido := p_preco / p_kg_por_litro;
  end if;
  preco_convertido := round(preco_convertido, 4);
end $$;

-- Calcula fator_informado, preco_convertido, avisos ao vendedor e ao Ivan a partir das entradas e do
-- retrato da linha. Os avisos ao vendedor nunca olham ref_* (sem oráculo do último preço, spec 14).
create or replace function public.cot_derivados(x cot_itens) returns cot_itens
language plpgsql stable set search_path = public as $$
declare r cot_itens := x; v record; v_valor numeric;
begin
  r.fator_informado := null;
  r.preco_convertido := null;
  r.avisos_vendedor := '{}';
  r.avisos_ivan := '{}';
  if r.estado = 'tem' then
    select * into v from cot_converter(r.unidade, r.base, r.preco_digitado, r.emb_unidades, r.emb_gramas, r.emb_ml, r.kg_por_litro);
    r.fator_informado := v.fator_informado;
    -- a coluna é numeric(12,4); um valor que não cabe (só com fator absurdo) fica sem conversão
    r.preco_convertido := case when v.preco_convertido < 100000000 then v.preco_convertido end;
    v_valor := coalesce(r.preco_convertido, v.valor_litro);
    if not r.confirmado_pelo_vendedor then
      if r.preco_digitado < 1.00 and (r.base = 'embalagem' or r.unidade = 'kg') then
        r.avisos_vendedor := r.avisos_vendedor || 'centavos'::text;
      end if;
      if v_valor > 300.00 then
        r.avisos_vendedor := r.avisos_vendedor || 'valor_alto'::text;
      end if;
      if r.base = 'embalagem' and r.fator_confirmado and r.fator_informado is not null and r.fator_informado <> r.fator then
        r.avisos_vendedor := r.avisos_vendedor || 'fator_diferente'::text;
      end if;
    end if;
    if r.ref_situacao in ('ok', 'antiga') and r.preco_convertido is not null and r.ref_preco > 0
       and (r.preco_convertido / r.ref_preco < 0.6 or r.preco_convertido / r.ref_preco > 1.6) then
      r.avisos_ivan := r.avisos_ivan || 'unidade_suspeita'::text;
    end if;
    if r.ref_situacao = 'sem_referencia' and r.preco_convertido > 500 then
      r.avisos_ivan := r.avisos_ivan || 'acima_500_sem_ref'::text;
    end if;
    if r.base = 'embalagem' and r.fator_informado is not null
       and not (r.fator_confirmado and r.fator_informado = r.fator) then
      r.avisos_ivan := r.avisos_ivan || 'fator_nao_confirmado'::text;
    end if;
    if (r.base = 'litro' or r.emb_ml is not null) and r.kg_por_litro is null then
      r.avisos_ivan := r.avisos_ivan || 'litro_sem_fator'::text;
    end if;
    if r.tenho_so is not null and r.tenho_so < r.qtd then
      r.avisos_ivan := r.avisos_ivan || 'parcial'::text;
    end if;
  end if;
  if r.similar_desc is not null then
    r.avisos_ivan := r.avisos_ivan || 'similar'::text;
  end if;
  if r.estado = 'tem' and r.a_partir_de is not null and r.a_partir_de > r.qtd then
    r.avisos_ivan := r.avisos_ivan || 'a_partir_de'::text;
  end if;
  return r;
end $$;

-- RespostaItem: o mesmo formato em abrir, responder e valor_atual.
create or replace function public.cot_resposta_json(x cot_itens) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'estado', x.estado, 'preco_digitado', x.preco_digitado, 'base', x.base,
    'emb_unidades', x.emb_unidades, 'emb_gramas', x.emb_gramas, 'emb_ml', x.emb_ml,
    'preco_convertido', x.preco_convertido, 'tenho_so', x.tenho_so,
    'similar_desc', x.similar_desc, 'similar_preco', x.similar_preco, 'a_partir_de', x.a_partir_de,
    'marca_informada', x.marca_informada,
    'confirmado_pelo_vendedor', x.confirmado_pelo_vendedor, 'avisos_vendedor', to_jsonb(x.avisos_vendedor))
$$;

create or replace function public.cot_item_resultado(x cot_itens, p_resultado text, p_erro text) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('numero', x.numero, 'resultado', p_resultado, 'rev', x.rev,
                            'valor_atual', cot_resposta_json(x), 'avisos_vendedor', to_jsonb(x.avisos_vendedor),
                            'erro', p_erro)
$$;

create or replace function public.cot_num(p jsonb, k text) returns numeric
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric end
$$;

-- Valida um item de p_itens contra a linha (3.10, passo 3). Devolve o código de erro ou null.
create or replace function public.cot_validar_item(x cot_itens, p jsonb) returns text
language plpgsql stable set search_path = public as $$
declare
  k text;
  v_estado text := p ->> 'estado';
  v_preco numeric := cot_num(p, 'preco');
  v_base text := p ->> 'base';
  v_un numeric := cot_num(p, 'emb_unidades');
  v_g numeric := cot_num(p, 'emb_gramas');
  v_ml numeric := cot_num(p, 'emb_ml');
  v_tenho numeric := cot_num(p, 'tenho_so');
  v_sdesc text := nullif(trim(p ->> 'similar_desc'), '');
  v_spreco numeric := cot_num(p, 'similar_preco');
  v_apartir numeric := cot_num(p, 'a_partir_de');
  v_marca text := case when jsonb_typeof(p -> 'marca') = 'string' then nullif(trim(p ->> 'marca'), '') end; -- 1.2: vazio = null
  v record;
begin
  foreach k in array array['preco', 'emb_unidades', 'emb_gramas', 'emb_ml', 'tenho_so', 'similar_preco', 'a_partir_de'] loop
    if coalesce(jsonb_typeof(p -> k), 'null') not in ('number', 'null') then
      return 'valor_invalido';
    end if;
  end loop;
  foreach k in array array['base', 'similar_desc', 'marca'] loop
    if coalesce(jsonb_typeof(p -> k), 'null') not in ('string', 'null') then
      return 'texto_invalido';
    end if;
  end loop;
  if coalesce(jsonb_typeof(p -> 'confirmado'), 'null') not in ('boolean', 'null') then
    return 'valor_invalido';
  end if;

  if v_estado = 'sem_resposta' then
    if v_preco is not null or v_base is not null or v_un is not null or v_g is not null or v_ml is not null
       or v_tenho is not null or v_sdesc is not null or v_spreco is not null or v_apartir is not null
       or v_marca is not null then
      return 'valor_invalido';
    end if;
    return null;
  elsif v_estado = 'nao_tem' then
    -- a marca só vale com "tem" (D50)
    if v_preco is not null or v_base is not null or v_un is not null or v_g is not null or v_ml is not null
       or v_tenho is not null or v_apartir is not null or v_marca is not null then
      return 'valor_invalido';
    end if;
  else -- tem
    if v_preco is null then
      return 'sem_preco';
    end if;
    if v_base is null or v_base not in ('un', 'kg', 'litro', 'embalagem')
       or (x.unidade = 'un' and v_base not in ('un', 'embalagem'))
       or (x.unidade = 'kg' and v_base not in ('kg', 'litro', 'embalagem'))
       or (v_base <> 'embalagem' and (v_un is not null or v_g is not null or v_ml is not null))
       or (x.unidade = 'un' and (v_g is not null or v_ml is not null))
       or (x.unidade = 'kg' and v_un is not null)
       or (v_g is not null and v_ml is not null) then
      return 'base_incompativel';
    end if;
    if v_base = 'embalagem' and ((x.unidade = 'un' and v_un is null) or (x.unidade = 'kg' and v_g is null and v_ml is null)) then
      return 'sem_embalagem';
    end if;
  end if;

  if (v_preco is not null and not cot_dinheiro_ok(v_preco))
     or (v_spreco is not null and not cot_dinheiro_ok(v_spreco))
     or (v_un is not null and (v_un <> trunc(v_un) or v_un < 1 or v_un > 10000))
     or (v_g is not null and (v_g < 1 or v_g > 100000))
     or (v_ml is not null and (v_ml < 1 or v_ml > 100000))
     or (v_tenho is not null and (v_tenho <= 0 or v_tenho > 1000000))
     or (v_apartir is not null and (v_apartir <= 0 or v_apartir > 1000000)) then
    return 'valor_invalido';
  end if;
  if not cot_texto_ok(v_sdesc, 200) or not cot_texto_ok(v_marca, 60) then
    return 'texto_invalido';
  end if;
  if v_estado = 'tem' then
    -- o convertido precisa caber em numeric(12,4) (1 g a R$ 1.000.000 daria R$ 1 bilhão por kg)
    select * into v from cot_converter(x.unidade, v_base, v_preco, v_un, v_g, v_ml, x.kg_por_litro);
    if v.preco_convertido >= 100000000 or v.valor_litro >= 100000000 then
      return 'valor_invalido';
    end if;
  end if;
  return null;
end $$;

-- Aplica um item de p_itens na cotação (já travada por quem chama): 3.10 inteiro. Nunca levanta exceção
-- por regra de negócio; devolve o resultado do item no formato de 5.2.
create or replace function public.cot_aplicar_resposta(p_cotacao bigint, p_item jsonb, p_origem text) returns jsonb
language plpgsql set search_path = public as $$
declare
  x cot_itens; n cot_itens; v_erro text;
  v_estado text := p_item ->> 'estado';
begin
  select * into x from cot_itens i
   where i.cotacao_id = p_cotacao and i.incluido and i.numero = cot_num(p_item, 'numero') for update;
  if not found then
    return jsonb_build_object('numero', p_item -> 'numero', 'resultado', 'erro', 'rev', null, 'valor_atual', null,
                              'avisos_vendedor', '[]'::jsonb, 'erro', 'numero_inexistente');
  end if;
  if cot_num(p_item, 'rev_lida') <> x.rev then
    return cot_item_resultado(x, 'conflito', null);
  end if;
  v_erro := cot_validar_item(x, p_item);
  if v_erro is not null then
    return cot_item_resultado(x, 'erro', v_erro);
  end if;

  n := x;
  n.estado := v_estado;
  n.preco_digitado := null; n.base := null; n.emb_unidades := null; n.emb_gramas := null; n.emb_ml := null;
  n.tenho_so := null; n.similar_desc := null; n.similar_preco := null; n.a_partir_de := null; n.marca_informada := null;
  n.confirmado_pelo_vendedor := false; n.origem := null; n.respondido_em := null;
  if v_estado <> 'sem_resposta' then
    if v_estado = 'tem' then
      n.preco_digitado := cot_num(p_item, 'preco');
      n.base := p_item ->> 'base';
      n.emb_unidades := cot_num(p_item, 'emb_unidades');
      n.emb_gramas := cot_num(p_item, 'emb_gramas');
      n.emb_ml := cot_num(p_item, 'emb_ml');
      n.tenho_so := cot_num(p_item, 'tenho_so');
      n.a_partir_de := cot_num(p_item, 'a_partir_de');
      n.marca_informada := case when jsonb_typeof(p_item -> 'marca') = 'string' then nullif(trim(p_item ->> 'marca'), '') end;
      n.confirmado_pelo_vendedor := coalesce((p_item ->> 'confirmado')::boolean, false);
    end if;
    n.similar_desc := nullif(trim(p_item ->> 'similar_desc'), '');
    n.similar_preco := cot_num(p_item, 'similar_preco');
    n.origem := p_origem;
    n.respondido_em := cot_agora();
  end if;
  n.copiada_da_versao := null;
  n.rev := x.rev + 1;
  n := cot_derivados(n);
  update cot_itens i
     set estado = n.estado, preco_digitado = n.preco_digitado, base = n.base, emb_unidades = n.emb_unidades,
         emb_gramas = n.emb_gramas, emb_ml = n.emb_ml, fator_informado = n.fator_informado,
         preco_convertido = n.preco_convertido, tenho_so = n.tenho_so, similar_desc = n.similar_desc,
         similar_preco = n.similar_preco, a_partir_de = n.a_partir_de, marca_informada = n.marca_informada,
         avisos_vendedor = n.avisos_vendedor, avisos_ivan = n.avisos_ivan,
         confirmado_pelo_vendedor = n.confirmado_pelo_vendedor, origem = n.origem,
         copiada_da_versao = n.copiada_da_versao, respondido_em = n.respondido_em, rev = n.rev
   where i.id = x.id
  returning * into n;
  update cot_cotacoes set respostas_rev = respostas_rev + 1 where id = p_cotacao;
  return cot_item_resultado(n, 'gravado', null);
end $$;

create or replace function public.cot_gerais_json(c cot_cotacoes) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('pagamento', c.pagamento, 'validade', cot_data_txt(c.validade),
                            'pedido_minimo', c.pedido_minimo, 'frete', c.frete,
                            'entrega', c.entrega, 'observacao', c.observacao)
$$;

-- Condições gerais (pagamento, validade, mínimo, frete, entrega, observação): troca as 6 de uma vez.
create or replace function public.cot_aplicar_gerais(p_cotacao bigint, p jsonb, p_origem text) returns jsonb
language plpgsql set search_path = public as $$
declare
  c cot_cotacoes; v_erro text; k text; v_hoje date := cot_data_local(cot_agora());
  v_pag text := nullif(trim(p ->> 'pagamento'), '');
  v_ent text := nullif(trim(p ->> 'entrega'), '');
  v_obs text := nullif(trim(p ->> 'observacao'), '');
  v_val date; v_min numeric := cot_num(p, 'pedido_minimo'); v_frete numeric := cot_num(p, 'frete');
begin
  select * into c from cot_cotacoes where id = p_cotacao;
  if cot_num(p, 'rev_lida') <> c.gerais_rev then
    return jsonb_build_object('resultado', 'conflito', 'rev', c.gerais_rev, 'valor_atual', cot_gerais_json(c), 'erro', null);
  end if;
  if coalesce(jsonb_typeof(p -> 'pagamento'), 'null') not in ('string', 'null') or not cot_texto_ok(v_pag, 200) then
    v_erro := 'texto_invalido';
  elsif coalesce(jsonb_typeof(p -> 'validade'), 'null') not in ('string', 'null') then
    v_erro := 'valor_invalido';
  elsif nullif(trim(p ->> 'validade'), '') is not null
        and ((cot_ler_data(trim(p ->> 'validade')) is null)
             or cot_ler_data(trim(p ->> 'validade')) not between v_hoje and v_hoje + 366) then
    v_erro := 'valor_invalido'; -- D30
  else
    foreach k in array array['pedido_minimo', 'frete'] loop
      if v_erro is null and (coalesce(jsonb_typeof(p -> k), 'null') not in ('number', 'null')
         or (cot_num(p, k) is not null and (cot_num(p, k) < 0 or cot_num(p, k) > 1000000 or cot_num(p, k) <> round(cot_num(p, k), 2)))) then
        v_erro := 'valor_invalido';
      end if;
    end loop;
    if v_erro is null and (coalesce(jsonb_typeof(p -> 'entrega'), 'null') not in ('string', 'null') or not cot_texto_ok(v_ent, 200)) then
      v_erro := 'texto_invalido';
    elsif v_erro is null and (coalesce(jsonb_typeof(p -> 'observacao'), 'null') not in ('string', 'null') or not cot_texto_ok(v_obs, 1000, true)) then
      v_erro := 'texto_invalido';
    end if;
  end if;
  if v_erro is not null then
    return jsonb_build_object('resultado', 'erro', 'rev', c.gerais_rev, 'valor_atual', cot_gerais_json(c), 'erro', v_erro);
  end if;
  v_val := cot_ler_data(nullif(trim(p ->> 'validade'), ''));
  update cot_cotacoes
     set pagamento = v_pag, validade = v_val, pedido_minimo = v_min, frete = v_frete, entrega = v_ent, observacao = v_obs,
         gerais_rev = gerais_rev + 1, gerais_origem = p_origem
   where id = p_cotacao
  returning * into c;
  return jsonb_build_object('resultado', 'gravado', 'rev', c.gerais_rev, 'valor_atual', cot_gerais_json(c), 'erro', null);
end $$;

-- Formato de um envio (5.2, passo 5). Devolve o detalhe do problema ou null.
create or replace function public.cot_checar_formato(p_envio_id uuid, p_itens jsonb, p_gerais jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare e jsonb; v_rep numeric;
begin
  if p_envio_id is null then
    return 'envio sem identificação';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    return 'os itens precisam vir numa lista';
  end if;
  if jsonb_array_length(p_itens) > 100 then
    return 'mais de 100 itens num envio';
  end if;
  for e in select x from jsonb_array_elements(p_itens) x loop
    if jsonb_typeof(e) <> 'object' then
      return 'item que não é objeto';
    end if;
    if cot_num(e, 'numero') is null or cot_num(e, 'numero') <> trunc(cot_num(e, 'numero')) or cot_num(e, 'numero') < 1 then
      return 'número de item inválido';
    end if;
    if cot_num(e, 'rev_lida') is null or cot_num(e, 'rev_lida') <> trunc(cot_num(e, 'rev_lida')) or cot_num(e, 'rev_lida') < 0 then
      return 'rev_lida inválido no item ' || (e ->> 'numero');
    end if;
    if jsonb_typeof(e -> 'estado') is distinct from 'string' or (e ->> 'estado') not in ('sem_resposta', 'tem', 'nao_tem') then
      return 'estado inválido no item ' || (e ->> 'numero');
    end if;
  end loop;
  select cot_num(x, 'numero') into v_rep from jsonb_array_elements(p_itens) x
   group by cot_num(x, 'numero') having count(*) > 1 limit 1;
  if v_rep is not null then
    return 'item ' || v_rep::text || ' repetido no envio';
  end if;
  if p_gerais is not null and jsonb_typeof(p_gerais) <> 'null' then
    if jsonb_typeof(p_gerais) <> 'object' or cot_num(p_gerais, 'rev_lida') is null
       or cot_num(p_gerais, 'rev_lida') <> trunc(cot_num(p_gerais, 'rev_lida')) or cot_num(p_gerais, 'rev_lida') < 0 then
      return 'condições gerais inválidas';
    end if;
  elsif jsonb_array_length(p_itens) = 0 then
    return 'envio vazio'; -- D29
  end if;
  return null;
end $$;

-- ================= Limites (contrato 3.12)

-- Balde global com janela fixa de 1 minuto. Devolve true enquanto a chamada cabe no limite.
create or replace function public.cot_contar_limite(p_balde text, p_limite int) returns boolean
language plpgsql set search_path = public as $$
declare v_agora timestamptz := cot_agora(); v_n int;
begin
  insert into cot_limites as l (balde, janela_inicio, chamadas) values (p_balde, v_agora, 1)
  on conflict (balde) do update
     set janela_inicio = case when l.janela_inicio + interval '1 minute' <= v_agora then v_agora else l.janela_inicio end,
         chamadas = case when l.janela_inicio + interval '1 minute' <= v_agora then 1 else l.chamadas + 1 end
  returning chamadas into v_n;
  return v_n <= p_limite;
end $$;

-- Código fora do formato ou inexistente: conta só no balde de inválidos.
create or replace function public.cot_resposta_invalido() returns jsonb
language plpgsql set search_path = public as $$
begin
  if cot_contar_limite('invalidos', 600) then
    return jsonb_build_object('ok', false, 'erro', 'codigo_invalido',
                              'texto', 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.');
  end if;
  return jsonb_build_object('ok', false, 'erro', 'devagar', 'texto', 'Muitas tentativas; tente em alguns minutos.', 'espera_s', 60);
end $$;

-- ================= Estado efetivo mostrado ao vendedor (contrato 3.13)

create or replace function public.cot_estado_efetivo(p_cotacao bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare c cot_cotacoes; s cot_cotacoes; n int := 0; v_codigo text;
begin
  select * into c from cot_cotacoes where id = p_cotacao;
  if c.status = 'cancelada' then
    return jsonb_build_object('estado', 'cancelada', 'texto', 'Esta cotação foi cancelada pelo Ivan.', 'nova', null);
  end if;
  if c.status = 'substituida' then
    s := c;
    while s.status = 'substituida' and s.substituida_por is not null and n < 100 loop
      select * into s from cot_cotacoes where id = s.substituida_por;
      n := n + 1;
    end loop;
    if s.status = 'cancelada' then
      return jsonb_build_object('estado', 'cancelada', 'texto', 'Esta cotação foi cancelada pelo Ivan.', 'nova', null);
    elsif s.resultado = 'pedido' then
      return jsonb_build_object('estado', 'pedido_confirmado',
                                'texto', 'O Ivan já confirmou o pedido com você pelo WhatsApp. Obrigado!', 'nova', null);
    elsif s.resultado = 'dispensado' then
      return jsonb_build_object('estado', 'encerrada_pelo_ivan', 'nova', null,
        'texto', 'Cotação encerrada pelo Ivan em ' || cot_ddmm(cot_data_local(s.fechada_em)) || ' às ' || cot_hora_br(s.fechada_em) || '. Obrigado!');
    elsif cot_eh_viva(s) then
      select k.codigo into v_codigo from cot_codigos k where k.cotacao_id = s.id;
      if v_codigo is not null then
        return jsonb_build_object('estado', 'substituida', 'texto', 'Esta cotação foi atualizada (v' || s.versao || ')',
                                  'nova', jsonb_build_object('versao', s.versao, 'codigo', v_codigo));
      end if;
    end if;
    return jsonb_build_object('estado', 'codigo_invalido',
                              'texto', 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.', 'nova', null);
  end if;
  if c.resultado = 'pedido' then
    return jsonb_build_object('estado', 'pedido_confirmado',
                              'texto', 'O Ivan já confirmou o pedido com você pelo WhatsApp. Obrigado!', 'nova', null);
  elsif c.resultado = 'dispensado' then
    return jsonb_build_object('estado', 'encerrada_pelo_ivan', 'nova', null,
      'texto', 'Cotação encerrada pelo Ivan em ' || cot_ddmm(cot_data_local(c.fechada_em)) || ' às ' || cot_hora_br(c.fechada_em) || '. Obrigado!');
  elsif c.status in ('pronta', 'enviada', 'respondida') and cot_agora() < c.fechamento then
    return jsonb_build_object('estado', 'aberta', 'texto', null, 'nova', null);
  end if;
  return jsonb_build_object('estado', 'encerrada', 'nova', null,
    'texto', 'Cotação encerrada às ' || cot_hora_br(c.fechamento) || ' de ' || cot_dia_curto(cot_data_local(c.fechamento))
             || ' ' || cot_ddmm(cot_data_local(c.fechamento)) || '. Obrigado!');
end $$;

-- Validade como datas absolutas: hoje, amanhã, primeira quarta e primeira sexta depois de hoje, sem repetir,
-- em ordem de data.
create or replace function public.cot_validade_opcoes(d date) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('data', cot_data_txt(x.data), 'rotulo', x.rotulo) order by x.data), '[]'::jsonb)
    from (
      -- sem repetir a mesma data: fica a primeira (terça: "amanhã" em vez de "qua")
      select distinct on (c.data) c.data, c.rotulo, c.ordem
        from (values
          (d, 'hoje ' || cot_ddmm(d), 1),
          (d + 1, 'amanhã ' || cot_ddmm(d + 1), 2),
          (d + 1 + ((3 - extract(dow from d + 1)::int + 7) % 7), 'qua ' || cot_ddmm(d + 1 + ((3 - extract(dow from d + 1)::int + 7) % 7)), 3),
          (d + 1 + ((5 - extract(dow from d + 1)::int + 7) % 7), 'sex ' || cot_ddmm(d + 1 + ((5 - extract(dow from d + 1)::int + 7) % 7)), 4)
        ) as c(data, rotulo, ordem)
       order by c.data, c.ordem
    ) x
$$;

-- O que o vendedor recebe ao abrir (lista branca de chaves, contrato 5.1).
create or replace function public.cot_abertura(p_cotacao bigint, p_ef jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare c cot_cotacoes; v cot_vendedores; v_agora timestamptz := cot_agora(); v_aberta boolean := p_ef ->> 'estado' = 'aberta';
begin
  select * into c from cot_cotacoes where id = p_cotacao;
  select * into v from cot_vendedores where id = c.vendedor_id;
  return jsonb_build_object(
    'ok', true,
    'estado', p_ef -> 'estado',
    'texto', p_ef -> 'texto',
    'loja', 'Spazio Gourmet',
    'vendedor_nome', v.nome,
    'versao', c.versao,
    'complementar', c.complementar,
    'substitui_versao', (select a.versao from cot_cotacoes a where a.substituida_por = c.id order by a.versao desc limit 1),
    'prazo', cot_iso(c.prazo),
    'fechamento', cot_iso(c.fechamento),
    'agora', cot_iso(v_agora),
    'prazo_local', cot_local(c.prazo),
    'fechamento_local', cot_local(c.fechamento),
    'agora_local', cot_local(v_agora),
    'segundos_para_fechar', floor(extract(epoch from c.fechamento - v_agora))::bigint,
    'validade_opcoes', case when v_aberta then cot_validade_opcoes(cot_data_local(v_agora)) else '[]'::jsonb end,
    'itens', case when v_aberta then coalesce((
       select jsonb_agg(jsonb_build_object(
                'numero', x.numero, 'nome', x.nome, 'nota', x.nota_vendedor, 'qtd', x.qtd, 'unidade', x.unidade,
                'rotulo', x.rotulo, 'vende_por_litro', x.vende_por_litro,
                'embalagem', case when x.fator_confirmado then x.embalagem end,
                'fator', case when x.fator_confirmado then x.fator end,
                'kg_por_litro', x.kg_por_litro,
                'descricao_fornecedor', x.descricao_fornecedor, 'codigo_fornecedor', x.codigo_fornecedor,
                'resposta', cot_resposta_json(x), 'rev', x.rev) order by x.numero)
         from cot_itens x where x.cotacao_id = c.id and x.incluido), '[]'::jsonb) else '[]'::jsonb end,
    'gerais', case when v_aberta then cot_gerais_json(c) end,
    'gerais_rev', case when v_aberta then c.gerais_rev else 0 end,
    'nova', p_ef -> 'nova');
end $$;

-- ================= Funções do vendedor (anon e authenticated). Nunca levantam exceção por regra de
-- negócio ou limite: uma exceção desfaria a contagem dos limites. Sempre devolvem JSON com ok.

create or replace function public.cotacao_abrir(p_codigo text, p_previa boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; v_id bigint; v_agora timestamptz := cot_agora(); v_n int; v_ef jsonb;
begin
  -- barato primeiro: formato antes de qualquer busca
  if p_codigo is null or p_codigo !~ '^[A-Za-z0-9_-]{32}$' then
    return cot_resposta_invalido();
  end if;
  select id into v_id from cot_cotacoes where codigo_hash = sha256(convert_to(p_codigo, 'UTF8'));
  if v_id is null then
    return cot_resposta_invalido();
  end if;
  -- código existente nunca toca o balde de inválidos. Primeiro o limite da própria cotação (120/h; a prévia
  -- conta; qualquer status); estourado, a chamada nem conta no balde global (D38): quem tem um código só
  -- esgota a própria cotação.
  select * into c from cot_cotacoes where id = v_id for update;
  if c.abrir_janela_inicio is null or c.abrir_janela_inicio + interval '1 hour' <= v_agora then
    v_n := 1;
    update cot_cotacoes set abrir_janela_inicio = v_agora, abrir_na_janela = 1 where id = c.id;
  else
    v_n := c.abrir_na_janela + 1;
    update cot_cotacoes set abrir_na_janela = v_n where id = c.id;
  end if;
  if v_n > 120 then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'texto', 'Muitas aberturas seguidas; tente em alguns minutos.');
  end if;
  if not cot_contar_limite('validos', 3000) then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'texto', 'Muitas aberturas seguidas; tente em alguns minutos.');
  end if;
  v_ef := cot_estado_efetivo(c.id);
  if not coalesce(p_previa, false) then
    update cot_cotacoes
       set primeiro_acesso = coalesce(primeiro_acesso, v_agora), ultimo_acesso = v_agora, acessos = acessos + 1,
           enviada_em = case when v_ef ->> 'estado' = 'aberta' and status = 'pronta' then coalesce(enviada_em, v_agora) else enviada_em end,
           status = case when v_ef ->> 'estado' = 'aberta' and status = 'pronta' then 'enviada' else status end
     where id = c.id;
  end if;
  return cot_abertura(c.id, v_ef);
end $$;

create or replace function public.cotacao_responder(p_codigo text, p_envio_id uuid, p_itens jsonb, p_gerais jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c cot_cotacoes; v_id bigint; v_agora timestamptz := cot_agora(); v_n int; v_ef jsonb; v_env cot_envios;
  v_fmt text; v_it jsonb; v_r jsonb; v_itens jsonb := '[]'::jsonb; v_ger jsonb; v_gravou boolean := false; v_res jsonb;
  v_formato constant text := 'Não consegui ler o envio. Se não funcionar, responda pelo WhatsApp com o número do item e o preço.';
  v_limite constant text := 'Muitos envios nesta cotação. Se precisar corrigir algo, responda pelo WhatsApp com o número do item e o preço.';
begin
  -- 0. barato primeiro
  if p_codigo is null or p_codigo !~ '^[A-Za-z0-9_-]{32}$' then
    return cot_resposta_invalido();
  end if;
  -- 1. código → cotação, travada
  select id into v_id from cot_cotacoes where codigo_hash = sha256(convert_to(p_codigo, 'UTF8'));
  if v_id is null then
    return cot_resposta_invalido();
  end if;
  select * into c from cot_cotacoes where id = v_id for update;
  -- 2. tentativas da própria cotação primeiro (D38): toda chamada com este código conta (aceitas, recusadas,
  -- reenvios, cotação fechada) e a contagem fica gravada; estourou → limite, sem tocar no balde global
  if c.tentativas_janela_inicio is null or c.tentativas_janela_inicio + interval '1 hour' <= v_agora then
    v_n := 1;
    update cot_cotacoes set tentativas_janela_inicio = v_agora, tentativas_na_janela = 1 where id = c.id;
  else
    v_n := c.tentativas_na_janela + 1;
    update cot_cotacoes set tentativas_na_janela = v_n where id = c.id;
  end if;
  if v_n > 200 then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'texto', v_limite);
  end if;
  -- 3. só a chamada que passou pelo limite da cotação conta no balde de válidos
  if not cot_contar_limite('validos', 3000) then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'texto', v_limite);
  end if;
  -- 4. idempotência (vale mesmo depois do fechamento ou de nova versão)
  if p_envio_id is not null then
    select * into v_env from cot_envios where envio_id = p_envio_id;
    if found then
      if v_env.cotacao_id = c.id then
        return v_env.resultado || jsonb_build_object('reenvio', true);
      end if;
      return jsonb_build_object('ok', false, 'erro', 'envio_de_outra_cotacao', 'texto', v_formato);
    end if;
  end if;
  -- 5. estado: aceita até 5 min depois do fechamento (envio em trânsito)
  if not (c.status in ('pronta', 'enviada', 'respondida') and v_agora < c.fechamento + interval '5 minutes') then
    v_ef := cot_estado_efetivo(c.id);
    return jsonb_build_object('ok', false, 'erro', 'estado', 'estado', v_ef -> 'estado', 'texto', v_ef -> 'texto', 'nova', v_ef -> 'nova');
  end if;
  -- 6. demais limites: 60 envios aceitos por código ("Trocar link" zera, D39) e 1 a cada 3 s
  if c.envios_aceitos >= 60 then
    return jsonb_build_object('ok', false, 'erro', 'limite', 'texto', v_limite);
  end if;
  if c.ultimo_envio_em is not null and v_agora - c.ultimo_envio_em < interval '3 seconds' then
    return jsonb_build_object('ok', false, 'erro', 'devagar', 'texto', 'Aguarde alguns segundos.', 'espera_s', 3);
  end if;
  -- 7. formato
  v_fmt := cot_checar_formato(p_envio_id, p_itens, p_gerais);
  if v_fmt is not null then
    return jsonb_build_object('ok', false, 'erro', 'formato', 'texto', v_formato);
  end if;
  -- 8. itens por número e condições gerais
  for v_it in select x from jsonb_array_elements(p_itens) with ordinality as t(x, n) order by n loop
    v_r := cot_aplicar_resposta(c.id, v_it, 'vendedor');
    v_gravou := v_gravou or v_r ->> 'resultado' = 'gravado';
    v_itens := v_itens || jsonb_build_array(v_r);
  end loop;
  if p_gerais is not null and jsonb_typeof(p_gerais) <> 'null' then
    v_ger := cot_aplicar_gerais(c.id, p_gerais, 'vendedor');
    v_gravou := v_gravou or v_ger ->> 'resultado' = 'gravado';
  end if;
  -- 9. envio aceito
  v_res :=jsonb_build_object('ok', true, 'recebido_em', cot_iso(v_agora), 'itens', v_itens, 'gerais', v_ger);
  insert into cot_envios (envio_id, cotacao_id, origem, recebido_em, resultado)
  values (p_envio_id, c.id, 'vendedor', v_agora, v_res);
  update cot_cotacoes
     set envios_aceitos = envios_aceitos + 1, ultimo_envio_em = v_agora,
         enviada_em = coalesce(enviada_em, v_agora),
         -- D24: envio sem nada gravado (tudo conflito ou erro) não vira respondida
         status = case when v_gravou then 'respondida' when status = 'pronta' then 'enviada' else status end
   where id = c.id;
  return v_res || jsonb_build_object('reenvio', false);
end $$;

-- ================= Funções do admin (authenticated + exigir_admin)

-- Preparação idempotente (7.3.2, contrato 4.1), chamada toda vez que a aba Cotações abre ou atualiza: cria
-- ou sincroniza os rascunhos e devolve o mapa da semana. Nunca escreve fora de rascunho nem em itens_semana.
create or replace function public.cot_preparar(p_semana bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s semanas; v_vend bigint; u cot_cotacoes; v_res jsonb;
begin
  perform exigir_admin();
  select * into s from semanas where id = p_semana for update; -- serializa chamadas simultâneas
  if not found then
    raise exception 'semana não encontrada';
  end if;
  if s.status <> 'em_compra' then
    raise exception 'a semana precisa estar em compra (aprovada e não encerrada) para montar as cotações';
  end if;

  for v_vend in
    select m.dono from cot_mapa(p_semana) m where m.dono is not null
    union
    select c.vendedor_id from cot_cotacoes c where c.semana_id = p_semana and c.status not in ('cancelada', 'substituida')
    order by 1
  loop
    u := cot_ultima(p_semana, v_vend);
    if u.status = 'liberada' then
      continue; -- a) "Comprar na loja nesta semana": nada até "Voltar a cotar"
    end if;
    if exists (select 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = v_vend and c.status = 'rascunho') then
      perform cot_sincronizar(p_semana, v_vend); -- b)
    elsif not exists (select 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = v_vend
                        and (cot_eh_viva(c) or c.resultado is not null))
          and exists (select 1 from cot_elegiveis(p_semana, v_vend)) then
      perform cot_criar_rascunho(p_semana, v_vend); -- c)
    end if;
  end loop;

  with m as (select * from cot_mapa(p_semana)),
  vend as (
    select m.dono as vendedor_id from m where m.dono is not null
    union
    select c.vendedor_id from cot_cotacoes c where c.semana_id = p_semana and c.status not in ('cancelada', 'substituida')
  ),
  -- estado de cada vendedor depois da sincronização
  est as (
    select v.vendedor_id,
           (cot_ultima(p_semana, v.vendedor_id)).id as ultima_id,
           (cot_ultima(p_semana, v.vendedor_id)).status as ultima_status,
           (cot_ultima(p_semana, v.vendedor_id)).resultado as ultima_resultado,
           exists (select 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = v.vendedor_id and c.status = 'rascunho') as tem_rascunho,
           (select c.id from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = v.vendedor_id and cot_eh_viva(c)) as viva_id
      from vend v
  ),
  cartoes as (
    select coalesce(jsonb_agg(jsonb_build_object('vendedor_id', x.vendedor_id, 'itens', x.itens, 'estimado', x.estimado, 'cotacoes', x.cotacoes)
                              order by x.estimado desc, x.empresa collate "C", x.vendedor_id), '[]'::jsonb) as j
      from (
        select v.vendedor_id, cv.empresa,
               (select count(*) from m where m.dono = v.vendedor_id)::int as itens,
               (select round(coalesce(sum(m.qtd * coalesce(m.preco_estimado, 0)), 0), 2) from m where m.dono = v.vendedor_id) as estimado,
               coalesce((select jsonb_agg(c.id order by c.versao desc) from cot_cotacoes c
                          where c.semana_id = p_semana and c.vendedor_id = v.vendedor_id
                            and c.status not in ('cancelada', 'substituida')), '[]'::jsonb) as cotacoes
          from vend v join cot_vendedores cv on cv.id = v.vendedor_id
      ) x
  ),
  -- S_V sem linha na viva nem em versão com resultado (D9: só quando o vendedor não tem rascunho)
  fora as (
    select e.vendedor_id, e.viva_id as cotacao_id, m.item_semana_id, m.produto_id, m.nome, m.unidade, m.qtd
      from est e join m on m.vendedor_id = e.vendedor_id and (m.preso_com is null or m.preso_com = e.vendedor_id)
                       and not m.atravessado
     where not e.tem_rascunho and e.viva_id is not null and e.ultima_status is distinct from 'liberada'
       and not exists (select 1 from cot_itens x where x.cotacao_id = e.viva_id and x.item_semana_id = m.item_semana_id)
       and not exists (select 1 from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
                        where x.item_semana_id = m.item_semana_id and c.semana_id = p_semana
                          and c.vendedor_id = e.vendedor_id and c.resultado is not null)
  ),
  depois as (
    select e.vendedor_id, e.ultima_id as cotacao_id, m.item_semana_id, m.produto_id, m.nome, m.unidade, m.qtd
      from est e
      cross join lateral cot_elegiveis(p_semana, e.vendedor_id) el
      join m on m.item_semana_id = el.item_semana_id
     where not e.tem_rascunho and e.viva_id is null and e.ultima_resultado is not null
  ),
  -- itens seguros por cotação da semana anterior (D43): a de pedido mais recente, senão a viva de menor id
  atr as (
    select m.item_semana_id, m.produto_id, m.nome, a.vendedor_id, a.cotacao_id, a.semana_id, a.tipo
      from m
      cross join lateral (
        select x.* from cot_atravessando(p_semana) x
         where x.produto_id = m.produto_id
         order by (x.tipo = 'pedido') desc, x.confirmado_em desc nulls last, x.cotacao_id
         limit 1) a
     where m.atravessado
  )
  select jsonb_build_object(
    'semana_id', s.id,
    'data_referencia', cot_data_txt(s.data_referencia),
    'aprovada_em', cot_iso(s.aprovada_em),
    'aguardando_ate', cot_iso(cot_aguardando_ate(s.id)),
    'agora', cot_iso(cot_agora()),
    'cartoes', (select j from cartoes),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
                 'item_semana_id', m.item_semana_id, 'produto_id', m.produto_id, 'vendedor_id', m.vendedor_id, 'via', m.via,
                 'preso_com', case when m.preso_com is distinct from m.vendedor_id then m.preso_com end,
                 'ultima_com_outro', m.ultima_com_outro) order by m.item_semana_id) from m), '[]'::jsonb),
    'sem_vendedor', coalesce((select jsonb_agg(jsonb_build_object(
                 'item_semana_id', m.item_semana_id, 'produto_id', m.produto_id, 'produto', m.produto,
                 'nome', cot_nome_limpo(m.produto), 'unidade', m.unidade, 'qtd', m.qtd, 'motivo', m.motivo,
                 'fornecedor', m.fornecedor_ultima, 'vendedor_id', m.vendedor_motivo_id)
                 order by cot_normalizar(m.produto) collate "C", m.item_semana_id)
               from m where m.vendedor_id is null and m.preso_com is null and not m.atravessado), '[]'::jsonb),
    'fora_da_enviada', coalesce((select jsonb_agg(jsonb_build_object(
                 'vendedor_id', f.vendedor_id, 'cotacao_id', f.cotacao_id, 'item_semana_id', f.item_semana_id,
                 'produto_id', f.produto_id, 'nome', f.nome, 'unidade', f.unidade, 'qtd', f.qtd)
                 order by f.vendedor_id, f.item_semana_id) from fora f), '[]'::jsonb),
    'depois_do_resultado', coalesce((select jsonb_agg(jsonb_build_object(
                 'vendedor_id', d.vendedor_id, 'cotacao_id', d.cotacao_id, 'item_semana_id', d.item_semana_id,
                 'produto_id', d.produto_id, 'nome', d.nome, 'unidade', d.unidade, 'qtd', d.qtd)
                 order by d.vendedor_id, d.item_semana_id) from depois d), '[]'::jsonb),
    'presos', coalesce((select jsonb_agg(jsonb_build_object(
                 'item_semana_id', m.item_semana_id, 'produto_id', m.produto_id, 'nome', m.nome,
                 'vendedor_id', m.preso_com, 'cotacao_id', m.preso_cotacao, 'vendedor_novo_id', m.vendedor_id)
                 order by m.item_semana_id)
               from m where m.preso_com is not null and m.preso_com is distinct from m.vendedor_id), '[]'::jsonb),
    'atravessados', coalesce((select jsonb_agg(jsonb_build_object(
                 'item_semana_id', a.item_semana_id, 'produto_id', a.produto_id, 'nome', a.nome,
                 'vendedor_id', a.vendedor_id, 'cotacao_id', a.cotacao_id, 'semana_id', a.semana_id,
                 'estado', a.tipo)
                 order by a.item_semana_id) from atr a), '[]'::jsonb))
    into v_res;
  return v_res;
end $$;

-- "Pedir a:" (item sem vendedor) e "Trocar vendedor": grava a escolha do Ivan no catálogo. Mudou o
-- vendedor → zera descrição, código e fator do fornecedor anterior. Não mexe em cotação: o App chama
-- cot_preparar em seguida (e item preso numa versão enviada continua com o vendedor antigo nesta semana).
create or replace function public.cot_definir_vendedor(p_produto_id bigint, p_vendedor_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare cat cot_catalogo;
begin
  perform exigir_admin();
  if not exists (select 1 from cot_vendedores v where v.id = p_vendedor_id and v.ativo) then
    raise exception 'vendedor inativo ou inexistente';
  end if;
  if not exists (select 1 from itens_semana i where i.produto_id = p_produto_id) then
    raise exception 'produto desconhecido';
  end if;
  select * into cat from cot_catalogo where produto_id = p_produto_id for update;
  if not found then
    insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em)
    values (p_produto_id, p_vendedor_id, 'ivan', cot_agora());
  elsif cat.vendedor_id is distinct from p_vendedor_id then
    update cot_catalogo
       set vendedor_id = p_vendedor_id, origem = 'ivan', atualizado_em = cot_agora(),
           descricao_fornecedor = null, codigo_fornecedor = null, descricao_de_fornecedor = null,
           fator = null, fator_confirmado_em = null
     where produto_id = p_produto_id;
  else
    update cot_catalogo set origem = 'ivan', atualizado_em = cot_agora() where produto_id = p_produto_id;
  end if;
end $$;

-- Botão "Nota" do item (ajuste Foozi 3, D49): grava a nota do Ivan ao vendedor no catálogo, sem mexer no
-- vendedor, na origem nem na data da escolha (atualizado_em). Linha nova fica sem vendedor (não decide o
-- vendedor, D35). O App chama cot_preparar em seguida: a sincronização leva a nota ao rascunho; versões já
-- congeladas ficam com a nota que tinham. "R$" e número com vírgula quem avisa é o App.
create or replace function public.cot_definir_nota(p_produto_id bigint, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nota text := nullif(trim(p_nota), '');
begin
  perform exigir_admin();
  if not exists (select 1 from itens_semana i where i.produto_id = p_produto_id) then
    raise exception 'produto desconhecido';
  end if;
  if char_length(v_nota) > 80 then
    raise exception 'a nota pode ter no máximo 80 caracteres';
  end if;
  if v_nota ~ '[\x01-\x1F\x7F\u0080-\u009F]' then
    raise exception 'a nota tem um caractere inválido';
  end if;
  insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em, nota_vendedor)
  values (p_produto_id, null, 'ivan', cot_agora(), v_nota)
  on conflict (produto_id) do update set nota_vendedor = excluded.nota_vendedor;
end $$;

create or replace function public.cot_marcar_item(p_cot_item bigint, p_incluido boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  perform exigir_admin();
  select c.status into v_status from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id where x.id = p_cot_item for update of c;
  if not found then
    raise exception 'item da cotação não encontrado';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'só dá para marcar ou desmarcar item de cotação em rascunho';
  end if;
  if p_incluido is null then
    raise exception 'informe se o item vai na cotação';
  end if;
  update cot_itens set incluido = p_incluido where id = p_cot_item;
end $$;

-- Dados para montar a mensagem e o link (só lê; o link é montado pelo App, D12).
create or replace function public.cot_dados_envio(p_cotacao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; v cot_vendedores; s semanas;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if c.status in ('rascunho', 'liberada') then
    raise exception 'cotação em rascunho: toque em Preparar mensagem';
  end if;
  select * into v from cot_vendedores where id = c.vendedor_id;
  select * into s from semanas where id = c.semana_id;
  return jsonb_build_object(
    'cotacao_id', c.id, 'semana_id', c.semana_id, 'data_referencia', cot_data_txt(s.data_referencia),
    'versao', c.versao, 'complementar', c.complementar,
    'substitui_versao', (select a.versao from cot_cotacoes a where a.substituida_por = c.id order by a.versao desc limit 1),
    'status', c.status,
    'codigo', (select k.codigo from cot_codigos k where k.cotacao_id = c.id),
    'prazo', cot_iso(c.prazo), 'fechamento', cot_iso(c.fechamento),
    'prazo_local', cot_local(c.prazo), 'fechamento_local', cot_local(c.fechamento),
    'vendedor', jsonb_build_object('id', v.id, 'codigo', v.codigo, 'nome', v.nome, 'empresa', v.empresa,
                                   'rotulo', cot_rotulo(v.empresa), 'whatsapp', v.whatsapp),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
               'numero', x.numero, 'produto_id', x.produto_id, 'nome', x.nome, 'qtd', x.qtd, 'unidade', x.unidade,
               'rotulo', x.rotulo, 'vende_por_litro', x.vende_por_litro,
               'embalagem', case when x.fator_confirmado then x.embalagem end,
               'fator', case when x.fator_confirmado then x.fator end,
               'nota', x.nota_vendedor) order by x.numero)
             from cot_itens x where x.cotacao_id = c.id and x.incluido), '[]'::jsonb));
end $$;

-- "Preparar mensagem": rascunho → pronta (7.3.3). Idempotente em pronta (toque duplo, dois aparelhos).
create or replace function public.cot_congelar(p_cotacao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; l cot_cotacoes; v_semana_status text; v_codigo text; v_maximo int; x cot_itens; o cot_itens;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  -- travas na ordem do contrato 3.15: semana → versão viva → a cotação
  select status into v_semana_status from semanas where id = c.semana_id for update;
  if v_semana_status <> 'em_compra' then
    raise exception 'a semana desta cotação não está em compra';
  end if;
  select * into l from cot_cotacoes v
   where v.semana_id = c.semana_id and v.vendedor_id = c.vendedor_id and v.id <> c.id and cot_eh_viva(v) for update;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if c.status = 'pronta' then
    return cot_dados_envio(c.id);
  elsif c.status = 'liberada' then
    raise exception 'este vendedor está em "Comprar na loja nesta semana"';
  elsif c.status <> 'rascunho' then
    raise exception 'esta cotação não está em rascunho';
  end if;
  if not cot_sincronizar(c.semana_id, c.vendedor_id) then
    raise exception 'nenhum item para cotar com este vendedor; atualize a aba';
  end if;
  if not exists (select 1 from cot_itens x2 where x2.cotacao_id = c.id and x2.incluido) then
    raise exception 'marque pelo menos um item antes de preparar a mensagem';
  end if;
  select * into c from cot_cotacoes where id = p_cotacao;
  perform cot_retratar(c.id);

  -- numeração estável por produto em (semana, vendedor), olhando todas as versões; os novos no fim, bebidas
  -- primeiro, depois o nome sem acento; número de item que saiu nunca é reutilizado
  update cot_itens x2 set numero = null where x2.cotacao_id = c.id;
  update cot_itens x2
     set numero = a.numero
    from (select ci.produto_id, min(ci.numero) as numero
            from cot_itens ci join cot_cotacoes cc on cc.id = ci.cotacao_id
           where cc.semana_id = c.semana_id and cc.vendedor_id = c.vendedor_id and cc.id <> c.id and ci.numero is not null
           group by ci.produto_id) a
   where x2.cotacao_id = c.id and x2.incluido and x2.produto_id = a.produto_id;
  select coalesce(max(ci.numero), 0) into v_maximo
    from cot_itens ci join cot_cotacoes cc on cc.id = ci.cotacao_id
   where cc.semana_id = c.semana_id and cc.vendedor_id = c.vendedor_id and ci.numero is not null;
  update cot_itens x2
     set numero = v_maximo + n.ordem
    from (select x3.id, row_number() over (order by i.bebida desc, cot_normalizar(x3.nome) collate "C", x3.produto_id) as ordem
            from cot_itens x3 join itens_semana i on i.id = x3.item_semana_id
           where x3.cotacao_id = c.id and x3.incluido and x3.numero is null) n
   where x2.id = n.id;

  -- a viva anterior vira substituída antes (o índice de uma versão viva não deixa as duas vivas ao mesmo tempo)
  if l.id is not null then
    update cot_cotacoes set status = 'substituida', substituida_por = c.id where id = l.id;
  end if;

  v_codigo := cot_gerar_codigo();
  update cot_cotacoes cc
     set status = 'pronta', congelada_em = cot_agora(), codigo_hash = sha256(convert_to(v_codigo, 'UTF8')),
         prazo = p.prazo, fechamento = p.fechamento
    from cot_calcular_prazo(cot_agora()) p
   where cc.id = c.id
  returning cc.* into c;
  insert into cot_codigos (cotacao_id, codigo) values (c.id, v_codigo)
  on conflict (cotacao_id) do update set codigo = excluded.codigo;

  -- item que veio pela última compra fica com este vendedor nas semanas seguintes (só em linha sem vendedor)
  insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em)
  select m.produto_id, c.vendedor_id, 'ultima_compra', cot_agora()
    from cot_mapa(c.semana_id) m
    join cot_itens x2 on x2.cotacao_id = c.id and x2.item_semana_id = m.item_semana_id and x2.incluido
   where m.via = 'ultima_compra' and m.vendedor_id = c.vendedor_id
  on conflict (produto_id) do update
     set vendedor_id = excluded.vendedor_id, origem = 'ultima_compra', atualizado_em = excluded.atualizado_em
   where cot_catalogo.vendedor_id is null;

  -- substituição: respostas (por produto, com a marca informada), condições e o sinal de notificação vêm da
  -- versão anterior, recalculando a conversão e os avisos com o retrato novo
  if l.id is not null then
    for x in select * from cot_itens x2 where x2.cotacao_id = c.id and x2.incluido loop
      select * into o from cot_itens x2 where x2.cotacao_id = l.id and x2.produto_id = x.produto_id and x2.estado <> 'sem_resposta';
      if found then
        x.estado := o.estado; x.preco_digitado := o.preco_digitado; x.base := o.base;
        x.emb_unidades := o.emb_unidades; x.emb_gramas := o.emb_gramas; x.emb_ml := o.emb_ml;
        x.tenho_so := o.tenho_so; x.similar_desc := o.similar_desc; x.similar_preco := o.similar_preco;
        x.a_partir_de := o.a_partir_de; x.marca_informada := o.marca_informada;
        x.confirmado_pelo_vendedor := o.confirmado_pelo_vendedor;
        x.origem := o.origem; x.respondido_em := o.respondido_em; x.copiada_da_versao := l.versao; x.rev := 0;
        x := cot_derivados(x);
        update cot_itens x2
           set estado = x.estado, preco_digitado = x.preco_digitado, base = x.base, emb_unidades = x.emb_unidades,
               emb_gramas = x.emb_gramas, emb_ml = x.emb_ml, fator_informado = x.fator_informado,
               preco_convertido = x.preco_convertido, tenho_so = x.tenho_so, similar_desc = x.similar_desc,
               similar_preco = x.similar_preco, a_partir_de = x.a_partir_de, marca_informada = x.marca_informada,
               avisos_vendedor = x.avisos_vendedor, avisos_ivan = x.avisos_ivan,
               confirmado_pelo_vendedor = x.confirmado_pelo_vendedor, origem = x.origem,
               copiada_da_versao = x.copiada_da_versao, respondido_em = x.respondido_em, rev = x.rev
         where x2.id = x.id;
      end if;
    end loop;
    update cot_cotacoes
       set pagamento = l.pagamento, validade = l.validade, pedido_minimo = l.pedido_minimo, frete = l.frete,
           entrega = l.entrega, observacao = l.observacao, gerais_origem = l.gerais_origem, gerais_rev = 0,
           notificado_hash = l.notificado_hash, notificado_em = l.notificado_em, ultimo_envio_em = l.ultimo_envio_em, -- D33
           cobranca_em = case when c.prazo = l.prazo then l.cobranca_em end
     where id = c.id;
  end if;
  return cot_dados_envio(c.id);
end $$;

-- "Desfazer (não enviei)": pronta sem sinal de envio → rascunho; o link deixa de valer.
create or replace function public.cot_descongelar(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  perform 1 from semanas where id = c.semana_id for update;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if c.status = 'rascunho' then
    return; -- idempotente
  end if;
  if c.status <> 'pronta' then
    raise exception 'só dá para desfazer uma cotação preparada e ainda não enviada';
  end if;
  if c.enviada_em is not null then
    raise exception 'você já marcou "Já enviei"; use Cancelar ou Nova versão';
  end if;
  if c.primeiro_acesso is not null then
    raise exception 'o link já foi aberto; use Cancelar ou Nova versão';
  end if;
  if c.respostas_rev > 0 or c.gerais_rev > 0
     or exists (select 1 from cot_itens x where x.cotacao_id = c.id and x.estado <> 'sem_resposta') then
    raise exception 'a cotação já tem resposta; use Cancelar ou Nova versão';
  end if;
  if exists (select 1 from cot_cotacoes a where a.substituida_por = c.id) then
    raise exception 'esta versão substituiu outra que o vendedor já tinha; use Cancelar';
  end if;
  delete from cot_codigos where cotacao_id = c.id;
  update cot_itens set numero = null where cotacao_id = c.id;
  update cot_cotacoes
     set status = 'rascunho', codigo_hash = null, prazo = null, fechamento = null, congelada_em = null,
         cobranca_em = null, consolidado_em = null, consolidado_rev = null
   where id = c.id;
end $$;

create or replace function public.cot_confirmar_envio(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if c.status = 'pronta' then
    update cot_cotacoes set status = 'enviada', enviada_em = coalesce(enviada_em, cot_agora()) where id = c.id;
  elsif c.status in ('enviada', 'respondida', 'fechada') then
    update cot_cotacoes set enviada_em = coalesce(enviada_em, cot_agora()) where id = c.id;
  else
    raise exception 'esta cotação não está preparada';
  end if;
end $$;

-- "Trocar link": código novo para a viva; os códigos das versões anteriores deixam de valer (sem redirecionar).
-- Zera os contadores do link na viva (D39: quem tem o link novo não herda os 60 envios gastos por quem tinha
-- o antigo); ultimo_envio_em, respostas e condições ficam (D2). Respostas gravadas pelo link antigo quem
-- limpa é o Ivan, pelo App ("Limpar respostas do link antigo", com cot_responder_admin).
create or replace function public.cot_trocar_codigo(p_cotacao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; v_codigo text;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if not cot_eh_viva(c) then
    raise exception 'só dá para trocar o link de uma cotação viva';
  end if;
  v_codigo := cot_gerar_codigo();
  update cot_cotacoes
     set codigo_hash = sha256(convert_to(v_codigo, 'UTF8')),
         envios_aceitos = 0, tentativas_janela_inicio = null, tentativas_na_janela = 0,
         abrir_janela_inicio = null, abrir_na_janela = 0
   where id = c.id;
  insert into cot_codigos (cotacao_id, codigo) values (c.id, v_codigo)
  on conflict (cotacao_id) do update set codigo = excluded.codigo;
  delete from cot_codigos k using cot_cotacoes a
   where k.cotacao_id = a.id and a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id and a.versao < c.versao;
  update cot_cotacoes a set codigo_hash = null
   where a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id and a.versao < c.versao and a.codigo_hash is not null;
  return cot_dados_envio(c.id);
end $$;

-- "Digitar preços" e "Colar resposta": a mesma regra do vendedor, sem limites e sem prazo.
create or replace function public.cot_responder_admin(p_cotacao bigint, p_envio_id uuid, p_itens jsonb, p_gerais jsonb,
                                                      p_origem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c cot_cotacoes; v_env cot_envios; v_fmt text; v_it jsonb; v_r jsonb; v_itens jsonb := '[]'::jsonb; v_ger jsonb;
  v_gravou boolean := false; v_res jsonb; v_agora timestamptz := cot_agora();
begin
  perform exigir_admin();
  if p_origem is null or p_origem not in ('ivan_digitou', 'ivan_colou') then
    raise exception 'origem inválida';
  end if;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if p_envio_id is not null then
    select * into v_env from cot_envios where envio_id = p_envio_id;
    if found then
      if v_env.cotacao_id = c.id then
        return v_env.resultado || jsonb_build_object('reenvio', true);
      end if;
      raise exception 'envio de outra cotação';
    end if;
  end if;
  if not (c.status in ('pronta', 'enviada', 'respondida') or (c.status = 'fechada' and c.resultado is null)) then
    raise exception 'esta cotação não aceita mais respostas';
  end if;
  v_fmt := cot_checar_formato(p_envio_id, p_itens, p_gerais);
  if v_fmt is not null then
    raise exception 'envio inválido: %', v_fmt;
  end if;
  for v_it in select x from jsonb_array_elements(p_itens) with ordinality as t(x, n) order by n loop
    v_r := cot_aplicar_resposta(c.id, v_it, p_origem);
    v_gravou := v_gravou or v_r ->> 'resultado' = 'gravado';
    v_itens := v_itens || jsonb_build_array(v_r);
  end loop;
  if p_gerais is not null and jsonb_typeof(p_gerais) <> 'null' then
    v_ger := cot_aplicar_gerais(c.id, p_gerais, p_origem);
    v_gravou := v_gravou or v_ger ->> 'resultado' = 'gravado';
  end if;
  if v_gravou then
    update cot_cotacoes
       set enviada_em = coalesce(enviada_em, v_agora),
           status = case when status in ('pronta', 'enviada') then 'respondida' else status end
     where id = c.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'recebido_em', cot_iso(v_agora), 'itens', v_itens, 'gerais', v_ger);
  insert into cot_envios (envio_id, cotacao_id, origem, recebido_em, resultado)
  values (p_envio_id, c.id, p_origem, v_agora, v_res);
  return v_res || jsonb_build_object('reenvio', false);
end $$;

-- "Nova versão" (de enviada, respondida, fechada sem resultado ou pronta com sinal de envio, D36) e "Cotação
-- complementar" (depois do resultado): rascunho v+1 com os elegíveis — os presos com o vendedor inclusive
-- (D37); o marcar/desmarcar vem da cotação de origem. Devolve o rascunho que já existir. Só a pronta sem
-- sinal vai para o Desfazer.
create or replace function public.cot_nova_versao(p_cotacao bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; v_status text; v_id bigint; u cot_cotacoes; v_compl boolean;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  select status into v_status from semanas where id = c.semana_id for update;
  if v_status <> 'em_compra' then
    raise exception 'a semana desta cotação não está em compra';
  end if;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  select id into v_id from cot_cotacoes a
   where a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id and a.status = 'rascunho';
  if v_id is not null then
    return v_id;
  end if;
  u := cot_ultima(c.semana_id, c.vendedor_id);
  if u.status = 'liberada' then
    raise exception 'este vendedor está em "Comprar na loja nesta semana"; toque em Voltar a cotar'; -- D26
  end if;
  if cot_pronta_sem_sinal(c) then
    raise exception 'esta cotação ainda não foi enviada: use Desfazer (não enviei)';
  end if;
  if not (cot_eh_viva(c) or c.resultado is not null) then
    raise exception 'não dá para gerar nova versão desta cotação';
  end if;
  v_compl := cot_tem_resultado(c.semana_id, c.vendedor_id);
  v_id := cot_criar_rascunho(c.semana_id, c.vendedor_id, c.id);
  if v_id is null then
    if v_compl then
      raise exception 'não há item novo para uma cotação complementar';
    end if;
    raise exception 'não há itens para cotar com este vendedor';
  end if;
  return v_id;
end $$;

create or replace function public.cot_cancelar(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if c.status = 'cancelada' then
    return;
  end if;
  if c.status not in ('pronta', 'enviada', 'respondida') then
    raise exception 'só dá para cancelar cotação preparada, enviada ou respondida';
  end if;
  update cot_cotacoes set status = 'cancelada' where id = c.id; -- o código fica: passa a responder "cancelada"
end $$;

-- "Obrigado, desta vez não". Recusa só a pronta sem sinal de envio (D31, D36): a pronta com sinal (que
-- substituiu outra, ou cujo link foi aberto) já está com o vendedor.
create or replace function public.cot_dispensar(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if c.resultado = 'dispensado' then
    return;
  end if;
  if c.resultado = 'pedido' then
    raise exception 'pedido já confirmado';
  end if;
  if cot_pronta_sem_sinal(c) then
    raise exception 'esta cotação ainda não foi enviada: use Desfazer ou Cancelar';
  end if;
  if c.status in ('enviada', 'respondida', 'pronta') or (c.status = 'fechada' and c.resultado is null) then
    update cot_cotacoes set resultado = 'dispensado', status = 'fechada', fechada_em = cot_agora() where id = c.id;
    return;
  end if;
  raise exception 'não dá para dispensar esta cotação';
end $$;

-- Itens do pedido validados e completados (produto_id e preço convertido), ordenados pelo número.
-- Levanta a exceção com a mensagem exata do contrato (4.13) no primeiro problema.
create or replace function public.cot_pedido_normalizado(p_cotacao bigint, p_itens jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  e jsonb; x cot_itens; v_num numeric; v_n text; v_vistos numeric[] := '{}'; v_qtd numeric; v_base text;
  v_emb numeric; v_fator numeric; v_preco numeric; v_conv numeric; v_linhas jsonb := '[]'::jsonb;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'o pedido precisa de pelo menos um item';
  end if;
  for e in select y from jsonb_array_elements(p_itens) with ordinality as t(y, n) order by n loop
    v_num := case when jsonb_typeof(e) = 'object' then cot_num(e, 'numero') end;
    v_n := coalesce(v_num::text, case when jsonb_typeof(e) = 'object' then e ->> 'numero' end, '?');
    if v_num = any(v_vistos) then
      raise exception 'item % repetido no pedido', v_n;
    end if;
    v_vistos := v_vistos || v_num;
    select * into x from cot_itens i where i.cotacao_id = p_cotacao and i.numero = v_num and i.incluido and i.estado = 'tem';
    if not found then
      raise exception 'item % não está cotado com preço', v_n;
    end if;
    v_n := x.numero::text;
    v_qtd := cot_num(e, 'qtd');
    if v_qtd is null or v_qtd <= 0 or v_qtd > 1000000 then
      raise exception 'quantidade inválida no item %', v_n;
    end if;
    v_base := case when jsonb_typeof(e -> 'base') = 'string' then e ->> 'base' end;
    if v_base is null or (x.unidade = 'un' and v_base not in ('un', 'embalagem'))
       or (x.unidade = 'kg' and v_base not in ('kg', 'litro', 'embalagem')) then
      raise exception 'base incompatível no item %', v_n;
    end if;
    v_emb := cot_num(e, 'embalagens');
    v_fator := cot_num(e, 'fator');
    if coalesce(jsonb_typeof(e -> 'embalagens'), 'null') not in ('number', 'null')
       or coalesce(jsonb_typeof(e -> 'fator'), 'null') not in ('number', 'null')
       or (v_base = 'embalagem' and (v_emb is null or v_emb <> trunc(v_emb) or v_emb < 1 or v_emb > 1000000))
       or (v_base = 'embalagem' and v_fator is not null and v_fator <= 0)
       or (v_base <> 'embalagem' and (v_emb is not null or v_fator is not null)) then
      raise exception 'embalagem inválida no item %', v_n;
    end if;
    v_preco := cot_num(e, 'preco_combinado');
    if v_preco is null or not cot_dinheiro_ok(v_preco) then
      raise exception 'preço inválido no item %', v_n;
    end if;
    -- D44: na caixa em ml de item em kg com kg_por_litro, o App manda o fator em kg por caixa, e o preço
    -- convertido sai daqui; sem kg_por_litro o fator vem null e o preço fica sem conversão
    v_conv := case when v_base in ('un', 'kg') then v_preco
                   when v_base = 'embalagem' and v_fator is not null then round(v_preco / v_fator, 4)
                   when v_base = 'litro' and x.kg_por_litro is not null then round(v_preco / x.kg_por_litro, 4) end;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'produto_id', x.produto_id, 'numero', x.numero, 'embalagens', v_emb, 'fator', v_fator, 'qtd', v_qtd,
      'preco_combinado', v_preco, 'base', v_base, 'preco_convertido', v_conv, 'marca', x.marca_informada));
  end loop;
  return (select jsonb_agg(l order by (l ->> 'numero')::int) from jsonb_array_elements(v_linhas) l);
end $$;

create or replace function public.cot_gravar_pedido(p_cotacao bigint, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; pe cot_pedidos; v_norm jsonb;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  if c.resultado = 'pedido' then
    begin
      v_norm := cot_pedido_normalizado(c.id, p_itens);
    exception when others then
      v_norm := null;
    end;
    select * into pe from cot_pedidos where cotacao_id = c.id;
    if v_norm is not null and v_norm = pe.itens then
      return jsonb_build_object('cotacao_id', pe.cotacao_id, 'confirmado_por', pe.confirmado_por,
                                'confirmado_em', cot_iso(pe.confirmado_em), 'itens', pe.itens); -- repetir igual: idempotente
    end if;
    raise exception 'pedido já confirmado';
  end if;
  if c.resultado = 'dispensado' or not cot_eh_viva(c) then
    raise exception 'esta cotação não aceita pedido';
  end if;
  -- D32: qualquer viva com item "tem" (a v2 nasce pronta com as respostas copiadas da v1)
  if not exists (select 1 from cot_itens x where x.cotacao_id = c.id and x.incluido and x.estado = 'tem') then
    raise exception 'a cotação ainda não tem item com preço';
  end if;
  v_norm := cot_pedido_normalizado(c.id, p_itens);
  insert into cot_pedidos (cotacao_id, confirmado_por, confirmado_em, itens)
  values (c.id, email_atual(), cot_agora(), v_norm)
  returning * into pe;
  update cot_cotacoes set resultado = 'pedido', status = 'fechada', fechada_em = cot_agora() where id = c.id;
  return jsonb_build_object('cotacao_id', pe.cotacao_id, 'confirmado_por', pe.confirmado_por,
                            'confirmado_em', cot_iso(pe.confirmado_em), 'itens', pe.itens);
end $$;

-- "O vendedor não confirmou — desfazer pedido" (D67): o pedido é gravado no toque em Confirmar, antes de o vendedor
-- responder o "Pode confirmar, por favor?" (10.3). Se ele não confirma, ou a quantidade foi digitada errada, o pedido
-- volta a ser só cotação: apaga a linha de cot_pedidos e a cotação volta a viva sem resultado — `fechada` se o
-- fechamento já passou, senão `respondida` (ela tem item com preço, D32). Daí o Ivan refaz o mapa (cot_gravar_pedido)
-- ou toca "Obrigado, desta vez não" (cot_dispensar); até lá os itens com preço ficam "Em cotação" (4.15, regra 2), e
-- nem a etiqueta "Pedido" nem a economia contam o pedido desfeito. Só na semana em compra e sem outra versão viva nem
-- "Comprar na loja" do vendedor (as duas não podem conviver com uma viva). Um rascunho do vendedor (a complementar
-- ainda não preparada) é sincronizado: os itens do pedido desfeito voltam a pertencer à viva e entram nele como numa
-- Nova versão.
create or replace function public.cot_desfazer_pedido(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; o cot_cotacoes; v_status text; v_fechou boolean;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  -- travas na ordem do contrato 3.15: semana → outra versão do vendedor → a cotação
  select status into v_status from semanas where id = c.semana_id for update;
  select * into o from cot_cotacoes a
   where a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id and a.id <> c.id
     and (cot_eh_viva(a) or a.status = 'liberada')
   order by a.versao desc limit 1
     for update;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if c.resultado is distinct from 'pedido' then
    if cot_eh_viva(c) then
      return; -- idempotente: o pedido já foi desfeito
    end if;
    raise exception 'esta cotação não tem pedido confirmado';
  end if;
  if v_status <> 'em_compra' then
    raise exception 'a semana desta cotação não está em compra';
  end if;
  if o.status = 'liberada' then
    raise exception 'este vendedor está em "Comprar na loja nesta semana"; toque em Voltar a cotar';
  end if;
  if o.id is not null then
    raise exception 'há outra cotação em andamento com este vendedor (v%): resolva a v% antes de desfazer este pedido',
      o.versao, o.versao;
  end if;
  delete from cot_pedidos where cotacao_id = c.id;
  v_fechou := cot_agora() >= c.fechamento;
  update cot_cotacoes
     set resultado = null,
         status = case when v_fechou then 'fechada' else 'respondida' end,
         fechada_em = case when v_fechou then cot_agora() end
   where id = c.id;
  if exists (select 1 from cot_cotacoes a where a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id
                and a.status = 'rascunho') then
    perform cot_sincronizar(c.semana_id, c.vendedor_id);
  end if;
end $$;

-- "Comprar na loja nesta semana": o vendedor não é cotado nesta semana (as etiquetas dele somem).
create or replace function public.cot_liberar_loja(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  perform 1 from semanas where id = c.semana_id for update;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if c.status = 'liberada' then
    return;
  end if;
  if c.status <> 'rascunho' then
    raise exception 'só dá para liberar um vendedor em rascunho';
  end if;
  if exists (select 1 from cot_cotacoes a where a.semana_id = c.semana_id and a.vendedor_id = c.vendedor_id and cot_eh_viva(a)) then
    raise exception 'já há cotação enviada para este vendedor nesta semana';
  end if;
  update cot_cotacoes set status = 'liberada' where id = c.id;
end $$;

create or replace function public.cot_voltar_a_cotar(p_cotacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c cot_cotacoes; v_status text;
begin
  perform exigir_admin();
  select * into c from cot_cotacoes where id = p_cotacao;
  if not found then
    raise exception 'cotação não encontrada';
  end if;
  select status into v_status from semanas where id = c.semana_id for update;
  select * into c from cot_cotacoes where id = p_cotacao for update;
  if c.status = 'rascunho' then
    return;
  end if;
  if c.status <> 'liberada' then
    raise exception 'esta cotação não está em "Comprar na loja"';
  end if;
  if v_status <> 'em_compra' then
    raise exception 'a semana desta cotação não está em compra';
  end if;
  update cot_cotacoes set status = 'rascunho' where id = c.id; -- o próximo cot_preparar sincroniza
end $$;

-- ================= Etiquetas para Comprar e Resumo (8.3)

-- Contrato 4.15. Para cada item da semana, a primeira regra que valer (só itens com etiqueta):
-- 1. pedido — o produto está no pedido de uma cotação da semana, ou (semana em compra) de uma cotação da
--    semana anterior que atravessa esta (D43); mais de um → o de confirmação mais recente;
-- 2. em_cotacao — semana em compra; linha incluída numa versão viva COM SINAL DE ENVIO desta semana (pelo
--    item) ou de uma que atravessa esta (pelo produto), sem "não tenho", e antes do fechamento ou com preço
--    (D36); mais de uma → a de menor id;
-- 3. aguardando_cotacao — semana em compra; o item pertence a um vendedor ativo que ainda não teve versão que
--    "saiu" (a pronta sem sinal não sai); não está desmarcado no rascunho nem numa pronta sem sinal dele; o
--    vendedor não está em "Comprar na loja"; e antes de aguardando_ate;
-- 4. sem etiqueta nos demais casos (item fora do pedido, "não tem", sem resposta depois do fechamento,
--    dispensada, liberada, sem vendedor).
-- qtd (D63) = quanto a etiqueta cobre, na unidade do SisChef: na regra 1, a soma das linhas do pedido escolhido
-- para o produto; na regra 2, o "só tenho" da linha quando é menor que a quantidade dela (estado 'tem'), senão a
-- quantidade da linha; na regra 3, null (o item inteiro espera). Menor que a aprovada → o App manda comprar o resto.
create or replace function public.cot_marcas(p_semana bigint)
returns table(item_semana_id bigint, estado text, vendedor_id bigint, vendedor text, ate timestamptz, qtd numeric)
language sql stable set search_path = public as $$
  with s as (select x.*, x.status = 'em_compra' as em_compra, cot_aguardando_ate(x.id) as ate from semanas x where x.id = p_semana),
  m as (select * from cot_mapa(p_semana)),
  at as (select * from cot_atravessando(p_semana)),
  ped as (
    -- por (cotação, produto): a quantidade é a soma das linhas do pedido dela para o produto
    select (e ->> 'produto_id')::bigint as produto_id, c.vendedor_id, p.confirmado_em, c.id as cotacao_id,
           sum((e ->> 'qtd')::numeric) as qtd
      from cot_cotacoes c join cot_pedidos p on p.cotacao_id = c.id
      cross join lateral jsonb_array_elements(p.itens) e
     where c.semana_id = p_semana and c.resultado = 'pedido'
     group by 1, 2, 3, 4
    union all
    select a.produto_id, a.vendedor_id, a.confirmado_em, a.cotacao_id, sum((e ->> 'qtd')::numeric)
      from (select distinct x.produto_id, x.vendedor_id, x.confirmado_em, x.cotacao_id from at x where x.tipo = 'pedido') a
      join cot_pedidos p on p.cotacao_id = a.cotacao_id
      cross join lateral jsonb_array_elements(p.itens) e
     where (e ->> 'produto_id')::bigint = a.produto_id
     group by 1, 2, 3, 4
  ),
  emc as (
    -- versões vivas com sinal desta semana (casam pelo item) e as que atravessam (casam pelo produto);
    -- qtd = o "só tenho" menor que a quantidade da linha (só com 'tem'), senão a quantidade da linha
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
    select m.item_semana_id, pd.vendedor_id as v_pedido, pd.qtd as q_pedido, ec.vendedor_id as v_cotacao, ec.qtd as q_cotacao,
           case when m.dono is not null
                 and exists (select 1 from cot_vendedores v where v.id = m.dono and v.ativo)
                 and not exists (select 1 from cot_cotacoes c where c.semana_id = p_semana and c.vendedor_id = m.dono
                                    and (cot_saiu(c) or c.status = 'liberada'))
                 and not exists (select 1 from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
                                  where x.item_semana_id = m.item_semana_id and not x.incluido and c.vendedor_id = m.dono
                                    and (c.status = 'rascunho' or cot_pronta_sem_sinal(c)))
                then m.dono end as v_aguardando
      from m
      left join lateral (select p.vendedor_id, p.qtd from ped p where p.produto_id = m.produto_id
                          order by p.confirmado_em desc, p.cotacao_id desc limit 1) pd on true
      left join lateral (select x.vendedor_id, x.qtd from emc x
                          where x.item_semana_id = m.item_semana_id or x.produto_id = m.produto_id
                          order by x.cotacao_id limit 1) ec on true
  ),
  e as (
    select r.item_semana_id,
           case when r.v_pedido is not null then 'pedido'
                when s.em_compra and r.v_cotacao is not null then 'em_cotacao'
                when s.em_compra and r.v_aguardando is not null and s.ate is not null and cot_agora() < s.ate
                  then 'aguardando_cotacao' end as estado,
           r.v_pedido, r.q_pedido, r.v_cotacao, r.q_cotacao, r.v_aguardando, s.ate
      from r cross join s
  )
  select e.item_semana_id, e.estado, v.id, cot_rotulo(v.empresa),
         case when e.estado = 'aguardando_cotacao' then e.ate end,
         case e.estado when 'pedido' then e.q_pedido when 'em_cotacao' then e.q_cotacao end
    from e
    join cot_vendedores v on v.id = case e.estado when 'pedido' then e.v_pedido when 'em_cotacao' then e.v_cotacao
                                                  else e.v_aguardando end
   where e.estado is not null
   order by e.item_semana_id
$$;

create or replace function public.cot_marcas_semana(p_semana bigint)
returns table(item_semana_id bigint, estado text, vendedor_id bigint, vendedor text, ate timestamptz, qtd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_status text; v_admin boolean;
begin
  perform exigir_ativo();
  select s.status into v_status from semanas s where s.id = p_semana;
  if not found then
    return;
  end if;
  v_admin := eh_admin();
  if v_status <> 'em_compra' and not v_admin then
    return; -- espelha a RLS: comprador só vê a semana em compra
  end if;
  return query select m.item_semana_id, m.estado, m.vendedor_id, m.vendedor, m.ate, m.qtd from cot_marcas(p_semana) m;
end $$;

-- ================= Funções do serviço (service_role, chamadas pelo robô)

create or replace function public.cot_coleta(p_semana bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_agora timestamptz := cot_agora(); v_em semanas; v_semanas bigint[]; v_ref date; v_pend jsonb; v_res jsonb;
begin
  select * into v_em from semanas where status = 'em_compra' order by id limit 1;
  if p_semana is not null then
    v_semanas := array(select s.id from semanas s where s.id = p_semana);
    v_ref := (select s.data_referencia from semanas s where s.id = p_semana);
  else
    v_semanas := array(select s.id from semanas s
                        where s.status = 'em_compra'
                           or exists (select 1 from cot_cotacoes c where c.semana_id = s.id and c.fechamento > v_agora - interval '8 days')
                        order by s.id);
    v_ref := coalesce(v_em.data_referencia,
                      (select max(s.data_referencia) from semanas s where exists (select 1 from cot_cotacoes c where c.semana_id = s.id)));
  end if;

  v_pend := case when v_em.id is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('vendedor_id', v.id, 'codigo', v.codigo, 'rotulo', cot_rotulo(v.empresa),
                                        'empresa', v.empresa, 'nome', v.nome, 'itens', p.itens) order by v.id)
      from (select m.vendedor_id, count(*)::int as itens from cot_marcas(v_em.id) m
             where m.estado = 'aguardando_cotacao' group by m.vendedor_id) p
      join cot_vendedores v on v.id = p.vendedor_id and v.ativo), '[]'::jsonb) end;

  select jsonb_build_object(
    'agora', cot_iso(v_agora),
    'agora_local', cot_local(v_agora),
    'semana_em_compra', case when v_em.id is not null then jsonb_build_object(
        'id', v_em.id, 'data_referencia', cot_data_txt(v_em.data_referencia),
        'aprovada_em', cot_iso(v_em.aprovada_em), 'aguardando_ate', cot_iso(cot_aguardando_ate(v_em.id))) end,
    'pendentes_preparar', v_pend,
    'semanas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data_referencia', cot_data_txt(s.data_referencia),
                                                             'status', s.status) order by s.id)
                           from semanas s where s.id = any(v_semanas)), '[]'::jsonb),
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'codigo', v.codigo, 'nome', v.nome,
                                                                'empresa', v.empresa, 'rotulo', cot_rotulo(v.empresa),
                                                                'ativo', v.ativo) order by v.id)
                              from cot_vendedores v
                             where v.id in (select c.vendedor_id from cot_cotacoes c where c.semana_id = any(v_semanas))
                                or v.id in (select (e ->> 'vendedor_id')::bigint from jsonb_array_elements(v_pend) e)), '[]'::jsonb),
    -- taxa de resposta (D40): respondidas conta resposta de qualquer origem (link, texto colado ou digitado
    -- pelo Ivan); pelo_link, só as semanas com envio aceito pela página. Cotação cancelada não valeu (ensaio,
    -- envio por engano) e sai das três contagens, com as versões substituídas que levariam a ela (3.13); a
    -- resposta que não virou pedido é a dispensada ("Obrigado, desta vez não"), que continua contando.
    'historico', coalesce((select jsonb_agg(jsonb_build_object('vendedor_id', h.vendedor_id, 'enviadas', h.enviadas,
                                                               'respondidas', h.respondidas, 'pelo_link', h.pelo_link)
                                            order by h.vendedor_id)
                             from (select c.vendedor_id,
                                          (count(distinct c.semana_id) filter (where k.valeu and c.enviada_em is not null))::int
                                            as enviadas,
                                          (count(distinct c.semana_id) filter (
                                             where k.valeu and c.status not in ('rascunho', 'liberada')
                                               and (exists (select 1 from cot_itens x where x.cotacao_id = c.id and x.estado <> 'sem_resposta')
                                                    or c.pagamento is not null or c.validade is not null or c.pedido_minimo is not null
                                                    or c.frete is not null or c.entrega is not null or c.observacao is not null)))::int
                                            as respondidas,
                                          (count(distinct c.semana_id) filter (where k.valeu and c.envios_aceitos > 0))::int as pelo_link
                                     from cot_cotacoes c join semanas s on s.id = c.semana_id
                                          cross join lateral (select case when c.status = 'substituida'
                                                                          then cot_estado_efetivo(c.id) ->> 'estado' <> 'cancelada'
                                                                          else c.status <> 'cancelada' end as valeu) k
                                    where v_ref is not null and s.data_referencia between v_ref - 49 and v_ref
                                    group by c.vendedor_id) h), '[]'::jsonb),
    'cotacoes', coalesce((select jsonb_agg(cot_coleta_cotacao(c) order by c.semana_id, c.vendedor_id, c.versao)
                            from cot_cotacoes c where c.semana_id = any(v_semanas)), '[]'::jsonb))
    into v_res;
  return v_res;
end $$;

-- Uma cotação no formato de cot_coleta (sem telefone e sem código).
create or replace function public.cot_coleta_cotacao(c cot_cotacoes) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'semana_id', c.semana_id, 'vendedor_id', c.vendedor_id, 'versao', c.versao,
    'complementar', c.complementar, 'substituida_por', c.substituida_por, 'status', c.status, 'resultado', c.resultado,
    'congelada_em', cot_iso(c.congelada_em), 'enviada_em', cot_iso(c.enviada_em), 'fechada_em', cot_iso(c.fechada_em),
    'prazo', cot_iso(c.prazo), 'fechamento', cot_iso(c.fechamento),
    'prazo_local', cot_local(c.prazo), 'fechamento_local', cot_local(c.fechamento),
    'primeiro_acesso', cot_iso(c.primeiro_acesso), 'ultimo_acesso', cot_iso(c.ultimo_acesso), 'acessos', c.acessos,
    'envios_aceitos', c.envios_aceitos, 'ultimo_envio_em', cot_iso(c.ultimo_envio_em),
    'gerais', cot_gerais_json(c) || jsonb_build_object('rev', c.gerais_rev, 'origem', c.gerais_origem),
    'respostas_rev', c.respostas_rev, 'notificado_hash', c.notificado_hash, 'notificado_em', cot_iso(c.notificado_em),
    'cobranca_em', cot_iso(c.cobranca_em), 'consolidado_em', cot_iso(c.consolidado_em), 'consolidado_rev', c.consolidado_rev,
    'resumo', (select to_jsonb(r) - 'cotacao_id' from cot_resumo r where r.cotacao_id = c.id),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'numero', x.numero, 'produto_id', x.produto_id, 'item_semana_id', x.item_semana_id, 'produto', i.produto,
        'nome', x.nome, 'unidade', x.unidade, 'rotulo', x.rotulo, 'vende_por_litro', x.vende_por_litro,
        'incluido', x.incluido, 'qtd', x.qtd, 'qtd_sugerida', x.qtd_sugerida, 'embalagem', x.embalagem,
        'fator', x.fator, 'fator_confirmado', x.fator_confirmado, 'kg_por_litro', x.kg_por_litro,
        'nota_vendedor', x.nota_vendedor,
        'ref_preco', x.ref_preco, 'ref_data', cot_data_txt(x.ref_data), 'ref_situacao', x.ref_situacao, 'delta', x.delta,
        'estado', x.estado, 'preco_digitado', x.preco_digitado, 'base', x.base, 'emb_unidades', x.emb_unidades,
        'emb_gramas', x.emb_gramas, 'emb_ml', x.emb_ml, 'fator_informado', x.fator_informado,
        'preco_convertido', x.preco_convertido, 'tenho_so', x.tenho_so, 'similar_desc', x.similar_desc,
        'similar_preco', x.similar_preco, 'a_partir_de', x.a_partir_de, 'marca_informada', x.marca_informada,
        'avisos_vendedor', to_jsonb(x.avisos_vendedor), 'avisos_ivan', to_jsonb(x.avisos_ivan),
        'confirmado_pelo_vendedor', x.confirmado_pelo_vendedor, 'origem', x.origem,
        'copiada_da_versao', x.copiada_da_versao, 'respondido_em', cot_iso(x.respondido_em), 'rev', x.rev)
        order by x.numero nulls last, x.nome collate "C")
      from cot_itens_admin x join itens_semana i on i.id = x.item_semana_id
     where x.cotacao_id = c.id), '[]'::jsonb),
    'pedido', (select jsonb_build_object('confirmado_por', p.confirmado_por, 'confirmado_em', cot_iso(p.confirmado_em),
                                         'itens', p.itens)
                 from cot_pedidos p where p.cotacao_id = c.id))
$$;

-- Compare-and-set do e-mail de resposta (D2): reserva com o hash novo; devolução quando o e-mail falha.
create or replace function public.cot_marcar_notificado(p_cotacao bigint, p_hash_antigo text, p_hash_novo text,
                                                        p_em timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update cot_cotacoes set notificado_hash = p_hash_novo, notificado_em = p_em
   where id = p_cotacao and notificado_hash is not distinct from p_hash_antigo;
  return found;
end $$;

create or replace function public.cot_marcar_cobranca(p_cotacao bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update cot_cotacoes set cobranca_em = cot_agora() where id = p_cotacao and cobranca_em is null;
  return found;
end $$;

create or replace function public.cot_liberar_cobranca(p_cotacao bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update cot_cotacoes set cobranca_em = null where id = p_cotacao and cobranca_em is not null;
  return found;
end $$;

create or replace function public.cot_marcar_aviso(p_semana bigint, p_vendedor bigint, p_tipo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_tipo is distinct from 'preparar' then
    raise exception 'tipo de aviso inválido';
  end if;
  insert into cot_avisos (semana_id, vendedor_id, tipo, enviado_em) values (p_semana, p_vendedor, p_tipo, cot_agora())
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

create or replace function public.cot_desmarcar_aviso(p_semana bigint, p_vendedores bigint[], p_tipo text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_tipo is distinct from 'preparar' then
    raise exception 'tipo de aviso inválido';
  end if;
  delete from cot_avisos where semana_id = p_semana and vendedor_id = any(p_vendedores) and tipo = p_tipo;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Fecha as vencidas (enviada/respondida, 5 min depois do fechamento; pronta nunca), expira os códigos com
-- fechamento há 14 dias ou mais (qualquer status; D38: um link antigo repassado não fica vivo para sempre) e
-- lista as semanas com consolidado pendente.
create or replace function public.cot_fechar_vencidas() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_agora timestamptz := cot_agora(); v_fechadas jsonb; v_expirados jsonb;
begin
  with f as (
    update cot_cotacoes set status = 'fechada', fechada_em = v_agora
     where status in ('enviada', 'respondida') and v_agora >= fechamento + interval '5 minutes'
    returning id)
  select coalesce(jsonb_agg(f.id order by f.id), '[]'::jsonb) into v_fechadas from f;
  with x as (
    update cot_cotacoes set codigo_hash = null
     where codigo_hash is not null and fechamento + interval '14 days' <= v_agora
    returning id)
  select coalesce(jsonb_agg(x.id order by x.id), '[]'::jsonb) into v_expirados from x;
  delete from cot_codigos k using cot_cotacoes c
   where k.cotacao_id = c.id and c.fechamento + interval '14 days' <= v_agora;
  return jsonb_build_object(
    'agora', cot_iso(v_agora),
    'fechadas', v_fechadas,
    'expirados', v_expirados,
    'semanas', coalesce((
      select jsonb_agg(jsonb_build_object('semana_id', s.id, 'data_referencia', cot_data_txt(s.data_referencia), 'tipo', t.tipo)
                       order by s.id)
        from semanas s
        cross join lateral (
          select case
            when exists (select 1 from cot_cotacoes c where c.semana_id = s.id
                            and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
                            and c.fechamento + interval '5 minutes' <= v_agora and c.consolidado_em is null) then 'consolidado'
            when exists (select 1 from cot_cotacoes c where c.semana_id = s.id
                            and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
                            and c.consolidado_em is not null and c.respostas_rev + c.gerais_rev > c.consolidado_rev) then 'atualizado'
          end as tipo) t
       where t.tipo is not null), '[]'::jsonb));
end $$;

-- Reserva do consolidado da semana (compare-and-set em consolidado_em/consolidado_rev, D4).
create or replace function public.cot_reservar_consolidado(p_semana bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_agora timestamptz := cot_agora(); v_a bigint[]; v_b bigint[]; v_tipo text; v_ids bigint[]; v_antes jsonb;
begin
  perform 1 from cot_cotacoes where semana_id = p_semana order by id for update;
  v_a := array(select c.id from cot_cotacoes c where c.semana_id = p_semana
                  and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
                  and c.fechamento + interval '5 minutes' <= v_agora and c.consolidado_em is null order by c.id);
  v_b := array(select c.id from cot_cotacoes c where c.semana_id = p_semana
                  and c.status in ('pronta', 'enviada', 'respondida', 'fechada')
                  and c.consolidado_em is not null and c.respostas_rev + c.gerais_rev > c.consolidado_rev order by c.id);
  if cardinality(v_a) > 0 then
    v_tipo := 'consolidado';
    v_ids := v_a || v_b;
  elsif cardinality(v_b) > 0 then
    v_tipo := 'atualizado';
    v_ids := v_b;
  else
    return jsonb_build_object('semana_id', p_semana, 'tipo', null, 'reservada_em', null,
      'parcial', exists (select 1 from cot_cotacoes c where c.semana_id = p_semana
                          and c.status in ('pronta', 'enviada', 'respondida') and v_agora < c.fechamento + interval '5 minutes'),
      'ids', '[]'::jsonb, 'antes', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'consolidado_em', cot_iso(c.consolidado_em),
                                               'consolidado_rev', c.consolidado_rev) order by c.id), '[]'::jsonb)
    into v_antes from cot_cotacoes c where c.id = any(v_ids);
  update cot_cotacoes set consolidado_em = v_agora, consolidado_rev = respostas_rev + gerais_rev where id = any(v_a);
  update cot_cotacoes set consolidado_rev = respostas_rev + gerais_rev where id = any(v_b);
  return jsonb_build_object(
    'semana_id', p_semana, 'tipo', v_tipo, 'reservada_em', cot_iso(v_agora),
    'parcial', exists (select 1 from cot_cotacoes c where c.semana_id = p_semana
                        and c.status in ('pronta', 'enviada', 'respondida') and v_agora < c.fechamento + interval '5 minutes'),
    'ids', to_jsonb(v_ids), 'antes', v_antes);
end $$;

-- Devolve a reserva quando o e-mail do consolidado falhou: restaura os valores de "antes".
create or replace function public.cot_liberar_consolidado(p_reserva jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_n int := 0; v_um int;
begin
  for e in select x from jsonb_array_elements(coalesce(p_reserva -> 'antes', '[]'::jsonb)) x loop
    update cot_cotacoes
       set consolidado_em = (e ->> 'consolidado_em')::timestamptz, consolidado_rev = (e ->> 'consolidado_rev')::int
     where id = (e ->> 'id')::bigint;
    get diagnostics v_um = row_count;
    v_n := v_n + v_um;
  end loop;
  return v_n;
end $$;

-- ================= Cadastros (CSVs do repositório privado, D5)

create or replace function public.cot_cadastro_erro(p_arquivo text, p_linha text, p_motivo text) returns void
language plpgsql volatile set search_path = public as $$
begin
  raise exception 'cadastro inválido: % linha %: %', p_arquivo, p_linha, p_motivo;
end $$;

-- Valida e aplica os quatro CSVs numa transação só (vendedores → fornecedores → catálogo → feriados).
-- Linha igual à última aplicada (mesmo hash) é pulada: um push que não mexeu nela não desfaz uma escolha
-- feita no App. Qualquer linha inválida → exceção e nada é aplicado.
create or replace function public.cot_aplicar_cadastros(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_arq text; v_lista jsonb; e jsonb; v_ord bigint; v_lin text; v_chave text; v_chaves text[]; v_hash text;
  v_total int; v_aplic int; v_res jsonb := '{}'::jsonb; v_vend bigint; v_data date;
  v_fator numeric; v_kg numeric; v_fconf date; v_kconf date;
  f_codigo text; f_nome text; f_empresa text; f_whats text; f_ativo text;
  f_prod text; f_vcod text; f_npv text; f_emb text; f_fator text; f_fconf text; f_litro text; f_kg text; f_kconf text;
  f_desc text; f_cod text; f_de text; f_nota text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'cadastro inválido: o envio precisa ser um objeto';
  end if;
  foreach v_arq in array array['vendedores', 'fornecedores', 'catalogo', 'feriados'] loop
    v_lista := p -> v_arq;
    v_total := 0; v_aplic := 0; v_chaves := '{}';
    if v_lista is not null and jsonb_typeof(v_lista) <> 'null' then
      if jsonb_typeof(v_lista) <> 'array' then
        raise exception 'cadastro inválido: % não é uma lista', v_arq;
      end if;
      for e, v_ord in select x, n from jsonb_array_elements(v_lista) with ordinality as t(x, n) order by n loop
        v_total := v_total + 1;
        if jsonb_typeof(e) <> 'object' then
          perform cot_cadastro_erro(v_arq, v_ord::text, 'a linha não é um objeto');
        end if;
        v_lin := coalesce(e ->> 'linha', v_ord::text);

        if v_arq = 'vendedores' then
          f_codigo := trim(coalesce(e ->> 'codigo', '')); f_nome := trim(coalesce(e ->> 'nome', ''));
          f_empresa := trim(coalesce(e ->> 'empresa', '')); f_whats := trim(coalesce(e ->> 'whatsapp', ''));
          f_ativo := trim(coalesce(e ->> 'ativo', ''));
          if f_codigo !~ '^[a-z0-9_]{1,30}$' then perform cot_cadastro_erro(v_arq, v_lin, 'codigo inválido'); end if;
          if char_length(f_nome) not between 1 and 60 then perform cot_cadastro_erro(v_arq, v_lin, 'nome precisa ter de 1 a 60 caracteres'); end if;
          if char_length(f_empresa) not between 1 and 80 then perform cot_cadastro_erro(v_arq, v_lin, 'empresa precisa ter de 1 a 80 caracteres'); end if;
          if f_whats !~ '^55[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$' then perform cot_cadastro_erro(v_arq, v_lin, 'whatsapp inválido'); end if;
          if f_ativo not in ('true', 'false') then perform cot_cadastro_erro(v_arq, v_lin, 'ativo precisa ser true ou false'); end if;
          v_chave := f_codigo;
        elsif v_arq = 'fornecedores' then
          f_nome := trim(coalesce(e ->> 'nome_fornecedor', '')); f_vcod := trim(coalesce(e ->> 'vendedor_codigo', ''));
          if char_length(f_nome) not between 1 and 200 then perform cot_cadastro_erro(v_arq, v_lin, 'nome_fornecedor precisa ter de 1 a 200 caracteres'); end if;
          select id into v_vend from cot_vendedores where codigo = f_vcod;
          if v_vend is null then perform cot_cadastro_erro(v_arq, v_lin, 'vendedor_codigo desconhecido'); end if;
          v_chave := cot_normalizar(f_nome);
        elsif v_arq = 'catalogo' then
          f_prod := trim(coalesce(e ->> 'produto_id', '')); f_vcod := trim(coalesce(e ->> 'vendedor_codigo', ''));
          f_npv := trim(coalesce(e ->> 'nome_para_vendedor', '')); f_emb := trim(coalesce(e ->> 'embalagem', ''));
          f_fator := trim(coalesce(e ->> 'fator', '')); f_fconf := trim(coalesce(e ->> 'fator_confirmado_em', ''));
          f_litro := trim(coalesce(e ->> 'vende_por_litro', '')); f_kg := trim(coalesce(e ->> 'kg_por_litro', ''));
          f_kconf := trim(coalesce(e ->> 'kg_por_litro_confirmado_em', ''));
          f_desc := trim(coalesce(e ->> 'descricao_fornecedor', '')); f_cod := trim(coalesce(e ->> 'codigo_fornecedor', ''));
          f_de := trim(coalesce(e ->> 'descricao_de_fornecedor', ''));
          f_nota := trim(coalesce(e ->> 'nota_vendedor', ''));
          -- (casts só depois da regex: o OR do SQL não garante a ordem de avaliação)
          if f_prod !~ '^[0-9]{1,18}$' then perform cot_cadastro_erro(v_arq, v_lin, 'produto_id inválido'); end if;
          if f_prod::bigint <= 0 then perform cot_cadastro_erro(v_arq, v_lin, 'produto_id inválido'); end if;
          v_vend := null;
          if f_vcod <> '' then
            select id into v_vend from cot_vendedores where codigo = f_vcod;
            if v_vend is null then perform cot_cadastro_erro(v_arq, v_lin, 'vendedor_codigo desconhecido'); end if;
          end if;
          if char_length(f_npv) > 80 then perform cot_cadastro_erro(v_arq, v_lin, 'nome_para_vendedor com mais de 80 caracteres'); end if;
          if f_emb not in ('', 'fardo', 'caixa', 'pacote', 'saco') then perform cot_cadastro_erro(v_arq, v_lin, 'embalagem inválida'); end if;
          if f_fator <> '' and f_fator !~ '^[0-9]{1,12}(\.[0-9]{1,12})?$' then perform cot_cadastro_erro(v_arq, v_lin, 'fator inválido'); end if;
          if f_fator <> '' and f_fator::numeric <= 0 then perform cot_cadastro_erro(v_arq, v_lin, 'fator inválido'); end if;
          if f_fconf <> '' and cot_ler_data(f_fconf) is null then perform cot_cadastro_erro(v_arq, v_lin, 'fator_confirmado_em inválido'); end if;
          if f_fconf <> '' and f_fator = '' then perform cot_cadastro_erro(v_arq, v_lin, 'fator_confirmado_em sem fator'); end if;
          if f_litro not in ('', 'true', 'false') then perform cot_cadastro_erro(v_arq, v_lin, 'vende_por_litro precisa ser true, false ou vazio'); end if;
          if f_kg <> '' and f_kg !~ '^[0-9]{1,12}(\.[0-9]{1,12})?$' then perform cot_cadastro_erro(v_arq, v_lin, 'kg_por_litro inválido'); end if;
          if f_kg <> '' and f_kg::numeric <= 0 then perform cot_cadastro_erro(v_arq, v_lin, 'kg_por_litro inválido'); end if;
          if f_kconf <> '' and cot_ler_data(f_kconf) is null then perform cot_cadastro_erro(v_arq, v_lin, 'kg_por_litro_confirmado_em inválido'); end if;
          if f_kconf <> '' and f_kg = '' then perform cot_cadastro_erro(v_arq, v_lin, 'kg_por_litro_confirmado_em sem kg_por_litro'); end if;
          if char_length(f_desc) > 200 then perform cot_cadastro_erro(v_arq, v_lin, 'descricao_fornecedor com mais de 200 caracteres'); end if;
          if char_length(f_cod) > 60 then perform cot_cadastro_erro(v_arq, v_lin, 'codigo_fornecedor com mais de 60 caracteres'); end if;
          if char_length(f_de) > 200 then perform cot_cadastro_erro(v_arq, v_lin, 'descricao_de_fornecedor com mais de 200 caracteres'); end if;
          if (f_desc <> '' or f_cod <> '') and f_de = '' then perform cot_cadastro_erro(v_arq, v_lin, 'descricao_de_fornecedor obrigatório com descrição ou código'); end if;
          if char_length(f_nota) > 80 then perform cot_cadastro_erro(v_arq, v_lin, 'nota_vendedor com mais de 80 caracteres'); end if;
          if f_nota ~ '[\x01-\x1F\x7F\u0080-\u009F]' then perform cot_cadastro_erro(v_arq, v_lin, 'nota_vendedor com caractere inválido'); end if;
          v_chave := f_prod::bigint::text;
        else -- feriados
          f_nome := trim(coalesce(e ->> 'nome', ''));
          v_data := cot_ler_data(trim(coalesce(e ->> 'data', '')));
          if v_data is null then perform cot_cadastro_erro(v_arq, v_lin, 'data inválida'); end if;
          if char_length(f_nome) not between 1 and 60 then perform cot_cadastro_erro(v_arq, v_lin, 'nome precisa ter de 1 a 60 caracteres'); end if;
          v_chave := cot_data_txt(v_data);
        end if;

        if v_chave = any(v_chaves) then
          perform cot_cadastro_erro(v_arq, v_lin, 'chave repetida no arquivo');
        end if;
        v_chaves := v_chaves || v_chave;
        v_hash := encode(sha256(convert_to((e - 'linha')::text, 'UTF8')), 'hex');
        if exists (select 1 from cot_cadastros_aplicados a where a.arquivo = v_arq and a.chave = v_chave and a.hash_linha = v_hash) then
          continue; -- linha igual à última aplicada
        end if;

        if v_arq = 'vendedores' then
          insert into cot_vendedores (codigo, nome, empresa, whatsapp, ativo) values (f_codigo, f_nome, f_empresa, f_whats, f_ativo::boolean)
          on conflict (codigo) do update
             set nome = excluded.nome, empresa = excluded.empresa, whatsapp = excluded.whatsapp, ativo = excluded.ativo;
        elsif v_arq = 'fornecedores' then
          insert into cot_fornecedores (nome_normalizado, nome_original, vendedor_id) values (v_chave, f_nome, v_vend)
          on conflict (nome_normalizado) do update set nome_original = excluded.nome_original, vendedor_id = excluded.vendedor_id;
        elsif v_arq = 'catalogo' then
          v_fator := nullif(f_fator, '')::numeric; v_kg := nullif(f_kg, '')::numeric;
          v_fconf := cot_ler_data(nullif(f_fconf, '')); v_kconf := cot_ler_data(nullif(f_kconf, ''));
          -- a linha inteira é a decisão explícita do Ivan: vazio = sem valor (trocar o vendedor sem
          -- descrição, código e fator os deixa nulos)
          insert into cot_catalogo as k (produto_id, vendedor_id, origem, nome_para_vendedor, embalagem, fator, fator_confirmado_em,
                                         vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em, descricao_fornecedor,
                                         codigo_fornecedor, descricao_de_fornecedor, nota_vendedor, atualizado_em)
          values (f_prod::bigint, v_vend, 'seed', nullif(f_npv, ''), nullif(f_emb, ''), v_fator,
                  case when v_fconf is not null then cot_instante(v_fconf, time '00:00') end,
                  coalesce(nullif(f_litro, '')::boolean, false), v_kg,
                  case when v_kconf is not null then cot_instante(v_kconf, time '00:00') end,
                  nullif(f_desc, ''), nullif(f_cod, ''), cot_normalizar(nullif(f_de, '')), nullif(f_nota, ''), cot_agora())
          on conflict (produto_id) do update
             set vendedor_id = excluded.vendedor_id, origem = 'seed', nome_para_vendedor = excluded.nome_para_vendedor,
                 embalagem = excluded.embalagem, fator = excluded.fator, fator_confirmado_em = excluded.fator_confirmado_em,
                 vende_por_litro = excluded.vende_por_litro, kg_por_litro = excluded.kg_por_litro,
                 kg_por_litro_confirmado_em = excluded.kg_por_litro_confirmado_em,
                 descricao_fornecedor = excluded.descricao_fornecedor, codigo_fornecedor = excluded.codigo_fornecedor,
                 descricao_de_fornecedor = excluded.descricao_de_fornecedor,
                 nota_vendedor = excluded.nota_vendedor, -- D49: a linha do CSV substitui também a nota do App
                 atualizado_em = excluded.atualizado_em;
        else
          insert into cot_feriados (data, nome) values (v_data, f_nome)
          on conflict (data) do update set nome = excluded.nome;
        end if;
        insert into cot_cadastros_aplicados (arquivo, chave, hash_linha, aplicado_em) values (v_arq, v_chave, v_hash, cot_agora())
        on conflict (arquivo, chave) do update set hash_linha = excluded.hash_linha, aplicado_em = excluded.aplicado_em;
        v_aplic := v_aplic + 1;
      end loop;
    end if;
    v_res := v_res || jsonb_build_object(v_arq, jsonb_build_object('linhas', v_total, 'aplicadas', v_aplic));
  end loop;
  return v_res;
end $$;

-- ================= Permissões (reaplica tudo, no padrão da 20260928000001)

-- 1. Tabelas: o Supabase dá por padrão a anon e authenticated todos os privilégios em toda tabela e
-- sequência nova de public. Leitura pela RLS; escrita só pelas funções (a única tabela gravada direto pelo
-- App é usuarios, tela Pessoas).
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant insert, update on public.usuarios to authenticated;

-- 2. Tabelas e views cot_*: nada para anon; o admin lê (a RLS restringe a eh_admin()); limites, avisos e
-- cadastros aplicados só a chave de serviço.
revoke all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
              public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
              public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
              public.cot_itens_admin, public.cot_resumo, public.cot_economia
  from anon, authenticated;
grant select on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
                public.cot_cotacoes, public.cot_codigos, public.cot_itens, public.cot_envios, public.cot_pedidos,
                public.cot_itens_admin, public.cot_resumo, public.cot_economia
  to authenticated;
grant all on public.cot_vendedores, public.cot_fornecedores, public.cot_catalogo, public.cot_feriados,
             public.cot_cadastros_aplicados, public.cot_cotacoes, public.cot_codigos, public.cot_itens,
             public.cot_envios, public.cot_pedidos, public.cot_limites, public.cot_avisos,
             public.cot_itens_admin, public.cot_resumo, public.cot_economia
  to service_role;

-- 3. Funções: lista completa. As internas (cot_agora, cot_mapa, cot_aplicar_resposta…) ficam sem grant:
-- só são chamadas de dentro das funções security definer.
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
  public.admin_fechar_compra(uuid, boolean, numeric),
  -- Fase 1B: aba Cotações (admin), etiquetas (usuário ativo) e a prévia do vendedor
  public.cot_cancelar(bigint), public.cot_confirmar_envio(bigint), public.cot_congelar(bigint),
  public.cot_dados_envio(bigint), public.cot_definir_nota(bigint, text), public.cot_definir_vendedor(bigint, bigint),
  public.cot_descongelar(bigint), public.cot_desfazer_pedido(bigint),
  public.cot_dispensar(bigint), public.cot_gravar_pedido(bigint, jsonb), public.cot_liberar_loja(bigint),
  public.cot_marcar_item(bigint, boolean), public.cot_marcas_semana(bigint), public.cot_nova_versao(bigint),
  public.cot_preparar(bigint), public.cot_responder_admin(bigint, uuid, jsonb, jsonb, text),
  public.cot_trocar_codigo(bigint), public.cot_voltar_a_cotar(bigint),
  public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb)
  to authenticated;
-- A página do vendedor (chave anônima + código da cotação): só estas duas.
grant execute on function public.cotacao_abrir(text, boolean), public.cotacao_responder(text, uuid, jsonb, jsonb) to anon;
grant execute on function
  public.importar_semana(jsonb),
  public.cot_coleta(bigint), public.cot_marcar_notificado(bigint, text, text, timestamptz),
  public.cot_marcar_cobranca(bigint), public.cot_liberar_cobranca(bigint),
  public.cot_marcar_aviso(bigint, bigint, text), public.cot_desmarcar_aviso(bigint, bigint[], text),
  public.cot_fechar_vencidas(), public.cot_reservar_consolidado(bigint), public.cot_liberar_consolidado(jsonb),
  public.cot_aplicar_cadastros(jsonb)
  to service_role;
