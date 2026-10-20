// Casca do app: login, perfil e abas no rodapé. Cada aba é um módulo em js/telas/.
import * as db from './db.js';
import { h, limpar, avisar, carregando, erroTela, campo, botao } from './ui.js';
import { AMBIENTE } from './config.js';

const ABAS = [
  { id: 'orcamentos', rotulo: 'Orçamentos', icone: '🧾' },
  { id: 'semana',     rotulo: 'Semana',     icone: '📅' },
  { id: 'filamentos', rotulo: 'Filamentos', icone: '🎨' },
  { id: 'vendas',     rotulo: 'Vendas',     icone: '💰' },
  { id: 'ajustes',    rotulo: 'Ajustes',    icone: '⚙️', soMarcos: true },
];

const raiz = document.getElementById('app');
let ctx = null;          // { db, perfil, ir }
let renderizando = 0;

function abasDoPerfil(perfil) { return ABAS.filter((a) => !a.soMarcos || perfil.papel === 'marcos'); }

function telaLogin(mensagem = '') {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const erro = h('p', { class: 'msg-erro', role: 'alert' }, mensagem);
  const form = h('form', { class: 'login', novalidate: true },
    h('h1', {}, 'Ateliê 3D'),
    h('p', { class: 'sub' }, 'Orçamento, estoque e vendas do laboratório.'),
    campo('E-mail', email), campo('Senha', senha), erro,
    h('button', { class: 'btn btn-primario btn-largo', type: 'submit' }, 'Entrar'),
    AMBIENTE !== 'produção' ? h('p', { class: 'ambiente' }, `Ambiente: ${AMBIENTE}`) : null);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]');
    b.disabled = true; erro.textContent = '';
    const r = await db.entrar(email.value, senha.value);
    b.disabled = false;
    if (r.erro) { erro.textContent = r.erro; senha.select(); return; }
    iniciar();
  });
  limpar(raiz).append(form);
  email.focus();
}

function semAcesso() {
  limpar(raiz).append(h('div', { class: 'login' },
    h('h1', {}, 'Sem acesso'),
    h('p', {}, 'Esse login existe, mas não foi liberado no Ateliê. Peça ao Marcos para incluir você.'),
    botao('Sair', async () => { await db.sair(); telaLogin(); }, 'btn')));
}

function abaAtual() {
  const id = location.hash.replace('#', '').split('/')[0];
  const abas = abasDoPerfil(ctx.perfil);
  return abas.find((a) => a.id === id) || abas[0];
}

function montarCasca() {
  const conteudo = h('main', { id: 'conteudo', class: 'conteudo', tabindex: '-1' });
  const nav = h('nav', { class: 'abas', 'aria-label': 'Seções' },
    abasDoPerfil(ctx.perfil).map((a) => h('a', { href: `#${a.id}`, 'data-aba': a.id },
      h('span', { class: 'aba-icone', 'aria-hidden': 'true' }, a.icone), h('span', {}, a.rotulo))));
  const topo = h('header', { class: 'topo' },
    h('span', { class: 'marca' }, 'Ateliê 3D'),
    h('span', { class: 'quem' }, ctx.perfil.nome,
      h('button', { class: 'btn-link', type: 'button', onclick: async () => { await db.sair(); } }, 'sair')));
  limpar(raiz).append(topo, conteudo, nav);
}

async function renderizar() {
  if (!ctx) return;
  const aba = abaAtual();
  document.querySelectorAll('.abas a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.aba === aba.id));
  document.title = `${aba.rotulo} · Ateliê 3D`;
  const area = document.getElementById('conteudo');
  const minha = ++renderizando;
  limpar(area).append(carregando());
  try {
    const modulo = await import(`./telas/${aba.id}.js`);
    if (minha !== renderizando) return;
    const tela = h('section', { class: 'tela' });
    await modulo.render(tela, ctx);
    if (minha !== renderizando) return;
    limpar(area).append(tela);
  } catch (e) {
    console.error(e);
    if (minha === renderizando) limpar(area).append(erroTela('Não consegui abrir essa tela.', renderizar));
  }
}

async function iniciar() {
  const u = await db.usuario();
  if (!u) return telaLogin();
  limpar(raiz).append(carregando(2));
  const p = await db.perfil();
  if (p.erro) { limpar(raiz).append(erroTela(p.erro, iniciar)); return; }
  if (!p.dados) return semAcesso();
  ctx = { db, perfil: p.dados, ir: (hash) => { if (location.hash === `#${hash}`) renderizar(); else location.hash = hash; }, atualizar: () => renderizar() };
  montarCasca();
  renderizar();
}

window.addEventListener('hashchange', renderizar);
db.aoMudarSessao((evento) => {
  if (evento === 'SIGNED_OUT') { ctx = null; telaLogin('Você saiu. Entre de novo para continuar.'); }
});
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); avisar('Algo deu errado. Tente de novo.', 'erro'); });
iniciar();
