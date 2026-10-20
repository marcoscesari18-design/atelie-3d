import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { ler3mf, Erro3mf } from '../app/js/le3mf.js';
import { gerar3mf, UMA_PLACA, DUAS_PLACAS, MULTICOR, MULTICOR_NAO_BATE, SEM_PREDICTION, SEM_PLACA } from './fixtures/gerar.mjs';

const deps = { JSZip, DOMParser };
const ler = async (spec) => ler3mf(await gerar3mf(spec), deps);
const erroCom = (codigo) => (e) => e instanceof Erro3mf && e.codigo === codigo;

test('uma placa: tempo, gramas, cor e foto', async () => {
  const r = await ler(UMA_PLACA);
  assert.equal(r.versao, '02.00.00.98');
  assert.equal(r.placas.length, 1);
  const p = r.placas[0];
  assert.equal(p.indice, 1); assert.equal(p.segundos, 3600); assert.equal(p.gramas, 20.5);
  assert.deepEqual(p.filamentos, [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 20.5 }]);
  assert.ok(p.foto instanceof Blob);
});

test('duas placas', async () => {
  const r = await ler(DUAS_PLACAS);
  assert.deepEqual(r.placas.map((p) => [p.indice, p.segundos, p.gramas]), [[1, 3600, 20.5], [2, 600, 2.25]]);
});

test('multicor separa as gramas por cor', async () => {
  const r = await ler(MULTICOR);
  assert.deepEqual(r.placas[0].filamentos.map((f) => [f.cor, f.gramas]), [['#FF6910', 6], ['#0085D5', 5.69]]);
});

test('multicor com soma diferente do peso é recusado', async () => {
  await assert.rejects(ler(MULTICOR_NAO_BATE), erroCom('nao_bate'));
});

test('sem tempo é tratado como sem fatiar', async () => {
  await assert.rejects(ler(SEM_PREDICTION), erroCom('sem_fatiar'));
});

test('sem placa é sem fatiar', async () => {
  await assert.rejects(ler(SEM_PLACA), erroCom('sem_fatiar'));
});

test('arquivo que não é zip é inválido', async () => {
  await assert.rejects(ler3mf(new TextEncoder().encode('não sou um 3mf').buffer, deps), erroCom('invalido'));
});

test('zip sem slice_info é inválido', async () => {
  const z = new JSZip(); z.file('x.txt', 'oi');
  await assert.rejects(ler3mf(await z.generateAsync({ type: 'arraybuffer' }), deps), erroCom('invalido'));
});

test('a mensagem de sem fatiar ensina o que fazer', async () => {
  await assert.rejects(ler(SEM_PLACA), /Fatiar placa/);
});

// Arquivos reais (tests/fixtures-locais/, fora do repo): pulam se não existirem.
const local = (n) => new URL(`./fixtures-locais/${n}`, import.meta.url);
const existe = async (n) => access(local(n)).then(() => true, () => false);
const real = async (n) => { const b = await readFile(local(n)); return ler3mf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), deps); };

test('real: dragchain', async (t) => {
  if (!(await existe('dragchain.3mf'))) return t.skip('sem arquivo local');
  const r = await real('dragchain.3mf');
  assert.equal(r.placas.length, 1);
  const p = r.placas[0];
  assert.equal(p.segundos, 14171); assert.equal(p.gramas, 74.93);
  assert.deepEqual(p.filamentos, [{ slot: 1, tipo: 'PLA', cor: '#FFFFFF', gramas: 74.93 }]);
  assert.ok(p.foto);
});

test('real: AMS hub com 2 placas', async (t) => {
  if (!(await existe('ams_hub_2placas.3mf'))) return t.skip('sem arquivo local');
  const r = await real('ams_hub_2placas.3mf');
  assert.deepEqual(r.placas.map((p) => [p.segundos, p.gramas]), [[17595, 121.15], [959, 2.05]]);
});

test('real: Bambu Studio 2.0 (PETG)', async (t) => {
  if (!(await existe('schlepp_v2.3mf'))) return t.skip('sem arquivo local');
  const r = await real('schlepp_v2.3mf');
  assert.equal(r.versao, '02.00.00.98');
  assert.equal(r.placas[0].gramas, 69.76); assert.equal(r.placas[0].segundos, 16159);
  assert.equal(r.placas[0].filamentos[0].tipo, 'PETG');
});

for (const n of ['sem_fatiar_ideal.3mf', 'sem_fatiar_wellpet.3mf']) {
  test(`real: ${n} não foi fatiado`, async (t) => {
    if (!(await existe(n))) return t.skip('sem arquivo local');
    await assert.rejects(real(n), erroCom('sem_fatiar'));
  });
}

test('cor com 0 g (slot carregado mas sem uso) é ignorada', async () => {
  const r = await ler({ placas: [{ indice: 1, segundos: 600, gramas: 20, filamentos: [
    { slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 20 }, { slot: 2, tipo: 'PLA', cor: '#0085D5', gramas: 0 }] }] });
  assert.deepEqual(r.placas[0].filamentos.map((f) => f.slot), [1]);
});

test('gramas inválidas numa cor tornam o arquivo inválido', async () => {
  await assert.rejects(ler({ placas: [{ indice: 1, segundos: 600, gramas: 20, filamentos: [
    { slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 'abc' }] }] }), erroCom('nao_bate'));
});
