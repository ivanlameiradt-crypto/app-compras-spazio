-- App de Compras Spazio — Fase 2, Bloco C1: os cadastros passam a ser feitos no App (a virada).
-- Desenho: compra-semanal/docs/DESIGN-fase-2.md, seção 5 (C.4.1 a C.4.7 e C.4.11 e C.4.12) — a fonte da verdade.
-- Terceira migration da Fase 2 por nome de arquivo (depois da D1 20261015000002, antes da D2 20261029000002 e
-- da B). Só CRIA funções e uma interna de auditoria: nenhuma função da 1A, da 1B, do E1 ou da D1 é reescrita
-- (fase2-base.test.ts, X2 da C1 confere o md5(prosrc)). No fim, reaplica o bloco de permissões completo do que
-- existe até aqui (1A + 1B + E1 + D1 + C1), tira o cot_aplicar_cadastros do service_role (a trava da virada,
-- C.4.12) e passa o cot_exportar_cadastros a ele. A D2 e a B, mais novas, reaplicam a lista delas por cima; a
-- C2 (a última por nome de arquivo) fecha com a lista COMPLETA.

-- ================= Internas de apoio (sem grant; revoke explícito do service_role no fim, §2.2 regra 6a)

-- Auditoria de cadastro (C.4.11). quem = email_atual(); depois ganha {"via": app|claude}; sem linha quando
-- antes = depois. O cliente não define app.via (nenhuma função o faz); só o conector (C.9) grava "claude".
create or replace function public.cot_registrar_mudanca(p_tabela text, p_registro text, p_antes jsonb, p_depois jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_antes is not distinct from p_depois then
    return;
  end if;
  insert into historico_alteracoes (quem, tabela, registro, antes, depois)
  values (email_atual(), p_tabela, p_registro, p_antes,
          coalesce(p_depois, '{}'::jsonb)
            || jsonb_build_object('via', coalesce(nullif(current_setting('app.via', true), ''), 'app')));
end $$;

-- WhatsApp normalizado (C.4.3): só dígitos, sem zeros à esquerda; 10/11 dígitos → '55' + dígitos; 12/13 já em
-- 55 ficam; o resto volta como está e a regex da 7.2 (no cot_vendedor_salvar) decide se é válido.
create or replace function public.cot_whatsapp_normalizar(t text) returns text
language plpgsql immutable set search_path = public as $$
declare d text;
begin
  d := regexp_replace(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '^0+', '');
  if char_length(d) in (10, 11) then
    return '55' || d;
  elsif char_length(d) in (12, 13) and left(d, 2) = '55' then
    return d;
  end if;
  return d;
end $$;

-- Código do vendedor (C.4.3): a empresa até o "(", sem acento, minúscula, não-[a-z0-9] vira "_", sem "_" das
-- pontas, cortado em 26 caracteres; vazio vira 'vendedor'; já existente ganha '_2', '_3'... O código nunca muda.
create or replace function public.cot_codigo_novo(p_empresa text) returns text
language plpgsql security definer set search_path = public as $$
declare base text; cod text; i int := 1;
begin
  base := lower(cot_normalizar(split_part(p_empresa, '(', 1)));
  base := regexp_replace(base, '[^a-z0-9]+', '_', 'g');
  base := regexp_replace(base, '^_+|_+$', '', 'g');
  base := regexp_replace(left(base, 26), '_+$', '', 'g');
  if base = '' then base := 'vendedor'; end if;
  cod := base;
  while exists (select 1 from cot_vendedores v where v.codigo = cod) loop
    i := i + 1;
    cod := base || '_' || i;
  end loop;
  return cod;
end $$;

-- Conta os itens "Aguardando cotação" deste vendedor na semana (C.4.3), pela própria cot_marcas: sem cópia da
-- regra 8.3 (liberada, atravessados, desmarcados, validade). A A a recria para contar pelas partes (A.5.2).
create or replace function public.cot_contar_aguardando(p_semana bigint, p_vendedor bigint) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from cot_marcas(p_semana) m
   where m.estado = 'aguardando_cotacao' and m.vendedor_id = p_vendedor
$$;

-- ================= Vendedores e grafias (C.4.3, admin)

-- Regex do WhatsApp (7.2): 55 + DDD + celular (9 + 8 dígitos) ou fixo (2–8 + 7 dígitos).
create or replace function public.cot_vendedor_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id       bigint := (p ->> 'id')::bigint;
  old        cot_vendedores;
  nova       cot_vendedores;
  v_nome     text;
  v_empresa  text;
  v_wpp      text;
  v_ativo    boolean;
  v_codigo   text;
  v_confirmar jsonb := coalesce(p -> 'confirmar', '[]'::jsonb);
  v_pend     jsonb := '[]'::jsonb;
  v_info     jsonb := '[]'::jsonb;
  v_semana   bigint;
  v_n        int := 0;
  v_outro    cot_vendedores;
begin
  perform exigir_admin();

  if v_id is not null then
    select * into old from cot_vendedores where id = v_id for update;
    if not found then
      raise exception 'vendedor não encontrado';
    end if;
  end if;

  v_nome    := case when p ? 'nome'    then nullif(trim(p ->> 'nome'), '')    else old.nome end;
  v_empresa := case when p ? 'empresa' then nullif(trim(p ->> 'empresa'), '') else old.empresa end;
  v_wpp     := case when p ? 'whatsapp' then cot_whatsapp_normalizar(p ->> 'whatsapp') else old.whatsapp end;
  v_ativo   := case when v_id is null then false                       -- vendedor novo nasce desligado
                    when p ? 'ativo' then (p ->> 'ativo')::boolean
                    else old.ativo end;

  if v_nome is null or not cot_texto_ok(v_nome, 60) then
    raise exception 'informe o nome (até 60 caracteres)';
  end if;
  if v_empresa is null or not cot_texto_ok(v_empresa, 80) then
    raise exception 'informe a empresa (até 80 caracteres)';
  end if;
  if v_wpp is null or v_wpp !~ '^55[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$' then
    raise exception 'WhatsApp inválido: use DDD + número, ex.: (91) 90000-1234';
  end if;

  -- whatsapp_repetido: o número já está em outro vendedor (vale para novo e para edição).
  select * into v_outro from cot_vendedores
   where whatsapp = v_wpp and (v_id is null or id <> v_id) limit 1;
  if found and not (v_confirmar ? 'whatsapp_repetido') then
    v_pend := v_pend || jsonb_build_array(jsonb_build_object('codigo', 'whatsapp_repetido',
                                                             'empresa', cot_rotulo(v_outro.empresa)));
  end if;

  if v_id is not null then
    -- aguardando: ligar (false → true) com semana em compra. Simula a ligação numa subtransação e conta.
    if not old.ativo and v_ativo then
      select id into v_semana from semanas where status = 'em_compra' limit 1;
      if v_semana is not null then
        begin
          update cot_vendedores set ativo = true where id = v_id;
          v_n := cot_contar_aguardando(v_semana, v_id);
          raise exception 'desfaz simulacao';   -- rollback da subtransação; v_n mantém o valor
        exception when others then
          null;
        end;
        if v_n > 0 and not (v_confirmar ? 'aguardando') then
          v_pend := v_pend || jsonb_build_array(jsonb_build_object('codigo', 'aguardando',
                      'itens', v_n, 'ate', cot_iso(cot_aguardando_ate(v_semana))));
        end if;
      end if;
    end if;
    -- cotacao_viva: desligar (true → false) com versão viva em qualquer semana.
    if old.ativo and not v_ativo
       and exists (select 1 from cot_cotacoes c where c.vendedor_id = v_id and cot_eh_viva(c))
       and not (v_confirmar ? 'cotacao_viva') then
      v_pend := v_pend || jsonb_build_array(jsonb_build_object('codigo', 'cotacao_viva',
                  'versoes', (select jsonb_agg(jsonb_build_object('semana', cot_data_txt(s.data_referencia),
                                                                  'versao', c.versao, 'status', c.status) order by c.id)
                                from cot_cotacoes c join semanas s on s.id = c.semana_id
                               where c.vendedor_id = v_id and cot_eh_viva(c))));
    end if;
  end if;

  if jsonb_array_length(v_pend) > 0 then
    return jsonb_build_object('ok', false, 'confirmar', v_pend);
  end if;

  if v_id is null then
    v_codigo := cot_codigo_novo(v_empresa);
    insert into cot_vendedores (codigo, nome, empresa, whatsapp, ativo)
    values (v_codigo, v_nome, v_empresa, v_wpp, false)
    returning * into nova;
    perform cot_registrar_mudanca('cot_vendedores', nova.id::text, null, to_jsonb(nova));
    return jsonb_build_object('ok', true, 'id', nova.id, 'codigo', v_codigo, 'avisos', '[]'::jsonb);
  end if;

  -- whatsapp_com_cotacao: o número mudou com versão viva (só informa).
  if v_wpp <> old.whatsapp
     and exists (select 1 from cot_cotacoes c where c.vendedor_id = v_id and cot_eh_viva(c)) then
    v_info := v_info || jsonb_build_array(jsonb_build_object('codigo', 'whatsapp_com_cotacao'));
  end if;

  update cot_vendedores set nome = v_nome, empresa = v_empresa, whatsapp = v_wpp, ativo = v_ativo
   where id = v_id returning * into nova;
  perform cot_registrar_mudanca('cot_vendedores', v_id::text, to_jsonb(old), to_jsonb(nova));
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', old.codigo, 'avisos', v_info);
end $$;

-- Excluir só o vendedor sem nenhuma referência (cadastrado por engano, C.4.3).
create or replace function public.cot_vendedor_excluir(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare old cot_vendedores;
begin
  perform exigir_admin();
  select * into old from cot_vendedores where id = p_id for update;
  if not found then
    raise exception 'vendedor não encontrado';
  end if;
  if exists (select 1 from cot_cotacoes    where vendedor_id = p_id)
     or exists (select 1 from cot_fornecedores where vendedor_id = p_id)
     or exists (select 1 from cot_catalogo    where vendedor_id = p_id) then
    raise exception 'este vendedor já tem cotações, grafias ou produtos: use Desligar';
  end if;
  if exists (select 1 from cot_fornecedores_cnpj where vendedor_id = p_id) then
    raise exception 'este vendedor tem CNPJ da NF-e: tire o CNPJ no cartão antes';
  end if;
  delete from cot_vendedores where id = p_id;
  perform cot_registrar_mudanca('cot_vendedores', p_id::text, to_jsonb(old), null);
end $$;

-- Grafia de fornecedor → vendedor (C.4.3). Upsert por cot_normalizar(nome). Quando muda de vendedor, os CNPJs
-- aprendidos por essa grafia (origem 'nome') vão junto, pela interna da D (cot_nfe_cnpj_trocar).
create or replace function public.cot_grafia_salvar(p_nome text, p_vendedor_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nome  text := nullif(trim(p_nome), '');
  v_norm  text;
  v_antes bigint;
  v_seg   int;
  v_cnpjs int := 0;
  v_cnpj  text;
  v_old   cot_fornecedores;
begin
  perform exigir_admin();
  if v_nome is null or not cot_texto_ok(v_nome, 200) then
    raise exception 'informe o fornecedor (até 200 caracteres)';
  end if;
  if not exists (select 1 from cot_vendedores where id = p_vendedor_id) then
    raise exception 'vendedor não encontrado';
  end if;
  v_norm := cot_normalizar(v_nome);
  select * into v_old from cot_fornecedores where nome_normalizado = v_norm;
  v_antes := v_old.vendedor_id;

  insert into cot_fornecedores (nome_normalizado, nome_original, vendedor_id)
  values (v_norm, v_nome, p_vendedor_id)
  on conflict (nome_normalizado) do update
    set nome_original = excluded.nome_original, vendedor_id = excluded.vendedor_id;

  if v_antes is not null and v_antes is distinct from p_vendedor_id then
    for v_cnpj in select cnpj from cot_fornecedores_cnpj
                   where origem = 'nome' and cot_normalizar(nome_na_nf) = v_norm loop
      perform cot_nfe_cnpj_trocar(v_cnpj, p_vendedor_id);
      v_cnpjs := v_cnpjs + 1;
    end loop;
  end if;

  -- produtos_seguindo: produtos da semana mais recente que têm essa grafia como última compra e ainda seguem a
  -- última compra (sem linha no catálogo, ou com vendedor_id null).
  select count(*)::int into v_seg
    from itens_semana i
   where i.semana_id = (select id from semanas order by data_referencia desc limit 1)
     and cot_normalizar(i.fornecedor_ultima) = v_norm
     and not exists (select 1 from cot_catalogo c where c.produto_id = i.produto_id and c.vendedor_id is not null);

  perform cot_registrar_mudanca('cot_fornecedores', v_norm,
            case when v_old.nome_normalizado is null then null else to_jsonb(v_old) end,
            (select to_jsonb(f) from cot_fornecedores f where f.nome_normalizado = v_norm));
  return jsonb_build_object('nome_normalizado', v_norm, 'vendedor_antes', v_antes,
                            'produtos_seguindo', v_seg, 'cnpjs_movidos', v_cnpjs);
end $$;

-- Tirar a grafia (C.4.3). Os CNPJs 'nome' aprendidos por ela são apagados (interna da D com vendedor null); os
-- 'ivan' ficam. Os produtos que seguiam a grafia vão para "Sem vendedor" no próximo Preparar.
create or replace function public.cot_grafia_remover(p_nome_normalizado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old cot_fornecedores; v_rem int := 0; v_cnpj text;
begin
  perform exigir_admin();
  select * into v_old from cot_fornecedores where nome_normalizado = p_nome_normalizado;
  if not found then
    raise exception 'grafia não encontrada';
  end if;
  for v_cnpj in select cnpj from cot_fornecedores_cnpj
                 where origem = 'nome' and cot_normalizar(nome_na_nf) = p_nome_normalizado loop
    perform cot_nfe_cnpj_trocar(v_cnpj, null);
    v_rem := v_rem + 1;
  end loop;
  delete from cot_fornecedores where nome_normalizado = p_nome_normalizado;
  perform cot_registrar_mudanca('cot_fornecedores', p_nome_normalizado, to_jsonb(v_old), null);
  return jsonb_build_object('cnpjs_removidos', v_rem);
end $$;

-- ================= Feriados (C.4.4, admin)

create or replace function public.cot_feriado_salvar(p_data date, p_nome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nome text := nullif(trim(p_nome), ''); v_old cot_feriados; v_muda boolean;
begin
  perform exigir_admin();
  if p_data < cot_data_local(cot_agora()) then
    raise exception 'só feriados de hoje em diante';
  end if;
  if v_nome is null or not cot_texto_ok(v_nome, 60) then
    raise exception 'informe o nome do feriado (até 60 caracteres)';
  end if;
  select * into v_old from cot_feriados where data = p_data;
  insert into cot_feriados (data, nome) values (p_data, v_nome)
  on conflict (data) do update set nome = excluded.nome;
  -- muda_aguardando: a data cai entre o dia seguinte à aprovação da semana em compra e o dia do aguardando_ate.
  select exists (
    select 1 from semanas s
     where s.status = 'em_compra' and s.aprovada_em is not null
       and p_data between cot_data_local(s.aprovada_em) + 1 and cot_data_local(cot_aguardando_ate(s.id))
  ) into v_muda;
  perform cot_registrar_mudanca('cot_feriados', cot_data_txt(p_data),
            case when v_old.data is null then null else to_jsonb(v_old) end,
            (select to_jsonb(f) from cot_feriados f where f.data = p_data));
  return jsonb_build_object('muda_aguardando', v_muda);
end $$;

create or replace function public.cot_feriado_remover(p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare v_old cot_feriados;
begin
  perform exigir_admin();
  if p_data < cot_data_local(cot_agora()) then
    raise exception 'só feriados de hoje em diante';
  end if;
  select * into v_old from cot_feriados where data = p_data;
  if not found then
    raise exception 'feriado não encontrado';
  end if;
  delete from cot_feriados where data = p_data;
  perform cot_registrar_mudanca('cot_feriados', cot_data_txt(p_data), to_jsonb(v_old), null);
end $$;

-- ================= Catálogo (C.4.5, admin). Linha nova nasce com vendedor_id null e origem 'ivan'.

create or replace function public.cot_definir_nome(p_produto_id bigint, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text := nullif(trim(p_nome), ''); v_antes jsonb; v_depois jsonb;
begin
  perform exigir_admin();
  if not exists (select 1 from itens_semana where produto_id = p_produto_id) then
    raise exception 'produto desconhecido';
  end if;
  if v_nome is not null and not cot_texto_ok(v_nome, 80) then
    raise exception 'o nome para o vendedor pode ter no máximo 80 caracteres';
  end if;
  v_antes := (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id);
  insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em, nome_para_vendedor)
  values (p_produto_id, null, 'ivan', cot_agora(), v_nome)
  on conflict (produto_id) do update set nome_para_vendedor = excluded.nome_para_vendedor;
  v_depois := (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id);
  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, v_antes, v_depois);
end $$;

create or replace function public.cot_definir_litro(p_produto_id bigint, p_vende_por_litro boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_depois jsonb;
begin
  perform exigir_admin();
  if not exists (select 1 from itens_semana where produto_id = p_produto_id) then
    raise exception 'produto desconhecido';
  end if;
  if not exists (select 1 from itens_semana i
                  where i.produto_id = p_produto_id
                    and i.semana_id = (select id from semanas order by data_referencia desc limit 1)
                    and i.unidade = 'kg') then
    raise exception 'só itens em kg podem ser vendidos por litro';
  end if;
  v_antes := (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id);
  insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em, vende_por_litro)
  values (p_produto_id, null, 'ivan', cot_agora(), p_vende_por_litro)
  on conflict (produto_id) do update set
    vende_por_litro = p_vende_por_litro,
    kg_por_litro = case when p_vende_por_litro then cot_catalogo.kg_por_litro else null end,
    kg_por_litro_confirmado_em = case when p_vende_por_litro then cot_catalogo.kg_por_litro_confirmado_em else null end;
  v_depois := (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id);
  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, v_antes, v_depois);
end $$;

create or replace function public.cot_confirmar_kg_por_litro(p_produto_id bigint, p_kg numeric) returns void
language plpgsql security definer set search_path = public as $$
declare cat cot_catalogo; v_antes jsonb;
begin
  perform exigir_admin();
  if not exists (select 1 from itens_semana where produto_id = p_produto_id) then
    raise exception 'produto desconhecido';
  end if;
  select * into cat from cot_catalogo where produto_id = p_produto_id for update;
  if not found or not cat.vende_por_litro then
    raise exception 'marque ''vendido por litro'' antes';
  end if;
  v_antes := to_jsonb(cat);
  if p_kg is null then
    update cot_catalogo set kg_por_litro = null, kg_por_litro_confirmado_em = null where produto_id = p_produto_id;
  else
    if p_kg < 0.2 or p_kg > 3 or p_kg <> round(p_kg, 3) then
      raise exception '1 L precisa valer entre 0,2 e 3 kg';
    end if;
    update cot_catalogo set kg_por_litro = p_kg, kg_por_litro_confirmado_em = cot_agora() where produto_id = p_produto_id;
  end if;
  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, v_antes,
            (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id));
end $$;

-- Confirmar a embalagem/fator (C.4.5). É a ÚNICA função de fator da Fase 2; a A a recria com a mesma
-- assinatura (6 parâmetros) acrescentando o ramo do concorrente em disputa (A.6).
create or replace function public.cot_confirmar_fator(p_produto_id bigint, p_vendedor_id bigint, p_embalagem text,
  p_fator numeric, p_origem text default 'ivan', p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cat cot_catalogo; v_unid text; v_atual bigint; v_antes jsonb; v_agora timestamptz := cot_agora();
begin
  perform exigir_admin();
  if p_origem not in ('ivan', 'resposta', 'nfe') then
    raise exception 'origem do fator inválida';
  end if;
  if p_embalagem not in ('fardo', 'caixa', 'pacote', 'saco') then
    raise exception 'embalagem inválida (fardo, caixa, pacote ou saco)';
  end if;

  select i.unidade into v_unid from itens_semana i
   where i.produto_id = p_produto_id and i.semana_id = (select id from semanas order by data_referencia desc limit 1)
   limit 1;
  if v_unid is null then
    raise exception 'produto desconhecido';
  end if;
  if v_unid = 'un' then
    if p_fator <> round(p_fator, 0) or p_fator < 2 or p_fator > 10000 then
      raise exception 'em item por unidade o fator é um número inteiro, ex.: 12';
    end if;
  else
    if p_fator < 0.001 or p_fator > 1000 or p_fator <> round(p_fator, 3) then
      raise exception 'em item por kg o fator é quantos kg vêm na embalagem, ex.: 0,5';
    end if;
  end if;

  select * into cat from cot_catalogo where produto_id = p_produto_id for update;
  if cat.vendedor_id is not null then
    v_atual := cat.vendedor_id;
  else
    select coalesce(v.vendedor_id, v.vendedor_motivo_id) into v_atual
      from itens_semana i cross join lateral cot_vendedor_do_item(i.id) v
     where i.produto_id = p_produto_id
       and i.semana_id = (select id from semanas order by data_referencia desc limit 1) limit 1;
  end if;
  if v_atual is null then
    raise exception 'escolha o vendedor do produto antes';
  end if;
  if v_atual <> p_vendedor_id then
    raise exception 'este produto hoje é de %: o fator vale para o vendedor dele',
      cot_rotulo((select empresa from cot_vendedores where id = v_atual));
  end if;

  if p_origem = 'resposta' then
    if not exists (
      select 1 from cot_itens x join cot_cotacoes c on c.id = x.cotacao_id
       where x.produto_id = p_produto_id and c.vendedor_id = p_vendedor_id
         and x.estado = 'tem' and x.base = 'embalagem' and x.fator_informado = p_fator) then
      raise exception 'essa resposta não existe mais';
    end if;
  elsif p_origem = 'nfe' then
    if not exists (
      select 1 from cot_nfe n cross join lateral jsonb_array_elements(n.itens) it
       where n.chave = p_ref and n.vendedor_id = p_vendedor_id
         and (it ->> 'produto_id') is not null and (it ->> 'produto_id')::bigint = p_produto_id
         and upper(coalesce(it ->> 'unidade_nf', '')) in ('CX', 'FD', 'FARDO', 'PCT', 'SC', 'SACO')
         and (it ->> 'qtd') is not null and (it ->> 'qtd_nf') is not null and (it ->> 'qtd_nf')::numeric <> 0
         and round((it ->> 'qtd')::numeric / (it ->> 'qtd_nf')::numeric, 3) = p_fator) then
      raise exception 'essa NF-e não tem esse fator para este produto';
    end if;
  end if;

  v_antes := case when cat.produto_id is null then null else to_jsonb(cat) end;
  if cat.produto_id is null then
    insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em, embalagem, fator, fator_confirmado_em)
    values (p_produto_id, p_vendedor_id, 'ultima_compra', v_agora, p_embalagem, p_fator, v_agora);
  elsif cat.vendedor_id is null then
    update cot_catalogo set vendedor_id = p_vendedor_id, origem = 'ultima_compra', atualizado_em = v_agora,
      embalagem = p_embalagem, fator = p_fator, fator_confirmado_em = v_agora
     where produto_id = p_produto_id;
  else
    update cot_catalogo set embalagem = p_embalagem, fator = p_fator, fator_confirmado_em = v_agora
     where produto_id = p_produto_id;
  end if;

  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, v_antes,
            (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id));
  return jsonb_build_object(
    'antes', jsonb_build_object('embalagem', cat.embalagem, 'fator', cat.fator, 'confirmado_em', cot_iso(cat.fator_confirmado_em)),
    'depois', jsonb_build_object('embalagem', p_embalagem, 'fator', p_fator, 'confirmado_em', cot_iso(v_agora)),
    'onde', 'catalogo');
end $$;

create or replace function public.cot_tirar_fator(p_produto_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb;
begin
  perform exigir_admin();
  v_antes := (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id);
  update cot_catalogo set embalagem = null, fator = null, fator_confirmado_em = null where produto_id = p_produto_id;
  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, v_antes,
            (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id));
end $$;

-- Voltar a seguir a última compra (C.4.5): zera os mesmos campos que o cot_definir_vendedor zera (7.2).
create or replace function public.cot_catalogo_soltar_vendedor(p_produto_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare cat cot_catalogo;
begin
  perform exigir_admin();
  select * into cat from cot_catalogo where produto_id = p_produto_id for update;
  if not found or cat.vendedor_id is null then
    raise exception 'o produto já segue a última compra';
  end if;
  update cot_catalogo set vendedor_id = null, origem = 'ivan', atualizado_em = cot_agora(),
    descricao_fornecedor = null, codigo_fornecedor = null, descricao_de_fornecedor = null,
    fator = null, fator_confirmado_em = null
   where produto_id = p_produto_id;
  perform cot_registrar_mudanca('cot_catalogo', p_produto_id::text, to_jsonb(cat),
            (select to_jsonb(c) from cot_catalogo c where c.produto_id = p_produto_id));
end $$;

-- ================= Leituras (C.4.6, admin)

-- Uma linha por produto da semana mais recente, com via/motivo iguais aos que o cot_preparar dá (cot_vendedor_do_item).
create or replace function public.cot_produtos_cadastro()
returns table(produto_id bigint, produto text, nome_limpo text, unidade text, bebida boolean,
  fornecedor_ultima text, data_ultima_compra date, vendedor_id bigint, via text, motivo text,
  vendedor_motivo_id bigint, catalogo_origem text, escolhido_em timestamptz, nome_para_vendedor text,
  nota_vendedor text, embalagem text, fator numeric, fator_confirmado_em timestamptz,
  vende_por_litro boolean, kg_por_litro numeric, kg_por_litro_confirmado_em timestamptz,
  descricao_fornecedor text, codigo_fornecedor text, categoria text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform exigir_admin();
  return query
  select i.produto_id, i.produto, cot_nome_limpo(i.produto), i.unidade, i.bebida,
         i.fornecedor_ultima, i.data_ultima_compra,
         v.vendedor_id, v.via, v.motivo, v.vendedor_motivo_id,
         cat.origem, cat.atualizado_em, cat.nome_para_vendedor, cat.nota_vendedor,
         cat.embalagem, cat.fator, cat.fator_confirmado_em,
         coalesce(cat.vende_por_litro, false), cat.kg_por_litro, cat.kg_por_litro_confirmado_em,
         cat.descricao_fornecedor, cat.codigo_fornecedor,
         coalesce(ctg.categoria, case when i.bebida then 'Bebidas' else 'Insumos' end)
    from itens_semana i
    cross join lateral cot_vendedor_do_item(i.id) v
    left join cot_catalogo cat on cat.produto_id = i.produto_id
    left join cot_categorias ctg on ctg.produto_id = i.produto_id
   where i.semana_id = (select id from semanas order by data_referencia desc limit 1)
   order by i.produto_id;
end $$;

-- Grafias de fornecedor_ultima das últimas p_semanas semanas que ainda não têm vendedor cadastrado (C.4.6).
create or replace function public.cot_fornecedores_sem_vendedor(p_semanas int default 8)
returns table(nome_original text, nome_normalizado text, produtos int, ultima_compra date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_admin();
  return query
  with sems as (
    select id, data_referencia from semanas order by data_referencia desc limit greatest(1, least(26, p_semanas))
  ),
  nova as (select id from semanas order by data_referencia desc limit 1),
  g as (
    select cot_normalizar(i.fornecedor_ultima) as norm, i.fornecedor_ultima as orig,
           i.data_ultima_compra, i.produto_id
      from itens_semana i
     where i.semana_id in (select id from sems) and nullif(trim(i.fornecedor_ultima), '') is not null
  )
  select
    (select g2.orig from g g2 where g2.norm = d.norm
       order by g2.data_ultima_compra desc nulls last, g2.orig limit 1) as nome_original,
    d.norm as nome_normalizado,
    (select count(*)::int from itens_semana i2
      where i2.semana_id = (select id from nova) and cot_normalizar(i2.fornecedor_ultima) = d.norm) as produtos,
    (select max(g3.data_ultima_compra) from g g3 where g3.norm = d.norm) as ultima_compra
    from (select distinct norm from g) d
   where not exists (select 1 from cot_fornecedores f where f.nome_normalizado = d.norm)
   order by produtos desc, nome_normalizado;
end $$;

-- ================= Backup (C.4.7, só service_role). Nomes das colunas = os dos CSVs antigos.
create or replace function public.cot_exportar_cadastros() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gerado_em', cot_iso(cot_agora()),
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', v.codigo, 'nome', v.nome, 'empresa', v.empresa, 'whatsapp', v.whatsapp, 'ativo', v.ativo)
        order by v.codigo) from cot_vendedores v), '[]'::jsonb),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object(
        'nome_fornecedor', f.nome_original, 'vendedor_codigo', v.codigo)
        order by f.nome_normalizado) from cot_fornecedores f join cot_vendedores v on v.id = f.vendedor_id), '[]'::jsonb),
    'cnpjs', coalesce((select jsonb_agg(jsonb_build_object(
        'cnpj', n.cnpj, 'vendedor_codigo', v.codigo, 'origem', n.origem, 'nome_na_nf', n.nome_na_nf)
        order by n.cnpj) from cot_fornecedores_cnpj n join cot_vendedores v on v.id = n.vendedor_id), '[]'::jsonb),
    'catalogo', coalesce((select jsonb_agg(jsonb_build_object(
        'produto_id', c.produto_id, 'vendedor_codigo', v.codigo, 'origem', c.origem,
        'nome_para_vendedor', c.nome_para_vendedor, 'embalagem', c.embalagem, 'fator', c.fator,
        'fator_confirmado_em', cot_iso(c.fator_confirmado_em), 'vende_por_litro', c.vende_por_litro,
        'kg_por_litro', c.kg_por_litro, 'kg_por_litro_confirmado_em', cot_iso(c.kg_por_litro_confirmado_em),
        'descricao_fornecedor', c.descricao_fornecedor, 'codigo_fornecedor', c.codigo_fornecedor,
        'descricao_de_fornecedor', c.descricao_de_fornecedor, 'nota_vendedor', c.nota_vendedor,
        'atualizado_em', cot_iso(c.atualizado_em)) order by c.produto_id)
        from cot_catalogo c left join cot_vendedores v on v.id = c.vendedor_id), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(jsonb_build_object('data', cot_data_txt(f.data), 'nome', f.nome)
        order by f.data) from cot_feriados f), '[]'::jsonb))
$$;

-- ================= Permissões (bloco completo do que existe até a C1: 1A + 1B + E1 + D1 + C1; §8.6)
-- A virada: o cot_aplicar_cadastros perde o service_role (revoke explícito), e o cot_exportar_cadastros entra.
-- A D2 e a B reaplicam a lista delas por cima; a C2 fecha com a lista completa.

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
-- C1: internas sem grant nem para o service_role (§2.2 regra 6a) e a virada (cot_aplicar_cadastros).
revoke execute on function public.cot_registrar_mudanca(text, text, jsonb, jsonb) from service_role;
revoke execute on function public.cot_whatsapp_normalizar(text) from service_role;
revoke execute on function public.cot_codigo_novo(text) from service_role;
revoke execute on function public.cot_contar_aguardando(bigint, bigint) from service_role;
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
  public.cot_produtos_cadastro(), public.cot_fornecedores_sem_vendedor(integer)
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
  public.cot_exportar_cadastros()
  to service_role;
