// O Supabase devolve no máximo 1.000 linhas por resposta: para listas que não podem perder nada,
// buscar(de, ate) → { dados, erro } é chamado página a página até vir uma incompleta.
export const POR_PAGINA = 1000;

export async function paginar(buscar, tamanho = POR_PAGINA) {
  const tudo = [];
  for (let de = 0; ; de += tamanho) {
    const r = await buscar(de, de + tamanho - 1);
    if (r.erro) return { dados: null, erro: r.erro };
    tudo.push(...r.dados);
    if (r.dados.length < tamanho) return { dados: tudo, erro: null };
  }
}
