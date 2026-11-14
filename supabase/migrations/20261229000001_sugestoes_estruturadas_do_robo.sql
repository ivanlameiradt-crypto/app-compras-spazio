-- App de Compras Spazio — etapa 6 do inventário dos erros do robô (14/11/2026): o robô passa a gravar, JUNTO do motivo em texto, uma lista ESTRUTURADA de sugestões,
-- e o app prefere esse dado a adivinhar pelo texto. O texto do motivo continua gravado como sempre (e o app continua lendo o texto quando não há sugestões).
--
-- FORMATO (o mesmo nas duas colunas) — uma lista (jsonb array, no máximo 20 itens) de objetos:
--   { "codigo": "<curto, minúsculo, sem espaço>", "item_n": <número do item na nota | null>, "acao": "<o que o app oferece>", "dados": { só números e ids } }
-- NADA de senha, token, chave nem texto livre dentro de `dados`. A frase que o Ivan lê mora no app, nunca aqui.
-- Conjunto inicial (só o que o app já trata hoje por texto):
--   codigo "conversao_desnecessaria"  acao "tirar_conversao"       item_n = item da nota   dados {"numero": 0.24}            (nota e produto na mesma unidade; o número informado não serve)
--   codigo "itens_mesmo_codigo"       acao "associar_no_sischef"   item_n = menor item     dados {"itens": [1, 2], "cod_for": "0009085"}  (dois itens com o mesmo CÓD. FOR: o robô não sabe qual associar)
--   codigo "falha_passageira"         acao "tentar_de_novo"        item_n = null           dados {"nada_criado": 1}          (o robô provou que nada foi criado no SisChef; repetir é seguro)
-- O app só usa "falha_passageira" depois de conferir de novo, pelas regras que já tinha, que não há sinal de compra criada (cinto e suspensório).
--
-- COLUNAS (nulas por padrão; cupom/nota antigos e novos sem sugestão ficam nulos):
--   cot_nfe.lancamento_sugestoes  — gravada pelo robô junto do estado, pela MESMA função de sempre (cot_nfe_marcar_estado). A função NÃO ganhou parâmetro novo (um 3º parâmetro criaria uma
--                                   segunda versão da função e o PostgREST recusaria a chamada por ambiguidade, PGRST203): a lista vai no campo opcional "sugestoes" do jsonb `p`.
--                                   Quem manda `p` sem "sugestoes" (robô antigo) continua funcionando e a coluna fica nula (cada novo estado SUBSTITUI a lista anterior).
--                                   Lista inválida (não é array, mais de 20, passa de 8000 bytes) é IGNORADA (vira nulo): o robô nunca quebra por causa disto.
--   cupom.sugestoes               — gravada pelo robô (service_role, PATCH direto) junto do estado REVISAR. Constraint: nulo ou array de até 20.
-- RLS: nenhuma política nova — o admin lê pela mesma política da tabela (cot_nfe_ler / cupom_sel_admin). service_role já tem acesso à tabela; o grant de leitura abaixo é explícito para o backup
-- diário (regra de 13/11/2026: sem ele o backup sai incompleto sem avisar).
--
-- ORDEM DE PUBLICAÇÃO (cada passo com o "pode" do Ivan): 1) ESTA migração; 2) o app (lê as colunas; sem elas ele repete a leitura sem a coluna nova); 3) o robô (sem a coluna ele grava só o texto).
-- Depois de aplicar: conferir `select lancamento_sugestoes from cot_nfe limit 1` e `select sugestoes from cupom limit 1`, e olhar a próxima rodada do "Backup do Supabase" (log sem "PROBLEMA").
-- Idempotente. DESFAZER: supabase/rollback/20261229000001_sugestoes_estruturadas_do_robo.desfazer.sql

alter table public.cot_nfe
  add column if not exists lancamento_sugestoes jsonb;
alter table public.cot_nfe drop constraint if exists cot_nfe_lancamento_sugestoes_forma;
alter table public.cot_nfe add constraint cot_nfe_lancamento_sugestoes_forma
  check (lancamento_sugestoes is null or (jsonb_typeof(lancamento_sugestoes) = 'array' and jsonb_array_length(lancamento_sugestoes) <= 20));

alter table public.cupom
  add column if not exists sugestoes jsonb;
alter table public.cupom drop constraint if exists cupom_sugestoes_forma;
alter table public.cupom add constraint cupom_sugestoes_forma
  check (sugestoes is null or (jsonb_typeof(sugestoes) = 'array' and jsonb_array_length(sugestoes) <= 20));

grant select on public.cot_nfe, public.cupom to service_role;

-- Mesma função e mesma assinatura de 20261206000001; a única mudança é gravar `lancamento_sugestoes` (campo opcional "sugestoes" de `p`).
create or replace function public.cot_nfe_marcar_estado(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v int; s jsonb := p -> 'sugestoes';
begin
  perform cot_nfe_exigir_robo(p_segredo);
  if coalesce(p ->> 'estado', '') not in ('revisar', 'erro', 'ensaio_ok') then
    raise exception 'estado inválido';
  end if;
  -- lista malformada = sem sugestões (nunca derruba o robô): só vale array de até 20 itens e até 8000 bytes
  if s is null or jsonb_typeof(s) <> 'array' or jsonb_array_length(s) = 0 or jsonb_array_length(s) > 20 or octet_length(s::text) > 8000 then
    s := null;
  end if;
  update cot_nfe set lancamento_estado = p ->> 'estado',
                     lancamento_motivo = left(nullif(p ->> 'motivo', ''), 2000),
                     lancamento_sugestoes = s,
                     lancamento_estado_em = cot_agora(),
                     atualizado_em = cot_agora()
   where chave = p ->> 'chave' and situacao <> 'lancada';
  get diagnostics v = row_count;
  return v;
end $$;
