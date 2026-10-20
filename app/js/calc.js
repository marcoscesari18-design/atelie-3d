// Fórmula de custo e preço do Precifica3D (calc() da calculadora original),
// sem DOM. Únicas generalizações (spec §6): material somado por rolo (multicor)
// e item feito de várias impressões (cada uma com N placas, impressa N vezes).

const r2 = (v) => Math.round(v * 100) / 100;

// Arredonda pra cima ao próximo "número bonito", igual à original.
export function arredondar(preco) {
  if (preco <= 0) return 0;
  if (preco < 20) return Math.ceil(preco);
  if (preco < 100) return Math.ceil(preco / 5) * 5;
  return Math.ceil(preco / 10) * 10;
}

// Uma placa impressa uma vez. extras entra no subtotal antes da taxa de falha,
// como na original.
export function calcularPlaca({ cores, segundos, extras = 0, params }) {
  const { maoHora, maoMin, falha, tarifa, potencia, desgaste } = params;
  const tempoH = segundos / 3600;
  const cMat = cores.reduce((s, c) => s + (c.gramas / 1000) * c.custoKg, 0);
  const cEne = (potencia / 1000) * tempoH * tarifa;
  const cDes = desgaste * tempoH;
  const cMao = maoHora * (maoMin / 60);
  const cExt = extras;
  const subtotal = cMat + cEne + cDes + cMao + cExt;
  const cFal = subtotal * (falha / 100);
  return { cMat, cEne, cDes, cMao, cExt, cFal, subtotal, custo: subtotal + cFal };
}

// Item vendido: soma das impressões. Sem sobra (decisão P1: refatia o que falta).
export function calcularItem({ impressoes, qtd, extras = 0, params }) {
  const unidades = impressoes.reduce((s, imp) => s + imp.vezes * imp.unidadesPorVez, 0);
  if (unidades > qtd) throw new Error(`sobra: imprime ${unidades} para vender ${qtd}`);
  const subtotalPlacas = impressoes.reduce((s, imp) =>
    s + imp.vezes * imp.placas.reduce((t, p) => t + calcularPlaca({ cores: p.cores, segundos: p.segundos, params }).subtotal, 0), 0);
  const subtotal = subtotalPlacas + extras * qtd;
  const custoItem = subtotal * (1 + params.falha / 100);
  const custoUnit = custoItem / qtd;
  const precoUnit = custoUnit * (1 + params.margem / 100);
  return { unidades, faltam: qtd - unidades, custoItem, custoUnit, precoUnit, arredondadoUnit: arredondar(precoUnit) };
}

// Orçamento: desconto só com mais de um item (como o "modo kit"), 0 < d < 100.
// Centavos do arredondamento vão para o último item, para a soma bater com o total.
export function calcularOrcamento({ itens, descontoPct = 0 }) {
  if (descontoPct !== 0 && (descontoPct < 0 || descontoPct >= 100 || itens.length < 2)) {
    throw new Error('desconto inválido: só entre 0 e 100% e com mais de um item');
  }
  const brutos = itens.map((it) => it.precoUnit * it.qtd);
  const subtotal = r2(brutos.reduce((s, v) => s + v, 0));
  const total = r2(subtotal * (1 - descontoPct / 100));
  const linhas = brutos.map((b) => ({ precoTotal: r2(b * (1 - descontoPct / 100)) }));
  if (linhas.length === 0) return { subtotal, total, linhas };
  const somaCent = linhas.reduce((s, l) => s + Math.round(l.precoTotal * 100), 0);
  linhas[linhas.length - 1].precoTotal = r2(linhas[linhas.length - 1].precoTotal + (Math.round(total * 100) - somaCent) / 100);
  return { subtotal, total, linhas };
}
