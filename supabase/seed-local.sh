#!/bin/bash
# Usuários e dados de TESTE só para o Supabase LOCAL (portas 55xxx). Nunca rodar no projeto de verdade.
# Logins locais: marcos@local.test / pedro@local.test, senha: atelie-local-123
set -e
API=http://127.0.0.1:55321
SR=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
for u in marcos pedro; do
  curl -s -o /dev/null -X POST "$API/auth/v1/admin/users" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
    -d "{\"email\":\"$u@local.test\",\"password\":\"atelie-local-123\",\"email_confirm\":true}"
done
docker exec -i supabase_db_atelie-3d psql -U postgres -qtA <<'SQL'
insert into public.perfis (user_id, papel, nome)
select id, case when email like 'marcos@%' then 'marcos' else 'pedro' end,
       case when email like 'marcos@%' then 'Marcos' else 'Pedro' end
  from auth.users where email in ('marcos@local.test','pedro@local.test')
on conflict (user_id) do nothing;
select papel || ' ok' from public.perfis order by papel;
SQL
