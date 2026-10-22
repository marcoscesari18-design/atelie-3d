#!/usr/bin/env bash
# Testes do banco no Supabase LOCAL: aplica o schema, roda supabase/testes.sql, concorrência e ida e volta da cópia.
# Só passa se o psql terminar sem erro E imprimir a linha final de sucesso (um filtro de saída não esconde falha).
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=(docker exec -i supabase_db_atelie-3d psql -U postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -q < supabase/schema.sql > /dev/null
saida=$("${PSQL[@]}" < supabase/testes.sql 2>&1) || { echo "$saida" | grep -E '^[0-9]+\.|FALHOU|ERROR' ; echo "FALHOU: testes.sql parou com erro"; exit 1; }
echo "$saida" | grep -E '^[0-9]+\.|PASSARAM|FALHOU|ERROR' || true
echo "$saida" | grep -q 'TODOS OS TESTES DO BANCO PASSARAM' || { echo "FALHOU: testes.sql não chegou ao fim"; exit 1; }
bash supabase/concorrencia.sh
bash supabase/restauracao.sh
