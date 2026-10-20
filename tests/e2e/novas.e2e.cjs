// Ponta a ponta das funções de 20/10/2026, contra o Supabase LOCAL e o app em http://127.0.0.1:5181/ (ou APP_URL):
// cor do rolo por foto (Pedro), frete no orçamento + venda Frete seguindo o item (Marcos), venda direta na calculadora.
// Uso: node tests/e2e/novas.e2e.cjs <pasta-saida-fotos>   — termina com "NOVAS OK" ou sai com código 1.
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/marcoscesari/Downloads/playwright-automacao/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const APP = process.env.APP_URL || 'http://127.0.0.1:5181/'; const OUT = process.argv[2] || '/tmp'; const FOTO = path.join(__dirname, '..', 'fixtures', 'rolo-azul.jpg');
const FIX = path.join(__dirname, '..', 'fixtures-locais');
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_atelie-3d', 'psql', '-U', 'postgres', '-qtA'], { input: q }).toString().trim();
const falha = (m) => { console.error('FALHOU:', m); process.exit(1); };
const ok = (m) => console.log('ok:', m);
const tag = `NOVA ${Date.now().toString().slice(-6)}`;
async function entrar(b, quem, opt) {
  const p = await (await b.newContext(opt)).newPage();
  p.on('pageerror', (e) => falha(`erro na página: ${e.message}`));
  await p.goto(APP); await p.getByLabel('E-mail').fill(`${quem}@local.test`); await p.getByLabel('Senha').fill('atelie-local-123');
  await p.getByRole('button', { name: 'Entrar' }).click(); await p.getByRole('link', { name: /Orçamentos/ }).first().waitFor();
  return p;
}
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const cel = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const pc = { viewport: { width: 1440, height: 900 } };

  // 1) Pedro confere a cor de um rolo pela foto
  const rolo = sql(`insert into filamentos (marca, tipo, cor_nome, cor_hex, custo_kg, gramas_iniciais) values ('Teste','PLA','${tag}','#FF0000',100,1000) returning id`).split('\n')[0];
  const pedro = await entrar(b, 'pedro', cel);
  await pedro.goto(APP + '#filamentos'); await pedro.getByText(tag).click();
  const escolha = pedro.waitForEvent('filechooser');
  await pedro.locator('dialog[open]').getByRole('button', { name: 'Conferir a cor por foto' }).click();
  await (await escolha).setFiles(FOTO);
  const tela = pedro.locator('dialog[open] canvas.foto-cor'); await tela.waitFor();
  if (!(await pedro.locator('dialog[open]').getByRole('button', { name: 'Usar esta cor' }).isDisabled())) falha('Usar esta cor ligado sem escolha');
  await tela.focus(); await pedro.keyboard.press('Enter');
  if ((await pedro.locator('dialog[open] [aria-live]').innerText()).trim() === 'toque no fio') falha('teclado não marcou a cor');
  const caixa = await tela.boundingBox();
  await tela.click({ position: { x: caixa.width * 0.70, y: caixa.height * 0.5 } });   // em cima do fio azul, longe do miolo
  await pedro.screenshot({ path: path.join(OUT, 'nova-cel-cor-foto.png') });
  await pedro.locator('dialog[open]').getByRole('button', { name: 'Usar esta cor' }).click();
  await pedro.getByText('Cor do rolo atualizada').waitFor();
  const cor = sql(`select cor_hex from filamentos where id = '${rolo}'`);
  const perto = [1, 3, 5].every((i, k) => Math.abs(parseInt(cor.slice(i, i + 2), 16) - [0x1e, 0x78, 0xc8][k]) <= 4);   // JPEG muda 1–2 pontos
  if (!perto) falha(`cor gravada ${cor}, esperado perto de #1E78C8`);
  if (sql(`select custo_kg from filamentos where id = '${rolo}'`) !== '100.00') falha('custo mudou');
  ok(`Pedro acertou a cor pela foto (${cor}, foto era #1E78C8) sem mexer no preço`);

  // 2) Marcos: orçamento com frete pago pelo cliente → PDF/total/vendas
  const marcos = await entrar(b, 'marcos', pc);
  await marcos.goto(APP + '#orcamentos/novo');
  await marcos.locator('main input[type=file]').last().setInputFiles(path.join(FIX, 'dragchain.3mf'));
  await marcos.getByText('Arquivo lido').first().waitFor();
  await marcos.getByLabel('Cliente').fill(`Frete ${tag}`);
  await marcos.locator('main select[aria-label^="Rolo para a cor"]').first().selectOption(rolo);
  await marcos.getByLabel('Preço por unidade (R$)').fill('40');
  await marcos.getByLabel('Frete (R$)').fill('12.5');
  await marcos.getByRole('button', { name: 'Cliente paga' }).waitFor();
  const resumo = await marcos.locator('.resumo').innerText();
  if (!/Frete[\s\S]*12,50/.test(resumo) || !/Total para o cliente[\s\S]*52,50/.test(resumo)) falha(`resumo: ${resumo}`);
  await marcos.screenshot({ path: path.join(OUT, 'nova-pc-orc-frete.png') });
  await marcos.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await marcos.locator('dialog[open]').getByText('Aprovar orçamento?').waitFor();
  await marcos.locator('dialog[open]').getByRole('button', { name: 'Aprovar' }).click();
  await marcos.getByText('Aprovado', { exact: true }).first().waitFor();
  const o = sql(`select id from orcamentos where cliente = 'Frete ${tag}'`);
  if (sql(`select total_aceito from orcamentos where id = '${o}'`) !== '52.50') falha('total aceito');
  if (sql(`select total || '|' || lucro from vendas where orcamento_id = '${o}' and descricao = 'Frete'`) !== '12.50|0.00') falha('venda Frete');
  ok('orçamento com frete do cliente: total 52,50 e venda Frete de 12,50 com lucro 0');
  // a venda Frete segue o item: marcar o item como pago e entregue leva o frete junto
  await marcos.goto(APP + '#vendas');
  const cartaoItem = marcos.locator('.venda', { hasText: `Frete ${tag}` }).filter({ hasText: 'dragchain' });
  await cartaoItem.getByRole('button', { name: 'Marcar pago' }).click();
  await marcos.locator('.venda', { hasText: `Frete ${tag}` }).filter({ hasText: 'dragchain' }).getByRole('button', { name: 'Pago ✓' }).waitFor();
  await marcos.locator('.venda', { hasText: `Frete ${tag}` }).filter({ hasText: 'dragchain' }).getByRole('button', { name: 'Marcar entregue' }).click();
  await marcos.locator('.venda', { hasText: `Frete ${tag}` }).filter({ hasText: 'dragchain' }).getByRole('button', { name: 'Entregue ✓' }).waitFor();
  if (sql(`select pago::text || entregue::text from vendas where orcamento_id = '${o}' and descricao = 'Frete'`) !== 'truetrue') falha('frete não seguiu o item');
  if (await marcos.locator('.venda', { hasText: `Frete ${tag}` }).filter({ hasText: 'Segue o pedido' }).getByRole('button').count()) falha('frete com botões próprios');
  await marcos.screenshot({ path: path.join(OUT, 'nova-pc-vendas-frete.png') });
  ok('venda Frete segue o item (pago e entregue juntos), sem botões próprios');

  // 3) frete grátis no editor muda total e lucro na hora
  await marcos.goto(APP + '#orcamentos/novo');
  await marcos.locator('main input[type=file]').last().setInputFiles(path.join(FIX, 'dragchain.3mf'));
  await marcos.getByText('Arquivo lido').first().waitFor();
  await marcos.getByLabel('Preço por unidade (R$)').fill('40');
  await marcos.getByLabel('Frete (R$)').fill('10');
  await marcos.getByRole('button', { name: 'Frete grátis (eu pago)' }).click();
  const r2 = await marcos.locator('.resumo').innerText();
  if (!/Frete grátis/.test(r2) || !/Total para o cliente[\s\S]*40,00/.test(r2)) falha(`resumo frete grátis: ${r2}`);
  ok('frete grátis: total fica 40,00 e aparece "Frete grátis"');
  await marcos.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('atelie:orc')).forEach((k) => localStorage.removeItem(k)));

  // 4) calculadora: venda direta é a primeira e tem frete
  for (const [nome, opt] of [['pc', pc], ['cel', cel]]) {
    const p = nome === 'pc' ? marcos : await entrar(b, 'marcos', opt);
    await p.goto(APP + '#ajustes');
    await p.getByLabel('Filamento (g)').fill('50'); await p.getByLabel('Horas').fill('2');
    const venda = p.getByRole('button', { name: 'Venda direta' });
    if ((await venda.getAttribute('aria-pressed')) !== 'true') falha('venda direta não é a padrão');
    await p.getByLabel('Frete (R$)').fill('15');
    const t = await p.locator('.ajustes-calc').innerText();
    if (!/Comissão\s*R\$\s*0,00/.test(t) || !/Cliente paga no total/.test(t)) falha(`calculadora: ${t.slice(-400)}`);
    await p.getByLabel('Frete (R$)').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `nova-${nome}-calc.png`), fullPage: nome === 'pc' });
  }
  ok('calculadora: Venda direta padrão, comissão 0 e frete');
  await b.close();
  console.log('NOVAS OK');
})().catch((e) => { console.error(e); process.exit(1); });
