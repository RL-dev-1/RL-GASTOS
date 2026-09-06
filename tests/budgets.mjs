import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const browserName = process.env.TEST_BROWSER || 'chromium';
const browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright')[browserName].launch({ headless:true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const report = [];
mkdirSync('artifacts', { recursive:true });
let page;
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, locale:'es-PY', timezoneId:'America/Asuncion' });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-06T15:00:00Z'));
  const open = async () => {
    await page.goto(base + '/rl-gastos.html');
    await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
    await page.locator('nav [data-tab=budgets]').click();
  };
  const read = () => page.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const s = new Store(); const state = await s.open(); const drafts = await s.drafts('budget'); s.close();
    return { state, drafts };
  });
  const month = async value => { await page.locator('#month').fill(value); await page.locator('#month').dispatchEvent('change'); };
  const values = () => page.locator('#budget-form input').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [input.name,input.value])));
  const save = async () => {
    await page.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Presupuesto guardado'));
    await page.waitForFunction(() => document.getElementById('discard-budget').hidden);
  };
  const lunch = () => page.locator('#budget-cat_almuerzo');
  await open();
  await page.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const s = new Store(), state = await s.open();
    state.legacyBudgets = { cat_almuerzo:650000, cat_transporte:250000 };
    state.monthlyBudgets['2026-08'] = { cat_almuerzo:450000, cat_transporte:150000 };
    await s.commit(state, state.revision); s.close();
  });
  await page.reload(); await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await page.locator('nav [data-tab=budgets]').click();

  // A real tap blurs the active input before submitting; all category values must survive.
  const fields = await page.locator('#budget-form input').all(), expected = {};
  for (const [index, input] of fields.entries()) {
    const n = (index + 1) * 125000;
    expected[await input.getAttribute('name')] = n;
    await input.fill(new Intl.NumberFormat('es-PY').format(n));
  }
  await save();
  assert.deepEqual((await read()).state.monthlyBudgets['2026-09'], expected);
  assert.equal((await read()).drafts.length, 0);
  report.push('Save all categories after input blur; verify stored amounts, not only the success message.');

  await lunch().fill('875.000');
  const pending = await values();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await page.locator('#privacy').click();
  await page.waitForFunction(() => document.getElementById('privacy').getAttribute('aria-label') === 'Mostrar montos');
  assert.deepEqual(await values(), pending);
  await month('2026-08'); await lunch().fill('510000');
  await month('2026-09'); assert.deepEqual(await values(), pending);
  await page.locator('nav [data-tab=home]').click(); await page.locator('nav [data-tab=budgets]').click();
  assert.deepEqual(await values(), pending);
  await page.reload(); await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  assert.equal(await page.getByRole('button', { name:'Continuar borrador pendiente' }).count(), 0, 'Budget draft must not open as a movement');
  await page.locator('nav [data-tab=budgets]').click();
  assert.deepEqual(await values(), pending);
  assert.deepEqual((await read()).state.monthlyBudgets['2026-09'], expected, 'A draft must not silently apply the budget');
  await save(); expected.cat_almuerzo = 875000;
  assert.deepEqual((await read()).state.monthlyBudgets['2026-09'], expected);
  await month('2026-08'); assert.equal(await lunch().inputValue(), '510000');
  await save(); assert.equal((await read()).state.monthlyBudgets['2026-08'].cat_almuerzo, 510000);
  report.push('Background/resume, network changes, privacy, navigation, two months and reload preserve drafts independently.');

  await month('2026-10'); await page.getByRole('button', { name:'Copiar mes anterior', exact:true }).click();
  const copied = await values();
  await page.locator('#privacy').click(); await page.waitForFunction(() => document.getElementById('privacy').getAttribute('aria-label') === 'Ocultar montos en pantalla');
  assert.deepEqual(await values(), copied);
  await save(); assert.deepEqual((await read()).state.monthlyBudgets['2026-10'], expected);
  await month('2026-11'); await page.getByRole('button', { name:'Usar los límites de tu backup en este mes', exact:true }).click();
  await save(); const backupBudget = (await read()).state.monthlyBudgets['2026-11'];
  assert.equal(backupBudget.cat_almuerzo, 650000); assert.equal(backupBudget.cat_transporte, 250000);
  report.push('Copy previous month and original backup limits, then read back the saved month.');

  await lunch().fill('1.23'); await page.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Revisá el monto de Almuerzo'));
  assert.equal(await lunch().inputValue(), '1.23');
  assert.deepEqual((await read()).state.monthlyBudgets['2026-11'], backupBudget);
  await lunch().fill('975000');
  // Abort a real IndexedDB write, including its draft deletion, after both were requested.
  await page.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const original = Store.prototype.commit;
    Store.prototype.commit = async function (candidate, revision, options) {
      Store.prototype.commit = original;
      return this.transaction(['state','drafts'], (stores, tx) => {
        stores.state.put(candidate, 'current'); stores.drafts.delete(options.clearDraft);
        tx.failure = new Error('Fallo simulado: no se pudo guardar el presupuesto.'); tx.abort();
      });
    };
  });
  await page.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Fallo simulado'));
  assert.equal(await lunch().inputValue(), '975000');
  let stored = await read(); assert.deepEqual(stored.state.monthlyBudgets['2026-11'], backupBudget);
  assert.equal(stored.drafts.find(d => d.month === '2026-11').values.cat_almuerzo, '975000');
  await page.reload(); await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await page.locator('nav [data-tab=budgets]').click(); await month('2026-11');
  assert.equal(await lunch().inputValue(), '975000'); await save();
  assert.equal((await read()).state.monthlyBudgets['2026-11'].cat_almuerzo, 975000);
  report.push('Invalid amount and aborted storage preserve prior budget plus draft; reload and retry save successfully.');

  // A newer draft from another tab must not be deleted by saving this tab's older draft.
  await month('2026-09'); await lunch().fill('990000');
  await page.evaluate(async () => {
    const { Store } = await import('./src/store.mjs'); const s = new Store(); await s.open();
    const draft = await s.getDraft('budget-2026-09'); draft.token = 'newer-tab-token'; draft.values.cat_almuerzo = '995000';
    await s.draft(draft, draft.draftId); s.close();
  });
  await save();
  stored = await read(); assert.equal(stored.state.monthlyBudgets['2026-09'].cat_almuerzo, 990000);
  assert.equal(stored.drafts.find(d => d.month === '2026-09').values.cat_almuerzo, '995000');
  await page.reload(); await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await page.locator('nav [data-tab=budgets]').click();
  assert.equal(await lunch().inputValue(), '995000');
  await page.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('El presupuesto de este mes cambió'));
  assert.equal((await read()).state.monthlyBudgets['2026-09'].cat_almuerzo, 990000);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name:'Descartar cambios y ver guardado', exact:true }).click();
  await page.waitForFunction(() => document.getElementById('discard-budget').hidden);
  assert.equal(await lunch().inputValue(), '990000');
  report.push('Concurrent drafts remain recoverable; stale budgets cannot overwrite a newer saved month.');

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (browserName === 'chromium') {
    await context.setOffline(true); await page.reload();
    await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
    await page.locator('nav [data-tab=budgets]').click(); await lunch().fill('1234567'); await save();
    await page.reload(); await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
    await page.locator('nav [data-tab=budgets]').click(); assert.equal(await lunch().inputValue(), '1234567');
    await context.setOffline(false);
    report.push('Offline reload, budget save and second offline reload retain the confirmed amount (Chromium).');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path:`artifacts/${browserName}-budget-saved.png` });
  writeFileSync(`artifacts/${browserName}-budget-report.json`, JSON.stringify(report, null, 2));
  console.log(`PASS budget regressions (${browserName}):\n` + report.join('\n'));
} catch (error) {
  if (page) await page.screenshot({ path:`artifacts/${browserName}-budget-failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
