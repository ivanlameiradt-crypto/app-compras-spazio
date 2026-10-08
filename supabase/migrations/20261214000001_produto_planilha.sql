-- App de Compras Spazio — a planilha "Produtos - como eu lanço no SisChef" do Ivan (08/10/2026) vira a FONTE da unidade de cada produto.
--
-- O Ivan revisou a lista de insumos do app e escreveu, produto por produto, a unidade em que o estoque é controlado DENTRO do SisChef (KG ou UN).
-- Essa unidade manda sobre o palpite que o app tirava do nome ("(KG)" no nome) e sobre itens_semana.unidade: o nome pode dizer KG e o SisChef
-- estar em UN (alface, manjericão, corante vermelho, óleo de gergelim) ou o nome não dizer nada e o produto ser KG (carne filé).
-- É dela que o app e o robô tiram a unidade para associar os itens do cupom e da nota e fazer a conta (regras do Ivan: peso na descrição × unidades,
-- ou a quantidade do cupom; gramas ÷ 1.000).
--
-- Uma linha por produto (produto_id = Cód. Interno do SisChef, o mesmo de itens_semana.produto_id; sem chave estrangeira de propósito, como
-- cot_produto_busca). Só o admin lê (RLS); ninguém escreve DIRETO pelo app: a carga é feita no servidor (SQL em supabase/dados/) quando o Ivan
-- devolve a planilha atualizada. Correção de NOME de produto continua em cot_produto_busca.nome_corrigido.

create table public.produto_planilha (
  produto_id    bigint primary key,
  unidade       text not null check (unidade in ('KG', 'UN')),
  atualizado_em timestamptz not null default now()
);

alter table public.produto_planilha enable row level security;
create policy produto_planilha_ler on public.produto_planilha for select to authenticated using (eh_admin());

revoke all on public.produto_planilha from public, anon, authenticated;
grant select on public.produto_planilha to authenticated;
grant all on public.produto_planilha to service_role;
