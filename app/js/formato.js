// Formatação para a tela (pt-BR).

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (casas) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });

export const brl = (v) => fmtBRL.format(Number(v) || 0);

export function gramas(g) {
  const n = Number(g) || 0;
  return n < 0 ? `faltam ${fmtNum(2).format(-n)} g` : `${fmtNum(2).format(n)} g`;
}

export function duracao(segundos) {
  const min = Math.round((Number(segundos) || 0) / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export const numeroOrc = (n) => `ORC-${String(n).padStart(4, '0')}`;

// Segunda-feira (data local) da semana de `data`, em AAAA-MM-DD — igual ao date_trunc('week') do banco.
export function segundaDaSemana(data = new Date()) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Data local (do aparelho) em AAAA-MM-DD, com dias a somar. Não usar toISOString(): ele converte para UTC.
export function hojeISO(base = new Date(), somarDias = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + somarDias);
  return iso(d);
}
// Dia (AAAA-MM-DD) em Brasília de um horário do banco (que vem em UTC).
const fmtBrasilia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dataBrasilia = (horario) => fmtBrasilia.format(new Date(horario));
export const inicioDoMesISO = (base = new Date()) => iso(new Date(base.getFullYear(), base.getMonth(), 1));
