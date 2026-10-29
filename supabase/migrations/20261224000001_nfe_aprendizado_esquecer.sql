-- App de Compras Spazio — memória de embalagem das NOTAS FISCAIS, fase 2 (a tela): "esquecer" o que o robô lembra (pedido do Ivan, 29/10/2026).
--
-- O QUE MUDA (só cria UMA função nova; nada que já existe é alterado, nem a tabela nem as 2 funções do robô)
--   nfe_aprendizado_esquecer(p_cnpj, p_cod_forn, p_unidade): apaga a UMA linha da memória (nfe_aprendizado) daquele fornecedor (CNPJ) + código do produto na nota
--   (CÓD. FOR) + unidade da nota, e devolve quantas linhas apagou (1; ou 0 se a linha não existia). Quem a chama é o app, pelo botão "Esquecer" do item da nota.
--
-- POR QUÊ
--   A tela "Lançamento fiscal" passa a mostrar o que o robô lembra ("1 UN da nota = 12 UN no estoque") e o Ivan precisa poder mandar o robô ESQUECER um número que
--   ficou errado. A tabela não aceita escrita direta de ninguém (nem do admin logado), e as funções do robô só valem com o segredo dele: esta é a única porta, e é só do admin.
--
-- REGRAS
--   • Só o administrador logado no app (eh_admin()). Qualquer outro usuário logado recebe "não autorizado"; o anon nem executa a função (permission denied). Nada é apagado.
--   • O CNPJ aceita pontuação (só os dígitos contam) e tem de fechar 14 dígitos; o código fica sem os espaços das pontas; a unidade fica sem espaços e em maiúsculas
--     (como o robô grava). Valor fora do formato dá erro em português e nada é apagado.
--   • Apaga exatamente a linha daquela chave (CNPJ + código + unidade): as outras linhas, inclusive o mesmo código em outra unidade, ficam intactas.
--   • Quem apagou e o que foi apagado (a linha inteira, com produto e número) fica no histórico de alterações (historico_alteracoes), como nas outras funções de admin do app:
--     dá para recriar a linha à mão se foi engano. O robô também volta a aprender sozinho: na próxima nota lançada com o número que o Ivan informar, a linha nasce de novo.
--
-- COMO DESFAZER
--   drop function if exists public.nfe_aprendizado_esquecer(text, text, text);
--   (isso só tira o botão "Esquecer" do app; as linhas que já foram esquecidas NÃO voltam por isso — o que foi apagado está em historico_alteracoes, coluna "antes".)

create or replace function public.nfe_aprendizado_esquecer(p_cnpj text, p_cod_forn text, p_unidade text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cnpj  text;
  v_cod   text;
  v_un    text;
  v_antes jsonb;
begin
  if not eh_admin() then
    raise exception 'não autorizado' using errcode = '42501';
  end if;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido: informe os 14 dígitos do emitente';
  end if;
  v_cod := btrim(coalesce(p_cod_forn, ''), E' \t\r\n');
  if v_cod = '' then
    raise exception 'informe o código do produto na nota (cod_forn)';
  end if;
  v_un := upper(btrim(coalesce(p_unidade, ''), E' \t\r\n'));
  if v_un = '' then
    raise exception 'informe a unidade da nota';
  end if;

  delete from nfe_aprendizado
   where emitente_cnpj = v_cnpj and cod_forn = v_cod and unidade_nota = v_un
  returning to_jsonb(nfe_aprendizado) into v_antes;

  if v_antes is null then
    return 0;   -- não havia nada a esquecer (já tinha sido esquecido, ou nunca existiu): nada muda e nada vai para o histórico
  end if;
  perform cot_registrar_mudanca('nfe_aprendizado', v_cnpj || '/' || v_cod || '/' || v_un, v_antes, null);
  return 1;
end $$;

-- Só o admin logado no app (authenticated + eh_admin()); o anon e o público não executam. (Padrão das outras funções de admin da Fase 3.)
revoke execute on function public.nfe_aprendizado_esquecer(text, text, text) from public, anon, authenticated;
grant execute on function public.nfe_aprendizado_esquecer(text, text, text) to authenticated;
