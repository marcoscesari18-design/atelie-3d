import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumoVendas } from '../app/js/vendas-calc.js';

const v = (total, lucro, extra = {}) => ({ total, lucro, pago: false, entregue: false, cancelada: false, ...extra });

test('soma faturamento e lucro, ignora canceladas', () => {
  const r = resumoVendas([v(10, 4), v(20, 8), v(99, 50, { cancelada: true })]);
  assert.equal(r.faturamento, 30); assert.equal(r.lucro, 12); assert.equal(r.n, 2);
});

test('em produção = não entregue; a receber = entregue e não pago', () => {
  const r = resumoVendas([v(10, 4, { entregue: true }), v(20, 8), v(5, 2, { entregue: true, pago: true })]);
  assert.equal(r.emProducao, 20); assert.equal(r.aReceber, 10);
});

test('centavos não acumulam erro', () => {
  assert.equal(resumoVendas([v(0.1, 0), v(0.2, 0)]).faturamento, 0.3);
});
