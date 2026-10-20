// Cálculo reverso de preço para marketplace, copiado da calc() original:
// preço = (custo + lucro + taxa fixa + frete grátis) / (1 − comissão),
// escolhendo o cenário pela faixa em que o preço cai.
import { arredondar } from './calc.js';

function configCanal(canal, t) {
  if (canal === 'shopee') return { comm: t.mkShopComm / 100, fixaLimite: 8, fixa: t.mkShopFix, freteLimite: Infinity, frete: 0 };
  if (canal === 'ml') return { comm: t.mkMlComm / 100, fixaLimite: 79, fixa: t.mkMlFix, freteLimite: 79, frete: t.mkMlFrete };
  if (canal === 'mlp') return { comm: t.mkMlpComm / 100, fixaLimite: 79, fixa: t.mkMlFix, freteLimite: 79, frete: t.mkMlFrete };
  throw new Error(`canal desconhecido: ${canal}`);
}

// Venda direta (escola, WhatsApp, feira): sem comissão nem taxa. Anuncia pelo preço sugerido (custo + lucro).
// Frete: cliente paga → soma no que ele paga e não é lucro; frete grátis → o cliente paga só o preço e o frete sai do lucro.
export function precoDireto({ custoTotal, lucroAlvo, frete = 0, freteCliente = true }) {
  const preco = custoTotal + lucroAlvo;
  const f = Math.max(0, Number(frete) || 0);
  const clientePaga = preco + (freteCliente ? f : 0);
  const lucro = lucroAlvo - (freteCliente ? 0 : f);
  return { preco, arredondado: arredondar(preco), clientePaga, recebe: clientePaga, comissao: 0, frete: f, freteCliente, lucro,
    alerta: lucro < 0 ? 'prejuizo' : null };
}

export function precoMarketplace({ custoTotal, lucroAlvo, canal, taxas }) {
  const cfg = configCanal(canal, taxas);
  const precoCom = (fixa, frete) => {
    const divisor = 1 - cfg.comm;
    if (divisor <= 0) return 0;
    return (custoTotal + lucroAlvo + (fixa ? cfg.fixa : 0) + (frete ? cfg.frete : 0)) / divisor;
  };
  const pA = precoCom(true, false);
  const pB = precoCom(false, false);
  const pC = precoCom(false, true);
  let preco, fixaUsada, freteUsado;
  if (pA > 0 && pA < cfg.fixaLimite) { preco = pA; fixaUsada = true; freteUsado = false; }
  else if (pC >= cfg.freteLimite) { preco = pC; fixaUsada = false; freteUsado = true; }
  else { preco = pB; fixaUsada = false; freteUsado = false; }

  const comissao = preco * cfg.comm;
  const recebe = preco - comissao - (fixaUsada ? cfg.fixa : 0) - (freteUsado ? cfg.frete : 0);
  const lucro = recebe - custoTotal;
  const margemPct = custoTotal > 0 ? (lucro / custoTotal) * 100 : 0;

  let alerta = null;
  if (lucro < 0) alerta = 'prejuizo';
  else if (canal !== 'shopee' && preco >= 70 && preco < 79) alerta = 'zona_morta';
  else if (canal !== 'shopee' && preco >= 79 && preco < 110) alerta = 'frete_gratis';

  return { preco, arredondado: arredondar(preco), recebe, lucro, margemPct, comissao, fixaUsada, freteUsado, alerta };
}
