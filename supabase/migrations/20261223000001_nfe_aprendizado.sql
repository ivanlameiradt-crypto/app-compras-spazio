-- App de Compras Spazio — memória de embalagem das NOTAS FISCAIS (pedido do Ivan, 29/10/2026).
--
-- O QUE MUDA (só cria objetos novos; nada que já existe é alterado)
--   1) Tabela nfe_aprendizado: para cada fornecedor (CNPJ do emitente) + código do produto na nota (CÓD. FOR) + unidade da nota, guarda a embalagem que o Ivan
--      decidiu — o produto do estoque (produto_id) e o fator (quantas unidades do produto vêm em 1 unidade da nota). Ex.: a nota diz "6 UN", cada UN é um fardo
--      de 6 latas e o produto do estoque é a lata: fator 6.
--   2) nfe_aprendizado_ler(segredo, cnpj): o robô lê tudo o que já aprendeu daquele fornecedor, ANTES de lançar a nota.
--   3) nfe_aprendizado_gravar(segredo, lista): o robô grava (upsert em lote) DEPOIS que a nota foi lançada certinho.
--
-- POR QUÊ
--   O cupom fiscal já memoriza (cupom_aprendizado); a nota fiscal ainda não: o número que o Ivan digita no "Editar" valia só para aquela nota, e na seguinte o
--   robô pedia de novo (ou lançava errado). Fardo de 6 e fardo de 12 têm CÓDIGOS diferentes na nota, então cada código guarda o seu fator. A descrição muda de nota
--   para nota (e o SisChef troca o nome depois de associar): por isso NÃO é chave, fica só como exemplo (descricao_exemplo).
--   Quem decide o que aprender é o robô (só o que o Ivan decidiu e que a nota lançou certinho); o banco só confere o formato e guarda.
--
-- REGRAS DE GRAVAÇÃO (nfe_aprendizado_gravar)
--   • O CNPJ do emitente vem da chave de acesso da nota (posições 7 a 20); a chave tem de ter 44 dígitos.
--   • Cada item exige cod_forn, unidade_nota, produto_id e fator > 1. Item inválido derruba o lote INTEIRO (mensagem em português, nada é gravado).
--   • Mesmo produto_id e mesmo fator: vezes = vezes + 1 e atualiza atualizado_em, ultima_chave, preco_ref (se vier) e descricao_exemplo.
--     Fator OU produto diferente: substitui os valores e vezes volta para 1.
--   • preco_ref é o preço por unidade da nota na última vez (null = sem referência; 0 também vale como "sem referência", p.ex. item de bonificação).
--   • Lote vazio ('[]') devolve 0 e só confere o segredo. Itens repetidos no mesmo lote são aplicados na ordem em que vêm (cada um é uma gravação).
--
-- QUEM FAZ O QUÊ
--   As duas funções são do robô de NF-e: chave anônima + segredo cot_nfe_robo (cot_nfe_exigir_robo), como as outras 5 dele — de propósito executam para
--   anon e para ninguém mais (authenticated e o público não). A tabela: só o admin LÊ (RLS, eh_admin()); anon e authenticated NÃO escrevem direto; a chave de
--   serviço pode tudo. Esquecer um aprendizado (apagar a linha) fica para a fase 2 do app; por ora só pela chave de serviço.
--
-- COMO DESFAZER (as duas funções primeiro, depois a tabela; apagar a tabela PERDE o que foi aprendido — copie antes, se quiser guardar)
--   drop function if exists public.nfe_aprendizado_gravar(text, jsonb), public.nfe_aprendizado_ler(text, text);
--   drop table if exists public.nfe_aprendizado;

create table public.nfe_aprendizado (
  id                uuid primary key default gen_random_uuid(),
  emitente_cnpj     text not null check (emitente_cnpj ~ '^[0-9]{14}$'),
  cod_forn          text not null check (cod_forn = btrim(cod_forn) and char_length(cod_forn) between 1 and 60),
  unidade_nota      text not null check (unidade_nota = upper(btrim(unidade_nota)) and char_length(unidade_nota) between 1 and 10),
  produto_id        bigint not null check (produto_id > 0),
  produto_nome      text check (produto_nome is null or char_length(produto_nome) <= 200),
  fator             numeric not null check (fator > 1),
  preco_ref         numeric check (preco_ref is null or preco_ref > 0),
  descricao_exemplo text check (descricao_exemplo is null or char_length(descricao_exemplo) <= 200),
  vezes             integer not null default 1 check (vezes >= 1),
  ultima_chave      text check (ultima_chave is null or ultima_chave ~ '^[0-9]{44}$'),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint nfe_aprendizado_chave_unica unique (emitente_cnpj, cod_forn, unidade_nota)
);

alter table public.nfe_aprendizado enable row level security;
create policy nfe_aprendizado_sel_admin on public.nfe_aprendizado for select to authenticated using (eh_admin());

-- Só leitura para o admin logado (a RLS acima restringe a eh_admin()); anon nada; escrita só pelas funções abaixo e pela chave de serviço.
revoke all on public.nfe_aprendizado from public, anon, authenticated;
grant select on public.nfe_aprendizado to authenticated;
grant all on public.nfe_aprendizado to service_role;

-- O robô lê o que aprendeu de um fornecedor: array JSON com as linhas daquele CNPJ, em ordem de cod_forn (texto, ordem binária) e depois de unidade_nota.
-- Sem nada aprendido devolve []. Aceita o CNPJ com pontuação (só os dígitos contam); o que não fechar 14 dígitos dá erro claro (em vez de [] silencioso, que
-- esconderia um robô lendo o CNPJ errado).
create or replace function public.nfe_aprendizado_ler(p_segredo text, p_cnpj text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cnpj text;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido: informe os 14 dígitos do emitente';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.cod_forn collate "C", a.unidade_nota collate "C")
      from nfe_aprendizado a
     where a.emitente_cnpj = v_cnpj
  ), '[]'::jsonb);
end $$;

-- O robô grava o que a nota lançada ensinou. p = lista de {chave, cod_forn, unidade_nota, produto_id, produto_nome, fator, preco_ref, descricao}; só chave,
-- cod_forn, unidade_nota, produto_id e fator são obrigatórios. Confere TUDO antes de gravar (tudo ou nada), normaliza (unidade em maiúsculas, textos sem espaços
-- nas pontas e cortados em 200) e devolve quantos itens gravou. Gravar o mesmo produto e fator de novo conta mais uma nota em vezes; fator ou produto novo
-- substitui (e vezes volta a 1). Um preco_ref que não vem (ou vem 0) não apaga o que já havia quando o fator é o mesmo; com fator ou produto novo, o preço antigo
-- era de outra embalagem e sai.
create or replace function public.nfe_aprendizado_gravar(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it      jsonb;
  i       int := 0;
  n       int;
  v_total int := 0;
  v_lote  jsonb := '[]'::jsonb;   -- itens já conferidos e normalizados
  v_chave text;
  v_cod   text;
  v_un    text;
  v_prod  bigint;
  v_fator numeric;
  v_preco numeric;
  v_nome  text;
  v_desc  text;
  v_txt   text;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  if jsonb_typeof(p) is distinct from 'array' then
    raise exception 'memória de embalagem inválida: esperava uma lista (array) de itens';
  end if;
  if jsonb_array_length(p) > 1000 then
    raise exception 'memória de embalagem inválida: lote com mais de 1000 itens';
  end if;

  -- 1) conferência de TODOS os itens (nada é gravado se algum estiver fora do formato)
  for it in select value from jsonb_array_elements(p) loop
    i := i + 1;
    if jsonb_typeof(it) is distinct from 'object' then
      raise exception 'memória de embalagem inválida (item %): o item precisa ser um objeto', i;
    end if;

    v_chave := coalesce(it ->> 'chave', '');
    if v_chave !~ '^[0-9]{44}$' then
      raise exception 'memória de embalagem inválida (item %): a chave da nota precisa ter 44 dígitos', i;
    end if;

    v_cod := case when coalesce(jsonb_typeof(it -> 'cod_forn'), '') in ('string', 'number') then btrim(it ->> 'cod_forn', E' \t\r\n') else '' end;
    if v_cod = '' then
      raise exception 'memória de embalagem inválida (item %): cod_forn (código do fornecedor na nota) é obrigatório', i;
    end if;
    if char_length(v_cod) > 60 then
      raise exception 'memória de embalagem inválida (item %): cod_forn passa de 60 caracteres', i;
    end if;

    v_un := case when coalesce(jsonb_typeof(it -> 'unidade_nota'), '') = 'string' then upper(btrim(it ->> 'unidade_nota', E' \t\r\n')) else '' end;
    if v_un = '' then
      raise exception 'memória de embalagem inválida (item %): unidade_nota é obrigatória', i;
    end if;
    if char_length(v_un) > 10 then
      raise exception 'memória de embalagem inválida (item %): unidade_nota passa de 10 caracteres', i;
    end if;

    v_txt := coalesce(it ->> 'produto_id', '');
    v_prod := case when v_txt ~ '^[0-9]{1,18}$' then v_txt::bigint end;
    if v_prod is null or v_prod < 1 then
      raise exception 'memória de embalagem inválida (item %): produto_id precisa ser um número inteiro maior que 0', i;
    end if;

    v_txt := coalesce(it ->> 'fator', '');
    v_fator := case when v_txt ~ '^[0-9]{1,15}(\.[0-9]{1,20})?$' then v_txt::numeric end;
    if v_fator is null or v_fator <= 1 then
      raise exception 'memória de embalagem inválida (item %): fator precisa ser um número maior que 1', i;
    end if;

    v_txt := nullif(btrim(it ->> 'preco_ref', E' \t\r\n'), '');   -- ausente, null e texto vazio dão NULL (= sem referência)
    v_preco := null;
    if v_txt is not null then
      v_preco := case when v_txt ~ '^[0-9]{1,15}(\.[0-9]{1,20})?$' then v_txt::numeric end;
      if v_preco is null then
        raise exception 'memória de embalagem inválida (item %): preco_ref precisa ser um número (ou ficar de fora)', i;
      end if;
      if v_preco = 0 then v_preco := null; end if;   -- preço zero (bonificação) não é referência
    end if;

    v_nome := left(nullif(btrim(coalesce(it ->> 'produto_nome', ''), E' \t\r\n'), ''), 200);
    v_desc := left(nullif(btrim(coalesce(it ->> 'descricao', ''), E' \t\r\n'), ''), 200);

    v_lote := v_lote || jsonb_build_array(jsonb_build_object(
      'chave', v_chave, 'cod_forn', v_cod, 'unidade_nota', v_un, 'produto_id', v_prod, 'produto_nome', v_nome,
      'fator', v_fator, 'preco_ref', v_preco, 'descricao', v_desc));
  end loop;

  -- 2) gravação (na ordem em que os itens vieram)
  for it in select value from jsonb_array_elements(v_lote) loop
    insert into nfe_aprendizado as a
      (emitente_cnpj, cod_forn, unidade_nota, produto_id, produto_nome, fator, preco_ref, descricao_exemplo, vezes, ultima_chave, criado_em, atualizado_em)
    values
      (substr(it ->> 'chave', 7, 14), it ->> 'cod_forn', it ->> 'unidade_nota', (it ->> 'produto_id')::bigint, it ->> 'produto_nome',
       (it ->> 'fator')::numeric, (it ->> 'preco_ref')::numeric, it ->> 'descricao', 1, it ->> 'chave', cot_agora(), cot_agora())
    on conflict (emitente_cnpj, cod_forn, unidade_nota) do update set
      vezes             = case when a.produto_id = excluded.produto_id and a.fator = excluded.fator then a.vezes + 1 else 1 end,
      produto_nome      = case when a.produto_id = excluded.produto_id then coalesce(excluded.produto_nome, a.produto_nome) else excluded.produto_nome end,
      preco_ref         = case when a.produto_id = excluded.produto_id and a.fator = excluded.fator then coalesce(excluded.preco_ref, a.preco_ref) else excluded.preco_ref end,
      descricao_exemplo = coalesce(excluded.descricao_exemplo, a.descricao_exemplo),
      produto_id        = excluded.produto_id,
      fator             = excluded.fator,
      ultima_chave      = excluded.ultima_chave,
      atualizado_em     = excluded.atualizado_em;
    get diagnostics n = row_count;
    v_total := v_total + n;
  end loop;
  return v_total;
end $$;

-- Só o robô (anon + segredo) executa; authenticated e o público não. (O service_role segue o padrão das outras do robô de NF-e.)
revoke execute on function public.nfe_aprendizado_ler(text, text), public.nfe_aprendizado_gravar(text, jsonb) from public, anon, authenticated;
grant execute on function public.nfe_aprendizado_ler(text, text), public.nfe_aprendizado_gravar(text, jsonb) to anon;
