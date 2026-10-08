-- Produto novo do cupom do Atacadão (08/10/2026): CHOCOLATE BARRA LACTA LAKA OREO - INSUMOS, cód. 3476366, KG. Palavra-chave dada pelo Ivan: LACTA LAKA OREO.
insert into produto_planilha (produto_id, unidade, descricao) values (3476366, 'KG', 'CHOCOLATE BARRA LACTA LAKA OREO - INSUMOS')
  on conflict (produto_id) do update set unidade = excluded.unidade, descricao = excluded.descricao, atualizado_em = now();
insert into cot_produto_busca (produto_id, palavras) values (3476366, 'LACTA LAKA OREO')
  on conflict (produto_id) do update set palavras = excluded.palavras, atualizado_em = now();
