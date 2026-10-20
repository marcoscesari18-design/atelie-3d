// Cor do rolo pela foto: tira a foto, toca em cima do fio, o app lê a cor ali.
// A foto não é guardada — só a cor (#RRGGBB) volta para quem chamou.
import { h, dialogo } from './ui.js';

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Cor de um quadradinho em volta de (x, y) numa imagem RGBA. Mediana por canal, ignorando
// reflexo (pixel quase branco) quando há pixels de sobra: o brilho do plástico não muda a cor.
export function corDaAmostra(dados, largura, altura, x, y, raio) {
  const px = [];
  for (let j = Math.max(0, y - raio); j <= Math.min(altura - 1, y + raio); j++) {
    for (let i = Math.max(0, x - raio); i <= Math.min(largura - 1, x + raio); i++) {
      const k = (j * largura + i) * 4;
      px.push([dados[k], dados[k + 1], dados[k + 2]]);
    }
  }
  const semReflexo = px.filter(([r, g, b]) => Math.min(r, g, b) < 235);
  const usar = semReflexo.length >= px.length / 3 ? semReflexo : px;
  return `#${hex2(mediana(usar.map((p) => p[0])))}${hex2(mediana(usar.map((p) => p[1])))}${hex2(mediana(usar.map((p) => p[2])))}`;
}

// Abre a câmera (celular) ou a escolha de arquivo (Mac). Chamar direto do toque no botão.
function escolherFoto() {
  return new Promise((resolver) => {
    const entrada = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto' });
    entrada.addEventListener('change', () => { resolver(entrada.files[0] || null); entrada.remove(); });
    entrada.addEventListener('cancel', () => { resolver(null); entrada.remove(); });
    document.body.append(entrada);
    entrada.click();
  });
}

// → '#RRGGBB' escolhida, ou null se desistiu. `atual` = cor que o rolo tem hoje (para comparar).
export async function pegarCorPorFoto(atual) {
  const arquivo = await escolherFoto();
  if (!arquivo) return null;
  const img = await abrirImagem(arquivo);
  if (!img) { await dialogo({ titulo: 'Não consegui abrir a foto', conteudo: 'Tente de novo, com a câmera ou outra imagem (JPG ou PNG).' }); return null; }
  const largura = img.naturalWidth || img.width, altura = img.naturalHeight || img.height;   // <img> ou ImageBitmap
  const escala = Math.min(1, 1200 / Math.max(largura, altura));
  const tela = h('canvas', { class: 'foto-cor', width: Math.round(largura * escala), height: Math.round(altura * escala), tabindex: '0',
    role: 'img', 'aria-label': 'Foto do rolo. Toque em cima do fio para pegar a cor. No teclado, as setas movem o ponto.' });
  const g = tela.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, tela.width, tela.height);
  const pixels = g.getImageData(0, 0, tela.width, tela.height).data;
  const raio = Math.max(3, Math.round(Math.max(tela.width, tela.height) * 0.012));

  const nova = h('span', { class: 'bolinha grande-bolinha vazia' });
  const novaTxt = h('span', { class: 'num', 'aria-live': 'polite' }, 'toque no fio');
  let escolhida = null;
  let px = Math.round(tela.width / 2), py = Math.round(tela.height / 2);
  let usar = null;   // botão "Usar esta cor": desligado até escolher um ponto
  const marcar = (x, y) => {
    px = x; py = y; nova.classList.remove('vazia'); if (usar) usar.disabled = false;
    escolhida = corDaAmostra(pixels, tela.width, tela.height, x, y, raio);
    nova.style.background = escolhida; novaTxt.textContent = escolhida;
    g.drawImage(img, 0, 0, tela.width, tela.height);
    g.lineWidth = Math.max(2, raio / 2); g.strokeStyle = '#ffffff';
    g.beginPath(); g.arc(x, y, raio * 2.2, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#000000'; g.lineWidth = Math.max(1, raio / 4);
    g.beginPath(); g.arc(x, y, raio * 2.2 + g.lineWidth * 2, 0, Math.PI * 2); g.stroke();
  };
  tela.addEventListener('pointerdown', (e) => {
    const r = tela.getBoundingClientRect();
    marcar(Math.round((e.clientX - r.left) / r.width * tela.width), Math.round((e.clientY - r.top) / r.height * tela.height));
  });
  // teclado: setas andam 2% da foto e já leem a cor (o primeiro aperto marca o centro)
  tela.addEventListener('keydown', (e) => {
    const passo = Math.max(4, Math.round(Math.max(tela.width, tela.height) * 0.02));
    const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (!d && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const [dx, dy] = escolhida ? (d || [0, 0]) : [0, 0];
    marcar(Math.min(tela.width - 1, Math.max(0, px + dx)), Math.min(tela.height - 1, Math.max(0, py + dy)));
  });

  const escolha = dialogo({
    titulo: 'Toque em cima do fio',
    conteudo: h('div', {},
      h('p', { class: 'meta', style: { margin: '0 0 10px' } }, 'Fuja do brilho e da sombra. A foto não é guardada, só a cor.'),
      tela,
      h('div', { class: 'cores-comparar' },
        h('span', {}, h('span', { class: 'bolinha grande-bolinha', style: { background: atual } }), h('span', {}, 'Agora')),
        h('span', { 'aria-hidden': 'true' }, '→'),
        h('span', {}, nova, h('span', {}, 'Da foto '), novaTxt))),
    botoes: [{ texto: 'Voltar', valor: null }, { texto: 'Usar esta cor', primario: true, valor: () => escolhida }],
  });
  const abertos = document.querySelectorAll('dialog[open]');
  usar = abertos[abertos.length - 1]?.querySelector('.btn-primario') || null;
  if (usar && !escolhida) usar.disabled = true;
  return escolha;
}

// Abre a foto já girada como o celular tirou. Safari antigo não aceita imageOrientation: cai para <img>,
// que também respeita a orientação da foto.
async function abrirImagem(arquivo) {
  try { return await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); } catch { /* tenta o próximo */ }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise((ok, falhou) => { img.onload = ok; img.onerror = falhou; img.src = url; });
    return img;
  } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
