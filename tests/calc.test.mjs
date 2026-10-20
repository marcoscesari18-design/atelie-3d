import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPlaca, calcularItem, calcularOrcamento, arredondar } from '../app/js/calc.js';

// Padrões da calculadora original (DEFAULTS em referencia_precifica3d_original.html)
const params = { margem: 100, maoHora: 20, maoMin: 10, falha: 5, tarifa: 0.80, potencia: 100, desgaste: 1.50 };
const perto = (real, esperado, msg) => assert.ok(Math.abs(real - esperado) < 0.005, `${msg}: ${real} ≠ ${esperado}`);

// Valores conferidos rodando a original no Chrome (19/10/2026): PEC 12,10 / R$ 13 · pá 26,59 / R$ 30
test('chaveiro PEC (minutos inteiros, igual à original)', () => {
  const it = calcularItem({ impressoes: [{ vezes: 1, unidadesPorVez: 1, placas: [{ segundos: 39 * 60, cores: [{ gramas: 11.69, custoKg: 120 }] }] }], qtd: 1, extras: 0, params });
  perto(it.custoItem, 6.0513, 'custo');
  perto(it.precoUnit, 12.1026, 'preço');
  assert.equal(it.arredondadoUnit, 13);
});

test('pá de ração com extras (igual à original)', () => {
  const it = calcularItem({ impressoes: [{ vezes: 1, unidadesPorVez: 1, placas: [{ segundos: 74 * 60, cores: [{ gramas: 40.65, custoKg: 120 }] }] }], qtd: 1, extras: 2.5, params });
  perto(it.custoItem, 13.2930, 'custo');
  assert.equal(it.arredondadoUnit, 30);
});

test('segundos importados do .3mf', () => {
  const p = calcularPlaca({ segundos: 14171, cores: [{ gramas: 74.93, custoKg: 120 }], params });
  perto(p.cMat, 8.9916, 'cMat');
  perto(p.custo, 19.4716, 'custo');
});

test('multicor soma o material por rolo', () => {
  const p = calcularPlaca({ segundos: 2340, cores: [{ gramas: 6, custoKg: 120 }, { gramas: 5.69, custoKg: 150 }], params });
  perto(p.cMat, 1.5735, 'cMat');
  perto(p.custo, 6.2305, 'custo');
});

test('um rolo só dá o mesmo valor da original', () => {
  const p = calcularPlaca({ segundos: 2340, cores: [{ gramas: 11.69, custoKg: 120 }], params });
  perto(p.custo, 6.0513, 'custo');
});

test('duas placas somam e contam a mão de obra duas vezes', () => {
  const placas = [
    { segundos: 17595, cores: [{ gramas: 121.15, custoKg: 120 }] },
    { segundos: 959, cores: [{ gramas: 2.05, custoKg: 120 }] },
  ];
  const it = calcularItem({ impressoes: [{ vezes: 1, unidadesPorVez: 1, placas }], qtd: 1, extras: 0, params });
  perto(it.custoItem, 31.0735, 'custo');
});

test('refatiar: 4 por vez + 1 por vez fecham 5', () => {
  const imp4 = { vezes: 1, unidadesPorVez: 4, placas: [{ segundos: 7200, cores: [{ gramas: 46.76, custoKg: 120 }] }] };
  const imp1 = { vezes: 1, unidadesPorVez: 1, placas: [{ segundos: 2340, cores: [{ gramas: 11.69, custoKg: 120 }] }] };
  const it = calcularItem({ impressoes: [imp4, imp1], qtd: 5, extras: 0, params });
  assert.equal(it.unidades, 5);
  assert.equal(it.faltam, 0);
  perto(it.custoItem, 18.7611, 'custo');
  perto(it.custoUnit, 3.7522, 'custo unit');
  perto(it.precoUnit, 7.5044, 'preço unit');
});

test('quantidade que não fecha diz quantas faltam', () => {
  const imp4 = { vezes: 1, unidadesPorVez: 4, placas: [{ segundos: 7200, cores: [{ gramas: 46.76, custoKg: 120 }] }] };
  const it = calcularItem({ impressoes: [imp4], qtd: 5, extras: 0, params });
  assert.equal(it.faltam, 1);
});

test('imprimir a mais que a quantidade é recusado', () => {
  const imp4 = { vezes: 2, unidadesPorVez: 4, placas: [{ segundos: 7200, cores: [{ gramas: 46.76, custoKg: 120 }] }] };
  assert.throws(() => calcularItem({ impressoes: [imp4], qtd: 5, extras: 0, params }), /sobra/);
});

test('desconto de 10% em 2 itens fecha no centavo', () => {
  const o = calcularOrcamento({ itens: [{ precoUnit: 13, qtd: 3 }, { precoUnit: 7.33, qtd: 1 }], descontoPct: 10 });
  assert.equal(o.subtotal, 46.33);
  assert.equal(o.total, 41.70);
  const soma = o.linhas.reduce((s, l) => s + Math.round(l.precoTotal * 100), 0) / 100;
  assert.equal(soma, o.total);
});

test('desconto de 100% ou em item único é recusado', () => {
  assert.throws(() => calcularOrcamento({ itens: [{ precoUnit: 10, qtd: 1 }, { precoUnit: 5, qtd: 1 }], descontoPct: 100 }), /desconto/);
  assert.throws(() => calcularOrcamento({ itens: [{ precoUnit: 10, qtd: 1 }], descontoPct: 10 }), /desconto/);
});

test('sem desconto o total é a soma', () => {
  const o = calcularOrcamento({ itens: [{ precoUnit: 13, qtd: 2 }], descontoPct: 0 });
  assert.equal(o.total, 26);
});

test('arredondar como a original', () => {
  assert.equal(arredondar(0), 0);
  assert.equal(arredondar(12.1), 13);
  assert.equal(arredondar(38.9), 40);
  assert.equal(arredondar(101), 110);
});
