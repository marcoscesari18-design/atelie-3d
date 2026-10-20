// Sugere qual rolo cadastrado corresponde a uma cor do .3mf.
// Só sugere: o Pedro sempre confirma (D7-1).

function hexParaLab(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  // sRGB → XYZ (D65), normalizado pelo branco de referência
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// CIE76: distância euclidiana em Lab.
export function distanciaCor(hexA, hexB) {
  const a = hexParaLab(hexA), b = hexParaLab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function sugerirRolo(corHex, tipo, rolos) {
  const candidatos = rolos.filter((r) => r.ativo && r.tipo.toUpperCase() === tipo.toUpperCase());
  if (candidatos.length === 0) return { rolo: null, motivo: 'sem_rolo_do_tipo' };
  let melhor = candidatos[0], menor = Infinity;
  for (const r of candidatos) {
    const d = distanciaCor(corHex, r.cor_hex);
    if (d < menor) { menor = d; melhor = r; }
  }
  return { rolo: melhor, motivo: 'cor_proxima' };
}
