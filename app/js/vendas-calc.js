// Painel de vendas (sem tela). "A receber" = entregue e não pago (briefing §4.3).
const r2 = (v) => Math.round(v * 100) / 100;

// Venda "Frete" criada na aprovação do orçamento (não é a avulsa que alguém chamou de Frete).
export const ehFrete = (v) => v.descricao === 'Frete' && !!v.orcamento_id && !v.orcamento_item_id;

export function resumoVendas(vendas) {
  const ativas = vendas.filter((v) => !v.cancelada);
  const soma = (lista, campo) => r2(lista.reduce((s, v) => s + Number(v[campo] || 0), 0));
  return {
    n: ativas.filter((v) => !ehFrete(v)).length,
    faturamento: soma(ativas, 'total'),
    lucro: soma(ativas, 'lucro'),
    emProducao: soma(ativas.filter((v) => !v.entregue), 'total'),
    aReceber: soma(ativas.filter((v) => v.entregue && !v.pago), 'total'),
  };
}
