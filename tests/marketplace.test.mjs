import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoMarketplace, precoDireto } from '../app/js/marketplace.js';

// Taxas padrão da original (DEFAULTS). Valores esperados lidos da original no Chrome (19/10/2026).
const taxas = { mkShopComm: 20, mkShopFix: 4, mkMlComm: 14, mkMlpComm: 19, mkMlFix: 6.25, mkMlFrete: 22 };
const perto = (real, esperado, msg) => assert.ok(Math.abs(real - esperado) < 0.006, `${msg}: ${real} ≠ ${esperado}`);
const pec = { custoTotal: 6.0513, lucroAlvo: 6.0513, taxas };
const grande = { custoTotal: 50.7605, lucroAlvo: 50.7605, taxas };

test('Shopee, chaveiro PEC', () => {
  const r = precoMarketplace({ ...pec, canal: 'shopee' });
  perto(r.preco, 15.13, 'preço'); assert.equal(r.arredondado, 16);
  perto(r.recebe, 12.10, 'recebe'); perto(r.comissao, 3.03, 'comissão');
  assert.equal(r.fixaUsada, false); assert.equal(r.freteUsado, false);
});

test('ML Clássico abaixo de R$ 79 paga taxa fixa', () => {
  const r = precoMarketplace({ ...pec, canal: 'ml' });
  perto(r.preco, 21.34, 'preço'); assert.equal(r.arredondado, 25);
  assert.equal(r.fixaUsada, true); perto(r.lucro, 6.05, 'lucro');
});

test('ML Premium, chaveiro PEC', () => {
  const r = precoMarketplace({ ...pec, canal: 'mlp' });
  perto(r.preco, 22.66, 'preço'); perto(r.comissao, 4.30, 'comissão');
});

test('ML acima de R$ 79 paga frete grátis', () => {
  const r = precoMarketplace({ ...grande, canal: 'ml' });
  perto(r.preco, 143.63, 'preço'); assert.equal(r.arredondado, 150);
  assert.equal(r.freteUsado, true); assert.equal(r.fixaUsada, false);
  perto(r.recebe, 101.52, 'recebe');
});

test('Shopee grande', () => {
  perto(precoMarketplace({ ...grande, canal: 'shopee' }).preco, 126.90, 'preço');
  perto(precoMarketplace({ ...grande, canal: 'mlp' }).preco, 152.50, 'preço mlp');
});

test('alerta de prejuízo quando o lucro alvo é negativo', () => {
  const r = precoMarketplace({ custoTotal: 10, lucroAlvo: -5, taxas, canal: 'shopee' });
  assert.equal(r.alerta, 'prejuizo');
});

test('alerta de zona morta R$ 70–79 no ML', () => {
  // custo+lucro tal que o preço ML Clássico fique em ~R$ 75
  const r = precoMarketplace({ custoTotal: 29.4, lucroAlvo: 29.4, taxas, canal: 'ml' });
  assert.ok(r.preco >= 70 && r.preco < 79, `preço ${r.preco}`);
  assert.equal(r.alerta, 'zona_morta');
});

test('alerta de frete grátis entre R$ 79 e 110 no ML', () => {
  const r = precoMarketplace({ custoTotal: 31, lucroAlvo: 31, taxas, canal: 'ml' });
  assert.ok(r.preco >= 79 && r.preco < 110, `preço ${r.preco}`);
  assert.equal(r.alerta, 'frete_gratis');
});

test('venda direta: sem comissão, anuncia pelo preço sugerido', () => {
  const r = precoDireto({ custoTotal: 6.0513, lucroAlvo: 6.0513, frete: 0, freteCliente: true });
  perto(r.preco, 12.10, 'preço'); assert.equal(r.comissao, 0);
  perto(r.recebe, 12.10, 'recebe'); perto(r.lucro, 6.05, 'lucro'); assert.equal(r.alerta, null);
});

test('venda direta com frete pago pelo cliente: soma no que ele paga, lucro igual', () => {
  const r = precoDireto({ custoTotal: 10, lucroAlvo: 10, frete: 15, freteCliente: true });
  assert.equal(r.preco, 20); assert.equal(r.clientePaga, 35); assert.equal(r.lucro, 10);
});

test('venda direta com frete grátis: cliente paga o preço, frete sai do lucro', () => {
  const r = precoDireto({ custoTotal: 10, lucroAlvo: 10, frete: 15, freteCliente: false });
  assert.equal(r.clientePaga, 20); assert.equal(r.lucro, -5); assert.equal(r.alerta, 'prejuizo');
});
