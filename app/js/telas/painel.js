// 📊 Painel — em 5 segundos: quanto vendemos e lucramos no mês, quanto dinheiro está em filamento,
// o que precisa de atenção hoje e como está a impressora. Pedro vê a lojinha dele e o filamento em kg.
import { h, erroTela } from '../ui.js';
import { brl, gramas, duracao, numeroOrc, inicioDoMesISO, segundaDaSemana } from '../formato.js';
import { resumoVendas, ehFrete } from '../vendas-calc.js';
import { valorEstoque, porGrupo, rolosAcabando, vendasPorSemana, orcamentosParados, impressora } from '../painel-calc.js';
import { carretel } from './filamentos.js';

const SEMANAS = 8;
const COR = { pedro: '#d9792f', b2b: '#3f74d1' };   // laranja x azul (seguro para daltonismo), contraste ≥ 3:1 sobre o cartão claro
const kg = (g) => `${(g / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const diaMes = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

export async function render(tela, ctx) {
  const marcos = ctx.perfil.papel === 'marcos';
  const semana = segundaDaSemana();
  const [a, m, d] = semana.split('-').map(Number);
  const inicioGrafico = segundaDaSemana(new Date(a, m - 1, d - 7 * (SEMANAS - 1)));
  const inicioMes = inicioDoMesISO();
  const desde = inicioGrafico < inicioMes ? inicioGrafico : inicioMes;

  const [rolos, vendas, orcs, tarefas] = await Promise.all([
    // Pedro não vê R$/kg: a consulta dele nem traz a coluna
    ctx.db.listar('filamentos', (q) => q.select(`id, cor_nome, cor_hex, marca, tipo, gramas_restantes, gramas_iniciais, ativo${marcos ? ', custo_kg' : ''}`)),
    ctx.db.listar('vendas', (q) => {
      let c = q.select('id, data, cliente, linha, descricao, total, lucro, pago, entregue, cancelada, orcamento_id, orcamento_item_id')
        .or(`data.gte.${desde},and(entregue.eq.false,cancelada.eq.false),and(pago.eq.false,cancelada.eq.false)`);
      return marcos ? c : c.eq('linha', 'pedro');
    }),
    ctx.db.listar('orcamentos', (q) => {
      const c = q.select('id, numero, cliente, status, enviado_em').eq('status', 'enviado');
      return marcos ? c : c.eq('linha', 'pedro');
    }),
    ctx.db.listar('tarefas', (q) => q.select('id, semana, ordem, titulo, status, segundos_previsto')
      .or(`semana.eq.${semana},status.in.(fila,imprimindo)`)),
  ]);
  const erro = rolos.erro || vendas.erro || orcs.erro || tarefas.erro;
  if (erro) { tela.append(erroTela(erro, ctx.atualizar)); return; }

  const vendasMes = vendas.dados.filter((v) => v.data >= inicioMes);
  const doMes = resumoVendas(vendasMes);
  // Marcos: o dinheiro da Lojinha do Pedro e o do B2B nunca aparecem só somados
  const loja = resumoVendas(vendasMes.filter((v) => v.linha !== 'b2b'));
  const b2b = resumoVendas(vendasMes.filter((v) => v.linha === 'b2b'));
  const separado = (campo) => (marcos && b2b.n ? `Lojinha ${brl(loja[campo])} · B2B ${brl(b2b[campo])}` : null);
  const receberLoja = resumoVendas(vendas.dados.filter((v) => v.linha !== 'b2b')).aReceber;
  const receberB2b = resumoVendas(vendas.dados.filter((v) => v.linha === 'b2b')).aReceber;
  const pendentes = resumoVendas(vendas.dados);
  const estoque = valorEstoque(rolos.dados);
  const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  tela.append(h('h1', {}, 'Painel'),
    h('p', { class: 'sub' }, `${mesNome[0].toUpperCase()}${mesNome.slice(1)} · ${marcos ? 'o que precisa de você hoje' : 'o seu ateliê'}`));

  tela.append(h('div', { class: 'kpis' },
    kpi('Vendido no mês', brl(doMes.faturamento), separado('faturamento') || (doMes.n ? `${doMes.n} venda(s)` : 'ainda sem vendas')),
    kpi('Lucro no mês', brl(doMes.lucro), separado('lucro') || 'depois de custo e frete', doMes.lucro < 0),
    kpi('A receber', brl(pendentes.aReceber), marcos && receberB2b ? `Lojinha ${brl(receberLoja)} · B2B ${brl(receberB2b)}` : 'entregue e não pago'),
    marcos ? kpi('Dinheiro em filamento', brl(estoque.reais), `${kg(estoque.gramas)} em ${estoque.rolos} rolos`)
      : kpi('Filamento na prateleira', kg(estoque.gramas), `${estoque.rolos} rolos`)));

  const esquerda = h('div', {});
  const direita = h('div', {});
  tela.append(h('div', { class: 'painel-grade' }, esquerda, direita));

  // ---------- precisa de atenção ----------
  esquerda.append(h('h2', { class: 'secao' }, 'Precisa de atenção'));
  const itens = [];
  // lista curta: até `max` de cada tipo; o resto vira uma linha "mais N" que leva à aba certa
  const mais = (n, texto, href) => itens.push(h('a', { class: 'item mais', href },
    h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, texto)), h('span', { class: 'meta' }, 'ver todos')));
  const acabando = rolosAcabando(rolos.dados);
  for (const f of acabando.slice(0, 4)) {
    itens.push(h('a', { class: 'item', href: '#filamentos' }, carretel(f),
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, `${f.cor_nome} · ${f.marca}`),
        h('div', { class: 'meta' }, Number(f.gramas_restantes) < 0 ? `${gramas(f.gramas_restantes)} — compre ou troque o rolo` : `sobra ${gramas(f.gramas_restantes)}`)),
      h('span', { class: `chip ${f.estado.nivel}` }, f.estado.rotulo)));
  }
  if (acabando.length > 4) mais(acabando.length - 4, `Mais ${acabando.length - 4} rolo(s) com pouco filamento`, '#filamentos');
  const parados = orcamentosParados(orcs.dados);
  for (const o of parados.slice(0, 3)) {
    itens.push(h('a', { class: 'item', href: `#orcamentos/${o.id}` },
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, `${numeroOrc(o.numero)} · ${o.cliente}`),
        h('div', { class: 'meta' }, `enviado há ${o.dias} dias, sem resposta`)),
      h('span', { class: 'chip atencao' }, 'Cobrar resposta')));
  }
  if (parados.length > 3) mais(parados.length - 3, `Mais ${parados.length - 3} orçamento(s) sem resposta`, '#orcamentos');
  const naoPagas = vendas.dados.filter((x) => x.entregue && !x.pago && !x.cancelada && !ehFrete(x));
  for (const v of naoPagas.slice(0, 3)) {
    itens.push(h('a', { class: `item ${v.linha === 'b2b' ? 'linha-b2b' : ''}`, href: '#vendas' },
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, v.cliente), h('div', { class: 'meta' }, `${v.descricao || 'venda'} · entregue e não pago`)),
      h('span', { class: 'valor' }, brl(v.total))));
  }
  if (naoPagas.length > 3) mais(naoPagas.length - 3, `Mais ${naoPagas.length - 3} venda(s) entregue(s) e não paga(s)`, '#vendas');
  const imp = impressora(tarefas.dados, semana);
  if (imp.atrasadas) {
    itens.push(h('a', { class: 'item', href: '#semana' },
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, `${imp.atrasadas} impressão(ões) de semanas anteriores`), h('div', { class: 'meta' }, 'ainda na fila')),
      h('span', { class: 'chip atencao' }, 'Atrasada')));
  }
  esquerda.append(itens.length ? h('div', { class: 'lista atencao-lista' }, itens)
    : h('div', { class: 'vazio' }, h('p', {}, 'Nada pendente. Tudo em dia ✓')));

  // ---------- impressora ----------
  direita.append(h('h2', { class: 'secao' }, 'Impressora'),
    h('div', { class: 'kpis producao' },
      kpi('Na fila', String(imp.naFila), imp.segundosFaltando ? `${duracao(imp.segundosFaltando)} de máquina` : 'fila vazia'),
      kpi('Feitas na semana', String(imp.feitas)),
      kpi('Deu ruim na semana', String(imp.deuRuim))),
    imp.proxima ? h('a', { class: 'item proxima', href: '#semana' },
      h('div', { class: 'corpo' }, h('div', { class: 'meta' }, imp.proxima.status === 'imprimindo' ? 'Imprimindo agora' : 'Próxima da fila'),
        h('div', { class: 'titulo' }, imp.proxima.titulo)),
      h('span', { class: 'valor' }, duracao(imp.proxima.segundos_previsto))) : null);

  // ---------- dinheiro em filamento (só Marcos: tem R$/kg) ----------
  if (marcos && estoque.reais > 0) {
    const marcas = porGrupo(rolos.dados, 'marca');
    const maior = marcas[0]?.reais || 1;
    const materiais = porGrupo(rolos.dados, 'tipo').map((g) => `${g.nome} ${brl(g.reais)}`).join(' · ');
    direita.append(h('h2', { class: 'secao' }, 'Onde está o dinheiro em filamento'),
      h('div', { class: 'card barras' },
        marcas.map((g) => h('div', { class: 'barra-linha', title: `${g.nome}: ${brl(g.reais)}` },
          h('span', { class: 'barra-nome' }, g.nome),
          h('span', { class: 'trilho', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.max(2, (g.reais / maior) * 100)}%` } })),
          h('span', { class: 'v' }, brl(g.reais)))),
        h('p', { class: 'meta nota' }, materiais)));
  }

  // ---------- vendas por semana ----------
  direita.append(h('h2', { class: 'secao' }, 'Vendas por semana'), grafico(vendasPorSemana(vendas.dados, new Date(), SEMANAS), marcos));
}

function kpi(rotulo, valor, meta, negativo = false) {
  return h('div', { class: 'kpi' }, h('div', { class: 'rot' }, rotulo),
    h('div', { class: `v ${negativo ? 'msg-erro' : ''}` }, valor), meta ? h('div', { class: 'meta' }, meta) : null);
}

// Colunas empilhadas: Lojinha do Pedro embaixo, B2B em cima (só Marcos). Rótulo só na semana atual e na melhor.
function grafico(semanas, marcos) {
  const total = (s) => s.pedro + (marcos ? s.b2b : 0);
  const maior = Math.max(...semanas.map(total));
  if (!maior) return h('div', { class: 'vazio' }, h('p', {}, marcos ? 'O gráfico aparece com as primeiras vendas, com a Lojinha do Pedro e o B2B separados.' : 'O gráfico aparece com as suas primeiras vendas.'));
  const melhor = semanas.findIndex((s) => total(s) === maior);
  const colunas = semanas.map((s, i) => {
    const t = total(s);
    const rotulo = `Semana de ${diaMes(s.semana)}: ${brl(t)}${marcos ? ` (Lojinha ${brl(s.pedro)}, B2B ${brl(s.b2b)})` : ''}`;
    return h('div', { class: 'coluna', tabindex: '0', title: rotulo, 'aria-label': rotulo },
      h('span', { class: 'coluna-valor' }, i === semanas.length - 1 || i === melhor ? brl(t) : ''),
      h('span', { class: 'pilha', style: { height: `${(t / maior) * 100}%` } },
        marcos && s.b2b > 0 ? h('span', { class: 'parte', style: { flexGrow: String(s.b2b), background: COR.b2b } }) : null,
        s.pedro > 0 ? h('span', { class: 'parte', style: { flexGrow: String(s.pedro), background: COR.pedro } }) : null),
      h('span', { class: 'coluna-dia' }, diaMes(s.semana)));
  });
  return h('div', { class: 'card grafico' },
    marcos ? h('div', { class: 'legenda' },
      h('span', {}, h('i', { style: { background: COR.pedro } }), 'Lojinha do Pedro'),
      h('span', {}, h('i', { style: { background: COR.b2b } }), 'B2B')) : null,
    h('div', { class: 'colunas', role: 'list' }, colunas.map((c) => { c.setAttribute('role', 'listitem'); return c; })),
    h('details', { class: 'tabela' }, h('summary', {}, 'Ver em tabela'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Semana'), marcos ? h('th', {}, 'Lojinha') : null, marcos ? h('th', {}, 'B2B') : null, h('th', {}, 'Total'))),
        h('tbody', {}, semanas.map((s) => h('tr', {}, h('td', {}, diaMes(s.semana)), marcos ? h('td', {}, brl(s.pedro)) : null,
          marcos ? h('td', {}, brl(s.b2b)) : null, h('td', {}, brl(total(s)))))))));
}
