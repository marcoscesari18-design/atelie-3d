// 🧾 Orçamentos — sobe o .3mf, confere rolos, define preço, gera PDF e aprova.
// Aprovar = vira venda + tarefas na Semana e as gramas saem do estoque (no banco, numa transação).
import { h, limpar, vazio, erroTela, avisar, dialogo, campo, confirmar, botao, corBolinha } from '../ui.js';
import { brl, gramas, duracao, numeroOrc, hojeISO, dataBrasilia } from '../formato.js';
import { ler3mf, Erro3mf } from '../le3mf.js';
import { impressaoDe3mf, calcularRascunho, problemas, resumoBaixa, linhasParaBanco, rascunhoDoBanco } from '../orcamento.js';
import { gerarPdfOrcamento } from '../pdf.js';

const CANAIS = { escola: 'Escola', whatsapp: 'WhatsApp', feira: 'Feira', shopee: 'Shopee', ml: 'Mercado Livre', b2b: 'Empresa (B2B)', outro: 'Outro' };
const STATUS = { rascunho: ['Rascunho', ''], enviado: ['Enviado', 'acento'], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'erro'], cancelado: ['Cancelado', 'erro'] };
const EDITAVEL = ['rascunho', 'enviado'];
const SELECT_ORC = '*, orcamento_itens(*, orcamento_impressoes(*, orcamento_item_placas(*, orcamento_placa_filamentos(*))))';
let filtro = 'abertos';

const chave = (id) => `atelie:orc:${id || 'novo'}`;
const lerLocal = (id) => { try { return JSON.parse(localStorage.getItem(chave(id))); } catch { return null; } };
const gravarLocal = (r) => { try { localStorage.setItem(chave(r.id), JSON.stringify(r)); } catch { /* sem espaço: segue */ } };
const apagarLocal = (id) => { try { localStorage.removeItem(chave(id)); } catch { /* ignora */ } };
const chipStatus = (s) => h('span', { class: `chip ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

export async function render(tela, ctx) {
  const [, rota] = location.hash.replace('#', '').split('/');
  if (rota) return editor(tela, ctx, rota === 'novo' ? null : rota);
  return lista(tela, ctx);
}

// ---------------------------------------------------------------- lista
async function lista(tela, ctx) {
  const marcos = ctx.perfil.papel === 'marcos';
  const r = await ctx.db.listar('orcamentos', (q) => {
    let c = q.select('id, numero, cliente, status, linha, total_aceito, frete, frete_cliente, created_at, orcamento_itens(preco_total)').order('numero', { ascending: false }).limit(100);
    if (!marcos) c = c.eq('linha', 'pedro');
    return c;
  });
  if (r.erro) { tela.append(erroTela(r.erro, ctx.atualizar)); return; }
  const novoBtn = h('a', { class: 'btn btn-primario', href: '#orcamentos/novo' }, '+ Novo');
  tela.append(h('div', { class: 'cabeca' }, h('div', {}, h('h1', {}, 'Orçamentos'),
    h('p', { class: 'sub' }, 'Suba o .3mf fatiado, confira e mande para o cliente.')), novoBtn));

  const seg = h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Filtrar' },
    [['abertos', 'Abertos'], ['aprovado', 'Aprovados'], ['todos', 'Todos']].map(([v, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(filtro === v), onclick: () => { filtro = v; ctx.atualizar(); } }, t)));
  tela.append(seg);

  const locais = lerLocal(null);
  const itens = r.dados.filter((o) => filtro === 'todos' || (filtro === 'abertos' ? EDITAVEL.includes(o.status) : o.status === filtro));
  const listaEl = h('div', { class: 'lista', style: { marginTop: '12px' } });
  if (locais && filtro !== 'aprovado') {
    listaEl.append(h('a', { class: 'item', href: '#orcamentos/novo' },
      h('div', { class: 'corpo' }, h('div', { class: 'titulo' }, locais.cliente || 'Orçamento sem nome'), h('div', { class: 'meta' }, 'Não salvo — continue de onde parou')),
      h('span', { class: 'chip atencao' }, 'Não salvo')));
  }
  for (const o of itens) {
    const total = o.total_aceito ?? o.orcamento_itens.reduce((s, i) => s + Number(i.preco_total), 0) + (o.frete_cliente !== false ? Number(o.frete) || 0 : 0);
    listaEl.append(h('a', { class: `item ${o.linha === 'b2b' ? 'linha-b2b' : ''}`, href: `#orcamentos/${o.id}` },
      h('div', { class: 'corpo' },
        h('div', { class: 'titulo' }, o.cliente),
        h('div', { class: 'meta' }, numeroOrc(o.numero), ' · ', new Date(o.created_at).toLocaleDateString('pt-BR'),
          o.linha === 'b2b' ? h('span', { class: 'chip b2b', style: { marginLeft: '6px' } }, 'B2B') : null)),
      h('div', { class: 'valor' }, h('div', {}, brl(total)), chipStatus(o.status))));
  }
  if (!itens.length && !locais) listaEl.append(vazio(filtro === 'abertos' ? 'Nenhum orçamento aberto.' : 'Nada por aqui.', filtro === 'abertos' ? h('a', { class: 'btn btn-primario', href: '#orcamentos/novo' }, 'Fazer o primeiro orçamento') : null));
  tela.append(listaEl);
}

// ---------------------------------------------------------------- dados de apoio
async function carregarApoio(ctx) {
  const [rolos, cfg, produtos] = await Promise.all([
    ctx.db.listar('filamentos', (q) => q.select('id, marca, tipo, cor_nome, cor_hex, custo_kg, gramas_restantes, ativo').order('tipo').order('cor_nome')),
    ctx.db.listar('config', (q) => q.select('chave, valor').in('chave', ['defaults_calculadora', 'marca'])),
    ctx.db.listar('produtos', (q) => { const c = q.select('id, nome, linha, receita, foto_path, preco_venda').not('receita', 'is', null).order('nome'); return ctx.perfil.papel === 'marcos' ? c : c.eq('linha', 'pedro'); }),
  ]);
  const erro = rolos.erro || cfg.erro || produtos.erro;
  if (erro) return { erro };
  const conf = Object.fromEntries(cfg.dados.map((c) => [c.chave, c.valor]));
  return { rolos: rolos.dados, params: conf.defaults_calculadora, marca: conf.marca || {}, produtos: produtos.dados };
}

// ---------------------------------------------------------------- editor
async function editor(tela, ctx, id) {
  const apoio = await carregarApoio(ctx);
  if (apoio.erro) { tela.append(erroTela(apoio.erro, ctx.atualizar)); return; }
  let r;
  if (id) {
    const o = await ctx.db.listar('orcamentos', (q) => q.select(SELECT_ORC).eq('id', id).maybeSingle());
    if (o.erro) { tela.append(erroTela(o.erro, ctx.atualizar)); return; }
    if (!o.dados) { tela.append(vazio('Orçamento não encontrado.', h('a', { class: 'btn', href: '#orcamentos' }, 'Voltar'))); return; }
    if (o.dados.linha === 'b2b' && ctx.perfil.papel !== 'marcos') { tela.append(vazio('Esse orçamento é do Marcos.', h('a', { class: 'btn', href: '#orcamentos' }, 'Voltar'))); return; }
    r = rascunhoDoBanco(o.dados, apoio.rolos);
    const local = lerLocal(id);
    if (!EDITAVEL.includes(r.status)) apagarLocal(id);
    else if (local) { r = { ...local, status: r.status, numero: r.numero }; r.alterado = true; }
  } else {
    r = lerLocal(null) || { cliente: '', contato: '', canal: 'escola', linha: 'pedro', descontoPct: 0, obs: '', itens: [], status: 'rascunho' };
  }
  await Promise.all(r.itens.filter((it) => !it.fotoDataUrl && it.fotoPath).map(async (it) => {
    const f = await ctx.db.foto(it.fotoPath); if (f.dados) it.fotoDataUrl = await reduzirFoto(f.dados);
  }));
  const estado = { r, apoio, ctx, tela };
  desenhar(estado);
}

function desenhar(est) {
  const { r, ctx, tela } = est;
  limpar(tela);
  est.precosEl = [];
  const titulo = r.id ? numeroOrc(r.numero) : 'Novo orçamento';
  tela.append(h('div', { class: 'cabeca' },
    h('div', {}, h('a', { href: '#orcamentos', class: 'btn-link' }, '← Orçamentos'), h('h1', {}, titulo)),
    h('div', { class: 'chips' }, r.linha === 'b2b' ? h('span', { class: 'chip b2b' }, 'B2B') : null, chipStatus(r.status))));
  if (!EDITAVEL.includes(r.status)) return visualizar(est);
  if (r.alterado && r.id) tela.append(h('p', { class: 'aviso' }, 'Você tem alterações neste aparelho que ainda não foram salvas.'));
  // computador: itens à esquerda, resumo e botões à direita (sempre à vista); celular: uma coluna, nesta ordem
  const col = h('div', { class: 'editor-principal' });
  const lado = h('aside', { class: 'editor-lado', 'aria-label': 'Resumo e ações', tabindex: '-1' });
  // teclado: atalho para o resumo sem passar por todos os campos dos itens (só aparece ao receber foco)
  tela.append(h('button', { class: 'pular', type: 'button', onclick: () => lado.focus() }, 'Ir para o resumo e Aprovar'),
    h('div', { class: 'editor' }, col, lado));

  const marcos = ctx.perfil.papel === 'marcos';
  const mudou = () => { r.alterado = true; gravarLocal(r); atualizarResumo(est); };

  // Cliente
  const nome = h('input', { type: 'text', value: r.cliente, placeholder: 'Quem está comprando', autocomplete: 'off' });
  nome.addEventListener('input', () => { r.cliente = nome.value; mudou(); });
  const contato = h('input', { type: 'text', value: r.contato, placeholder: 'WhatsApp, sala…', autocomplete: 'off' });
  contato.addEventListener('input', () => { r.contato = contato.value; mudou(); });
  const canal = h('select', {}, Object.entries(CANAIS).map(([v, t]) => h('option', { value: v, selected: r.canal === v }, t)));
  canal.addEventListener('change', () => { r.canal = canal.value; mudou(); });
  const cliente = h('div', { class: 'card' }, campo('Cliente', nome), h('div', { class: 'grade-2' }, campo('Contato', contato), campo('Canal', canal)));
  if (marcos) {
    cliente.append(h('div', { class: 'campo' }, h('label', {}, 'Linha'), h('div', { class: 'segmentado' },
      [['pedro', 'Lojinha do Pedro'], ['b2b', 'Cliente B2B']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(r.linha === v),
        onclick: () => { r.linha = v; mudou(); desenhar(est); } }, t)))));
  }
  col.append(cliente);

  // Itens
  col.append(h('p', { class: 'secao' }, 'Itens'));
  const calc = calcularRascunho(r, est.apoio.rolos, est.apoio.params);
  r.itens.forEach((item, i) => col.append(cartaoItem(est, item, i, calc.itens[i], mudou)));
  const entrada = h('input', { type: 'file', accept: '.3mf', class: 'oculto' });
  entrada.addEventListener('change', () => { const f = entrada.files[0]; entrada.value = ''; if (f) adicionar3mf(est, f, null); });
  col.append(entrada, h('div', { class: 'acoes acoes-itens' },
    h('button', { class: 'btn btn-largo', type: 'button', onclick: () => entrada.click() }, '+ Item: subir .3mf fatiado'),
    est.apoio.produtos.length ? h('button', { class: 'btn btn-largo', type: 'button', onclick: () => usarProduto(est) }, '+ Item: produto salvo') : null));

  // Desconto
  if (r.itens.length > 1) {
    const desc = h('input', { type: 'number', inputmode: 'decimal', min: '0', max: '99', step: '1', value: r.descontoPct || '' , placeholder: '0' });
    desc.addEventListener('input', () => { r.descontoPct = Number(desc.value) || 0; mudou(); });
    col.append(h('div', { class: 'card', style: { marginTop: '12px' } }, campo('Desconto do pacote (%)', desc, 'Vale para o orçamento todo.')));
  }

  // Frete: começa vazio; quem paga aparece só quando há valor
  const frete = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5', value: Number(r.frete) > 0 ? r.frete : '', placeholder: 'sem frete' });
  const quemPaga = h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Quem paga o frete' },
    [[true, 'Cliente paga'], [false, 'Frete grátis (eu pago)']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String((r.freteCliente !== false) === v),
      onclick: (e) => { r.freteCliente = v; quemPaga.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); mudou(); } }, t)));
  const blocoQuem = h('div', { class: `campo ${Number(r.frete) > 0 ? '' : 'oculto'}` }, h('span', { class: 'rotulo' }, 'Quem paga o frete?'), quemPaga);
  frete.addEventListener('input', () => { r.frete = frete.value === '' ? 0 : Number(frete.value); blocoQuem.classList.toggle('oculto', !(Number(frete.value) > 0)); mudou(); });
  col.append(h('div', { class: 'card', style: { marginTop: '12px' } }, campo('Frete (R$)', frete, 'Deixe vazio se o cliente busca a peça.'), blocoQuem));

  est.resumoEl = h('div', { class: 'card resumo' });
  est.problemasEl = h('div', {});
  lado.append(est.resumoEl, est.problemasEl);
  atualizarResumo(est);

  // Ações
  const acoes = h('div', { class: 'acoes-fixas' },
    botao('Salvar', () => salvar(est), 'btn'),
    botao('PDF', () => pdf(est), 'btn'),
    botao('Aprovar', () => aprovar(est), 'btn btn-primario'));
  lado.append(acoes, h('div', { class: 'acoes acoes-secundarias' },
    r.id ? botao('Cliente recusou', () => recusar(est), 'btn btn-perigo') : null,
    r.alterado || !r.id ? botao(r.id ? 'Descartar alterações' : 'Descartar', async () => {
      if (!(await confirmar('Descartar?', 'O que não foi salvo será perdido.', 'Descartar'))) return;
      apagarLocal(r.id); ctx.ir(r.id ? `orcamentos/${r.id}` : 'orcamentos'); ctx.atualizar();
    }, 'btn') : null,
    r.id && r.status === 'rascunho' ? botao('Apagar', async () => {
      if (!(await confirmar('Apagar orçamento?', 'Isso não pode ser desfeito.', 'Apagar'))) return;
      const x = await ctx.db.apagar('orcamentos', r.id);
      if (x.erro) return avisar(x.erro, 'erro');
      apagarLocal(r.id); avisar('Orçamento apagado'); ctx.ir('orcamentos');
    }, 'btn btn-perigo') : null));
}

function atualizarResumo(est) {
  const { r, apoio, ctx } = est;
  if (!est.resumoEl) return;
  const c = calcularRascunho(r, apoio.rolos, apoio.params);
  const marcos = ctx.perfil.papel === 'marcos';
  limpar(est.resumoEl).append(...[
    c.desconto ? h('div', { class: 'linha-dado' }, h('span', {}, 'Subtotal'), h('span', { class: 'v' }, brl(c.subtotal))) : null,
    c.desconto ? h('div', { class: 'linha-dado' }, h('span', {}, `Desconto (${c.desconto}%)`), h('span', { class: 'v' }, `− ${brl(c.subtotal - c.totalItens)}`)) : null,
    c.frete > 0 ? h('div', { class: 'linha-dado' }, h('span', {}, c.freteCliente ? 'Frete' : 'Frete grátis (você paga)'),
      h('span', { class: 'v' }, c.freteCliente ? brl(c.frete) : `− ${brl(c.frete)} do lucro`)) : null,
    h('div', { class: 'linha-dado total' }, h('span', {}, 'Total para o cliente'), h('span', { class: 'v' }, brl(c.total))),
    marcos ? h('div', { class: 'linha-dado' }, h('span', { class: 'meta' }, 'Custo'), h('span', { class: 'v meta' }, brl(c.custo))) : null,
    marcos ? h('div', { class: 'linha-dado' }, h('span', { class: 'meta' }, 'Lucro'), h('span', { class: `v ${c.lucro < 0 ? 'msg-erro' : 'positivo'}` }, brl(c.lucro))) : null].filter(Boolean));
  (est.precosEl || []).forEach((fn) => fn(c));
  const p = problemas(r, apoio.rolos, apoio.params);
  limpar(est.problemasEl);
  if (p.length) est.problemasEl.append(h('div', { class: 'aviso' }, h('strong', {}, 'Antes de salvar:'), h('ul', {}, p.map((x) => h('li', {}, x)))));
}

function opcoesRolo(rolos, tipo, atual) {
  const ativos = rolos.filter((x) => x.ativo || x.id === atual);
  const doTipo = ativos.filter((x) => x.tipo.toUpperCase() === String(tipo).toUpperCase());
  const outros = ativos.filter((x) => !doTipo.includes(x));
  const op = (x) => h('option', { value: x.id, selected: x.id === atual }, `${x.cor_nome} · ${x.tipo} · ${gramas(x.gramas_restantes)}`);
  return [h('option', { value: '', selected: !atual }, 'Escolha o rolo'),
    doTipo.length ? h('optgroup', { label: `Rolos de ${tipo}` }, doTipo.map(op)) : null,
    outros.length ? h('optgroup', { label: 'Outros' }, outros.map(op)) : null];
}

function cartaoItem(est, item, i, calc, mudou) {
  const { r, apoio, ctx } = est;
  const marcos = ctx.perfil.papel === 'marcos';
  const desc = h('input', { type: 'text', value: item.descricao, placeholder: 'ex.: Chaveiro com nome' });
  desc.addEventListener('input', () => { item.descricao = desc.value; mudou(); });
  const qtd = h('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: item.qtd });
  qtd.addEventListener('change', () => { item.qtd = Math.max(1, Number(qtd.value) || 1); mudou(); desenhar(est); });
  const preco = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5', value: item.precoUnit ?? '', placeholder: calc.precoSugerido ? String(calc.precoSugerido) : '' });
  preco.addEventListener('input', () => { item.precoUnit = preco.value === '' ? null : Number(preco.value); mudou(); });

  const impressoes = item.impressoes.map((imp, k) => {
    const vezes = h('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: imp.vezes });
    vezes.addEventListener('change', () => { imp.vezes = Math.max(1, Number(vezes.value) || 1); mudou(); desenhar(est); });
    const upv = h('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: imp.unidadesPorVez });
    upv.addEventListener('change', () => { imp.unidadesPorVez = Math.max(1, Number(upv.value) || 1); mudou(); desenhar(est); });
    const segundos = imp.placas.reduce((s, p) => s + p.segundos, 0);
    const gr = imp.placas.reduce((s, p) => s + p.gramas, 0);
    return h('div', { class: 'impressao' },
      h('div', { class: 'imp-topo' },
        h('div', {}, h('strong', {}, imp.arquivo || 'Impressão'),
          h('div', { class: 'meta' }, `${imp.placas.length > 1 ? `${imp.placas.length} placas · ` : `placa ${imp.placas[0]?.placa} · `}${gramas(gr)} · ${duracao(segundos)} por vez`)),
        h('button', { class: 'btn-link', type: 'button', 'aria-label': 'Tirar esta impressão', onclick: () => { item.impressoes.splice(k, 1); mudou(); desenhar(est); } }, 'tirar')),
      h('div', { class: 'grade-2' }, campo('Peças que saem por vez', upv), campo('Quantas vezes imprimir', vezes)),
      imp.placas.map((pl) => h('div', { class: 'cores' }, pl.cores.map((c) => {
        const sel = h('select', { 'aria-label': `Rolo para a cor ${c.cor}` }, opcoesRolo(apoio.rolos, c.tipo, c.filamentoId));
        sel.addEventListener('change', () => { c.filamentoId = sel.value || null; mudou(); });
        return h('div', { class: 'cor-linha' }, corBolinha(c.cor, `cor do arquivo ${c.cor}`),
          h('span', { class: 'num cor-g' }, gramas(c.gramas)), sel);
      }))));
  });

  const precoInfo = h('div', { class: 'meta' });
  est.precosEl[i] = (c) => {
    const ci = c.itens[i];
    limpar(precoInfo).append(`Sugerido ${brl(ci.precoSugerido)}/un`, marcos ? ` · custo ${brl(ci.custoUnit)}/un` : '', ` · total ${brl(ci.precoUnit * item.qtd)}`);
  };
  const entrada = h('input', { type: 'file', accept: '.3mf', class: 'oculto' });
  entrada.addEventListener('change', () => { const f = entrada.files[0]; entrada.value = ''; if (f) adicionar3mf(est, f, item); });

  return h('div', { class: 'card item-orc' },
    h('div', { class: 'item-topo' },
      item.fotoDataUrl ? h('img', { class: 'foto-placa', src: item.fotoDataUrl, alt: '' }) : null,
      h('div', { style: { flex: '1' } }, campo('O que é', desc), campo('Quantidade', qtd))),
    impressoes,
    calc.faltam > 0 ? h('div', { class: 'aviso' }, `Faltam ${calc.faltam}. Suba o .3mf com ${calc.faltam} peça(s) ou aumente as vezes.`,
      h('div', { class: 'acoes' }, h('button', { class: 'btn', type: 'button', onclick: () => entrada.click() }, '+ .3mf do que falta'))) : null,
    calc.sobra ? h('div', { class: 'aviso erro' }, `Assim saem ${calc.unidades} peças, mais que ${item.qtd}. Diminua as vezes.`) : null,
    entrada,
    campo('Preço por unidade (R$)', preco), precoInfo,
    h('div', { class: 'acoes' },
      botao('Salvar como produto', () => salvarProduto(est, item, calc), 'btn'),
      h('button', { class: 'btn btn-perigo', type: 'button', onclick: async () => {
        if (!(await confirmar('Tirar item?', `"${item.descricao || 'Item'}" sai do orçamento.`, 'Tirar'))) return;
        r.itens.splice(i, 1); mudou(); desenhar(est);
      } }, 'Tirar item')));
}

// ---------------------------------------------------------------- .3mf
async function reduzirFoto(blob) {
  if (!blob) return null;
  try {
    const img = await createImageBitmap(blob);
    const escala = Math.min(1, 480 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return null; }
}

async function adicionar3mf(est, arquivo, itemExistente) {
  const { r, apoio } = est;
  let leitura;
  try {
    leitura = await ler3mf(await arquivo.arrayBuffer(), { JSZip: window.JSZip, DOMParser: window.DOMParser });
  } catch (e) {
    await dialogo({ titulo: 'Não deu para usar esse arquivo', conteudo: e instanceof Erro3mf ? e.message : 'Não consegui ler esse arquivo.' });
    return;
  }
  let escolhidas = leitura.placas.map((p) => p.indice);
  if (leitura.placas.length > 1) {
    const caixas = leitura.placas.map((p) => ({ p, cb: h('input', { type: 'checkbox', checked: true }) }));
    const fotos = await Promise.all(leitura.placas.map((p) => reduzirFoto(p.foto)));
    const ok = await dialogo({ titulo: 'Quais placas fazem este item?', conteudo: h('div', {},
      h('p', {}, 'Marque todas as placas que precisam ser impressas para sair uma unidade (ou um lote).'),
      caixas.map(({ p, cb }, k) => h('label', { class: 'placa-opcao' }, cb, fotos[k] ? h('img', { class: 'foto-placa', src: fotos[k], alt: '' }) : null,
        h('span', {}, h('strong', {}, `Placa ${p.indice}`), h('br'), h('span', { class: 'meta' }, `${gramas(p.gramas)} · ${duracao(p.segundos)}`))))),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Usar', valor: true, primario: true }] });
    if (!ok) return;
    escolhidas = caixas.filter((x) => x.cb.checked).map((x) => x.p.indice);
    if (!escolhidas.length) return avisar('Marque pelo menos uma placa.', 'erro');
  }
  const imp = impressaoDe3mf(leitura, { arquivo: arquivo.name, placas: escolhidas, rolos: apoio.rolos });
  const semRolo = imp.placas.some((p) => p.cores.some((c) => !c.filamentoId));
  if (itemExistente) {
    itemExistente.impressoes.push(imp);
  } else {
    const foto = await reduzirFoto(leitura.placas.find((p) => p.indice === escolhidas[0])?.foto);
    imp.placas.forEach((p) => { delete p.foto; });
    r.itens.push({ descricao: arquivo.name.replace(/\.3mf$/i, '').replace(/[_-]+/g, ' ').trim(), qtd: 1, extras: 0, precoUnit: null, impressoes: [imp], fotoDataUrl: foto });
  }
  imp.placas.forEach((p) => { delete p.foto; });
  r.alterado = true; gravarLocal(r);
  desenhar(est);
  avisar(semRolo ? 'Arquivo lido. Escolha o rolo das cores marcadas.' : 'Arquivo lido ✓');
}

async function usarProduto(est) {
  const { r, apoio } = est;
  const sel = h('select', {}, apoio.produtos.map((p) => h('option', { value: p.id }, p.nome)));
  const ok = await dialogo({ titulo: 'Usar produto salvo', conteudo: campo('Produto', sel), botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Usar', valor: true, primario: true }] });
  if (!ok) return;
  const p = apoio.produtos.find((x) => x.id === sel.value);
  const receita = structuredClone(p.receita);
  const ativos = new Set(apoio.rolos.filter((x) => x.ativo).map((x) => x.id));
  receita.impressoes.forEach((imp) => imp.placas.forEach((pl) => pl.cores.forEach((c) => { if (!ativos.has(c.filamentoId)) c.filamentoId = null; })));
  let foto = null;
  if (p.foto_path) { const f = await est.ctx.db.foto(p.foto_path); if (f.dados) foto = await reduzirFoto(f.dados); }
  r.itens.push({ descricao: p.nome, qtd: 1, extras: 0, precoUnit: p.preco_venda ?? null, impressoes: receita.impressoes, fotoDataUrl: foto, fotoPath: p.foto_path, produtoId: p.id });
  r.alterado = true; gravarLocal(r); desenhar(est);
}

async function salvarProduto(est, item, calc) {
  const { ctx, r } = est;
  if (!item.impressoes.length || item.impressoes.some((imp) => imp.placas.some((pl) => pl.cores.some((c) => !c.filamentoId)))) {
    return avisar('Escolha os rolos antes de salvar como produto.', 'erro');
  }
  let fotoPath = item.fotoPath || null;
  if (!fotoPath && item.fotoDataUrl) {
    const up = await ctx.db.enviarFoto(await (await fetch(item.fotoDataUrl)).blob());
    if (!up.erro) fotoPath = up.dados;
  }
  const receita = { impressoes: item.impressoes.map((imp) => ({ ...imp, placas: imp.placas.map((p) => ({ ...p, foto: undefined })) })) };
  const x = await ctx.db.inserir('produtos', { nome: item.descricao || 'Produto', linha: r.linha, receita,
    custo_calculado: Math.round(calc.custoUnit * 100) / 100, preco_venda: calc.precoUnit, foto_path: fotoPath, validado: false }, 'id');
  if (x.erro) return avisar(x.erro, 'erro');
  item.fotoPath = fotoPath; gravarLocal(r);
  avisar('Produto salvo ✓ — da próxima vez é só escolher.');
}

// ---------------------------------------------------------------- salvar / pdf / aprovar
async function salvar(est) {
  const { r, apoio, ctx } = est;
  const p = problemas(r, apoio.rolos, apoio.params);
  if (p.length) { avisar(p[0], 'erro'); return false; }
  const calc = calcularRascunho(r, apoio.rolos, apoio.params);
  let fotoFalhou = false;
  for (const item of r.itens) {
    if (!item.fotoPath && item.fotoDataUrl) {
      const up = await ctx.db.enviarFoto(await (await fetch(item.fotoDataUrl)).blob());
      if (up.erro) fotoFalhou = true; else item.fotoPath = up.dados;
    }
  }
  const l = linhasParaBanco(r, calc);
  gravarLocal(r);
  const x = await ctx.db.rpc('salvar_orcamento', { p_id: r.id || null, p_dados: { orcamento: l.orcamento, itens: l.itens } });
  if (x.erro) { avisar(x.erro, 'erro'); return false; }
  const id = x.dados[0].id;
  if (!r.id) { apagarLocal(null); Object.assign(r, { id, numero: x.dados[0].numero, status: 'rascunho' }); }
  r.alterado = false; apagarLocal(id);
  avisar(fotoFalhou ? 'Salvo, mas a foto não subiu (conexão). Ela tenta de novo no próximo salvar.' : 'Salvo ✓', fotoFalhou ? 'erro' : 'ok');
  if (fotoFalhou) { r.alterado = true; gravarLocal(r); }
  if (location.hash !== `#orcamentos/${id}`) history.replaceState(null, '', `#orcamentos/${id}`);
  desenhar(est);
  return true;
}

async function fotoParaPdf(ctx, item) {
  if (item.fotoDataUrl) return item.fotoDataUrl;
  if (!item.fotoPath) return null;
  const f = await ctx.db.foto(item.fotoPath);
  return f.dados ? reduzirFoto(f.dados) : null;
}

async function pdf(est) {
  const { r, apoio, ctx } = est;
  if (EDITAVEL.includes(r.status) && (r.alterado || !r.id)) { if (!(await salvar(est))) return; }
  if (!window.jspdf) return avisar('O gerador de PDF não carregou. Confira a internet.', 'erro');
  const calc = calcularRascunho(r, apoio.rolos, apoio.params);
  let logo = null;
  if (apoio.marca.logo_path) { const f = await ctx.db.foto(apoio.marca.logo_path); if (f.dados) logo = await reduzirFoto(f.dados); }
  const hoje = hojeISO();
  const validade = r.validade || hojeISO(new Date(), 7);
  const doc = gerarPdfOrcamento(window.jspdf.jsPDF, {
    numero: r.numero, cliente: r.cliente, contato: r.contato, data: r.createdAt ? dataBrasilia(r.createdAt) : hoje, validade,
    itens: await Promise.all(r.itens.map(async (it, i) => ({ descricao: it.descricao, qtd: it.qtd, precoUnit: calc.itens[i].precoUnit, foto: await fotoParaPdf(ctx, it) }))),
    subtotal: calc.subtotal, totalItens: calc.totalItens, descontoPct: calc.desconto, frete: calc.frete, freteCliente: calc.freteCliente, total: r.totalAceito ?? calc.total,
    marca: { nome: apoio.marca.nome, fone: apoio.marca.fone, instagram: apoio.marca.instagram, logo },
  });
  const nome = `${numeroOrc(r.numero)} ${r.cliente}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  const blob = doc.output('blob');
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  const baixar = () => { const a = h('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); return 'baixou'; };
  let feito;
  if (navigator.canShare?.({ files: [arquivo] })) {
    // iPhone: o share precisa do toque "fresco" — por isso um botão depois que o PDF ficou pronto
    feito = await dialogo({ titulo: 'PDF pronto', conteudo: `${nome}`, botoes: [
      { texto: 'Baixar', valor: baixar },
      { texto: 'Compartilhar', primario: true, valor: () => navigator.share({ files: [arquivo], title: nome }).then(() => 'enviou',
        (e) => (e?.name === 'AbortError' ? null : 'falhou')) }] });
    if (feito === 'falhou') {   // o compartilhar não abriu: oferece baixar, com um toque novo
      feito = await dialogo({ titulo: 'Não abriu o compartilhar', conteudo: 'Baixe o PDF e mande pelo WhatsApp.',
        botoes: [{ texto: 'Voltar', valor: null }, { texto: 'Baixar o PDF', valor: baixar, primario: true }] });
    }
  } else {
    feito = baixar();
  }
  if (!feito) return;   // desistiu: não marca como enviado
  if (r.status === 'rascunho') {
    const m = await ctx.db.rpc('marcar_orcamento', { p_id: r.id, p_status: 'enviado' });
    if (!m.erro) { r.status = 'enviado'; desenhar(est); }
  }
}

async function aprovar(est) {
  const { r, ctx } = est;
  // nunca aprovar uma versão diferente da que está na tela
  if (r.alterado || !r.id) { if (!(await salvar(est))) return; }
  // dados frescos: saldo dos rolos pode ter mudado em outro aparelho
  const apoio = await carregarApoio(ctx);
  if (apoio.erro) return avisar(apoio.erro, 'erro');
  est.apoio = apoio;
  const calc = calcularRascunho(r, apoio.rolos, apoio.params);
  const baixa = resumoBaixa(r, apoio.rolos);
  const faltas = baixa.filter((b) => b.falta);
  const tarefas = r.itens.reduce((s, it) => s + it.impressoes.reduce((t, imp) => t + imp.vezes * imp.placas.length, 0), 0);
  const ok = await dialogo({
    titulo: 'Aprovar orçamento?',
    conteudo: h('div', {},
      h('p', {}, `${r.cliente} · `, h('strong', { class: 'num' }, brl(calc.total))),
      h('p', {}, `Vão para a Semana ${tarefas} impressão(ões). Sai do estoque agora:`),
      baixa.map((b) => h('div', { class: 'linha-dado' }, h('span', {}, corBolinha(b.cor, b.nome), ' ', b.nome),
        h('span', { class: 'v' }, `− ${gramas(b.gramas)}`, h('br'), h('small', { class: b.falta ? 'msg-erro' : 'meta' }, b.falta ? gramas(b.depois) : `fica ${gramas(b.depois)}`)))),
      faltas.length ? h('p', { class: 'aviso erro' }, 'Vai faltar filamento. Dá para aprovar, mas compre/troque o rolo antes de imprimir.') : null),
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Aprovar', valor: true, primario: true }],
  });
  if (!ok) return;
  const x = await ctx.db.rpc('aprovar_orcamento', { p_id: r.id, p_total_esperado: calc.total });
  if (x.erro) {
    // resposta perdida? confere no banco antes de deixar tentar de novo
    const s = await ctx.db.listar('orcamentos', (q) => q.select('status').eq('id', r.id).maybeSingle());
    if (s.dados?.status === 'aprovado') { avisar('Aprovado ✓'); ctx.atualizar(); return; }
    avisar(x.erro, 'erro');
    if (/mudou/.test(x.erro)) ctx.atualizar();
    return;
  }
  apagarLocal(r.id);
  avisar(`Aprovado ✓ ${tarefas} impressão(ões) na Semana`);
  ctx.atualizar();
}

async function recusar(est) {
  const { r, ctx } = est;
  if (!(await confirmar('Cliente recusou?', 'O orçamento fica guardado no histórico como recusado.', 'Marcar recusado'))) return;
  const x = await ctx.db.rpc('marcar_orcamento', { p_id: r.id, p_status: 'recusado' });
  if (x.erro) return avisar(x.erro, 'erro');
  apagarLocal(r.id); avisar('Marcado como recusado'); ctx.atualizar();
}

// ---------------------------------------------------------------- só leitura
function visualizar(est) {
  const { r, apoio, ctx, tela } = est;
  const calc = calcularRascunho(r, apoio.rolos, apoio.params);
  tela.classList.add('leitura');
  tela.append(h('div', { class: 'card' },
    h('div', { class: 'linha-dado' }, h('span', {}, 'Cliente'), h('span', {}, r.cliente)),
    r.contato ? h('div', { class: 'linha-dado' }, h('span', {}, 'Contato'), h('span', {}, r.contato)) : null,
    h('div', { class: 'linha-dado' }, h('span', {}, 'Canal'), h('span', {}, CANAIS[r.canal] || r.canal))));
  tela.append(h('p', { class: 'secao' }, 'Itens'), h('div', { class: 'card' }, r.itens.map((it, i) =>
    h('div', { class: 'linha-dado' }, h('span', {}, `${it.qtd}× ${it.descricao}`), h('span', { class: 'v' }, brl(calc.itens[i].precoUnit * it.qtd)))),
  calc.frete > 0 ? h('div', { class: 'linha-dado' }, h('span', {}, 'Frete'), h('span', { class: 'v' }, calc.freteCliente ? brl(calc.frete) : 'grátis')) : null,
  h('div', { class: 'linha-dado total' }, h('span', {}, 'Total'), h('span', { class: 'v' }, brl(r.totalAceito ?? calc.total)))));
  const acoes = h('div', { class: 'acoes' }, botao('PDF de novo', () => pdf(est), 'btn'));
  if (r.status === 'aprovado') {
    acoes.append(h('a', { class: 'btn', href: '#semana' }, 'Ver na Semana'), h('a', { class: 'btn', href: '#vendas' }, 'Ver vendas'));
    if (ctx.perfil.papel === 'marcos') acoes.append(botao('Cancelar orçamento', async () => {
      if (!(await confirmar('Cancelar orçamento aprovado?', 'As impressões que ainda estão na fila saem da Semana e as gramas delas voltam para o estoque. O que já foi impresso fica gasto. As vendas ficam marcadas como canceladas.', 'Cancelar orçamento'))) return;
      const x = await ctx.db.rpc('cancelar_orcamento', { p_id: r.id });
      if (x.erro) return avisar(x.erro, 'erro');
      avisar('Orçamento cancelado'); ctx.atualizar();
    }, 'btn btn-perigo'));
  }
  tela.append(acoes);
}
