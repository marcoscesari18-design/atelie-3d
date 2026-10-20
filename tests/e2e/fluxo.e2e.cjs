// Ponta a ponta no tamanho de celular (375×812), contra o Supabase LOCAL e o app em http://127.0.0.1:5180.
// Uso: node tests/e2e/fluxo.e2e.cjs <pasta-com-.3mf>     (Playwright de ~/Downloads/playwright-automacao, Chrome instalado)
// Termina com "E2E OK" ou sai com código 1.
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/marcoscesari/Downloads/playwright-automacao/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const APP = process.env.APP_URL || 'http://127.0.0.1:5180/';
const FIX = process.argv[2];
const SENHA = 'atelie-local-123'; // logins de teste do supabase/seed-local.sh (só valem no Supabase local)
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_atelie-3d', 'psql', '-U', 'postgres', '-qtA'], { input: q }).toString().trim();
const falha = (m) => { console.error('FALHOU:', m); process.exit(1); };
const ok = (m) => console.log('ok:', m);
const tag = `E2E ${Date.now().toString().slice(-6)}`;

async function entrar(page, quem) {
  await page.goto(APP);
  await page.getByLabel('E-mail').fill(`${quem}@local.test`);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: /Orçamentos/ }).first().waitFor();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const celular = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

  // 1) Marcos cadastra um rolo
  const marcos = await (await browser.newContext(celular)).newPage();
  await entrar(marcos, 'marcos');
  await marcos.goto(APP + '#filamentos');
  await marcos.getByRole('button', { name: '+ Rolo' }).click();
  const dlg = marcos.locator('dialog[open]');
  await dlg.getByLabel('Marca').fill('Teste');
  await dlg.getByLabel('Nome da cor').fill(tag);
  await dlg.getByLabel('R$ por kg').fill('100');
  await dlg.getByLabel('Gramas do rolo').fill('500');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await marcos.getByText(tag).waitFor();
  const roloId = sql(`select id from filamentos where cor_nome = '${tag}'`);
  if (sql(`select gramas_restantes from filamentos where id = '${roloId}'`) !== '500.00') falha('rolo não entrou com 500 g');
  ok('Marcos cadastrou o rolo');

  // 2) Pedro vê o rolo, sem R$/kg
  const ctxPedro = await browser.newContext(celular);
  const pedro = await ctxPedro.newPage();
  await entrar(pedro, 'pedro');
  await pedro.goto(APP + '#filamentos');
  await pedro.getByText(tag).waitFor();
  if (await pedro.getByText('/kg').count()) falha('Pedro está vendo R$/kg');
  if (await pedro.getByRole('link', { name: /Ajustes/ }).count()) falha('Pedro vê a aba Ajustes');
  ok('Pedro vê o rolo, sem custo e sem Ajustes');

  // 3) Orçamento a partir do .3mf; recarregar no meio não perde nada
  await pedro.goto(APP + '#orcamentos/novo');
  await pedro.locator('main input[type=file]').last().setInputFiles(path.join(FIX, 'dragchain.3mf'));
  await pedro.getByText('Arquivo lido').waitFor();
  await pedro.getByLabel('Cliente').fill(`Cliente ${tag}`);
  await pedro.locator('main select[aria-label^="Rolo para a cor"]').first().selectOption(roloId);
  await pedro.reload();
  await pedro.getByLabel('Cliente').waitFor();
  if ((await pedro.getByLabel('Cliente').inputValue()) !== `Cliente ${tag}`) falha('recarregar perdeu o cliente');
  if ((await pedro.locator('main select[aria-label^="Rolo para a cor"]').first().inputValue()) !== roloId) falha('recarregar perdeu o rolo');
  ok('recarregar no meio do orçamento mantém tudo');

  // 4) Sessão expira no meio: rascunho continua depois do login
  await ctxPedro.clearCookies();
  await pedro.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)));
  await pedro.reload();
  await pedro.getByLabel('Senha').waitFor();
  await pedro.getByLabel('E-mail').fill('pedro@local.test');
  await pedro.getByLabel('Senha').fill(SENHA);
  await pedro.getByRole('button', { name: 'Entrar' }).click();
  await pedro.goto(APP + '#orcamentos/novo');
  await pedro.getByLabel('Cliente').waitFor();
  if ((await pedro.getByLabel('Cliente').inputValue()) !== `Cliente ${tag}`) falha('sessão expirada perdeu o rascunho');
  ok('sessão expirada: entrou de novo e o rascunho estava lá');

  // 5) Aprovar com a resposta perdida no caminho: o banco aprova, a tela confere e não deixa aprovar 2x
  // salva com um rolo, troca para outro na tela e toca Aprovar: tem de aprovar a versão da tela
  await pedro.getByRole('button', { name: 'Salvar', exact: true }).click();
  await pedro.getByText('Salvo ✓').waitFor();
  const outro = sql(`insert into filamentos (marca, tipo, cor_nome, cor_hex, custo_kg, gramas_iniciais) values ('Teste','PLA','${tag} B','#FFFFFF',100,300) returning id`).split('\n')[0];
  await pedro.reload();
  await pedro.locator('main select[aria-label^="Rolo para a cor"]').first().selectOption(outro);
  await pedro.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await pedro.locator('dialog[open]').getByText('Aprovar orçamento?').waitFor();
  await pedro.route('**/rest/v1/rpc/aprovar_orcamento', async (route) => { await route.fetch(); await route.abort('connectionreset'); });
  await pedro.locator('dialog[open]').getByRole('button', { name: 'Aprovar' }).click();
  await pedro.getByText('Aprovado', { exact: true }).first().waitFor();
  await pedro.unroute('**/rest/v1/rpc/aprovar_orcamento');
  if (await pedro.getByRole('button', { name: /Aprovar/ }).count()) falha('tela ainda oferece aprovar');
  const s1 = sql(`select gramas_restantes from filamentos where id = '${roloId}'`);
  const s2 = sql(`select gramas_restantes from filamentos where id = '${outro}'`);
  if (s1 !== '500.00' || s2 !== '225.07') falha(`baixa no rolo errado: antigo ${s1}, novo ${s2} (esperado 500,00 e 225,07)`);
  const tarefas = sql(`select count(*) from tarefas t join orcamento_itens i on i.id = t.orcamento_item_id join orcamentos o on o.id = i.orcamento_id where o.cliente = 'Cliente ${tag}'`);
  if (tarefas !== '1') falha(`tarefas: ${tarefas}`);
  ok('trocar o rolo depois de salvar e aprovar: baixou do rolo da tela');
  ok('resposta perdida: aprovado uma vez só');

  // 6) Venda avulsa em menos de 30 s
  const t0 = Date.now();
  await pedro.goto(APP + '#vendas');
  await pedro.getByRole('button', { name: '+ Venda' }).click();
  const v = pedro.locator('dialog[open]');
  await v.getByLabel('Cliente').fill(`Avulsa ${tag}`);
  await v.getByLabel('O que').fill('Chaveiro');
  await v.getByLabel('Preço (R$)').fill('10');
  await v.getByRole('button', { name: 'Registrar' }).click();
  await pedro.getByText(`Avulsa ${tag}`).waitFor();
  const seg = (Date.now() - t0) / 1000;
  if (seg > 30) falha(`venda levou ${seg}s`);
  ok(`venda avulsa registrada em ${seg.toFixed(1)} s`);

  await pedro.screenshot({ path: path.join(process.env.SAIDA || '/tmp', 'e2e-vendas.png') });
  await browser.close();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
