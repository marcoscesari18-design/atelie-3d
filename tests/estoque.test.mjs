import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoRolo } from '../app/js/estoque.js';

// Briefing §4.1: > 300 g normal · 100–300 g atenção · < 100 g acabando; negativo = faltando
test('mais de 300 g é normal', () => {
  assert.deepEqual(estadoRolo(650, 1000), { nivel: 'ok', rotulo: 'Normal', pct: 65 });
});
test('entre 100 e 300 g pede atenção', () => {
  assert.equal(estadoRolo(300, 1000).nivel, 'atencao');
  assert.equal(estadoRolo(100, 1000).nivel, 'atencao');
});
test('menos de 100 g está acabando', () => {
  const e = estadoRolo(99.5, 1000);
  assert.equal(e.nivel, 'erro'); assert.equal(e.rotulo, 'Acabando');
});
test('negativo está faltando e a barra fica vazia', () => {
  assert.deepEqual(estadoRolo(-12, 1000), { nivel: 'erro', rotulo: 'Faltando', pct: 0 });
});
test('rolo novo maior que o inicial não passa de 100%', () => {
  assert.equal(estadoRolo(1800, 1000).pct, 100);
});
test('inicial zero não quebra', () => {
  assert.equal(estadoRolo(50, 0).pct, 100);
});
