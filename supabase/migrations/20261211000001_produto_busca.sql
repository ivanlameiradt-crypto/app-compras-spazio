-- App de Compras Spazio — Fase 3: palavras-chave e nome corrigido dos produtos (caixa de associação da aba "Lançamento fiscal").
--
-- O Ivan conferiu a lista de insumos do app (planilha de 07/10/2026) e, para cada produto, escreveu como o fornecedor costuma chamá-lo na nota
-- ("palavras-chave": ex. "nuggets ou Chicken Supreme 2,5Kg") e, quando o nome do SisChef tem erro, o nome certo ("nome corrigido": ex.
-- CONDESSADO → CONDENSADO). A caixa de associação passa a achar (e a sugerir) o produto por esses textos também. O nome VERDADEIRO do produto
-- continua sendo o do SisChef: o corrigido só vale dentro do app (busca e exibição); nada muda no SisChef, em itens_semana nem em cot_nfe.
--
-- Uma linha por produto. produto_id = Cód. Interno do SisChef (o mesmo de itens_semana.produto_id); sem chave estrangeira de propósito: a lista
-- semanal muda de semana em semana e o produto pode sair dela sem que a anotação do Ivan precise sumir. Só o admin lê (RLS); ninguém escreve
-- DIRETO na tabela pelo app: a carga inicial é feita no servidor (SQL em supabase/dados/) e o app só ACRESCENTA palavras pela função de admin
-- cot_produto_lembrar (abaixo; security definer + exigir_admin(), como cot_nfe_associar). Editar ou apagar palavras: pelo servidor, por enquanto.
--
-- `palavras` é texto livre, do jeito que o Ivan escreveu: palavras soltas ("queijo mussarela mozarela") e/ou frases separadas por " OU "
-- ("CARNE LAGARTO OU CARNE RESFRIADA LARGATO"). O app não separa nada aqui: lê o texto inteiro como um conjunto de palavras.

create table public.cot_produto_busca (
  produto_id     bigint primary key,
  palavras       text check (palavras is null or char_length(palavras) <= 500),
  nome_corrigido text check (nome_corrigido is null or char_length(nome_corrigido) <= 200),
  atualizado_em  timestamptz not null default now(),
  check (btrim(coalesce(palavras, '')) <> '' or btrim(coalesce(nome_corrigido, '')) <> '')   -- linha sem nada para dizer não existe
);

alter table public.cot_produto_busca enable row level security;
create policy cot_produto_busca_ler on public.cot_produto_busca for select to authenticated using (eh_admin());

-- Só leitura para o admin logado (a RLS acima restringe a eh_admin()); anon nada; escrita só com a chave de serviço (a carga).
revoke all on public.cot_produto_busca from public, anon, authenticated;
grant select on public.cot_produto_busca to authenticated;
grant all on public.cot_produto_busca to service_role;

-- "Lembrar esta descrição": ao confirmar a associação de um item da nota (ou do cupom), o Ivan pode deixar a descrição que veio no documento (sem o
-- "CÓD. FOR: 123" do SisChef) guardada como mais uma palavra-chave do produto; da próxima vez a caixa já a sugere sozinha. É assim que a planilha
-- "aprende" e não trava: o que o Ivan confirma entra no dicionário. Admin; devolve true se acrescentou, false se não precisou (já estava lá) ou se
-- não coube nos 500 caracteres (aí o Ivan edita as palavras do produto). Grava o antes/depois em historico_alteracoes.
create or replace function public.cot_produto_lembrar(p_produto_id bigint, p_texto text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_texto text;
  v_atual text;
  v_novo  text;
begin
  perform exigir_admin();
  if p_produto_id is null or p_produto_id <= 0 then raise exception 'produto inválido'; end if;
  v_texto := regexp_replace(btrim(coalesce(p_texto, '')), '^CÓD\. FOR:\s*\S+\s*', '', 'i');
  v_texto := regexp_replace(btrim(v_texto), '\s+', ' ', 'g');
  if v_texto = '' then raise exception 'texto vazio'; end if;
  if char_length(v_texto) > 150 then raise exception 'texto grande demais'; end if;

  select palavras into v_atual from cot_produto_busca where produto_id = p_produto_id for update;
  if v_atual is not null and position(lower(v_texto) in lower(v_atual)) > 0 then return false; end if;
  v_novo := case when coalesce(btrim(v_atual), '') = '' then v_texto else btrim(v_atual) || ' OU ' || v_texto end;
  if char_length(v_novo) > 500 then return false; end if;

  insert into cot_produto_busca (produto_id, palavras) values (p_produto_id, v_novo)
    on conflict (produto_id) do update set palavras = excluded.palavras, atualizado_em = now();
  perform cot_registrar_mudanca('cot_produto_busca', p_produto_id::text, jsonb_build_object('palavras', v_atual), jsonb_build_object('palavras', v_novo));
  return true;
end $$;

-- Só o admin logado executa (a checagem de admin está dentro da função); anon e o público não.
revoke execute on function public.cot_produto_lembrar(bigint, text) from public, anon, authenticated;
grant execute on function public.cot_produto_lembrar(bigint, text) to authenticated;
