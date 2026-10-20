// ⚙️ Ajustes (só Marcos) — parâmetros da calculadora, marca do PDF, taxas de marketplace
// e a calculadora livre (simular sem salvar), com Shopee / ML Clássico / ML Premium.
import { h, limpar, erroTela, avisar, campo, botao } from '../ui.js';
import { brl } from '../formato.js';
import { calcularPlaca, arredondar } from '../calc.js';
import { precoMarketplace, precoDireto } from '../marketplace.js';

const PARAMS = [
  ['margem', 'Margem de lucro (% sobre o custo)'], ['maoHora', 'Mão de obra (R$/hora)'], ['maoMin', 'Tempo manual por placa (min)'],
  ['falha', 'Reserva para falhas (%)'], ['tarifa', 'Energia (R$/kWh)'], ['potencia', 'Potência da impressora (W)'], ['desgaste', 'Desgaste da máquina (R$/hora)'],
];
const TAXAS = [
  ['mkShopComm', 'Shopee: comissão (%)'], ['mkShopFix', 'Shopee: taxa fixa (R$)'], ['mkMlComm', 'ML Clássico: comissão (%)'],
  ['mkMlpComm', 'ML Premium: comissão (%)'], ['mkMlFix', 'ML: taxa fixa abaixo de R$ 79 (R$)'], ['mkMlFrete', 'ML: frete grátis acima de R$ 79 (R$)'],
];
const ALERTAS = {
  prejuizo: 'Nesse canal você vende no prejuízo. Suba a margem ou o preço.',
  zona_morta: 'Preço na zona morta R$ 70–79: um pouco abaixo de R$ 70 evita a taxa fixa.',
  frete_gratis: 'Acima de R$ 79 você paga o frete grátis. Logo abaixo de R$ 79 a margem sobe.',
};

const num = (input) => Number(String(input.value).replace(',', '.')) || 0;

export async function render(tela, ctx) {
  if (ctx.perfil.papel !== 'marcos') { tela.append(h('h1', {}, 'Ajustes'), h('p', {}, 'Só o Marcos mexe aqui.')); return; }
  const [cfg, rolos, perfis] = await Promise.all([
    ctx.db.listar('config', (q) => q.select('chave, valor')),
    ctx.db.listar('filamentos', (q) => q.select('id, cor_nome, tipo, custo_kg').eq('ativo', true).order('tipo').order('cor_nome')),
    ctx.db.listar('perfis', (q) => q.select('nome, papel')),
  ]);
  const erro = cfg.erro || rolos.erro || perfis.erro;
  if (erro) { tela.append(erroTela(erro, ctx.atualizar)); return; }
  const conf = Object.fromEntries(cfg.dados.map((c) => [c.chave, c.valor]));
  const d = { ...conf.defaults_calculadora };
  const marca = { nome: '', fone: '', instagram: '', logo_path: null, ...conf.marca };

  tela.append(h('h1', {}, 'Ajustes'), h('p', { class: 'sub' }, 'Valem para todos os orçamentos novos.'));
  // computador: calculadora livre à esquerda, configurações à direita; celular: uma coluna
  const colA = h('div', { class: 'ajustes-calc' });
  const colB = h('div', { class: 'ajustes-config' });
  tela.append(h('div', { class: 'ajustes' }, colA, colB));

  // ---------- calculadora livre ----------
  colA.append(h('p', { class: 'secao' }, 'Calculadora livre (simular)'));
  colA.append(calculadoraLivre(d, conf, rolos.dados));

  // ---------- parâmetros ----------
  colB.append(h('p', { class: 'secao' }, 'Parâmetros da calculadora'));
  const impressoras = conf.impressoras || [];
  const imp = h('select', {}, impressoras.map((p) => h('option', { value: p.id, selected: p.id === d.impressora }, p.nome)));
  const campos = Object.fromEntries(PARAMS.map(([k]) => [k, h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: d[k] })]));
  imp.addEventListener('change', () => {
    const p = impressoras.find((x) => x.id === imp.value);
    if (p) { campos.potencia.value = p.potencia; campos.desgaste.value = p.desgaste; }
  });
  const regimes = conf.regimes || {};
  const regime = h('select', {}, Object.entries(regimes).map(([k, r]) => h('option', { value: k, selected: k === d.regime }, r.label)));
  colB.append(h('div', { class: 'card' }, campo('Impressora', imp), h('div', { class: 'grade-2' }, PARAMS.map(([k, rot]) => campo(rot, campos[k]))),
    campo('Regime de imposto', regime, regimes[d.regime]?.alerta || ''),
    h('div', { class: 'acoes' }, botao('Salvar parâmetros', async () => {
      const novo = { ...conf.defaults_calculadora, impressora: imp.value, regime: regime.value };
      for (const [k] of PARAMS) novo[k] = num(campos[k]);
      await gravar(ctx, 'defaults_calculadora', novo);
    }, 'btn btn-primario'))));

  // ---------- marketplaces ----------
  colB.append(h('p', { class: 'secao' }, 'Taxas de marketplace'));
  const taxas = Object.fromEntries(TAXAS.map(([k]) => [k, h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: d[k] })]));
  colB.append(h('div', { class: 'card' }, h('div', { class: 'grade-2' }, TAXAS.map(([k, rot]) => campo(rot, taxas[k]))),
    h('div', { class: 'acoes' }, botao('Salvar taxas', async () => {
      const novo = { ...conf.defaults_calculadora };
      for (const [k] of TAXAS) novo[k] = num(taxas[k]);
      await gravar(ctx, 'defaults_calculadora', novo);
    }, 'btn'))));

  // ---------- marca do PDF ----------
  colB.append(h('p', { class: 'secao' }, 'Marca no PDF do orçamento'));
  const nome = h('input', { type: 'text', value: marca.nome, placeholder: 'ex.: Ateliê do Pedro' });
  const fone = h('input', { type: 'text', value: marca.fone, placeholder: '(44) 9…' });
  const ig = h('input', { type: 'text', value: marca.instagram, placeholder: '@…' });
  const logo = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
  const previa = h('img', { class: 'foto-placa', alt: 'Logo atual' });
  if (marca.logo_path) ctx.db.foto(marca.logo_path).then((f) => { if (f.dados) previa.src = URL.createObjectURL(f.dados); });
  else previa.classList.add('oculto');
  colB.append(h('div', { class: 'card' }, campo('Nome', nome), h('div', { class: 'grade-2' }, campo('Telefone', fone), campo('Instagram', ig)),
    h('div', { class: 'item-topo' }, previa, campo('Logo (PNG ou JPG, até 300 KB)', logo)),
    h('div', { class: 'acoes' }, botao('Salvar marca', async () => {
      const nova = { ...marca, nome: nome.value.trim(), fone: fone.value.trim(), instagram: ig.value.trim() };
      if (logo.files[0]) {
        if (logo.files[0].size > 300 * 1024) return avisar('Logo maior que 300 KB. Diminua a imagem.', 'erro');
        const up = await ctx.db.enviarFoto(logo.files[0]);
        if (up.erro) return avisar(up.erro, 'erro');
        nova.logo_path = up.dados;
      }
      await gravar(ctx, 'marca', nova);
    }, 'btn'))));

  // ---------- quem usa ----------
  colB.append(h('p', { class: 'secao' }, 'Quem usa o app'), h('div', { class: 'card' },
    perfis.dados.map((p) => h('div', { class: 'linha-dado' }, h('span', {}, p.nome), h('span', { class: 'chip' }, p.papel === 'marcos' ? 'vê tudo' : 'sem custos e sem B2B'))),
    h('p', { class: 'meta', style: { marginBottom: '0' } }, 'Novos logins são criados no painel do Supabase (cadastro aberto está desligado).')));
}

async function gravar(ctx, chave, valor) {
  const r = await ctx.db.listar('config', (q) => q.update({ valor, updated_at: new Date().toISOString() }).eq('chave', chave).select('chave'));
  if (r.erro) return avisar(r.erro, 'erro');
  if (!r.dados?.length) return avisar('Não consegui salvar.', 'erro');
  avisar('Salvo ✓');
  ctx.atualizar();
}

function calculadoraLivre(d, conf, rolos) {
  const g = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'do Bambu Studio' });
  const hh = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: '0' });
  const mm = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: '0' });
  const ext = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'embalagem, ímã…' });
  const rolo = h('select', {}, h('option', { value: '' }, `Preço padrão (${brl(d.precoKg)}/kg)`), rolos.map((r) => h('option', { value: r.id }, `${r.cor_nome} · ${r.tipo} · ${brl(r.custo_kg)}/kg`)));
  const saida = h('div', {});
  const resultado = h('div', {});
  let canal = 'direta';
  // frete da venda direta: fica fora do bloco redesenhado para não perder o foco enquanto digita
  let freteCliente = true;
  const frete = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5', placeholder: 'sem frete' });
  const quem = h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Quem paga o frete' },
    [[true, 'Cliente paga'], [false, 'Frete grátis (eu pago)']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(v),
      onclick: (e) => { freteCliente = v; quem.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); atualizar(); } }, t)));
  const blocoQuem = h('div', { class: 'campo oculto' }, h('span', { class: 'rotulo' }, 'Quem paga o frete?'), quem);
  const blocoFrete = h('div', { style: { marginTop: '12px' } }, campo('Frete (R$)', frete), blocoQuem);
  const regime = (conf.regimes || {})[d.regime] || { taxa: 0, label: 'Sem imposto' };

  const atualizar = () => {
    const custoKg = rolos.find((r) => r.id === rolo.value)?.custo_kg ?? d.precoKg;
    const segundos = (num(hh) * 60 + num(mm)) * 60;
    const p = calcularPlaca({ cores: [{ gramas: num(g), custoKg: Number(custoKg) }], segundos, extras: num(ext), params: d });
    const preco = p.custo * (1 + d.margem / 100);
    const lucro = preco - p.custo;
    const imposto = preco * (regime.taxa / 100);
    const vazio = !(num(g) > 0 && segundos > 0);
    const linha = (rot, v, cls = '') => h('div', { class: `linha-dado ${cls}` }, h('span', {}, rot), h('span', { class: 'v' }, v));
    limpar(saida).append(...[
      h('div', { class: 'kpis', style: { marginTop: '8px' } },
        h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Preço sugerido'), h('div', { class: 'v' }, brl(preco)), h('div', { class: 'meta' }, `arredondado: ${brl(arredondar(preco))}`)),
        h('div', { class: 'kpi' }, h('div', { class: 'rot' }, 'Custo total'), h('div', { class: 'v' }, brl(p.custo)), h('div', { class: 'meta' }, `lucro ${brl(lucro)}`))),
      h('div', {}, linha('Material', brl(p.cMat)), linha('Energia', brl(p.cEne)), linha('Desgaste da máquina', brl(p.cDes)),
        linha('Mão de obra', brl(p.cMao)), linha('Reserva p/ falhas', brl(p.cFal)), linha('Extras', brl(p.cExt)),
        regime.taxa > 0 ? linha(`Imposto ${regime.taxa}% → lucro líquido`, brl(lucro - imposto)) : null),
      h('p', { class: 'secao' }, 'Onde vai vender'),
      h('div', { class: 'segmentado canais', role: 'group', 'aria-label': 'Onde vai vender' }, [['direta', 'Venda direta'], ['shopee', 'Shopee'], ['ml', 'ML Clássico'], ['mlp', 'ML Premium']].map(([v, t]) =>
        h('button', { type: 'button', 'aria-pressed': String(canal === v), onclick: () => { canal = v; atualizar(); } }, t)))].filter(Boolean));
    blocoFrete.classList.toggle('oculto', canal !== 'direta');
    blocoQuem.classList.toggle('oculto', !(num(frete) > 0));
    if (canal === 'direta') {
      const dr = precoDireto({ custoTotal: p.custo, lucroAlvo: lucro, frete: num(frete), freteCliente });
      limpar(resultado).append(...[
        h('div', { style: { marginTop: '8px' } },
          linha('Cobre', `${brl(dr.preco)} (ou ${brl(dr.arredondado)})`, 'total'),
          linha('Comissão', brl(0)),
          dr.frete > 0 ? linha(dr.freteCliente ? 'Frete (o cliente paga)' : 'Frete grátis (você paga)', dr.freteCliente ? `+ ${brl(dr.frete)}` : `− ${brl(dr.frete)} do lucro`) : null,
          dr.frete > 0 && dr.freteCliente ? linha('Cliente paga no total', brl(dr.clientePaga)) : null,
          linha('Lucro', brl(dr.lucro))),
        !vazio && dr.alerta ? h('p', { class: 'aviso erro' }, 'Com esse frete grátis você vende no prejuízo. Cobre o frete ou suba o preço.') : null].filter(Boolean));
      return;
    }
    const mk = precoMarketplace({ custoTotal: p.custo, lucroAlvo: lucro, canal, taxas: d });
    limpar(resultado).append(...[
      h('div', { style: { marginTop: '8px' } },
        linha('Anuncie por', `${brl(mk.preco)} (ou ${brl(mk.arredondado)})`, 'total'),
        linha('Comissão', `− ${brl(mk.comissao)}`),
        mk.fixaUsada ? linha('Taxa fixa', `− ${brl(canal === 'shopee' ? d.mkShopFix : d.mkMlFix)}`) : null,
        mk.freteUsado ? linha('Frete grátis', `− ${brl(d.mkMlFrete)}`) : null,
        linha('Você recebe', brl(mk.recebe)), linha('Lucro', brl(mk.lucro))),
      !vazio && mk.alerta ? h('p', { class: `aviso ${mk.alerta === 'prejuizo' ? 'erro' : ''}` }, ALERTAS[mk.alerta]) : null].filter(Boolean));
  };
  [g, hh, mm, ext, frete].forEach((i) => i.addEventListener('input', atualizar));
  rolo.addEventListener('change', atualizar);
  atualizar();
  return h('div', { class: 'card' }, h('div', { class: 'grade-2' }, campo('Filamento (g)', g), campo('Extras (R$)', ext), campo('Horas', hh), campo('Minutos', mm)),
    campo('Rolo', rolo), saida, blocoFrete, resultado);
}
