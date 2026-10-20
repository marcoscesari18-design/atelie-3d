import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sugerirRolo, distanciaCor } from '../app/js/cores.js';

const rolo = (id, tipo, cor_hex, ativo = true) => ({ id, tipo, cor_hex, ativo, cor_nome: id });
const rolos = [rolo('branco', 'PLA', '#F5F5F5'), rolo('cinza', 'PLA', '#BCBCBC'), rolo('laranja', 'PLA', '#FF6910'), rolo('petg', 'PETG', '#FFFFFF')];

test('branco do arquivo casa com o rolo branco', () => {
  const r = sugerirRolo('#FFFFFF', 'PLA', rolos);
  assert.equal(r.rolo.id, 'branco');
  assert.equal(r.motivo, 'cor_proxima');
});

test('respeita o tipo: PETG branco vai para o rolo PETG', () => {
  assert.equal(sugerirRolo('#FFFFFF', 'PETG', rolos).rolo.id, 'petg');
});

test('sem rolo do tipo devolve nulo', () => {
  const r = sugerirRolo('#C12E1E', 'ABS', rolos);
  assert.equal(r.rolo, null);
  assert.equal(r.motivo, 'sem_rolo_do_tipo');
});

test('rolo arquivado é ignorado', () => {
  const r = sugerirRolo('#FF6910', 'PLA', [rolo('laranja', 'PLA', '#FF6910', false), rolo('cinza', 'PLA', '#BCBCBC')]);
  assert.equal(r.rolo.id, 'cinza');
});

test('tipo sem diferença de maiúsculas', () => {
  assert.equal(sugerirRolo('#FF6910', 'pla', rolos).rolo.id, 'laranja');
});

test('distância de cor: igual é zero, preto e branco é ~100', () => {
  assert.equal(distanciaCor('#FF6910', '#ff6910'), 0);
  assert.ok(Math.abs(distanciaCor('#000000', '#FFFFFF') - 100) < 0.5);
});
