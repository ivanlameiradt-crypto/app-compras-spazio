-- App de Compras Spazio — "Excluir cupom" (e compra avulsa): pedido do Ivan em 03/11/2026. O cupom (ou a compra avulsa) que ele não quer lançar — devolvido, repetido,
-- enviado por engano — sai de "Últimos envios" e o robô NUNCA o lança. NADA muda no SisChef (não cancela nada lá).
--
-- Desenho, igual ao de cot_nfe_descartar (nota), com UMA diferença de propósito: aqui há um estado novo, 'EXCLUIDO'. O robô só pega cupom PENDENTE (reivindicar_cupom:
-- PENDENTE e sem pedido), o reaper só olha PENDENTE/PROCESSANDO e o app lista por estado: uma coluna "excluído" SEM estado novo deixaria o robô lançar um PENDENTE excluído.
-- Com o estado novo nada do robô muda: ele lê o cupom, vê que não está PENDENTE ("já processado") e sai.
--
-- A tabela `cupom` é do robô do cupom (db/migrations do sischef-monitor-notas: 20260930090000, 20261001120000 e 20261219000001). Esta migração mexe só no CHECK do estado
-- e em colunas novas; quem usa é o app, pelas duas funções abaixo (admin). Aplicar DEPOIS de conferir que o CHECK atual é o de 5 estados (PENDENTE, PROCESSANDO, LANCADO, REVISAR, TESTE).
-- Para refazer o esquema do zero (docs/BACKUP-SUPABASE.md do robô: todos os .sql das duas pastas, na ordem das datas) esta vem DEPOIS das três do robô, que criam a tabela e o CHECK de
-- 5 estados. ATENÇÃO: a 20261001120000_cupom_subfase3.sql do robô recria o `cupom_estado_check` com 5 estados; reaplicá-la SOZINHA, depois desta, apagaria o estado novo (ou falharia
-- se já houver linha EXCLUIDO). Não reaplicar.
--   excluido_em / excluido_por / excluido_motivo — preenchidas = excluído; estado_antes_de_excluir guarda de onde veio (REVISAR ou TESTE), para o "Voltar para a lista" devolver EXATAMENTE como estava.
--
-- cupom_excluir (admin): só REVISAR ("precisa de você") ou TESTE. NUNCA o LANCADO (a compra já está no SisChef: quem cancela é o Ivan lá), nem o que ficou com pedido no SisChef, nem o
-- que o robô está lançando (PROCESSANDO; se travar, o reaper o põe em REVISAR em 40 min e aí pode, se não parou no meio do SisChef), nem o que está na fila (PENDENTE: o robô vai
-- lançá-lo; se travar, o reaper o põe em REVISAR em 60 min e aí pode; a revisão independente de 04/11 mostrou que excluir um PENDENTE traz problemas: devolvê-lo à lista o deixaria sem
-- disparo e o reaper o marcaria "confira no SisChef" por engano, e uma escrita atrasada do reaper deixaria um excluído incoerente). Nem o REVISAR que parou no meio do SisChef (a compra
-- PODE existir lá e o aviso tem de continuar à vista até alguém conferir — as mesmas palavras que a tela usa em cupomRegras.diagnosticoDoCupom). UMA exceção, a frase EXATA que o reaper
-- grava num PENDENTE parado ("CONFERIR NO SISCHEF antes de repetir: PENDENTE nunca lançado há mais de N min"): nesse caso o robô nunca pegou o cupom, não há nada a conferir no SisChef e
-- o Ivan pode excluir. SÓ SE `processando_desde` for nulo: a reivindicação do robô o grava e nada o limpa (a re-revisão de 04/11 mostrou a corrida: o reaper lê o PENDENTE velho, o robô o
-- reivindica e clica no SisChef, e a escrita atrasada do reaper põe essa frase num cupom que o robô JÁ tocou). Idempotente. cupom_restaurar (admin): desfaz. Os dois gravam o antes/depois em historico_alteracoes.

alter table public.cupom drop constraint if exists cupom_estado_check;
alter table public.cupom add constraint cupom_estado_check
  check (estado in ('PENDENTE', 'PROCESSANDO', 'LANCADO', 'REVISAR', 'TESTE', 'EXCLUIDO'));

alter table public.cupom
  add column if not exists excluido_em timestamptz,
  add column if not exists excluido_por text,
  add column if not exists excluido_motivo text
    check (excluido_motivo is null or char_length(excluido_motivo) <= 300),
  add column if not exists estado_antes_de_excluir text
    check (estado_antes_de_excluir is null or estado_antes_de_excluir in ('REVISAR', 'TESTE'));

create or replace function public.cupom_excluir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c cupom; v_motivo text; v_robo text;
begin
  perform exigir_admin();
  select * into c from cupom where id = p_id for update;
  if not found then raise exception 'cupom não encontrado'; end if;
  if c.estado = 'EXCLUIDO' then return; end if;   -- já está excluído: nada a fazer
  if c.estado = 'LANCADO' or c.pedido_sischef is not null then
    raise exception 'este cupom já foi lançado no SisChef: para desfazer, cancele a entrada lá';
  end if;
  if c.estado = 'PROCESSANDO' then
    raise exception 'o robô está lançando este cupom agora: aguarde terminar';
  end if;
  if c.estado = 'PENDENTE' then
    raise exception 'este cupom está na fila e o robô vai lançá-lo: se ele travar, o app o mostra como "precisa de você" depois de cerca de 1 hora, e aí dá para excluir';
  end if;
  v_robo := btrim(coalesce(c.motivo, ''), E' \t\r\n');   -- as mesmas pontas que o .trim() da tela tira
  if c.estado = 'REVISAR'
     and v_robo ~* '^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO|^falha ao preencher o pagamento no Sischef'
     and not (c.processando_desde is null   -- o robô NUNCA reivindicou este cupom (a reivindicação grava processando_desde e nada a limpa)
              and v_robo ~ '^CONFERIR NO SISCHEF antes de repetir: PENDENTE nunca lançado há mais de [0-9]+ min$') then
    raise exception 'o robô começou a lançar este cupom e parou no meio: confira no SisChef antes de excluir';
  end if;
  v_motivo := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
  update cupom set estado_antes_de_excluir = c.estado, estado = 'EXCLUIDO', excluido_em = cot_agora(), excluido_por = email_atual(),
                   excluido_motivo = v_motivo, atualizado_em = cot_agora()
   where id = p_id;
  perform cot_registrar_mudanca('cupom', p_id::text, jsonb_build_object('estado', c.estado),
    jsonb_build_object('estado', 'EXCLUIDO', 'motivo', v_motivo));
end $$;

create or replace function public.cupom_restaurar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c cupom; v_volta text;
begin
  perform exigir_admin();
  select * into c from cupom where id = p_id for update;
  if not found then raise exception 'cupom não encontrado'; end if;
  if c.estado <> 'EXCLUIDO' then return; end if;   -- já está na lista normal
  v_volta := coalesce(c.estado_antes_de_excluir, 'REVISAR');
  update cupom set estado = v_volta, estado_antes_de_excluir = null, excluido_em = null, excluido_por = null, excluido_motivo = null,
                   atualizado_em = cot_agora()
   where id = p_id;
  perform cot_registrar_mudanca('cupom', p_id::text, jsonb_build_object('estado', 'EXCLUIDO', 'motivo', c.excluido_motivo),
    jsonb_build_object('estado', v_volta));
end $$;

-- Só o admin logado executa (a checagem de admin está dentro de cada função); anon e o público não.
revoke execute on function public.cupom_excluir(uuid, text), public.cupom_restaurar(uuid) from public, anon, authenticated;
grant execute on function public.cupom_excluir(uuid, text), public.cupom_restaurar(uuid) to authenticated;
