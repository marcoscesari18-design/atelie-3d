// Casca do app: login, perfil e abas no rodapé. Cada aba é um módulo em js/telas/.
import * as db from './db.js';
import { h, limpar, avisar, carregando, erroTela, campo, botao } from './ui.js';
import { AMBIENTE } from './config.js';

// Ícones de traço (24×24), desenhados para o app: folha de orçamento, calendário, carretel, moedas, controles.
const ICONES = {
  orcamentos: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  semana: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h2M12 14h2',
  filamentos: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  vendas: 'M4 7h16v11H4zM4 11h16M8 15h3',
  ajustes: 'M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M8 16v4',
};
const ABAS = [
  { id: 'orcamentos', rotulo: 'Orçamentos' },
  { id: 'semana',     rotulo: 'Semana' },
  { id: 'filamentos', rotulo: 'Filamentos' },
  { id: 'vendas',     rotulo: 'Vendas' },
  { id: 'ajustes',    rotulo: 'Ajustes', soMarcos: true },
];
const SVG = 'http://www.w3.org/2000/svg';
function icone(id) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'aba-icone'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', ICONES[id]);
  s.append(p);
  return s;
}
// Marca: um carretel visto de frente (o mesmo do ícone do app).
const marca = () => h('span', { class: 'marca' }, h('span', { class: 'marca-carretel', 'aria-hidden': 'true' }), 'Ateliê 3D');

const raiz = document.getElementById('app');
let ctx = null;          // { db, perfil, ir }
let renderizando = 0;

function abasDoPerfil(perfil) { return ABAS.filter((a) => !a.soMarcos || perfil.papel === 'marcos'); }

function telaLogin(mensagem = '') {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const erro = h('p', { class: 'msg-erro', role: 'alert' }, mensagem);
  const form = h('form', { class: 'login', novalidate: true },
    h('span', { class: 'marca-carretel login-carretel', 'aria-hidden': 'true' }),
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
    abasDoPerfil(ctx.perfil).map((a) => h('a', { href: `#${a.id}`, 'data-aba': a.id }, icone(a.id), h('span', {}, a.rotulo))));
  // nav dentro do header, entre a marca e o "Sair": a ordem do Tab é a mesma da barra lateral
  const topo = h('header', { class: 'topo' },
    marca(), nav,
    h('span', { class: 'quem' }, h('span', { class: 'quem-nome' }, ctx.perfil.nome),
      h('button', { class: 'btn-link', type: 'button', onclick: async () => { await db.sair(); } }, 'Sair')));
  // celular: barra de cima + abas fixas no rodapé; computador (≥1024 px): o header vira a barra lateral (só CSS)
  limpar(raiz).append(topo, conteudo);
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
  if (!db.configurado) {
    limpar(raiz).append(h('div', { class: 'login' }, h('h1', {}, 'Ateliê 3D'),
      h('p', {}, 'O app ainda está sendo ligado ao banco de dados. Volte daqui a pouco.')));
    return;
  }
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
