// 📅 Semana — a fila do Pedro. Botões grandes; "deu ruim" vira lição.
// O estoque já saiu na aprovação do orçamento: aqui só muda o status.
import { h, vazio, erroTela, avisar, dialogo, campo, botao, corBolinha } from '../ui.js';
import { gramas, duracao, segundaDaSemana } from '../formato.js';
import { resumoFila, podeReimprimir } from '../fila.js';

const BOTOES = [
  ['fila', 'Na fila'],
  ['imprimindo', 'Imprimindo'],
  ['ok', 'Deu certo'],
  ['falhou', 'Deu ruim'],
];
const CHIP = { fila: ['Na fila', ''], imprimindo: ['Imprimindo', 'acento'], ok: ['Deu certo', 'ok'], falhou: ['Deu ruim', 'erro'] };

export async function render(tela, ctx) {
  const semana = segundaDaSemana();
  const duasSemanas = new Date(Date.now() - 14 * 864e5).toISOString();
  const r = await ctx.db.listar('tarefas', (q) => q
    .select('id, semana, ordem, titulo, qtd, gramas_previsto, segundos_previsto, status, motivo_falha, aprendizado, reimpressao_de, concluida_em, tarefa_filamentos(gramas, filamentos(cor_nome, cor_hex))')
    .or(`semana.eq.${semana},status.in.(fila,imprimindo),and(status.eq.falhou,concluida_em.gte.${duasSemanas})`)
    .order('semana').order('ordem'));
  if (r.erro) { tela.append(erroTela(r.erro, ctx.atualizar)); return; }
  const tarefas = r.dados;
  const res = resumoFila(tarefas);

  tela.append(h('h1', {}, 'Semana'),
    h('p', { class: 'sub' }, `Semana de ${new Date(`${semana}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Feitas'), h('div', { class: 'v' }, String(res.feitas))),
      h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Faltam'), h('div', { class: 'v' }, String(res.faltam))),
      h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Tempo de máquina'), h('div', { class: 'v' }, res.segundosRestantes ? duracao(res.segundosRestantes) : '—'))));

  if (!tarefas.length) {
    tela.append(vazio('Nada na fila. Quando um orçamento for aprovado, as impressões aparecem aqui.',
      h('a', { class: 'btn', href: '#orcamentos' }, 'Ver orçamentos')));
    return;
  }

  const pendentes = tarefas.filter((t) => t.status === 'fila' || t.status === 'imprimindo');
  const atrasadas = pendentes.filter((t) => t.semana < semana);
  const resto = tarefas.filter((t) => !pendentes.includes(t));
  if (pendentes.length) {
    tela.append(h('p', { class: 'secao' }, 'Para imprimir'));
    if (atrasadas.length) tela.append(h('p', { class: 'aviso' }, `${atrasadas.length} ficou(aram) da semana passada.`));
    tela.append(h('div', { class: 'lista grade-tarefas' }, pendentes.map((t) => cartao(t, tarefas, ctx))));
  }
  if (resto.length) tela.append(h('p', { class: 'secao' }, 'Já impressas'), h('div', { class: 'lista grade-tarefas' }, resto.map((t) => cartao(t, tarefas, ctx))));

  const licoes = tarefas.filter((t) => t.status === 'falhou' && t.aprendizado);
  if (licoes.length) {
    tela.append(h('p', { class: 'secao' }, 'O que aprendemos'), h('div', { class: 'card licoes' }, licoes.map((t) =>
      h('div', { class: 'licao' }, h('strong', {}, t.titulo), h('p', {}, h('span', { class: 'meta' }, 'O que houve: '), t.motivo_falha),
        h('p', {}, h('span', { class: 'meta' }, 'Da próxima vez: '), t.aprendizado)))));
  }
}

function cartao(t, todas, ctx) {
  const cores = (t.tarefa_filamentos || []).map((f) => corBolinha(f.filamentos?.cor_hex || '#888', f.filamentos?.cor_nome || 'cor'));
  const [rotulo, classe] = CHIP[t.status];
  const reimp = t.status === 'falhou' && podeReimprimir(t, todas);
  return h('div', { class: `card tarefa ${t.status}` },
    h('div', { class: 'tarefa-topo' },
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, t.titulo),
        h('div', { class: 'meta' }, h('span', { class: 'bolinhas' }, cores), ' ', gramas(t.gramas_previsto), ' · ', duracao(t.segundos_previsto),
          t.qtd > 1 ? ` · ${t.qtd} peças` : '')),
      h('span', { class: `chip ${classe}` }, rotulo)),
    t.status === 'ok' || t.status === 'falhou' ? null : h('div', { class: 'status-botoes' }, BOTOES.map(([s, texto]) =>
      h('button', { type: 'button', class: `btn st-${s}`, 'aria-pressed': String(t.status === s), onclick: () => mudar(t, s, ctx) }, texto))),
    t.status === 'falhou' ? h('div', { class: 'acoes' }, reimp ? botao('Reimprimir', () => reimprimir(t, ctx), 'btn btn-primario') : h('span', { class: 'meta' }, 'Já foi para a fila de novo.')) : null,
    t.status === 'ok' ? h('div', { class: 'acoes' }, h('button', { class: 'btn-link', type: 'button', onclick: () => mudar(t, 'fila', ctx) }, 'Marquei errado')) : null);
}

async function mudar(t, status, ctx) {
  if (status === t.status) return;
  if (status === 'falhou') return deuRuim(t, ctx);
  const r = await ctx.db.atualizar('tarefas', t.id, { status }, 'id');
  if (r.erro) return avisar(r.erro, 'erro');
  avisar(status === 'ok' ? 'Boa! Peça pronta ✓' : 'Atualizado');
  ctx.atualizar();
}

async function deuRuim(t, ctx) {
  const motivo = h('textarea', { rows: '3', placeholder: 'ex.: descolou da mesa na 3ª camada' });
  const licao = h('textarea', { rows: '3', placeholder: 'ex.: limpar a mesa com álcool antes' });
  const erro = h('p', { class: 'msg-erro', role: 'alert' });
  const pedir = async () => {
    const ok = await dialogo({ titulo: 'Deu ruim — tudo bem, faz parte.', conteudo: h('div', {},
      campo('O que aconteceu?', motivo), campo('O que você faria diferente na próxima?', licao), erro),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Salvar a lição', valor: true, primario: true }] });
    if (!ok) return false;
    if (!motivo.value.trim() || !licao.value.trim()) { erro.textContent = 'Responda as duas perguntas — é assim que a gente aprende.'; return pedir(); }
    return true;
  };
  if (!(await pedir())) return;
  const r = await ctx.db.atualizar('tarefas', t.id, { status: 'falhou', motivo_falha: motivo.value.trim(), aprendizado: licao.value.trim() }, 'id');
  if (r.erro) return avisar(r.erro, 'erro');
  const de_novo = await dialogo({ titulo: 'Lição salva ✓', conteudo: 'Quer colocar essa peça na fila de novo? O filamento dela sai do estoque outra vez.',
    botoes: [{ texto: 'Agora não', valor: false }, { texto: 'Reimprimir', valor: true, primario: true }] });
  if (de_novo) await reimprimir(t, ctx); else ctx.atualizar();
}

async function reimprimir(t, ctx) {
  const r = await ctx.db.rpc('reimprimir_tarefa', { p_tarefa: t.id });
  if (r.erro) avisar(r.erro, 'erro'); else avisar('Na fila de novo ✓');
  ctx.atualizar();
}
