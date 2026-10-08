-- Nome fantasia dos fornecedores, só do app (pedido do Ivan, 08/10/2026): é o nome que "Últimos envios" (cupom) e as notas fiscais mostram; a razão social fica no detalhe.
-- O SisChef não recebe fantasia nenhuma. Upsert por CNPJ (a A. N. da Silva já existia com "Coplast Desartavel", sem o "c" e sem acento: corrigida).
begin;
insert into fornecedor_app (cnpj, razao_social, nome_fantasia) values
  ('63540861000182', 'A. N. DA SILVA DESCARTAVEIS LTDA', 'COPLAST DESCARTÁVEL'),
  ('75315333032655', 'ATACADAO S.A.', 'ATACADÃO'),
  ('05054671003840', 'LIDER COMERCIO E INDUSTRIA LTDA', 'LÍDER'),
  ('03995515011363', 'MATEUS SUPERMERCADOS SA', 'MATEUS SUPERMERCADOS')
on conflict (cnpj) do update set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, atualizado_em = now();
commit;
