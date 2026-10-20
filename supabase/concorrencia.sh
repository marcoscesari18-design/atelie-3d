#!/bin/bash
# Dois "celulares" ao mesmo tempo no mesmo orçamento (Supabase LOCAL).
# Uso: bash supabase/concorrencia.sh   → termina com "CONCORRÊNCIA OK" ou sai com erro.
set -u
DB=supabase_db_atelie-3d
P="docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -qtA"
M=00000000-0000-0000-0000-0000000000aa
U="select set_config('request.jwt.claims', json_build_object('sub','$M','role','authenticated')::text, true); set local role authenticated;"

prepara() {  # cria rolo de 1000 g e orçamento com 1 item de 10 g; imprime "rolo orc"
  $P <<SQL | tail -1
insert into auth.users (id, email, aud, role) values ('$M','conc@teste.local','authenticated','authenticated') on conflict do nothing;
insert into public.perfis (user_id, papel, nome) values ('$M','marcos','Conc') on conflict do nothing;
begin;
insert into public.filamentos (marca,tipo,cor_nome,custo_kg,gramas_iniciais) values ('T','PLA','Conc',120,1000) returning id as rolo \\gset
insert into public.orcamentos (cliente) values ('Conc') returning id as orc \\gset
insert into public.orcamento_itens (orcamento_id,descricao,qtd,custo_total,preco_total) values (:'orc','Conc',1,5,13) returning id as item \\gset
insert into public.orcamento_impressoes (item_id,vezes,unidades_por_vez) values (:'item',1,1) returning id as imp \\gset
insert into public.orcamento_item_placas (impressao_id,placa,segundos,gramas) values (:'imp',1,3600,10) returning id as placa \\gset
insert into public.orcamento_placa_filamentos (placa_id,filamento_id,gramas) values (:'placa',:'rolo',10);
select :'rolo' || ' ' || :'orc';
commit;
SQL
}
corre() {  # $1 = chamada SQL; segura a transação 2 s para forçar o encontro
  $P <<SQL 2>&1 | grep -v '^$'
begin; $U select $1; select pg_sleep(2); commit;
SQL
}
saldo() { $P -c "select gramas_restantes from public.filamentos where id='$1'"; }
limpa() {
  $P -c "delete from public.vendas where orcamento_id='$2'; delete from public.movimentos_estoque where filamento_id='$1'; delete from public.tarefas t using public.orcamento_itens i where i.id=t.orcamento_item_id and i.orcamento_id='$2'; delete from public.orcamentos where id='$2'; delete from public.filamentos where id='$1';" > /dev/null
}
falha() { echo "FALHOU: $*"; exit 1; }

# 1) aprovar × aprovar
read ROLO ORC < <(prepara)
corre "public.aprovar_orcamento('$ORC', 13)" > /tmp/c1 & sleep 0.5
corre "public.aprovar_orcamento('$ORC', 13)" > /tmp/c2; wait
grep -q "já foi aprovado" /tmp/c1 /tmp/c2 || falha "aprovar×aprovar: nenhuma recusa ($(cat /tmp/c1 /tmp/c2))"
[ "$(saldo $ROLO)" = "990.00" ] || falha "aprovar×aprovar: saldo $(saldo $ROLO)"
echo "ok: aprovar × aprovar"; limpa $ROLO $ORC

# 2) aprovar × cancelar
read ROLO ORC < <(prepara)
corre "public.aprovar_orcamento('$ORC', 13)" > /tmp/c1 & sleep 0.5
corre "public.cancelar_orcamento('$ORC')" > /tmp/c2; wait
S=$($P -c "select status from public.orcamentos where id='$ORC'")
[ "$S" = "cancelado" ] && [ "$(saldo $ROLO)" = "1000.00" ] || falha "aprovar×cancelar: status $S saldo $(saldo $ROLO)"
echo "ok: aprovar × cancelar (cancelar esperou e devolveu)"; limpa $ROLO $ORC

# 3) reimprimir × reimprimir
read ROLO ORC < <(prepara)
$P > /dev/null <<SQL
begin; $U select public.aprovar_orcamento('$ORC', 13);
update public.tarefas t set status='falhou', motivo_falha='x', aprendizado='y' from public.orcamento_itens i where i.id=t.orcamento_item_id and i.orcamento_id='$ORC';
commit;
SQL
T=$($P -c "select t.id from public.tarefas t join public.orcamento_itens i on i.id=t.orcamento_item_id where i.orcamento_id='$ORC'")
corre "public.reimprimir_tarefa('$T')" > /tmp/c1 & sleep 0.5
corre "public.reimprimir_tarefa('$T')" > /tmp/c2; wait
grep -q "já foi reimpressa" /tmp/c1 /tmp/c2 || falha "reimprimir×reimprimir: nenhuma recusa ($(cat /tmp/c1 /tmp/c2))"
[ "$(saldo $ROLO)" = "980.00" ] || falha "reimprimir×reimprimir: saldo $(saldo $ROLO)"
echo "ok: reimprimir × reimprimir"; limpa $ROLO $ORC

# 4) salvar (editando gramas) × aprovar: a aprovação espera e usa a versão salva
read ROLO ORC < <(prepara)
D="{\"orcamento\":{\"cliente\":\"Conc\",\"canal\":\"escola\",\"linha\":\"pedro\",\"desconto_pct\":0},\"itens\":[{\"descricao\":\"Conc\",\"qtd\":1,\"extras\":0,\"custo_total\":5,\"preco_unit\":13,\"preco_total\":13,\"impressoes\":[{\"arquivo_nome\":\"c.3mf\",\"vezes\":1,\"unidades_por_vez\":1,\"placas\":[{\"placa\":1,\"segundos\":3600,\"gramas\":20,\"filamentos\":[{\"filamento_id\":\"$ROLO\",\"gramas\":20}]}]}]}]}"
corre "public.salvar_orcamento('$ORC', '$D'::jsonb)" > /tmp/c1 & sleep 0.5
corre "public.aprovar_orcamento('$ORC', 13)" > /tmp/c2; wait
[ "$(saldo $ROLO)" = "980.00" ] || falha "salvar×aprovar: saldo $(saldo $ROLO) (esperado 980,00 = versão salva)"
G=$($P -c "select gramas_previsto from public.tarefas t join public.orcamento_itens i on i.id=t.orcamento_item_id where i.orcamento_id='$ORC'")
[ "$G" = "20.00" ] || falha "salvar×aprovar: tarefa com $G g"
echo "ok: salvar × aprovar (aprovou a versão salva, tarefa e estoque iguais)"; limpa $ROLO $ORC

$P -c "delete from public.perfis where user_id='$M'; delete from auth.users where id='$M';" > /dev/null
echo "CONCORRÊNCIA OK"
