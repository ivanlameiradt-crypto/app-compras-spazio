-- App de Compras Spazio — Fase 3: descartar a nota que não dá para lançar (aba "Lançamento de nota SEFAZ").
--
-- Há nota que nunca vai poder ser lançada pelo app: a SEFAZ entregou só o "XML resumido" (sem itens — o XML completo só vem depois da
-- ciência da operação), ou o item não tem produto e o Ivan não vai associar, ou é conta especial. Ela fica na lista e atrapalha as notas
-- que dá para lançar. O Ivan pede "descartar": a nota some da lista do app e NADA mais muda — nem no SisChef nem na SEFAZ (a nota
-- continua pendente lá; descartar aqui não gera entrada no estoque nem no financeiro).
--
-- Desenho: três colunas novas em vez de um valor novo em `situacao`, de propósito. A leitura da SEFAZ (cot_nfe_sincronizar) reescreve
-- `situacao` de toda nota que ainda está na fila do SisChef ('na_fila'): um 'descartada' ali seria desfeito na leitura seguinte. As
-- colunas abaixo a leitura nunca toca (o `on conflict do update` dela só lista as colunas dela).
--   descartada_em / descartada_por / descartada_motivo — preenchidas = descartada; nulas = na lista normal.
-- A nota descartada que sai da fila do SisChef vira 'saiu_da_fila' pela leitura, como qualquer outra, e some também da lista de descartadas.
--
-- cot_nfe_descartar (admin): só nota 'na_fila'; NUNCA a que ficou pela metade ('erro': o pedido já existe no SisChef e a nota tem de
-- continuar à vista até alguém conferir) nem a que o robô está lançando agora (reserva 'lancando' de menos de 30 min — o mesmo limite
-- da Edge Function lancar-nfe). Idempotente. cot_nfe_restaurar (admin): desfaz. Os dois gravam o antes/depois em historico_alteracoes.

alter table public.cot_nfe
  add column if not exists descartada_em timestamptz,
  add column if not exists descartada_por text,
  add column if not exists descartada_motivo text
    check (descartada_motivo is null or char_length(descartada_motivo) <= 300);

create or replace function public.cot_nfe_descartar(p_chave text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare n cot_nfe; v_motivo text;
begin
  perform exigir_admin();
  select * into n from cot_nfe where chave = p_chave for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if n.situacao <> 'na_fila' then raise exception 'esta nota não está mais na fila: não dá para descartar'; end if;
  if n.lancamento_estado = 'erro' then
    raise exception 'esta nota ficou pela metade: confira no SisChef antes de descartar';
  end if;
  if n.lancamento_estado = 'lancando' and coalesce(n.lancamento_em, cot_agora()) > cot_agora() - interval '30 minutes' then
    raise exception 'o robô está lançando esta nota agora: aguarde terminar';
  end if;
  v_motivo := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
  update cot_nfe set descartada_em = coalesce(descartada_em, cot_agora()), descartada_por = email_atual(),
                     descartada_motivo = v_motivo, atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('descartada', n.descartada_em is not null),
    jsonb_build_object('descartada', true, 'motivo', v_motivo));
end $$;

create or replace function public.cot_nfe_restaurar(p_chave text) returns void
language plpgsql security definer set search_path = public as $$
declare n cot_nfe;
begin
  perform exigir_admin();
  select * into n from cot_nfe where chave = p_chave for update;
  if not found then raise exception 'nota não encontrada'; end if;
  if n.descartada_em is null then return; end if; -- já está na lista normal
  update cot_nfe set descartada_em = null, descartada_por = null, descartada_motivo = null, atualizado_em = cot_agora()
   where chave = p_chave;
  perform cot_registrar_mudanca('cot_nfe', p_chave, jsonb_build_object('descartada', true, 'motivo', n.descartada_motivo),
    jsonb_build_object('descartada', false));
end $$;

-- Só o admin logado executa (a checagem de admin está dentro de cada função); anon e o público não.
revoke execute on function public.cot_nfe_descartar(text, text), public.cot_nfe_restaurar(text) from public, anon, authenticated;
grant execute on function public.cot_nfe_descartar(text, text), public.cot_nfe_restaurar(text) to authenticated;
