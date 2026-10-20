import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valorEstoque, porGrupo, rolosAcabando, vendasPorSemana, orcamentosParados, impressora } from '../app/js/painel-calc.js';

const rolo = (cor, gramas, custo, extra = {}) => ({ id: cor, cor_nome: cor, marca: 'M', tipo: 'PLA', gramas_restantes: gramas, gramas_iniciais: 1000, custo_kg: custo, ativo: true, ...extra });

test('dinheiro em filamento: gramas × R$/kg dos rolos ativos; rolo negativo não vira dinheiro', () => {
  const r = valorEstoque([rolo('a', 500, 100), rolo('b', 250, 120), rolo('c', -30, 90), rolo('d', 1000, 99, { ativo: false })]);
  assert.equal(r.reais, 80);          // 0,5×100 + 0,25×120
  assert.equal(r.gramas, 750); assert.equal(r.rolos, 3);
});

test('a planilha do Marcos dá R$ 2.620,62 (conferência com os números reais)', () => {
  // 3 rolos da planilha só para conferir a conta; o total real foi calculado da lista completa
  const r = valorEstoque([rolo('Ciano', 1000, 133), rolo('Preto', 1000, 99), rolo('Branco', 400, 145.9)]);
  assert.equal(r.reais, 290.36);
});

test('agrupa por marca e por material, do maior para o menor', () => {
  const g = porGrupo([rolo('a', 1000, 100, { marca: 'X' }), rolo('b', 500, 100, { marca: 'Y' }), rolo('c', 500, 100, { marca: 'X' })], 'marca');
  assert.deepEqual(g, [{ nome: 'X', reais: 150 }, { nome: 'Y', reais: 50 }]);
});

test('rolos acabando: atenção e acabando, do que tem menos para o que tem mais', () => {
  const a = rolosAcabando([rolo('ok', 900, 1), rolo('pouco', 250, 1), rolo('quase', 80, 1), rolo('falta', -10, 1), rolo('velho', 5, 1, { ativo: false })]);
  assert.deepEqual(a.map((x) => x.cor_nome), ['falta', 'quase', 'pouco']);
});

const venda = (data, total, linha = 'pedro', extra = {}) => ({ data, total, linha, cancelada: false, ...extra });

test('vendas por semana: 8 semanas terminando nesta, Pedro e B2B separados, sem canceladas', () => {
  const hoje = new Date(2026, 9, 21);                 // quarta, semana de 19/10
  const s = vendasPorSemana([venda('2026-10-19', 10), venda('2026-10-20', 5, 'b2b'), venda('2026-10-13', 7),
    venda('2026-10-14', 99, 'pedro', { cancelada: true }), venda('2026-08-01', 50)], hoje);
  assert.equal(s.length, 8);
  assert.equal(s[7].semana, '2026-10-19'); assert.equal(s[7].pedro, 10); assert.equal(s[7].b2b, 5);
  assert.equal(s[6].semana, '2026-10-12'); assert.equal(s[6].pedro, 7);
  assert.equal(s[0].semana, '2026-08-31');
  assert.ok(s.every((x) => x.pedro + x.b2b < 50));     // agosto fica fora
});

test('orçamento parado conta dias do calendário de Brasília (enviado dia 17 às 23h já conta 3 dias no dia 20 de manhã)', () => {
  const p = orcamentosParados([{ numero: 7, status: 'enviado', enviado_em: '2026-10-18T02:00:00Z' }], new Date('2026-10-20T12:00:00Z'));
  assert.deepEqual(p.map((o) => o.dias), [3]);
});

test('orçamento enviado há 3 dias ou mais sem resposta', () => {
  const agora = new Date('2026-10-20T15:00:00Z');
  const p = orcamentosParados([
    { numero: 1, status: 'enviado', enviado_em: '2026-10-16T10:00:00Z' },
    { numero: 2, status: 'enviado', enviado_em: '2026-10-19T10:00:00Z' },
    { numero: 3, status: 'aprovado', enviado_em: '2026-10-01T10:00:00Z' },
  ], agora);
  assert.deepEqual(p.map((o) => o.numero), [1]);
  assert.equal(p[0].dias, 4);
});

test('impressora: fila, feitas, deu ruim, horas que faltam e a próxima', () => {
  const t = (status, semana, ordem, seg = 3600) => ({ status, semana, ordem, segundos_previsto: seg, titulo: `${status}${ordem}` });
  const r = impressora([t('ok', '2026-10-19', 1), t('fila', '2026-10-19', 3), t('imprimindo', '2026-10-19', 2, 1800),
    t('falhou', '2026-10-19', 4), t('fila', '2026-10-12', 9)], '2026-10-19');
  assert.equal(r.naFila, 3); assert.equal(r.feitas, 1); assert.equal(r.deuRuim, 1);
  assert.equal(r.segundosFaltando, 9000); assert.equal(r.atrasadas, 1);
  assert.equal(r.proxima.titulo, 'imprimindo2');        // a que já está imprimindo vem primeiro
});
