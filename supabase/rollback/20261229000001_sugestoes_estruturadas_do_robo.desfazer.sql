-- DESFAZER 20261229000001_sugestoes_estruturadas_do_robo.sql (rodar SÓ depois de o robô e o app novos saírem do ar; o robô antigo e o app antigo não usam as colunas).
-- Devolve a função à versão de 20261206000001 (sem gravar sugestões) e apaga as duas colunas (as sugestões gravadas se perdem; o texto do motivo não é tocado).
create or replace function public.cot_nfe_marcar_estado(p_segredo text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform cot_nfe_exigir_robo(p_segredo);
  if coalesce(p ->> 'estado', '') not in ('revisar', 'erro', 'ensaio_ok') then
    raise exception 'estado inválido';
  end if;
  update cot_nfe set lancamento_estado = p ->> 'estado',
                     lancamento_motivo = left(nullif(p ->> 'motivo', ''), 2000),
                     lancamento_estado_em = cot_agora(),
                     atualizado_em = cot_agora()
   where chave = p ->> 'chave' and situacao <> 'lancada';
  get diagnostics v = row_count;
  return v;
end $$;
alter table public.cot_nfe drop constraint if exists cot_nfe_lancamento_sugestoes_forma;
alter table public.cot_nfe drop column if exists lancamento_sugestoes;
alter table public.cupom drop constraint if exists cupom_sugestoes_forma;
alter table public.cupom drop column if exists sugestoes;
