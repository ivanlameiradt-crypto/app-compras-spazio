-- App de Compras Spazio — Fase 3: os boletos (duplicatas cobr/dup do XML) da nota SEFAZ ficam na cot_nfe.
--
-- A aba "Lançamento de nota SEFAZ" precisa mostrar o financeiro da nota (parcelas x total) para o Ivan conferir e para marcar a
-- nota como "pronta" (todos os itens associados, pagamento em boleto e as parcelas fechando com o total). Até aqui a leitura
-- da SEFAZ não trazia isso para o banco.
--
-- parcelas: jsonb array de {numero, vencimento, valor}. NULL = o XML ainda não foi lido; [] = XML lido e a nota NÃO tem
-- duplicatas (à vista). Só o robô de leitura grava, pela função abaixo (chave anônima + segredo cot_nfe_robo, como as outras 4);
-- authenticated só lê (a coluna entra no SELECT que o admin já tem na tabela).
--
-- cot_nfe_anexar_parcelas: valida TUDO antes de gravar (uma nota ruim derruba o lote inteiro, como cot_nfe_sincronizar),
-- normaliza cada parcela (só as 3 chaves, número sem caractere de controle), nunca mexe em nota já lançada, é idempotente e devolve
-- quantas notas gravou. Chave desconhecida é ignorada (a nota pode ter saído da fila entre a leitura e a gravação).

alter table public.cot_nfe
  add column if not exists parcelas jsonb
    check (parcelas is null or (jsonb_typeof(parcelas) = 'array' and jsonb_array_length(parcelas) <= 60));

create or replace function public.cot_nfe_anexar_parcelas(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare nota jsonb; par jsonb; v int := 0; n int; v_lista jsonb; v_notas jsonb;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  v_notas := p -> 'notas';
  if jsonb_typeof(v_notas) <> 'array' or jsonb_array_length(v_notas) > 300 then
    raise exception 'parcelas inválidas: notas';
  end if;
  -- validação (nada é gravado se algo estiver fora do formato)
  for nota in select value from jsonb_array_elements(v_notas) loop
    if coalesce(nota ->> 'chave', '') !~ '^[0-9]{44}$' then raise exception 'parcelas inválidas: chave'; end if;
    if jsonb_typeof(nota -> 'parcelas') <> 'array' or jsonb_array_length(nota -> 'parcelas') > 60 then
      raise exception 'parcelas inválidas: parcelas';
    end if;
    for par in select value from jsonb_array_elements(nota -> 'parcelas') loop
      if jsonb_typeof(par) <> 'object' then raise exception 'parcelas inválidas: parcela'; end if;
      if (par ->> 'vencimento') is not null and cot_ler_data(par ->> 'vencimento') is null then
        raise exception 'parcelas inválidas: vencimento';
      end if;
      if (par ->> 'valor') is null or (par ->> 'valor') !~ '^[0-9]+(\.[0-9]+)?$'
         or (par ->> 'valor')::numeric > 10000000 then
        raise exception 'parcelas inválidas: valor';
      end if;
    end loop;
  end loop;
  -- efeito
  for nota in select value from jsonb_array_elements(v_notas) loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero', nullif(regexp_replace(left(coalesce(e.value ->> 'numero', ''), 20), '[\x00-\x1f\x7f]', '', 'g'), ''),
             'vencimento', cot_ler_data(e.value ->> 'vencimento'),
             'valor', (e.value ->> 'valor')::numeric) order by e.ord), '[]'::jsonb)
      into v_lista
      from jsonb_array_elements(nota -> 'parcelas') with ordinality as e(value, ord);
    update cot_nfe set parcelas = v_lista, atualizado_em = cot_agora()
     where chave = nota ->> 'chave' and situacao <> 'lancada';
    get diagnostics n = row_count;
    v := v + n;
  end loop;
  return v;
end $$;

-- Só o robô (anon + segredo) executa; authenticated e o público não. (O service_role segue o padrão das outras do robô de NF-e.)
revoke execute on function public.cot_nfe_anexar_parcelas(text, jsonb) from public, anon, authenticated;
grant execute on function public.cot_nfe_anexar_parcelas(text, jsonb) to anon;
