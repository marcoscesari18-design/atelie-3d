// Lógica do orçamento (sem tela): montar a partir do .3mf, calcular, validar,
// resumir a baixa de estoque e converter de/para as linhas do banco.
import { calcularItem, calcularOrcamento, arredondar } from './calc.js';
import { sugerirRolo } from './cores.js';

const r2 = (v) => Math.round(v * 100) / 100;
const porId = (rolos) => new Map(rolos.map((r) => [r.id, r]));

// Uma "impressão" = placas escolhidas de um .3mf, impressas `vezes` vezes, rendendo `unidadesPorVez`.
export function impressaoDe3mf(leitura, { arquivo, placas, rolos }) {
  return {
    arquivo,
    vezes: 1,
    unidadesPorVez: 1,
    placas: leitura.placas.filter((p) => placas.includes(p.indice)).map((p) => ({
      placa: p.indice,
      segundos: p.segundos,
      gramas: p.gramas,
      foto: p.foto || null,
      cores: p.filamentos.map((f) => ({ slot: f.slot, tipo: f.tipo, cor: f.cor, gramas: f.gramas,
        filamentoId: sugerirRolo(f.cor, f.tipo, rolos).rolo?.id ?? null })),
    })),
  };
}

function itemParaCalculo(item, mapa) {
  return {
    impressoes: item.impressoes.map((imp) => ({
      vezes: Number(imp.vezes), unidadesPorVez: Number(imp.unidadesPorVez),
      placas: imp.placas.map((p) => ({ segundos: p.segundos,
        cores: p.cores.map((c) => ({ gramas: c.gramas, custoKg: Number(mapa.get(c.filamentoId)?.custo_kg) || 0 })) })),
    })),
    qtd: Number(item.qtd), extras: Number(item.extras) || 0,
  };
}

// → { itens: [{ custoItem, custoUnit, precoSugerido, precoUnit, unidades, faltam, sobra }], subtotal, total, linhas, custo, lucro }
export function calcularRascunho(r, rolos, params) {
  const mapa = porId(rolos);
  const itens = r.itens.map((item) => {
    const base = itemParaCalculo(item, mapa);
    const unidades = base.impressoes.reduce((s, i) => s + i.vezes * i.unidadesPorVez, 0);
    if (unidades > base.qtd || base.impressoes.length === 0) {
      return { custoItem: 0, custoUnit: 0, precoSugerido: 0, precoUnit: Number(item.precoUnit) || 0, unidades, faltam: base.qtd - unidades, sobra: unidades > base.qtd };
    }
    const c = calcularItem({ ...base, params });
    const precoUnit = item.precoUnit != null && item.precoUnit !== '' ? Number(item.precoUnit) : c.arredondadoUnit;
    return { custoItem: c.custoItem, custoUnit: c.custoUnit, precoSugerido: c.arredondadoUnit, precoUnit, unidades, faltam: c.faltam, sobra: false };
  });
  const desconto = r.itens.length > 1 ? Number(r.descontoPct) || 0 : 0;
  const o = calcularOrcamento({ itens: itens.map((c, i) => ({ precoUnit: c.precoUnit, qtd: Number(r.itens[i].qtd) })), descontoPct: desconto });
  const custo = r2(itens.reduce((s, c) => s + c.custoItem, 0));
  return { itens, subtotal: o.subtotal, total: o.total, linhas: o.linhas, custo, lucro: r2(o.total - custo), desconto };
}

// Lista de frases do que impede salvar/aprovar. Vazia = pode seguir.
export function problemas(r, rolos, params) {
  const p = [];
  if (!String(r.cliente || '').trim()) p.push('Falta o nome do cliente.');
  if (!r.itens.length) p.push('Inclua pelo menos um item.');
  const desc = Number(r.descontoPct) || 0;
  if (desc < 0 || desc >= 100) p.push('Desconto precisa ser entre 0 e 99%.');
  const c = calcularRascunho(r, rolos, params);
  r.itens.forEach((item, i) => {
    const nome = item.descricao?.trim() || `Item ${i + 1}`;
    if (!item.descricao?.trim()) p.push(`Item ${i + 1}: dê um nome.`);
    if (!(Number(item.qtd) > 0)) p.push(`${nome}: quantidade inválida.`);
    if (!item.impressoes.length) p.push(`${nome}: suba o .3mf.`);
    else if (c.itens[i].sobra) p.push(`${nome}: as impressões fazem ${c.itens[i].unidades}, mais que ${item.qtd}. Diminua as vezes.`);
    else if (c.itens[i].faltam > 0) p.push(`${nome}: faltam ${c.itens[i].faltam} — suba o .3mf com ${c.itens[i].faltam} peça(s) ou aumente as vezes.`);
    if (item.impressoes.some((imp) => imp.placas.some((pl) => pl.cores.some((cor) => !cor.filamentoId)))) p.push(`${nome}: escolha o rolo de cada cor.`);
    if (!(c.itens[i].precoUnit >= 0)) p.push(`${nome}: preço inválido.`);
  });
  return p;
}

// Quanto sai de cada rolo se aprovar agora. → [{ filamentoId, nome, cor, gramas, antes, depois, falta }]
export function resumoBaixa(r, rolos) {
  const mapa = porId(rolos);
  const soma = new Map();
  for (const item of r.itens) for (const imp of item.impressoes) for (const pl of imp.placas) for (const c of pl.cores) {
    if (!c.filamentoId) continue;
    soma.set(c.filamentoId, (soma.get(c.filamentoId) || 0) + c.gramas * Number(imp.vezes));
  }
  return [...soma].map(([id, g]) => {
    const rolo = mapa.get(id) || {};
    const antes = Number(rolo.gramas_restantes) || 0;
    const gramas = r2(g);
    return { filamentoId: id, nome: rolo.cor_nome || '?', cor: rolo.cor_hex || '#888888', gramas, antes, depois: r2(antes - gramas), falta: antes - gramas < 0 };
  });
}

// Converte o rascunho nas linhas que vão para as tabelas do orçamento.
export function linhasParaBanco(r, calculo) {
  return {
    orcamento: { cliente: r.cliente.trim(), contato: r.contato?.trim() || null, canal: r.canal, linha: r.linha,
      desconto_pct: calculo.desconto, obs: r.obs?.trim() || null },
    total: calculo.total,
    itens: r.itens.map((item, i) => ({
      descricao: item.descricao.trim(), qtd: Number(item.qtd), extras: Number(item.extras) || 0,
      custo_total: r2(calculo.itens[i].custoItem), preco_total: calculo.linhas[i].precoTotal,
      foto_path: item.fotoPath || null,
      impressoes: item.impressoes.map((imp) => ({
        arquivo_nome: imp.arquivo || null, vezes: Number(imp.vezes), unidades_por_vez: Number(imp.unidadesPorVez),
        placas: imp.placas.map((pl) => {
          const junta = new Map();
          for (const c of pl.cores) junta.set(c.filamentoId, r2((junta.get(c.filamentoId) || 0) + c.gramas));
          return { placa: pl.placa, segundos: pl.segundos, gramas: pl.gramas,
            filamentos: [...junta].map(([filamento_id, gramas]) => ({ filamento_id, gramas })) };
        }),
      })),
    })),
  };
}

// Inverso: orçamento lido do banco (com filhos aninhados) → rascunho editável.
export function rascunhoDoBanco(o, rolos) {
  const mapa = porId(rolos);
  const d = Number(o.desconto_pct) || 0;
  const itens = o.orcamento_itens || [];
  return {
    id: o.id, numero: o.numero, status: o.status, cliente: o.cliente, contato: o.contato || '', canal: o.canal, linha: o.linha,
    descontoPct: d, obs: o.obs || '', totalAceito: o.total_aceito, validade: o.validade, createdAt: o.created_at,
    itens: itens.map((it) => ({
      id: it.id, descricao: it.descricao, qtd: it.qtd, extras: Number(it.extras) || 0, fotoPath: it.foto_path,
      precoUnit: r2(Number(it.preco_total) / (itens.length > 1 ? 1 - d / 100 : 1) / it.qtd),
      impressoes: (it.orcamento_impressoes || []).map((m) => ({
        arquivo: m.arquivo_nome, vezes: m.vezes, unidadesPorVez: m.unidades_por_vez,
        placas: (m.orcamento_item_placas || []).sort((a, b) => a.placa - b.placa).map((p) => ({
          placa: p.placa, segundos: p.segundos, gramas: Number(p.gramas),
          cores: (p.orcamento_placa_filamentos || []).map((f) => ({ filamentoId: f.filamento_id, gramas: Number(f.gramas),
            tipo: mapa.get(f.filamento_id)?.tipo || '', cor: mapa.get(f.filamento_id)?.cor_hex || '#888888' })),
        })),
      })),
    })),
  };
}

export { arredondar };
