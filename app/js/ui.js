// Componentes mínimos de tela, sem framework.

// h('button', { class: 'btn', onclick }, 'Texto', filho, ...)
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export function limpar(el) { el.replaceChildren(); return el; }

let toastTimer;
export function avisar(texto, tipo = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.className = `toast ${tipo} visivel`;
  t.textContent = texto;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visivel'), tipo === 'erro' ? 6000 : 2600);
}

// Abre um <dialog> com conteúdo e botões; resolve com o valor do botão clicado (ou null).
export function dialogo({ titulo, conteudo, botoes = [{ texto: 'OK', valor: true, primario: true }] }) {
  return new Promise((resolver) => {
    const d = h('dialog', { class: 'dialogo' },
      h('h2', {}, titulo),
      conteudo ? h('div', { class: 'dialogo-corpo' }, conteudo) : null,
      h('div', { class: 'dialogo-acoes' }, botoes.map((b) =>
        h('button', { class: `btn ${b.primario ? 'btn-primario' : ''} ${b.perigo ? 'btn-perigo' : ''}`, type: 'button',
          onclick: () => { d.close(); resolver(typeof b.valor === 'function' ? b.valor(d) : b.valor); } }, b.texto))));
    d.addEventListener('cancel', () => resolver(null));
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    document.body.append(d);
    d.showModal();
  });
}

export const confirmar = (titulo, texto, sim = 'Confirmar') =>
  dialogo({ titulo, conteudo: texto, botoes: [{ texto: 'Voltar', valor: false }, { texto: sim, valor: true, primario: true }] });

export function vazio(texto, acao) {
  return h('div', { class: 'vazio' }, h('p', {}, texto), acao || null);
}

export function carregando(linhas = 3) {
  return h('div', { class: 'carregando', 'aria-busy': 'true', 'aria-label': 'Carregando' },
    Array.from({ length: linhas }, () => h('div', { class: 'skeleton' })));
}

export function erroTela(texto, tentar) {
  return h('div', { class: 'erro-tela', role: 'alert' }, h('p', {}, texto),
    tentar ? h('button', { class: 'btn', onclick: tentar }, 'Tentar de novo') : null);
}

export function campo(rotulo, input, dica) {
  const id = input.id || `c-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'campo' }, h('label', { for: id }, rotulo), input, dica ? h('small', {}, dica) : null);
}

// Botão que desabilita enquanto a ação roda (evita toque duplo)
export function botao(texto, acao, classe = 'btn') {
  const b = h('button', { class: classe, type: 'button' }, texto);
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    try { await acao(b); } finally { b.disabled = false; b.removeAttribute('aria-busy'); }
  });
  return b;
}

export const corBolinha = (hex, titulo) => h('span', { class: 'bolinha', style: { background: hex }, title: titulo, 'aria-label': titulo });
