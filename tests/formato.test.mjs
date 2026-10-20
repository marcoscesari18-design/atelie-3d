import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brl, gramas, duracao, numeroOrc, segundaDaSemana } from '../app/js/formato.js';
import { traduzirErro } from '../app/js/erros.js';

const nb = (s) => s.replace(/ /g, ' ');

test('brl com centavos e milhar', () => {
  assert.equal(nb(brl(12.1)), 'R$ 12,10');
  assert.equal(nb(brl(1234.5)), 'R$ 1.234,50');
  assert.equal(nb(brl(-3)), '-R$ 3,00');
});

test('gramas: negativo vira "faltam"', () => {
  assert.equal(gramas(74.93), '74,93 g');
  assert.equal(gramas(1000), '1.000 g');
  assert.equal(gramas(-5), 'faltam 5 g');
});

test('duração em h e min', () => {
  assert.equal(duracao(14171), '3h56');
  assert.equal(duracao(2340), '39 min');
  assert.equal(duracao(3600), '1h00');
});

test('número do orçamento', () => {
  assert.equal(numeroOrc(7), 'ORC-0007');
});

test('segunda-feira da semana', () => {
  assert.equal(segundaDaSemana(new Date('2026-10-22T12:00:00')), '2026-10-19');
  assert.equal(segundaDaSemana(new Date('2026-10-19T08:00:00')), '2026-10-19');
  assert.equal(segundaDaSemana(new Date('2026-10-25T23:00:00')), '2026-10-19');
});

test('erro de login vira português simples', () => {
  assert.equal(traduzirErro({ message: 'Invalid login credentials' }), 'E-mail ou senha não conferem.');
});

test('sem internet', () => {
  assert.equal(traduzirErro(new TypeError('Failed to fetch')), 'Sem conexão. Nada foi salvo — tente de novo.');
});

test('mensagem das funções do banco passa como está', () => {
  assert.equal(traduzirErro({ code: 'P0001', message: 'esse orçamento já foi aprovado' }), 'Esse orçamento já foi aprovado.');
});

test('sem permissão', () => {
  assert.equal(traduzirErro({ code: '42501', message: 'permission denied for table filamentos' }), 'Você não tem permissão para fazer isso.');
});

test('sessão expirada', () => {
  assert.equal(traduzirErro({ code: 'PGRST301', message: 'JWT expired' }), 'Sua sessão expirou. Entre de novo.');
});

test('erro desconhecido não mostra jargão', () => {
  assert.equal(traduzirErro({ code: 'XX000', message: 'internal error at line 4' }), 'Algo deu errado. Tente de novo; se continuar, avise o Marcos.');
});
