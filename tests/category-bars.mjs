import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { initialState, saveMovement, setDeleted } from '../src/core.mjs';

const require = createRequire(import.meta.url);
const browserName = process.env.TEST_BROWSER || 'chromium';
const browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright')[browserName].launch({
  headless:true, ...(process.env.CHROME_EXECUTABLE ? { executablePath:process.env.CHROME_EXECUTABLE } : {})
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';

// Deliberately synthetic values; never load a user's financial export in this suite.
let seed = initialState();
const add = (id, amount, categoryId, extra = {}) => {
  seed = saveMovement(seed, { id, amount, categoryId, type:'expense', paymentMethodId:'pay_efectivo', note:'Prueba sintética', raw:'', occurredOn:'2026-09-05', ...extra });
};
add('under', 48000, 'cat_almuerzo');
add('over', 70000, 'cat_suscripcion');
add('well-over', 90000, 'cat_lujo');
add('no-limit', 32000, 'cat_cena');
add('zero-limit', 10000, 'cat_transporte');
add('income', 999000, 'cat_salario', { type:'income', paymentMethodId:null });
add('deleted', 999000, 'cat_almuerzo');
seed = setDeleted(seed, 'deleted', true);
add('previous-month', 60000, 'cat_almuerzo', { occurredOn:'2026-08-05' });
seed.monthlyBudgets['2026-09'] = { cat_almuerzo:60000, cat_suscripcion:60000, cat_lujo:40000, cat_transporte:0 };
seed.monthlyBudgets['2026-08'] = { cat_almuerzo:60000 };
seed.categories.find(c => c.id === 'cat_lujo').active = false;
seed.favorites = ['under'];
seed.reviewedMonths = ['2026-08'];

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, locale:'es-PY', timezoneId:'America/Asuncion', serviceWorkers:'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-17T15:00:00Z'));
  const ready = () => page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  const read = () => page.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const store = new Store(); const data = await store.open(); store.close(); return data;
  });
  const month = async value => { await page.locator('#month').fill(value); await page.locator('#month').dispatchEvent('change'); };
  await page.goto(base + '/rl-gastos.html'); await ready();
  await page.evaluate(async data => {
    const { Store } = await import('./src/store.mjs');
    const store = new Store(), before = await store.open(); await store.commit(data, before.revision); store.close();
  }, seed);
  await page.reload(); await ready();
  const before = await read();
  const row = id => page.locator(`.category[data-id="${id}"]`);
  const bar = id => row(id).locator('.bar span');
  const width = id => bar(id).evaluate(el => parseFloat(el.style.width));
  const text = id => row(id).innerText();
  assert.equal(await page.locator('.category').count(), 5);
  assert.equal(await width('cat_almuerzo'), 80);
  assert.match(await text('cat_almuerzo'), /80% del límite/);
  assert.doesNotMatch(await text('cat_almuerzo'), /Excedido/);
  assert.equal(await width('cat_suscripcion'), 100);
  assert.match(await text('cat_suscripcion'), /116,7% del límite/);
  assert.match(await text('cat_suscripcion'), /Excedido por ₲ 10\.000/);
  assert.equal(await width('cat_lujo'), 100);
  assert.match(await text('cat_lujo'), /225% del límite/);
  assert.match(await text('cat_lujo'), /Excedido por ₲ 50\.000/);
  assert.equal(await width('cat_cena'), 12.8);
  assert.match(await text('cat_cena'), /12,8% del gasto total del mes/);
  assert.match(await text('cat_cena'), /Sin límite/);
  assert.equal(await width('cat_transporte'), 4);
  assert.match(await text('cat_transporte'), /4% del gasto total del mes/);
  assert.match(await text('cat_transporte'), /Sin límite/);
  const colors = await page.locator('.category').evaluateAll(rows => rows.map(row => ({
    over:row.classList.contains('over-budget'),
    color:getComputedStyle(row.querySelector('.bar span')).backgroundColor
  })));
  assert.equal(new Set(colors.filter(c => c.over).map(c => c.color)).size, 1);
  assert.notEqual(colors.find(c => c.over).color, colors.find(c => !c.over).color);

  // The selected month controls both spending and the denominator, including 100%.
  await month('2026-08');
  assert.equal(await page.locator('.category').count(), 1);
  assert.equal(await width('cat_almuerzo'), 100);
  assert.match(await text('cat_almuerzo'), /100% del límite/);
  assert.doesNotMatch(await text('cat_almuerzo'), /Excedido/);
  await month('2026-07');
  assert.equal(await page.locator('.category').count(), 0);
  assert.match(await page.locator('.home-categories').innerText(), /Sin gastos en este mes/);
  await month('2026-09');
  // Category navigation still shows only its active expenses in the selected month.
  await row('cat_almuerzo').click();
  assert.equal(await page.locator('#filter-category').inputValue(), 'cat_almuerzo');
  assert.equal(await page.locator('#history-list [data-action=edit]').count(), 1);
  await page.locator('nav [data-tab=home]').click();
  await page.reload(); await ready();
  assert.deepEqual(await read(), before, 'Rendering, filtering and reload must not modify persisted data');
  for (const viewport of [{ width:320, height:740 }, { width:390, height:844 }, { width:1280, height:900 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const oversized = await page.locator('.category .bar').evaluateAll(bars => bars.some(bar => bar.firstElementChild.getBoundingClientRect().width > bar.getBoundingClientRect().width + 0.5));
    assert.equal(oversized, false, 'An over-budget bar must stay inside its track');
  }
  await page.setViewportSize({ width:390, height:844 });
  if (process.env.CATEGORY_SCREENSHOT) {
    await page.locator('.home-categories').screenshot({ path:process.env.CATEGORY_SCREENSHOT });
  }
  await page.locator('#privacy').click();
  await page.waitForFunction(() => document.body.classList.contains('privacy'));
  assert.equal(await row('cat_suscripcion').locator('.category-excess .private').count(), 1);
  const afterPrivacy = await read();
  assert.deepEqual(afterPrivacy.entries, before.entries);
  assert.deepEqual(afterPrivacy.monthlyBudgets, before.monthlyBudgets);
  assert.deepEqual(errors, []);
  console.log(`PASS category bars (${browserName}): limits, fractional/over-100% labels, zero/missing limits, archived categories, month/income/deletion filtering, excess color/text, navigation, responsive widths, privacy and persisted-data preservation.`);
} finally {
  await browser.close();
}
