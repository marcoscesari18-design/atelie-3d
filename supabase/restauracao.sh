#!/usr/bin/env bash
# Ida e volta da cópia de segurança no Supabase LOCAL: exporta como o Marcos (exportar_tudo), monta o .zip
# igual ao do botão, gera o restaurar.sql, esvazia todas as tabelas, restaura e compara tabela por tabela.
# Tudo numa transação desfeita no fim: o banco local fica como estava. Termina com "RESTAURAÇÃO OK".
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=(docker exec -i supabase_db_atelie-3d psql -U postgres -v ON_ERROR_STOP=1 -qtA)
TMP=${TMP_RESTAURACAO:-$(mktemp -d)}; [ -n "${TMP_RESTAURACAO:-}" ] || trap 'rm -rf "$TMP"' EXIT
TABELAS="perfis config filamentos produtos orcamentos orcamento_itens orcamento_impressoes orcamento_item_placas orcamento_placa_filamentos tarefas tarefa_filamentos movimentos_estoque vendas"

marcos=$("${PSQL[@]}" -c "select user_id from public.perfis where papel = 'marcos' limit 1")
[ -n "$marcos" ] || { echo "FALHOU: sem login do Marcos no banco local (rode supabase/seed-local.sh)"; exit 1; }

# 1) exporta como o app faz
"${PSQL[@]}" > "$TMP/copia.json" <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$marcos', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.exportar_tudo();
rollback;
SQL
grep -v '^$' "$TMP/copia.json" | grep -v '^set_config\|^{"sub"' | tail -1 > "$TMP/so.json"

# 2) monta o .zip (dados/<tabela>.json) e gera o SQL de restauração com a ferramenta de verdade
node --input-type=module -e "
import JSZip from 'jszip'; import { readFile, writeFile } from 'node:fs/promises';
const c = JSON.parse(await readFile('$TMP/so.json', 'utf8')); const z = new JSZip();
for (const [t, l] of Object.entries(c)) z.file('dados/' + t + '.json', JSON.stringify(l));
await writeFile('$TMP/copia.zip', await z.generateAsync({ type: 'nodebuffer' }));"
node ferramentas/restaurar-copia.mjs "$TMP/copia.zip" > "$TMP/restaurar.sql"

# 3) foto de cada tabela antes (tabelas temporárias); depois compara linha a linha nos dois sentidos com EXCEPT,
#    que compara valores (jsonb 1.50 = 1.5: o navegador reescreve números do JSON sem mudar o valor)
{
  echo "begin;"
  for t in $TABELAS; do echo "create temp table antes_$t on commit drop as select * from public.$t;"; done
  echo "truncate $(echo $TABELAS | sed 's/ /, public./g; s/^/public./') cascade;"
  grep -v -E '^(begin|commit);$' "$TMP/restaurar.sql"
  for t in $TABELAS; do
    echo "select 'comparar|$t|' || (select count(*) from public.$t) || '|' ||"
    echo "  (select count(*) from (select * from antes_$t except all select * from public.$t) x) + (select count(*) from (select * from public.$t except all select * from antes_$t) y);"
  done
  echo "rollback;"
} | "${PSQL[@]}" > "$TMP/saida.txt"

falhou=0
for t in $TABELAS; do
  linha=$(grep "^comparar|$t|" "$TMP/saida.txt" || true); n=$(echo "$linha" | cut -d'|' -f3); dif=$(echo "$linha" | cut -d'|' -f4)
  if [ -n "$linha" ] && [ "$dif" = 0 ]; then echo "ok: $t ($n linhas iguais)"; else echo "FALHOU: $t (linhas diferentes: ${dif:-sem resultado})"; falhou=1; fi
done
[ "$falhou" = 0 ] && echo "RESTAURAÇÃO OK" || exit 1
