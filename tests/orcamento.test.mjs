import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impressaoDe3mf, calcularRascunho, problemas, resumoBaixa, linhasParaBanco, rascunhoDoBanco } from '../app/js/orcamento.js';

const params = { margem: 100, maoHora: 20, maoMin: 10, falha: 5, tarifa: 0.80, potencia: 100, desgaste: 1.50 };
const rolos = [
  { id: 'lar', tipo: 'PLA', cor_hex: '#FF6910', custo_kg: 120, gramas_restantes: 1000, ativo: true, cor_nome: 'Laranja' },
  { id: 'azu', tipo: 'PLA', cor_hex: '#0085D5', custo_kg: 150, gramas_restantes: 8, ativo: true, cor_nome: 'Azul' },
];
const leitura = { placas: [
  { indice: 1, segundos: 2340, gramas: 11.69, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 6 }, { slot: 2, tipo: 'PLA', cor: '#0085D5', gramas: 5.69 }] },
  { indice: 2, segundos: 600, gramas: 2, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 2 }] },
] };

test('impressão do .3mf sugere o rolo de cada cor e usa as placas escolhidas', () => {
  const imp = impressaoDe3mf(leitura, { arquivo: 'chaveiro.3mf', placas: [1], rolos });
  assert.equal(imp.arquivo, 'chaveiro.3mf');
  assert.equal(imp.vezes, 1); assert.equal(imp.unidadesPorVez, 1);
  assert.equal(imp.placas.length, 1);
  assert.deepEqual(imp.placas[0].cores.map((c) => c.filamentoId), ['lar', 'azu']);
});

const rascunho = () => ({
  cliente: 'João', canal: 'escola', linha: 'pedro', descontoPct: 0,
  itens: [{ descricao: 'Chaveiro', qtd: 1, extras: 0, precoUnit: null,
    impressoes: [impressaoDe3mf(leitura, { arquivo: 'c.3mf', placas: [1], rolos })] }],
});

test('calcula custo e preço sugerido usando o R$/kg de cada rolo', () => {
  const c = calcularRascunho(rascunho(), rolos, params);
  assert.ok(Math.abs(c.itens[0].custoItem - 6.2305) < 0.005);
  assert.equal(c.itens[0].precoUnit, 13);           // sugerido arredondado
  assert.equal(c.total, 13);
});

test('preço digitado pelo Pedro vale no lugar do sugerido', () => {
  const r = rascunho(); r.itens[0].precoUnit = 15;
  assert.equal(calcularRascunho(r, rolos, params).total, 15);
});

test('problemas: falta rolo, falta unidade, sem cliente', () => {
  const r = rascunho();
  r.cliente = '';
  r.itens[0].qtd = 3;
  r.itens[0].impressoes[0].placas[0].cores[1].filamentoId = null;
  const p = problemas(r, rolos, params);
  assert.ok(p.some((x) => /cliente/i.test(x)));
  assert.ok(p.some((x) => /faltam 2/.test(x)));
  assert.ok(p.some((x) => /rolo/.test(x)));
});

test('sem problemas quando tudo fecha', () => {
  assert.deepEqual(problemas(rascunho(), rolos, params), []);
});

test('resumo de baixa soma por rolo e aponta falta', () => {
  const r = rascunho(); r.itens[0].qtd = 2; r.itens[0].impressoes[0].vezes = 2;
  const b = resumoBaixa(r, rolos);
  const lar = b.find((x) => x.filamentoId === 'lar'); const azu = b.find((x) => x.filamentoId === 'azu');
  assert.equal(lar.gramas, 12); assert.equal(lar.depois, 988); assert.equal(lar.falta, false);
  assert.equal(azu.gramas, 11.38); assert.equal(azu.falta, true);
});

test('duas cores do arquivo no mesmo rolo viram uma linha só no banco', () => {
  const r = rascunho(); r.itens[0].impressoes[0].placas[0].cores[1].filamentoId = 'lar';
  const l = linhasParaBanco(r, calcularRascunho(r, rolos, params));
  assert.deepEqual(l.itens[0].impressoes[0].placas[0].filamentos, [{ filamento_id: 'lar', gramas: 11.69 }]);
  assert.equal(l.itens[0].preco_total, l.itens[0].preco_total); // número
  assert.equal(l.total, 13);
});

test('volta do banco reconstrói o rascunho', () => {
  const r = rascunho();
  const l = linhasParaBanco(r, calcularRascunho(r, rolos, params));
  const orc = { id: 'o1', numero: 3, status: 'enviado', cliente: 'João', contato: null, canal: 'escola', linha: 'pedro', desconto_pct: 0, obs: null,
    orcamento_itens: l.itens.map((it, i) => ({ id: `i${i}`, descricao: it.descricao, qtd: it.qtd, extras: it.extras, preco_total: it.preco_total, foto_path: null,
      orcamento_impressoes: it.impressoes.map((m) => ({ arquivo_nome: m.arquivo_nome, vezes: m.vezes, unidades_por_vez: m.unidades_por_vez,
        orcamento_item_placas: m.placas.map((p) => ({ placa: p.placa, segundos: p.segundos, gramas: p.gramas,
          orcamento_placa_filamentos: p.filamentos })) })) })) };
  const de = rascunhoDoBanco(orc, rolos);
  assert.equal(de.id, 'o1'); assert.equal(de.status, 'enviado');
  assert.equal(de.itens[0].precoUnit, 13);
  assert.equal(calcularRascunho(de, rolos, params).total, 13);
});

test('reabrir orçamento com desconto mantém o total salvo (caso do Codex: R$ 8,23)', () => {
  const r = rascunho();
  r.itens = [
    { ...r.itens[0], descricao: 'A', precoUnit: 5.07 },
    { ...structuredClone(r.itens[0]), descricao: 'B', precoUnit: 5.22 },
  ];
  r.descontoPct = 20;
  const c = calcularRascunho(r, rolos, params);
  assert.equal(c.total, 8.23);
  const l = linhasParaBanco(r, c);
  assert.deepEqual(l.itens.map((i) => i.preco_unit), [5.07, 5.22]);
  const orc = { id: 'o1', numero: 1, status: 'enviado', cliente: 'J', canal: 'escola', linha: 'pedro', desconto_pct: 20,
    orcamento_itens: l.itens.map((it) => ({ ...it, orcamento_impressoes: [] })) };
  const de = rascunhoDoBanco(orc, rolos);
  assert.deepEqual(de.itens.map((i) => i.precoUnit), [5.07, 5.22]);
});
