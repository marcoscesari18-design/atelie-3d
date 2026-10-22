// Transforma a cópia baixada em Ajustes ("Baixar cópia de tudo", .zip) num .sql que devolve os dados ao banco.
//
// Uso:  node ferramentas/restaurar-copia.mjs atelie-3d-copia-AAAA-MM-DD.zip > restaurar.sql
//       e rodar restaurar.sql inteiro no SQL Editor do Supabase.
//
// Pré-requisitos (o próprio .sql confere e para com erro se não estiverem certos):
//  - o banco já tem o schema (supabase/schema.sql) e as tabelas do app estão VAZIAS;
//  - os logins existem em Authentication com o mesmo id da cópia (dados/perfis.json). Num projeto novo,
//    os ids mudam: crie os logins, depois troque user_id em perfis pelo id novo de cada e-mail.
// Como funciona:
//  - session_replication_role = replica desliga os gatilhos durante a carga: recadastrar um rolo não cria
//    outra entrada de estoque (o saldo vem da cópia e os movimentos são os da cópia, sem dobrar);
//  - colunas calculadas pelo banco (total e lucro da venda) ficam de fora — o banco recalcula;
//  - o número dos orçamentos (ORC-0001…) volta igual e a contagem continua do maior.
// As fotos (pasta fotos/ do .zip) voltam à mão: Storage > bucket "fotos", mantendo as pastas por mês.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

// ordem das chaves estrangeiras: quem é referenciado entra antes
export const ORDEM = ['perfis', 'config', 'filamentos', 'produtos', 'orcamentos', 'orcamento_itens', 'orcamento_impressoes',
  'orcamento_item_placas', 'orcamento_placa_filamentos', 'tarefas', 'tarefa_filamentos', 'movimentos_estoque', 'vendas'];

// $tag$…$tag$ que não aparece dentro do texto
const citar = (texto) => {
  let tag = 'copia';
  while (texto.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${texto}$${tag}$`;
};

export function sqlDeRestauracao(dados) {
  for (const t of ORDEM) if (!Array.isArray(dados[t])) throw new Error(`a cópia não tem dados/${t}.json`);
  const linhas = [
    '-- Restauração do Ateliê 3D a partir da cópia de segurança. Rodar inteiro; ou entra tudo ou nada.',
    'begin;',
    'set local session_replication_role = replica;',
    '',
    'create function pg_temp.restaurar(p_tabela text, p_dados jsonb) returns integer language plpgsql as $f$',
    'declare v_cols text; v_n integer;',
    'begin',
    "  execute format('select count(*) from public.%I', p_tabela) into v_n;",
    "  if v_n > 0 then raise exception 'a tabela % já tem % linha(s): a restauração é só para tabelas vazias', p_tabela, v_n; end if;",
    "  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols",
    "    from information_schema.columns where table_schema = 'public' and table_name = p_tabela and is_generated = 'NEVER';",
    "  execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',",
    '                 p_tabela, v_cols, v_cols, p_tabela) using p_dados;',
    '  get diagnostics v_n = row_count;',
    '  return v_n;',
    'end $f$;',
    '',
  ];
  for (const t of ORDEM) linhas.push(`select pg_temp.restaurar('${t}', ${citar(JSON.stringify(dados[t]))}::jsonb) as ${t};`);
  linhas.push('',
    "select setval(pg_get_serial_sequence('public.orcamentos', 'numero'), coalesce((select max(numero) from public.orcamentos), 0) + 1, false);",
    '-- o saldo de cada rolo tem de bater com a soma dos movimentos (é o que os gatilhos garantem no dia a dia)',
    'do $c$ begin',
    '  if exists (select 1 from public.filamentos f',
    '              where f.gramas_restantes <> coalesce((select sum(m.gramas) from public.movimentos_estoque m where m.filamento_id = f.id), 0)) then',
    "    raise exception 'saldo de rolo diferente da soma dos movimentos: a cópia está incompleta';",
    '  end if;',
    'end $c$;',
    'commit;', '');
  return linhas.join('\n');
}

export async function lerCopia(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const dados = {};
  for (const t of ORDEM) {
    const f = zip.file(`dados/${t}.json`);
    if (!f) throw new Error(`a cópia não tem dados/${t}.json`);
    dados[t] = JSON.parse(await f.async('string'));
  }
  return dados;
}

// pathToFileURL: a pasta tem acento e espaço ("Laboratório de Projetos"), que a URL do módulo codifica
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arquivo = process.argv[2];
  if (!arquivo) { console.error('Uso: node ferramentas/restaurar-copia.mjs <copia.zip> > restaurar.sql'); process.exit(2); }
  try {
    process.stdout.write(sqlDeRestauracao(await lerCopia(await readFile(arquivo))));
  } catch (e) { console.error(`Não deu: ${e.message}`); process.exit(1); }
}
