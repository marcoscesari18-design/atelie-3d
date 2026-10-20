// 💰 Vendas — quem comprou, quanto pagou, quanto sobrou. Registro avulso em poucos toques.
// Vendas de orçamento nascem na aprovação; aqui o Pedro marca pago/entregue.
import { h, vazio, erroTela, avisar, dialogo, campo, confirmar } from '../ui.js';
import { brl, numeroOrc, inicioDoMesISO } from '../formato.js';
import { resumoVendas } from '../vendas-calc.js';

const CANAIS = { escola: 'Escola', whatsapp: 'WhatsApp', feira: 'Feira', shopee: 'Shopee', ml: 'Mercado Livre', b2b: 'B2B', outro: 'Outro' };
let canalFiltro = 'todos';

export async function render(tela, ctx) {
  const marcos = ctx.perfil.papel === 'marcos';
  const desde = inicioDoMesISO();
  const r = await ctx.db.listar('vendas', (q) => {
    let c = q.select('id, data, cliente, canal, linha, descricao, qtd, preco_unit, total, lucro, pago, entregue, cancelada, orcamento_id, orcamentos(numero)')
      .or(`data.gte.${desde},and(entregue.eq.false,cancelada.eq.false),and(pago.eq.false,cancelada.eq.false)`)
      .order('data', { ascending: false }).order('created_at', { ascending: false });
    if (!marcos) c = c.eq('linha', 'pedro');
    return c;
  });
  if (r.erro) { tela.append(erroTela(r.erro, ctx.atualizar)); return; }
  const doMes = r.dados.filter((v) => v.data >= desde);
  const res = resumoVendas(doMes);
  const pendentes = resumoVendas(r.dados);

  tela.append(h('div', { class: 'cabeca' },
    h('div', {}, h('h1', {}, 'Vendas'), h('p', { class: 'sub' }, `${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · ${res.n} venda(s)`)),
    h('button', { class: 'btn btn-primario', type: 'button', onclick: () => registrar(ctx) }, '+ Venda')));

  tela.append(h('div', { class: 'kpis' },
    h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Vendido no mês'), h('div', { class: 'v' }, brl(res.faturamento))),
    h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Lucro no mês'), h('div', { class: `v ${res.lucro < 0 ? 'msg-erro' : ''}` }, brl(res.lucro))),
    h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'A receber'), h('div', { class: 'v' }, brl(pendentes.aReceber)),
      h('div', { class: 'meta', style: { fontSize: '12px' } }, 'entregue e não pago')),
    h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Em produção'), h('div', { class: 'v' }, brl(pendentes.emProducao)),
      h('div', { class: 'meta', style: { fontSize: '12px' } }, 'ainda não entregue'))));

  const canais = ['todos', ...new Set(r.dados.map((v) => v.canal))];
  if (canais.length > 2) {
    tela.append(h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Canal', style: { marginTop: '8px' } },
      canais.map((c) => h('button', { type: 'button', 'aria-pressed': String(canalFiltro === c), onclick: () => { canalFiltro = c; ctx.atualizar(); } }, c === 'todos' ? 'Todos' : CANAIS[c]))));
  }

  const lista = r.dados.filter((v) => canalFiltro === 'todos' || v.canal === canalFiltro);
  if (!lista.length) {
    tela.append(vazio('Nenhuma venda ainda neste mês.', h('button', { class: 'btn btn-primario', type: 'button', onclick: () => registrar(ctx) }, 'Registrar a primeira venda')));
    return;
  }
  tela.append(h('div', { class: 'lista lista-vendas', style: { marginTop: '12px' } }, lista.map((v) => cartao(v, ctx))));
}

function cartao(v, ctx) {
  const alternar = async (campoNome) => {
    const x = await ctx.db.atualizar('vendas', v.id, { [campoNome]: !v[campoNome] }, 'id');
    if (x.erro) return avisar(x.erro, 'erro');
    ctx.atualizar();
  };
  return h('div', { class: `card venda ${v.cancelada ? 'cancelada' : ''} ${v.linha === 'b2b' ? 'linha-b2b' : ''}` },
    h('div', { class: 'tarefa-topo' },
      h('div', { class: 'corpo' },
        h('div', { class: 'titulo' }, v.cliente, v.linha === 'b2b' ? h('span', { class: 'chip b2b', style: { marginLeft: '6px' } }, 'B2B') : null),
        h('div', { class: 'meta' }, `${v.qtd}× ${v.descricao || 'venda'}`, ' · ', new Date(`${v.data}T12:00:00`).toLocaleDateString('pt-BR'), ' · ', CANAIS[v.canal] || v.canal,
          v.orcamento_id ? h('a', { href: `#orcamentos/${v.orcamento_id}`, style: { marginLeft: '6px' } }, numeroOrc(v.orcamentos?.numero ?? 0)) : null)),
      h('div', { class: 'valor' }, h('div', {}, brl(v.total)), v.cancelada ? h('span', { class: 'chip erro' }, 'Cancelada') : null)),
    v.cancelada ? null : h('div', { class: 'status-botoes' },
      h('button', { type: 'button', class: `btn ${v.pago ? 'st-ok' : ''}`, 'aria-pressed': String(v.pago), onclick: () => alternar('pago') }, v.pago ? 'Pago ✓' : 'Marcar pago'),
      h('button', { type: 'button', class: `btn ${v.entregue ? 'st-ok' : ''}`, 'aria-pressed': String(v.entregue), onclick: () => alternar('entregue') }, v.entregue ? 'Entregue ✓' : 'Marcar entregue')),
    !v.orcamento_id && !v.cancelada ? h('div', { class: 'acoes' }, h('button', { class: 'btn-link', type: 'button', onclick: async () => {
      if (!(await confirmar('Apagar venda?', 'Use só se registrou errado.', 'Apagar'))) return;
      const x = await ctx.db.apagar('vendas', v.id);
      if (x.erro) avisar(x.erro, 'erro'); else { avisar('Venda apagada'); ctx.atualizar(); }
    } }, 'apagar')) : null);
}

async function registrar(ctx) {
  const marcos = ctx.perfil.papel === 'marcos';
  const prods = await ctx.db.listar('produtos', (q) => {
    let c = q.select('id, nome, linha, custo_calculado, preco_venda').order('nome');
    if (!marcos) c = c.eq('linha', 'pedro');
    return c;
  });
  const produtos = prods.dados || [];
  const cliente = h('input', { type: 'text', placeholder: 'Quem comprou', autocomplete: 'off' });
  const produto = h('select', {}, h('option', { value: '' }, 'Outra coisa (escrever)'), produtos.map((p) => h('option', { value: p.id }, p.nome)));
  const descricao = h('input', { type: 'text', placeholder: 'O que vendeu' });
  const qtd = h('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: '1' });
  const preco = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5', placeholder: 'por unidade' });
  const canal = h('select', {}, Object.entries(CANAIS).map(([k, t]) => h('option', { value: k }, t)));
  const pago = h('input', { type: 'checkbox' });
  const entregue = h('input', { type: 'checkbox', checked: true });
  const blocoDesc = campo('O que', descricao);
  produto.addEventListener('change', () => {
    const p = produtos.find((x) => x.id === produto.value);
    blocoDesc.classList.toggle('oculto', !!p);
    if (p?.preco_venda != null) preco.value = p.preco_venda;
  });
  const ok = await dialogo({ titulo: 'Registrar venda', conteudo: h('div', {},
    campo('Cliente', cliente), produtos.length ? campo('Produto', produto) : null, blocoDesc,
    h('div', { class: 'grade-2' }, campo('Quantidade', qtd), campo('Preço (R$)', preco)), campo('Canal', canal),
    h('label', { class: 'check' }, pago, ' Já pagou'), h('label', { class: 'check' }, entregue, ' Já entreguei')),
  botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Registrar', valor: true, primario: true }] });
  if (!ok) return;
  return gravarVenda(ctx, { cliente, produto, descricao, qtd, preco, canal, pago, entregue, produtos, marcos }, crypto.randomUUID());
}

// id gerado no aparelho: se a resposta se perder e o Pedro tocar de novo, não duplica.
async function gravarVenda(ctx, campos, id) {
  const { cliente, produto, descricao, qtd, preco, canal, pago, entregue, produtos, marcos } = campos;
  const p = produtos.find((x) => x.id === produto.value);
  if (!cliente.value.trim() || preco.value === '' || (!p && !descricao.value.trim())) return avisar('Preencha cliente, o que vendeu e o preço.', 'erro');
  const x = await ctx.db.inserir('vendas', {
    id, cliente: cliente.value.trim(), canal: canal.value, linha: p?.linha || 'pedro', produto_id: p?.id || null,
    descricao: p ? p.nome : descricao.value.trim(), qtd: Math.max(1, Number(qtd.value) || 1), preco_unit: Number(preco.value),
    custo_unit: Number(p?.custo_calculado) || 0, pago: pago.checked, entregue: entregue.checked,
  }, 'id');
  if (x.erro) {
    const ja = await ctx.db.listar('vendas', (q) => q.select('id').eq('id', id).maybeSingle());
    if (!ja.dados) return avisar(x.erro, 'erro');
  }
  avisar(p || marcos ? 'Venda registrada ✓' : 'Venda registrada ✓ (sem produto, o lucro conta custo zero)');
  ctx.atualizar();
}
