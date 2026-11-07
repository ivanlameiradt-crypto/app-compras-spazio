-- App de Compras Spazio — NF-e lançada não pode ficar com o estado 'lancando' para sempre (07/11/2026).
--
-- Sintoma: a aba mostrava "Lançando… (o robô está trabalhando)" e travava o botão "Lançar" em notas que o robô já
-- tinha lançado no SisChef (ex.: NF 000090330, Mateus MIX, LANCADA às 18:22 UTC de 06/11). Causa: o robô marca o
-- sucesso só com cot_nfe_marcar_lancadas (situacao = 'lancada', lancada_em, nf_sischef), e essa função não mexia no
-- estado do lançamento. A Edge Function lancar-nfe só troca 'lancando' por outro estado enquanto lancada_em é nulo,
-- então a reserva ficava para sempre.
--
-- Correção: a lançada também tira a reserva 'lancando' (vira nulo, sem motivo). Só o 'lancando' é limpo: 'erro'
-- (pedido pela metade, ex.: frete com boleto por lançar no SisChef), 'revisar' e 'ensaio_ok' continuam como estão.

create or replace function public.cot_nfe_marcar_lancadas(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; v int := 0;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  for e in select value from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    update cot_nfe set situacao = 'lancada', lancada_em = (e ->> 'lancada_em')::timestamptz,
                       nf_sischef = e ->> 'nf_sischef', saiu_da_fila_em = coalesce(saiu_da_fila_em, (e ->> 'lancada_em')::timestamptz),
                       atualizado_em = cot_agora()
     where chave = e ->> 'chave' and situacao <> 'lancada';
    if found then
      v := v + 1;
      -- a reserva da Edge Function acabou com o lançamento: sem isto a nota fica "Lançando…" para sempre
      update cot_nfe set lancamento_estado = null, lancamento_motivo = null, lancamento_estado_em = cot_agora()
       where chave = e ->> 'chave' and lancamento_estado = 'lancando';
    end if;
  end loop;
  return v;
end $$;

-- Notas já lançadas que ficaram presas em 'lancando' (40 em 07/11/2026; todas com situacao = 'lancada').
update cot_nfe set lancamento_estado = null, lancamento_motivo = null, lancamento_estado_em = cot_agora(), atualizado_em = cot_agora()
 where situacao = 'lancada' and lancamento_estado = 'lancando';
