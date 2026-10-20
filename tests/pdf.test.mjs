import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { gerarPdfOrcamento } from '../app/js/pdf.js';

const dados = {
  numero: 3, cliente: 'João da Silva', contato: '(44) 99999-0000', data: '2026-10-19', validade: '2026-10-26',
  itens: [
    { descricao: 'Chaveiro PEC', qtd: 5, precoUnit: 13, precoTotal: 58.5, foto: null },
    { descricao: 'Pá de ração', qtd: 1, precoUnit: 30, precoTotal: 27, foto: null },
  ],
  subtotal: 95, descontoPct: 10, total: 85.5,
  marca: { nome: 'Ateliê do Pedro', fone: '(44) 98888-0000', instagram: '@atelie', logo: null },
};
const texto = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

test('PDF tem número, cliente, itens e total', () => {
  const t = texto(gerarPdfOrcamento(jsPDF, dados));
  for (const s of ['ORC-0003', 'Jo\\343o da Silva', 'Chaveiro PEC', 'R$ 85,50', 'Validade', '26/10/2026']) {
    assert.ok(t.includes(s) || t.includes(s.replace(/\\343/, 'ã')), `faltou ${s}`);
  }
});

test('PDF do cliente não mostra custo nem lucro', () => {
  const t = texto(gerarPdfOrcamento(jsPDF, dados));
  assert.ok(!/Lucro|lucro|Custo|custo|Material|Energia|Desgaste/.test(t));
});

test('desconto só aparece quando existe', () => {
  assert.ok(texto(gerarPdfOrcamento(jsPDF, dados)).includes('Desconto'));
  const sem = { ...dados, descontoPct: 0, subtotal: 85.5, total: 85.5 };
  assert.ok(!texto(gerarPdfOrcamento(jsPDF, sem)).includes('Desconto'));
});

test('frete do cliente aparece como linha e soma no total; frete grátis aparece como grátis', () => {
  const com = texto(gerarPdfOrcamento(jsPDF, { ...dados, frete: 12.5, freteCliente: true, total: 98 }));
  assert.ok(com.includes('Frete') && com.includes('R$ 12,50') && com.includes('R$ 98,00'));
  const gratis = texto(gerarPdfOrcamento(jsPDF, { ...dados, frete: 12.5, freteCliente: false }));
  assert.ok(gratis.includes('Frete') && gratis.includes('gr') && !gratis.includes('R$ 12,50'));
  assert.ok(!texto(gerarPdfOrcamento(jsPDF, dados)).includes('Frete'));
});

test('desconto com frete do cliente mostra só o desconto dos itens', () => {
  const t = texto(gerarPdfOrcamento(jsPDF, { ...dados, subtotal: 20, descontoPct: 10, totalItens: 18, frete: 12.5, freteCliente: true, total: 30.5 }));
  assert.ok(t.includes('- R$ 2,00'), 'desconto deveria ser R$ 2,00');
});
