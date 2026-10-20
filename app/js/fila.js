// Regras da fila da semana (sem tela).
export function resumoFila(tarefas) {
  const pend = tarefas.filter((t) => t.status === 'fila' || t.status === 'imprimindo');
  return {
    feitas: tarefas.filter((t) => t.status === 'ok').length,
    faltam: pend.length,
    falharam: tarefas.filter((t) => t.status === 'falhou').length,
    segundosRestantes: pend.reduce((s, t) => s + (Number(t.segundos_previsto) || 0), 0),
  };
}

export function podeReimprimir(tarefa, todas) {
  return tarefa.status === 'falhou' && !todas.some((t) => t.reimpressao_de === tarefa.id);
}
