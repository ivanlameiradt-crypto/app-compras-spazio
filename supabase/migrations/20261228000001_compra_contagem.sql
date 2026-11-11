-- App de Compras Spazio — contagem da prateleira da "Lista da semana" (11/11/2026).
--
-- O QUE MUDA (só cria objetos novos; nada que já existe é alterado)
--   1) Tabela compra_contagem: o que alguém CONTOU na prateleira de cada produto da semana (semana_id, produto_id, qtd), com quem contou
--      (contado_por, e-mail) e quando (contado_em). Chave primária (semana_id, produto_id): uma contagem por produto por semana.
--   2) compra_contagem_salvar(semana, produto, qtd): grava (ou troca) a contagem; qtd null APAGA a contagem.
--
-- POR QUÊ
--   A tela "Lista da semana" deixa contar o que tem na prateleira; o app usa a contagem para calcular quanto comprar. Faltava guardá-la.
--
-- REGRAS DE GRAVAÇÃO (compra_contagem_salvar)
--   • Exige usuário ATIVO (eh_ativo(): admin ou comprador cadastrado e ativo); senão "usuário sem acesso ao app".
--   • A semana tem de existir e NÃO estar encerrada (rascunho e em_compra aceitam).
--   • O produto tem de estar em itens_semana daquela semana.
--   • qtd null apaga; senão grava (upsert) com contado_por = e-mail de quem chamou e contado_em = cot_agora().
--   • qtd negativa ou com mais de 3 casas decimais é recusada. Zero é uma contagem válida.
--
-- QUEM FAZ O QUÊ
--   compra_contagem_salvar: só authenticated (anon e o público não executam); a checagem de usuário ativo está dentro dela.
--   A tabela: qualquer usuário ATIVO logado LÊ (RLS, eh_ativo()); anon e authenticated NÃO escrevem direto; a chave de serviço pode tudo.
--
-- COMO DESFAZER (a função primeiro, depois a tabela; apagar a tabela PERDE as contagens guardadas — é só contar de novo)
--   drop function if exists public.compra_contagem_salvar(bigint, bigint, numeric);
--   drop table if exists public.compra_contagem;

create table public.compra_contagem (
  semana_id   bigint not null references public.semanas (id) on delete cascade,
  produto_id  bigint not null check (produto_id > 0),
  qtd         numeric not null check (qtd >= 0 and qtd = round(qtd, 3)),
  contado_por text not null check (char_length(contado_por) between 1 and 200),
  contado_em  timestamptz not null,
  primary key (semana_id, produto_id)
);

alter table public.compra_contagem enable row level security;
create policy compra_contagem_sel_ativo on public.compra_contagem for select to authenticated using (eh_ativo());

-- Só leitura para o usuário ativo logado (a RLS acima); anon nada; escrita só pela função abaixo e pela chave de serviço.
revoke all on public.compra_contagem from public, anon, authenticated;
grant select on public.compra_contagem to authenticated;
grant all on public.compra_contagem to service_role;

create or replace function public.compra_contagem_salvar(p_semana bigint, p_produto bigint, p_qtd numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  perform exigir_ativo();
  select status into v_status from semanas where id = p_semana;
  if not found then
    raise exception 'semana não encontrada';
  end if;
  if v_status = 'encerrada' then
    raise exception 'esta semana já foi encerrada: a contagem não pode mais ser alterada';
  end if;
  if not exists (select 1 from itens_semana where semana_id = p_semana and produto_id = p_produto) then
    raise exception 'este produto não está na lista desta semana';
  end if;

  if p_qtd is null then
    delete from compra_contagem where semana_id = p_semana and produto_id = p_produto;
    return;
  end if;
  if p_qtd < 0 then
    raise exception 'quantidade negativa não vale';
  end if;
  if p_qtd <> round(p_qtd, 3) then
    raise exception 'quantidade com mais de 3 casas decimais não vale';
  end if;

  insert into compra_contagem (semana_id, produto_id, qtd, contado_por, contado_em)
  values (p_semana, p_produto, p_qtd, email_atual(), cot_agora())
  on conflict (semana_id, produto_id) do update
    set qtd = excluded.qtd, contado_por = excluded.contado_por, contado_em = excluded.contado_em;
end $$;

revoke execute on function public.compra_contagem_salvar(bigint, bigint, numeric) from public, anon;
grant execute on function public.compra_contagem_salvar(bigint, bigint, numeric) to authenticated;
