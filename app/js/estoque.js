// Nível do rolo para a tela (briefing §4.1). Cor sempre acompanhada do rótulo.
export function estadoRolo(restantes, iniciais) {
  const r = Number(restantes) || 0;
  const base = Number(iniciais) > 0 ? Number(iniciais) : Math.max(r, 1);
  const pct = Math.max(0, Math.min(100, Math.round((r / base) * 100)));
  if (r < 0) return { nivel: 'erro', rotulo: 'Faltando', pct: 0 };
  if (r < 100) return { nivel: 'erro', rotulo: 'Acabando', pct };
  if (r <= 300) return { nivel: 'atencao', rotulo: 'Atenção', pct };
  return { nivel: 'ok', rotulo: 'Normal', pct };
}
