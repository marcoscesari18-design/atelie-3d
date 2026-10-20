// Gera .3mf sintéticos em memória, com a mesma estrutura do Bambu Studio
// (Metadata/slice_info.config + plate_N.png). Os arquivos reais ficam em
// tests/fixtures-locais/ (fora do repo).
import JSZip from 'jszip';

const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function placaXml({ indice, segundos, gramas, filamentos }) {
  const meta = [
    `<metadata key="index" value="${indice}"/>`,
    segundos !== undefined ? `<metadata key="prediction" value="${segundos}"/>` : '',
    gramas !== undefined ? `<metadata key="weight" value="${gramas}"/>` : '',
  ].join('');
  const fils = filamentos.map((f) =>
    `<filament id="${f.slot}" tray_info_idx="GFA00" type="${f.tipo}" color="${f.cor}" used_m="1" used_g="${f.gramas}" />`).join('');
  return `<plate>${meta}<object identify_id="1" name="peca.stl" skipped="false" />${fils}</plate>`;
}

export async function gerar3mf({ versao = '02.00.00.98', placas = [], comFoto = true } = {}) {
  const zip = new JSZip();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><config><header>`
    + `<header_item key="X-BBL-Client-Type" value="slicer"/>`
    + `<header_item key="X-BBL-Client-Version" value="${versao}"/></header>`
    + placas.map(placaXml).join('') + `</config>`;
  zip.file('Metadata/slice_info.config', xml);
  zip.file('3D/3dmodel.model', '<model/>');
  if (comFoto) placas.forEach((p) => zip.file(`Metadata/plate_${p.indice}.png`, PNG_1PX));
  return zip.generateAsync({ type: 'arraybuffer' });
}

export const UMA_PLACA = {
  placas: [{ indice: 1, segundos: 3600, gramas: 20.5, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 20.5 }] }],
};
export const DUAS_PLACAS = {
  placas: [
    { indice: 1, segundos: 3600, gramas: 20.5, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 20.5 }] },
    { indice: 2, segundos: 600, gramas: 2.25, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 2.25 }] },
  ],
};
export const MULTICOR = {
  placas: [{ indice: 1, segundos: 2340, gramas: 11.69, filamentos: [
    { slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 6 },
    { slot: 2, tipo: 'PLA', cor: '#0085D5', gramas: 5.69 },
  ] }],
};
export const MULTICOR_NAO_BATE = {
  placas: [{ indice: 1, segundos: 2340, gramas: 15, filamentos: [
    { slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 6 },
    { slot: 2, tipo: 'PLA', cor: '#0085D5', gramas: 5.69 },
  ] }],
};
export const SEM_PREDICTION = {
  placas: [{ indice: 1, gramas: 20.5, filamentos: [{ slot: 1, tipo: 'PLA', cor: '#FF6910', gramas: 20.5 }] }],
};
export const SEM_PLACA = { placas: [] };
