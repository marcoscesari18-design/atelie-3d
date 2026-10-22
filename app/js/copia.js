// Cópia de segurança: o plano grátis do Supabase não guarda backup. O Marcos baixa um .zip com
// todas as tabelas (JSON para restaurar, CSV para abrir no Excel) e as fotos, e guarda fora do Supabase.
// Nunca vai para o GitHub (o repositório é público).

// as tabelas que exportar_tudo() devolve (no banco, num comando só: todas do mesmo instante)
export const TABELAS = ['perfis', 'config', 'filamentos', 'produtos', 'orcamentos', 'orcamento_itens', 'orcamento_impressoes',
  'orcamento_item_placas', 'orcamento_placa_filamentos', 'tarefas', 'tarefa_filamentos', 'movimentos_estoque', 'vendas'];

const celula = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return String(v).replace('.', ',');
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // texto que começa com = + - @ vira fórmula no Excel (ex.: um nome de cliente "=HYPERLINK(...)"): o ' desarma
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV no jeito do Excel brasileiro: ; separa, vírgula decimal, BOM para os acentos
export function paraCsv(linhas) {
  if (!linhas.length) return '﻿';
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'));
  return '﻿' + [colunas.join(';'), ...corpo].join('\r\n') + '\r\n';
}

export const nomeDaCopia = (dataISO) => `atelie-3d-copia-${dataISO}.zip`;

const LEIA_ME = (quando, contagem) => `Cópia do Ateliê 3D feita em ${quando}.

dados/*.json  — o conteúdo de cada tabela, para restaurar o banco se precisar.
planilhas/*.csv — as mesmas tabelas para abrir no Excel.
fotos/ — fotos dos itens e o logo do PDF.

Linhas por tabela:
${contagem.map(([t, n]) => `  ${t}: ${n}`).join('\n')}

Guarde este arquivo fora do Supabase (computador, Google Drive). Não suba para o GitHub.

Para restaurar: no projeto do app, rode  node ferramentas/restaurar-copia.mjs <este arquivo .zip> > restaurar.sql
e cole restaurar.sql no SQL Editor do Supabase (as tabelas precisam estar vazias; as instruções estão no topo da ferramenta).
As fotos voltam pelo Storage, bucket "fotos", mantendo as pastas por mês.
`;

// db = módulo db.js; JSZip = a biblioteca carregada no index.html; aoAvancar(texto) mostra o progresso
export async function gerarCopia(db, JSZip, hojeISO, aoAvancar = () => {}) {
  const zip = new JSZip();
  const contagem = [];
  aoAvancar('Copiando os dados…');
  const r = await db.rpc('exportar_tudo');
  if (r.erro) return { erro: r.erro };
  for (const t of TABELAS) {
    const linhas = r.dados?.[t];
    if (!Array.isArray(linhas)) return { erro: `a cópia veio sem a tabela ${t}` };
    zip.file(`dados/${t}.json`, JSON.stringify(linhas, null, 1));
    zip.file(`planilhas/${t}.csv`, paraCsv(linhas));
    contagem.push([t, linhas.length]);
  }
  aoAvancar('Copiando as fotos…');
  const fotos = await db.listarFotos();
  if (fotos.erro) return { erro: fotos.erro };
  for (const caminho of fotos.dados) {
    const f = await db.foto(caminho);
    if (f.erro) return { erro: f.erro };
    zip.file(`fotos/${caminho}`, f.dados);
  }
  contagem.push(['fotos', fotos.dados.length]);
  zip.file('LEIA-ME.txt', LEIA_ME(new Date().toLocaleString('pt-BR'), contagem));
  aoAvancar('Compactando…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, nome: nomeDaCopia(hojeISO), contagem };
}
