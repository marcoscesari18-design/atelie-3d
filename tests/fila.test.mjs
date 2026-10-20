import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumoFila, podeReimprimir } from '../app/js/fila.js';

const t = (status, segundos, extra = {}) => ({ id: Math.random().toString(), status, segundos_previsto: segundos, ...extra });

test('resumo conta feitas, faltam e tempo que falta', () => {
  const r = resumoFila([t('ok', 100), t('fila', 3600), t('imprimindo', 1800), t('falhou', 50)]);
  assert.deepEqual(r, { feitas: 1, faltam: 2, falharam: 1, segundosRestantes: 5400 });
});

test('falha já reimpressa não conta como pendente nem pode reimprimir de novo', () => {
  const a = t('falhou', 50, { id: 'a' });
  const b = t('fila', 50, { reimpressao_de: 'a' });
  assert.equal(podeReimprimir(a, [a, b]), false);
  assert.equal(podeReimprimir(t('falhou', 50, { id: 'c' }), [a, b]), true);
  assert.equal(podeReimprimir(t('ok', 50), [a, b]), false);
});
