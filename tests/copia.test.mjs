import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paraCsv, nomeDaCopia, TABELAS, gerarCopia } from '../app/js/copia.js';
import { paginar } from '../app/js/paginar.js';

test('paraCsv: cabeçalho pela união das colunas, ; como separador e aspas quando precisa', () => {
  const csv = paraCsv([{ cliente: 'Ana; filha', total: 10.5 }, { cliente: 'Bia "B"', obs: 'linha 1\nlinha 2' }]);
  assert.equal(csv, '﻿cliente;total;obs\r\n"Ana; filha";10,5;\r\n"Bia ""B""";;"linha 1\nlinha 2"\r\n');
});

test('paraCsv: objeto (jsonb) vira JSON, nulo vira vazio, booleano vira sim/não', () => {
  const csv = paraCsv([{ valor: { a: 1 }, pago: true, entregue: false, obs: null }]);
  assert.equal(csv, '﻿valor;pago;entregue;obs\r\n"{""a"":1}";sim;não;\r\n');
});

test('paraCsv: lista vazia dá arquivo vazio com BOM', () => {
  assert.equal(paraCsv([]), '﻿');
});

test('paginar junta páginas até vir uma incompleta', async () => {
  const todas = Array.from({ length: 2503 }, (_, i) => i);
  const pedidos = [];
  const r = await paginar(async (de, ate) => { pedidos.push([de, ate]); return { dados: todas.slice(de, ate + 1), erro: null }; }, 1000);
  assert.equal(r.erro, null);
  assert.equal(r.dados.length, 2503);
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('paginar com página exata pede mais uma e para no vazio', async () => {
  const r = await paginar(async (de, ate) => ({ dados: Array.from({ length: 1000 }, (_, i) => de + i).filter((x) => x < 1000), erro: null }), 1000);
  assert.equal(r.dados.length, 1000);
});

test('paginar devolve o erro sem dados parciais', async () => {
  let n = 0;
  const r = await paginar(async () => (n++ ? { dados: null, erro: 'caiu a internet' } : { dados: new Array(10).fill(0), erro: null }), 10);
  assert.deepEqual(r, { dados: null, erro: 'caiu a internet' });
});

test('nome da cópia leva a data', () => {
  assert.equal(nomeDaCopia('2026-10-21'), 'atelie-3d-copia-2026-10-21.zip');
});

test('todas as tabelas do banco entram na cópia', () => {
  assert.deepEqual([...TABELAS].sort(), ['config', 'filamentos', 'movimentos_estoque', 'orcamento_impressoes', 'orcamento_item_placas',
    'orcamento_itens', 'orcamento_placa_filamentos', 'orcamentos', 'perfis', 'produtos', 'tarefa_filamentos', 'tarefas', 'vendas']);
});

class ZipFalso {
  constructor() { this.arquivos = {}; }
  file(nome, conteudo) { this.arquivos[nome] = conteudo; }
  async generateAsync() { return this.arquivos; }
}
const dbFalso = (dados, fotos = []) => ({
  rpc: async (nome) => (nome === 'exportar_tudo' ? dados : { dados: null, erro: 'função errada' }),
  listarFotos: async () => ({ dados: fotos, erro: null }),
  foto: async (c) => ({ dados: `bytes de ${c}`, erro: null }),
});

test('gerarCopia: JSON + CSV de cada tabela, fotos e LEIA-ME', async () => {
  const dados = Object.fromEntries(TABELAS.map((t) => [t, []]));
  dados.vendas = [{ id: 'v1', total: 10 }];
  const r = await gerarCopia(dbFalso({ dados, erro: null }, ['2026-10/a.png']), ZipFalso, '2026-10-21');
  assert.equal(r.nome, 'atelie-3d-copia-2026-10-21.zip');
  assert.deepEqual(JSON.parse(r.blob['dados/vendas.json']), [{ id: 'v1', total: 10 }]);
  assert.equal(r.blob['planilhas/vendas.csv'], '\uFEFFid;total\r\nv1;10\r\n');
  assert.equal(r.blob['fotos/2026-10/a.png'], 'bytes de 2026-10/a.png');
  assert.match(r.blob['LEIA-ME.txt'], /vendas: 1/);
  assert.deepEqual(r.contagem.at(-1), ['fotos', 1]);
});

test('gerarCopia: erro do banco ou tabela faltando não gera arquivo', async () => {
  assert.deepEqual(await gerarCopia(dbFalso({ dados: null, erro: 'só o Marcos baixa a cópia de tudo' }), ZipFalso, '2026-10-21'),
    { erro: 'só o Marcos baixa a cópia de tudo' });
  const r = await gerarCopia(dbFalso({ dados: { perfis: [] }, erro: null }), ZipFalso, '2026-10-21');
  assert.match(r.erro, /sem a tabela config/);
});

test('restauração: ordem das chaves, gatilhos desligados, tudo ou nada e conferência do saldo', async () => {
  const { sqlDeRestauracao, ORDEM } = await import('../ferramentas/restaurar-copia.mjs');
  assert.deepEqual([...ORDEM].sort(), [...TABELAS].sort());
  assert.ok(ORDEM.indexOf('orcamentos') < ORDEM.indexOf('orcamento_itens') && ORDEM.indexOf('filamentos') < ORDEM.indexOf('movimentos_estoque'));
  const dados = Object.fromEntries(TABELAS.map((t) => [t, []]));
  dados.vendas = [{ id: 'v1', obs: 'texto com $copia$ dentro' }];
  const sql = sqlDeRestauracao(dados);
  assert.match(sql, /^-- Restauração[\s\S]*\nbegin;\nset local session_replication_role = replica;/);
  assert.match(sql, /saldo de rolo diferente[\s\S]*\ncommit;\n$/);
  assert.match(sql, /\$copiax\$\[\{"id":"v1","obs":"texto com \$copia\$ dentro"\}\]\$copiax\$::jsonb/);
  assert.throws(() => sqlDeRestauracao({ perfis: [] }), /não tem dados\/config\.json/);
});

test('paraCsv: texto que vira fórmula no Excel é desarmado; número negativo continua número', () => {
  const csv = paraCsv([{ cliente: '=HYPERLINK("http://x")', obs: '+5', a: '@soma', b: '-2', valor: -3.5 }]);
  assert.equal(csv, '﻿cliente;obs;a;b;valor\r\n"\'=HYPERLINK(""http://x"")";\'+5;\'@soma;\'-2;-3,5\r\n');
});
