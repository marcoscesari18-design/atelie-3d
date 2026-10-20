// Lê o .3mf salvo pelo Bambu Studio depois de fatiar: tempo, gramas e cores
// de cada placa (Metadata/slice_info.config) e a foto da placa.
// JSZip e DOMParser são injetados (CDN no navegador, pacotes no teste).

const MENSAGENS = {
  sem_fatiar: 'Esse arquivo foi salvo sem fatiar. No Bambu Studio clique em "Fatiar placa" e salve de novo.',
  invalido: 'Não consegui ler esse arquivo. Ele precisa ser o .3mf salvo pelo Bambu Studio.',
  nao_bate: 'Os números do arquivo não batem (gramas por cor ≠ peso total). Fatie de novo e salve.',
};

export class Erro3mf extends Error {
  constructor(codigo) {
    super(MENSAGENS[codigo]);
    this.codigo = codigo;
  }
}

const TOLERANCIA_G = 0.5;

function meta(placa, chave) {
  for (const m of Array.from(placa.getElementsByTagName('metadata'))) {
    if (m.getAttribute('key') === chave) return m.getAttribute('value');
  }
  return null;
}

export async function ler3mf(arrayBuffer, { JSZip, DOMParser }) {
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch { throw new Erro3mf('invalido'); }
  const info = zip.file('Metadata/slice_info.config');
  if (!info) throw new Erro3mf('invalido');

  const doc = new DOMParser().parseFromString(await info.async('string'), 'text/xml');
  let versao = null;
  for (const h of Array.from(doc.getElementsByTagName('header_item'))) {
    if (h.getAttribute('key') === 'X-BBL-Client-Version') versao = h.getAttribute('value');
  }

  const elPlacas = Array.from(doc.getElementsByTagName('plate'));
  if (elPlacas.length === 0) throw new Erro3mf('sem_fatiar');

  const placas = [];
  for (const el of elPlacas) {
    const segundos = Number(meta(el, 'prediction'));
    const gramas = Number(meta(el, 'weight'));
    if (!(segundos > 0) || !(gramas > 0)) throw new Erro3mf('sem_fatiar');
    const indice = Number(meta(el, 'index'));
    const todos = Array.from(el.getElementsByTagName('filament')).map((f) => ({
      slot: Number(f.getAttribute('id')),
      tipo: f.getAttribute('type'),
      cor: (f.getAttribute('color') || '').toUpperCase(),
      gramas: Number(f.getAttribute('used_g')),
    }));
    if (todos.some((f) => !Number.isFinite(f.gramas) || f.gramas < 0)) throw new Erro3mf('nao_bate');
    const filamentos = todos.filter((f) => f.gramas > 0); // slot carregado no AMS mas não usado: 0 g
    const soma = filamentos.reduce((s, f) => s + f.gramas, 0);
    if (filamentos.length === 0 || Math.abs(soma - gramas) > TOLERANCIA_G) throw new Erro3mf('nao_bate');

    const png = zip.file(`Metadata/plate_${indice}.png`);
    const foto = png ? new Blob([await png.async('uint8array')], { type: 'image/png' }) : null;
    placas.push({ indice, segundos, gramas, foto, filamentos });
  }
  return { versao, placas };
}
