import { h, vazio } from '../ui.js';

export async function render(tela) {
  tela.append(h('h1', {}, 'Vendas'), vazio('Em construção.'));
}
