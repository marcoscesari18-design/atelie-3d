// 🎨 Filamentos — cores de verdade, quanto sobrou e o histórico de cada rolo.
// Pedro vê tudo menos R$/kg; só o Marcos cadastra, edita, ajusta e arquiva.
import { h, vazio, erroTela, avisar, dialogo, campo, confirmar } from '../ui.js';
import { brl, gramas } from '../formato.js';
import { estadoRolo } from '../estoque.js';

const TIPOS = ['PLA', 'PLA Silk', 'PLA Matte', 'PETG', 'TPU', 'ABS', 'ASA'];
const MOTIVOS = { rolo_novo: 'Rolo novo', aprovacao: 'Orçamento aprovado', reimpressao: 'Reimpressão', cancelamento: 'Cancelamento', ajuste: 'Ajuste' };
let verArquivados = false;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export async function render(tela, ctx) {
  const marcos = ctx.perfil.papel === 'marcos';
  const r = await ctx.db.listar('filamentos', (q) => q.select('*').order('ativo', { ascending: false }).order('tipo').order('cor_nome'));
  if (r.erro) { tela.append(erroTela(r.erro, ctx.atualizar)); return; }
  const rolos = r.dados.filter((f) => verArquivados || f.ativo);
  const acabando = rolos.filter((f) => f.ativo && estadoRolo(f.gramas_restantes, f.gramas_iniciais).nivel === 'erro').length;

  tela.append(h('div', { class: 'cabeca' },
    h('div', {}, h('h1', {}, 'Filamentos'),
      h('p', { class: 'sub' }, plural(rolos.filter((f) => f.ativo).length, 'rolo ativo', 'rolos ativos'), acabando ? ` · ${acabando} acabando` : '')),
    marcos ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => formRolo(ctx) }, '+ Rolo') : null));

  if (r.dados.length === 0) {
    tela.append(vazio(marcos ? 'Nenhum rolo cadastrado ainda. Comece pelos rolos que estão no AMS.' : 'O Marcos ainda não cadastrou os rolos.',
      marcos ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => formRolo(ctx) }, 'Cadastrar o primeiro rolo') : null));
    return;
  }

  const grade = h('div', { class: 'grade-rolos' });
  for (const f of rolos) {
    const e = estadoRolo(f.gramas_restantes, f.gramas_iniciais);
    grade.append(h('button', { class: `rolo ${f.ativo ? '' : 'arquivado'}`, type: 'button', onclick: () => detalhe(ctx, f) },
      h('span', { class: 'rolo-cor', style: { background: f.cor_hex } },
        f.slot_ams ? h('span', { class: 'rolo-ams' }, `AMS ${f.slot_ams}`) : null),
      h('span', { class: 'rolo-info' },
        h('span', { class: 'rolo-nome' }, f.cor_nome),
        h('span', { class: 'rolo-tipo' }, `${f.tipo} · ${f.marca}`),
        h('span', { class: `barra ${e.nivel}`, role: 'img', 'aria-label': `${e.pct}% do rolo` }, h('span', { style: { width: `${e.pct}%` } })),
        h('span', { class: 'rolo-rodape' },
          h('span', { class: 'num' }, gramas(f.gramas_restantes)),
          f.ativo ? h('span', { class: `chip ${e.nivel}` }, e.rotulo) : h('span', { class: 'chip' }, 'Arquivado')),
        marcos ? h('span', { class: 'rolo-custo num' }, `${brl(f.custo_kg)}/kg`) : null)));
  }
  tela.append(grade);
  if (r.dados.some((f) => !f.ativo)) {
    tela.append(h('div', { class: 'acoes' }, h('button', { class: 'btn-link', type: 'button',
      onclick: () => { verArquivados = !verArquivados; ctx.atualizar(); } }, verArquivados ? 'Esconder arquivados' : 'Mostrar arquivados')));
  }
}

async function detalhe(ctx, f) {
  const marcos = ctx.perfil.papel === 'marcos';
  const mov = await ctx.db.listar('movimentos_estoque', (q) => q.select('gramas, motivo, obs, created_at')
    .eq('filamento_id', f.id).order('created_at', { ascending: false }).limit(20));
  const historico = mov.erro ? h('p', { class: 'msg-erro' }, mov.erro)
    : h('div', {}, mov.dados.map((m) => h('div', { class: 'linha-dado' },
      h('span', {}, MOTIVOS[m.motivo] || m.motivo, m.obs && m.motivo === 'ajuste' ? h('small', { class: 'meta' }, ` — ${m.obs}`) : null,
        h('br'), h('small', { class: 'meta' }, new Date(m.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))),
      h('span', { class: `v ${m.gramas > 0 ? 'positivo' : ''}` }, `${m.gramas > 0 ? '+' : '−'}${gramas(Math.abs(m.gramas))}`))));
  const e = estadoRolo(f.gramas_restantes, f.gramas_iniciais);
  const botoes = [{ texto: 'Fechar', valor: null }];
  if (marcos) botoes.unshift({ texto: 'Mais ações', valor: 'acoes', primario: true });
  const escolha = await dialogo({
    titulo: `${f.cor_nome} · ${f.tipo}`,
    conteudo: h('div', {},
      h('div', { class: 'detalhe-rolo' }, h('span', { class: 'rolo-cor pequena', style: { background: f.cor_hex } }),
        h('div', {}, h('div', { class: 'num grande' }, gramas(f.gramas_restantes)), h('span', { class: `chip ${e.nivel}` }, e.rotulo))),
      h('p', { class: 'secao' }, 'Últimos movimentos'), historico),
    botoes,
  });
  if (escolha === 'acoes') acoesMarcos(ctx, f);
}

async function acoesMarcos(ctx, f) {
  const escolha = await dialogo({
    titulo: `${f.cor_nome} · ${f.tipo}`,
    conteudo: 'O que você quer fazer com este rolo?',
    botoes: [
      { texto: 'Chegou rolo novo', valor: 'entrada' },
      { texto: 'Ajustar saldo', valor: 'ajuste' },
      { texto: 'Editar', valor: 'editar' },
      { texto: f.ativo ? 'Arquivar' : 'Reativar', valor: 'arquivar' },
      { texto: 'Voltar', valor: null },
    ],
  });
  if (escolha === 'entrada') entrada(ctx, f);
  if (escolha === 'ajuste') ajuste(ctx, f);
  if (escolha === 'editar') formRolo(ctx, f);
  if (escolha === 'arquivar') {
    if (f.ativo && !(await confirmar('Arquivar rolo?', 'Ele some da lista e não aparece mais nos orçamentos. O histórico fica guardado.', 'Arquivar'))) return;
    const r = await ctx.db.atualizar('filamentos', f.id, { ativo: !f.ativo }, 'id');
    if (r.erro) avisar(r.erro, 'erro'); else { avisar(f.ativo ? 'Rolo arquivado' : 'Rolo reativado'); ctx.atualizar(); }
  }
}

async function entrada(ctx, f) {
  const g = h('input', { type: 'number', inputmode: 'decimal', min: '1', step: '1', value: String(Number(f.gramas_iniciais) || 1000) });
  const ok = await dialogo({ titulo: 'Chegou rolo novo', conteudo: campo('Gramas do rolo novo', g, 'Soma no saldo deste rolo.'),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Somar', valor: true, primario: true }] });
  if (!ok) return;
  const r = await ctx.db.rpc('entrada_rolo', { p_filamento: f.id, p_gramas: Number(g.value) });
  if (r.erro) avisar(r.erro, 'erro'); else { avisar('Rolo somado ✓'); ctx.atualizar(); }
}

async function ajuste(ctx, f) {
  const atual = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: String(f.gramas_restantes) });
  const motivo = h('input', { type: 'text', placeholder: 'ex.: pesei o rolo na balança', maxlength: '200' });
  const ok = await dialogo({ titulo: 'Ajustar saldo', conteudo: h('div', {},
    campo('Quanto tem agora (g)', atual, `Hoje o sistema diz ${gramas(f.gramas_restantes)}.`), campo('Motivo', motivo)),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Ajustar', valor: true, primario: true }] });
  if (!ok) return;
  const dif = Math.round((Number(atual.value) - Number(f.gramas_restantes)) * 100) / 100;
  if (!dif) { avisar('Nada mudou.'); return; }
  const r = await ctx.db.rpc('ajustar_estoque', { p_filamento: f.id, p_gramas: dif, p_obs: motivo.value });
  if (r.erro) avisar(r.erro, 'erro'); else { avisar('Saldo ajustado ✓'); ctx.atualizar(); }
}

async function formRolo(ctx, f = null, rascunho = null) {
  const v = rascunho || f || { marca: '', tipo: 'PLA', cor_nome: '', cor_hex: '#FF6910', custo_kg: '', gramas_iniciais: 1000, slot_ams: null };
  const marca = h('input', { type: 'text', value: v.marca, placeholder: 'Bambu, Voolt…' });
  const tipo = h('select', {}, TIPOS.map((t) => h('option', { value: t, selected: t === v.tipo }, t)));
  if (!TIPOS.includes(v.tipo)) tipo.append(h('option', { value: v.tipo, selected: true }, v.tipo));
  const cor = h('input', { type: 'text', value: v.cor_nome, placeholder: 'Laranja' });
  const hex = h('input', { type: 'color', value: String(v.cor_hex).toLowerCase() });
  const custo = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: v.custo_kg, placeholder: 'o que você pagou' });
  const ini = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', value: v.gramas_iniciais });
  const slot = h('select', {}, h('option', { value: '' }, 'Gaveta (fora do AMS)'),
    [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: Number(v.slot_ams) === n }, `AMS ${n}`)));
  const ok = await dialogo({
    titulo: f ? 'Editar rolo' : 'Novo rolo',
    conteudo: h('div', {}, campo('Marca', marca), campo('Tipo', tipo), h('div', { class: 'grade-2' }, campo('Nome da cor', cor), campo('Cor', hex)),
      campo('R$ por kg', custo, 'Preço real pago no rolo — é o que a calculadora usa.'),
      f ? null : campo('Gramas do rolo', ini), campo('Onde está', slot)),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Salvar', valor: true, primario: true }],
  });
  if (!ok) return;
  const atual = { marca: marca.value.trim(), tipo: tipo.value, cor_nome: cor.value.trim(), cor_hex: hex.value.toUpperCase(),
    custo_kg: custo.value, gramas_iniciais: ini.value, slot_ams: slot.value ? Number(slot.value) : null };
  if (!atual.marca || !atual.cor_nome || atual.custo_kg === '') {
    avisar('Preencha marca, nome da cor e R$/kg.', 'erro');
    return formRolo(ctx, f, atual);
  }
  const linha = { marca: atual.marca, tipo: atual.tipo, cor_nome: atual.cor_nome, cor_hex: atual.cor_hex, custo_kg: Number(atual.custo_kg), slot_ams: atual.slot_ams };
  const r = f ? await ctx.db.atualizar('filamentos', f.id, linha, 'id')
    : await ctx.db.inserir('filamentos', { ...linha, gramas_iniciais: Number(atual.gramas_iniciais) || 0 }, 'id');
  if (r.erro) { avisar(r.erro, 'erro'); return; }
  avisar(f ? 'Rolo atualizado ✓' : 'Rolo cadastrado ✓');
  ctx.atualizar();
}
