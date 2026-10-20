import { h, vazio } from '../ui.js';

export async function render(tela) {
  tela.append(h('h1', {}, 'Semana'), vazio('Em construção.'));
}
