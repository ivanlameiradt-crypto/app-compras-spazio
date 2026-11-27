-- App de Compras Spazio — aviso ao dono quando um cupom fica PARADO no app (decisão do Ivan em 19/11/2026: "sim").
--
-- Hoje o cupom que a função enviar-cupom deixa parado (foto ilegível, item sem casamento, total não lido, possível repetida) ou esperando o "Confirmar e lançar" não avisa ninguém:
-- só o robô de lançamento avisa, e só quando ELE falha. Quem passa a avisar é o robô (repositório sischef-monitor-notas, fluxo "Reaper do cupom", a cada 30 min no servidor;
-- programa aviso_cupom_parado.py): UM aviso por cupom, no WhatsApp e no e-mail. Esta migração cria a marca durável de "já avisado":
--   cupom.aviso_parado_em — preenchida = o dono já foi avisado deste cupom parado (o robô grava ANTES de mandar o aviso e só apaga se nenhum dos dois canais saiu).
-- Nula por padrão. Só o servidor (service_role, o robô) escreve; o admin lê pela RLS que `cupom` já tem (nenhuma política nova). O app não usa a coluna.
--
-- CUPOM QUE JÁ ESTAVA PARADO: no momento em que a coluna é criada, todo cupom em REVISAR recebe a marca (como se já tivesse sido avisado), para o primeiro giro do robô não mandar
-- uma enxurrada de avisos de cupons antigos. Só acontece na CRIAÇÃO da coluna: aplicar a migração de novo não marca nada (não esconde aviso de cupom novo).
--
-- ORDEM: esta migração pode entrar antes ou depois do robô novo. Sem a coluna, o robô novo só escreve no log que a migração falta e não avisa (nada quebra).
-- Depois de aplicar: conferir `select aviso_parado_em from cupom limit 1` e olhar a próxima rodada do "Backup do Supabase" (log sem "PROBLEMA").
-- Idempotente. DESFAZER: supabase/rollback/20261231000004_cupom_aviso_parado.desfazer.sql

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cupom' and column_name = 'aviso_parado_em') then
    alter table public.cupom add column aviso_parado_em timestamptz;
    update public.cupom set aviso_parado_em = now() where estado = 'REVISAR';
  end if;
end $$;

-- Explícito para o backup diário (regra de 13/11/2026); a tabela já tinha este acesso.
grant select on public.cupom to service_role;
