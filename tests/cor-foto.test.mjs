import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corDaAmostra } from '../app/js/cor-foto.js';

// imagem sintética RGBA: fundo de uma cor e, opcionalmente, alguns pixels de brilho (reflexo)
function imagem(w, h, [r, g, b], brilhos = []) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([r, g, b, 255], i * 4);
  for (const [x, y] of brilhos) d.set([255, 255, 255, 255], (y * w + x) * 4);
  return d;
}

test('pega a cor do ponto tocado', () => {
  assert.equal(corDaAmostra(imagem(20, 20, [255, 105, 16]), 20, 20, 10, 10, 3), '#FF6910');
});

test('reflexo branco no meio do fio não estraga a cor (mediana)', () => {
  const brilhos = [[9, 9], [10, 9], [11, 9], [9, 10], [10, 10], [11, 10]];
  assert.equal(corDaAmostra(imagem(20, 20, [0, 133, 213], brilhos), 20, 20, 10, 10, 3), '#0085D5');
});

test('toque na borda não sai da imagem', () => {
  assert.equal(corDaAmostra(imagem(10, 10, [10, 20, 30]), 10, 10, 0, 9, 4), '#0A141E');
});
