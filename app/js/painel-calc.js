// Contas do Painel (sem tela). Tudo sai do que o app já guarda: rolos, vendas, orçamentos e tarefas.
import { estadoRolo } from './estoque.js';
import { segundaDaSemana, dataBrasilia } from './formato.js';

const r2 = (v) => Math.round(v * 100) / 100;
const ativos = (rolos) => rolos.filter((f) => f.ativo);
// rolo "faltando" (negativo) não é dinheiro parado: conta zero
const reaisDo = (f) => (Math.max(0, Number(f.gramas_restantes) || 0) / 1000) * (Number(f.custo_kg) || 0);

export function valorEstoque(rolos) {
  const a = ativos(rolos);
  return {
    reais: r2(a.reduce((s, f) => s + reaisDo(f), 0)),
    gramas: r2(a.reduce((s, f) => s + Math.max(0, Number(f.gramas_restantes) || 0), 0)),
    rolos: a.length,
  };
}

// campo = 'marca' ou 'tipo' → [{ nome, reais }] do maior para o menor
export function porGrupo(rolos, campo) {
  const m = new Map();
  for (const f of ativos(rolos)) m.set(f[campo] || '—', (m.get(f[campo] || '—') || 0) + reaisDo(f));
  return [...m].map(([nome, reais]) => ({ nome, reais: r2(reais) })).sort((a, b) => b.reais - a.reais);
}

// "Atenção" (≤ 300 g) e "Acabando/Faltando" (< 100 g), do que tem menos para o que tem mais
export function rolosAcabando(rolos) {
  return ativos(rolos)
    .map((f) => ({ ...f, estado: estadoRolo(f.gramas_restantes, f.gramas_iniciais) }))
    .filter((f) => f.estado.nivel !== 'ok')
    .sort((a, b) => Number(a.gramas_restantes) - Number(b.gramas_restantes));
}

// Últimas n semanas (segunda a domingo), a última é a desta semana. → [{ semana, pedro, b2b }]
export function vendasPorSemana(vendas, hoje = new Date(), n = 8) {
  const atual = segundaDaSemana(hoje);
  const [a, m, d] = atual.split('-').map(Number);
  const semanas = Array.from({ length: n }, (_, i) => segundaDaSemana(new Date(a, m - 1, d - 7 * (n - 1 - i))));
  const linhas = new Map(semanas.map((s) => [s, { semana: s, pedro: 0, b2b: 0 }]));
  for (const v of vendas) {
    if (v.cancelada) continue;
    const [va, vm, vd] = String(v.data).split('-').map(Number);
    const l = linhas.get(segundaDaSemana(new Date(va, vm - 1, vd)));
    if (l) l[v.linha === 'b2b' ? 'b2b' : 'pedro'] = r2(l[v.linha === 'b2b' ? 'b2b' : 'pedro'] + Number(v.total || 0));
  }
  return [...linhas.values()];
}

// Enviado há `dias` ou mais (dias do calendário de Brasília) e ainda sem resposta → com quantos dias está parado
const diaNum = (iso) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d) / 864e5; };
export function orcamentosParados(orcs, agora = new Date(), dias = 3) {
  const hoje = diaNum(dataBrasilia(agora));
  return orcs
    .filter((o) => o.status === 'enviado' && o.enviado_em)
    .map((o) => ({ ...o, dias: hoje - diaNum(dataBrasilia(o.enviado_em)) }))
    .filter((o) => o.dias >= dias)
    .sort((a, b) => b.dias - a.dias);
}

// Situação da impressora: o que está pendente (de qualquer semana) e o que aconteceu nesta semana
export function impressora(tarefas, semana) {
  const pendentes = tarefas.filter((t) => t.status === 'fila' || t.status === 'imprimindo');
  const ordem = (t) => [t.status === 'imprimindo' ? 0 : 1, t.semana, Number(t.ordem) || 0];
  const proxima = [...pendentes].sort((x, y) => {
    const a = ordem(x), b = ordem(y);
    return a[0] - b[0] || String(a[1]).localeCompare(String(b[1])) || a[2] - b[2];
  })[0] || null;
  const destaSemana = tarefas.filter((t) => t.semana === semana);
  return {
    naFila: pendentes.length,
    feitas: destaSemana.filter((t) => t.status === 'ok').length,
    deuRuim: destaSemana.filter((t) => t.status === 'falhou').length,
    segundosFaltando: pendentes.reduce((s, t) => s + (Number(t.segundos_previsto) || 0), 0),
    atrasadas: pendentes.filter((t) => t.semana < semana).length,
    proxima,
  };
}
