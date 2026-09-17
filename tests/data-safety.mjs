import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const browserName = process.env.TEST_BROWSER || 'chromium';
const browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright')[browserName].launch({ headless:true, ...(process.env.CHROME_EXECUTABLE ? { executablePath:process.env.CHROME_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const context = await browser.newContext({ serviceWorkers:'block', locale:'es-PY', timezoneId:'America/Asuncion' });
const results = [];
const read = page => page.evaluate(async () => {
  const { Store } = await import('./src/store.mjs');
  const store = new Store(); await store.open();
  const data = { state:await store.read(), drafts:await store.drafts('budget'), recoveries:await store.recoveries() };
  store.close(); return data;
});
async function open(page) {
  await page.clock.setFixedTime(new Date('2026-09-17T15:00:00Z'));
  await page.goto(base + '/rl-gastos.html');
  await page.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await page.locator('nav [data-tab=budgets]').click();
}
async function waitDraft(page, value) {
  await page.waitForFunction(async value => {
    const { Store } = await import('./src/store.mjs');
    const s = new Store(); await s.open(); const drafts = await s.drafts('budget'); s.close();
    return drafts.some(d => Object.values(d.values).includes(value));
  }, value);
}
async function loadBudgetDraft(page, id) {
  await page.getByRole('button', { name:'Ajustes', exact:true }).click();
  await page.getByText('Recuperación y borradores', { exact:true }).click();
  await page.getByRole('button', { name:'Ver borradores guardados', exact:true }).click();
  await page.locator(`[data-action="draft-load"][data-id="${id}"]`).click();
  await page.locator('#settings').waitFor({ state:'hidden' });
  await page.locator('#budget-form').waitFor();
}
try {
  const a = await context.newPage(), b = await context.newPage();
  const errors = [];
  for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
  await open(a); await open(b);
  await a.locator('#budget-cat_almuerzo').fill('123456'); await waitDraft(a,'123456');
  await b.locator('#budget-cat_transporte').fill('654321'); await waitDraft(b,'654321');
  let saved = await read(a);
  const displaced = saved.drafts.find(d => d.conflictCopy && d.values.cat_almuerzo === '123456');
  assert(displaced, 'Displaced budget must remain recoverable');
  assert.equal(saved.drafts.find(d => !d.conflictCopy).values.cat_transporte,'654321');
  assert.deepEqual(saved.state.monthlyBudgets, {}, 'Drafts must not modify confirmed budgets');
  await a.reload(); await a.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await a.locator('nav [data-tab=budgets]').click();
  assert.equal(await a.locator('#budget-cat_transporte').inputValue(),'654321');
  await loadBudgetDraft(a,displaced.draftId);
  assert.equal(await a.locator('#budget-cat_almuerzo').inputValue(),'123456');
  assert.deepEqual((await read(a)).drafts,saved.drafts,'Opening a preserved draft must not overwrite another pending draft');
  await a.reload(); await a.getByRole('heading', { name:'Resumen', exact:true }).waitFor();
  await a.locator('nav [data-tab=budgets]').click();
  assert.equal(await a.locator('#budget-cat_transporte').inputValue(),'654321');
  await loadBudgetDraft(a,displaced.draftId);
  await a.locator('#budget-cat_almuerzo').fill('222222'); await waitDraft(a,'222222');
  await a.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
  await a.waitForFunction(() => document.getElementById('discard-budget').hidden);
  saved = await read(a);
  assert.equal(saved.state.monthlyBudgets['2026-09'].cat_almuerzo,222222);
  assert(saved.drafts.some(d => d.conflictCopy && d.values.cat_transporte === '654321'),'Editing and saving recovered draft must preserve the other tab’s pending amounts');
  assert(saved.drafts.some(d => d.draftId === displaced.draftId),'Original conflict copy remains available after editing its recovered values');
  results.push('Concurrent budget edits preserve both drafts; copies can be opened, reloaded, edited and saved without deleting another pending draft.');

  await b.close();
  await a.locator('#privacy').click();
  await a.waitForFunction(() => document.body.classList.contains('privacy'));
  await a.locator('#budget-cat_almuerzo').fill('333333');
  await a.getByRole('button', { name:'Guardar presupuesto', exact:true }).click();
  await a.waitForFunction(() => document.getElementById('discard-budget').hidden);
  const message = await a.locator('#notice').innerText();
  assert.match(message,/Presupuesto guardado/);
  assert.doesNotMatch(message,/₲|333/);
  results.push('Budget confirmation does not reveal amounts while privacy is enabled.');

  const stale=(await read(a)).drafts.find(d=>d.conflictCopy && d.values.cat_transporte==='654321');
  await loadBudgetDraft(a,stale.draftId);
  await a.getByRole('button', { name:'Revisar y aplicar borrador', exact:true }).waitFor();
  assert.match(await a.locator('#budget-form').innerText(),/Comparar antes de reemplazar/);
  a.once('dialog',dialog=>dialog.dismiss());
  await a.getByRole('button', { name:'Revisar y aplicar borrador', exact:true }).click();
  assert.equal((await read(a)).state.monthlyBudgets['2026-09'].cat_almuerzo,333333,'Cancelling review leaves saved budget unchanged');
  a.once('dialog',dialog=>dialog.accept());
  await a.getByRole('button', { name:'Revisar y aplicar borrador', exact:true }).click();
  await a.waitForFunction(() => document.getElementById('discard-budget').hidden);
  saved=await read(a);
  assert.equal(saved.state.monthlyBudgets['2026-09'].cat_transporte,654321);
  assert(saved.recoveries.some(r=>r.state.monthlyBudgets['2026-09']?.cat_almuerzo===333333),'Explicitly applying stale values retains previously confirmed budget in recovery');
  assert(saved.drafts.some(d=>d.draftId===stale.draftId),'Original recovered copy remains available');
  results.push('Stale budget copies show saved-versus-draft values; cancel is inert, explicit confirmation applies them while preserving previous budget and original copy.');

  const recoveryResult = await a.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const { initialState, saveMovement } = await import('./src/core.mjs');
    const s = new Store(); let current = await s.open();
    const movement = id => ({ id, amount:1000, type:'expense', categoryId:'cat_almuerzo', paymentMethodId:'pay_efectivo', occurredOn:'2026-09-05', note:'Synthetic audit', raw:'' });
    const original = saveMovement(initialState(),movement('original'));
    const legacy = { at:'2026-09-01T15:00:00Z', reason:'before-replacement', state:saveMovement(initialState(),movement('legacy-copy')) };
    await s.transaction(['recovery'], stores => stores.recovery.put(legacy,'before-replacement'));
    current = await s.commit(original,current.revision);
    current = await s.commit(saveMovement(initialState(),movement('first-import')),current.revision,{recovery:true});
    current = await s.commit(initialState(),current.revision,{recovery:true});
    const copies = await s.recoveries();
    const existingLegacy = await new Promise((resolve,reject) => { const req=s.db.transaction('recovery').objectStore('recovery').get('before-replacement');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
    const snapshot = {state:await s.read(),copies};
    const originalTransaction = s.transaction.bind(s);
    s.transaction=(names,work)=>originalTransaction(names,(stores,tx)=>{work({...stores,state:{get:stores.state.get.bind(stores.state),put:(...args)=>{stores.state.put(...args);tx.abort();}}},tx);});
    let failed=false;try{await s.commit(original,current.revision,{recovery:true});}catch{failed=true;}
    const atomic=JSON.stringify(snapshot)===JSON.stringify({state:await s.read(),copies:await s.recoveries()});
    s.close();return {ids:copies.flatMap(c=>c.state.entries.map(e=>e.id)),legacyUnchanged:JSON.stringify(legacy)===JSON.stringify(existingLegacy),failed,atomic};
  });
  assert(recoveryResult.ids.includes('original'));
  assert(recoveryResult.ids.includes('first-import'));
  assert(recoveryResult.ids.includes('legacy-copy'));
  assert.equal(recoveryResult.legacyUnchanged,true);
  assert.equal(recoveryResult.failed,true);
  assert.equal(recoveryResult.atomic,true);
  results.push('Successive replacements retain every prior snapshot and the legacy recovery key; aborted replacement leaves state and all copies untouched.');

  const draftResult = await a.evaluate(async () => {
    const { Store } = await import('./src/store.mjs');
    const s = new Store(); await s.open();
    await s.saveBudgetDraft({kind:'budget',draftId:'budget-2026-09',month:'2026-09',token:'original-draft',values:{cat_almuerzo:'123'},base:'[]'},'budget-2026-09',null);
    const before=await s.drafts('budget');
    const originalTransaction=s.transaction.bind(s);
    s.transaction=(names,work)=>originalTransaction(names,(stores,tx)=>{let writes=0;work({...stores,drafts:{get:stores.drafts.get.bind(stores.drafts),put:(...args)=>{stores.drafts.put(...args);if(++writes===2)tx.abort();}}},tx);});
    let failed=false;try{await s.saveBudgetDraft({kind:'budget',draftId:'budget-2026-09',month:'2026-09',token:'abort',values:{cat_almuerzo:'999'},base:'[]'},'budget-2026-09',null);}catch{failed=true;}
    const unchanged=JSON.stringify(before)===JSON.stringify(await s.drafts('budget'));
    s.close();return {failed,unchanged};
  });
  assert.deepEqual(draftResult,{failed:true,unchanged:true});
  assert.deepEqual(errors,[]);
  results.push('Aborted budget draft write leaves canonical and preserved drafts unchanged.');
  await a.getByRole('button', { name:'Ajustes', exact:true }).click();
  await a.getByText('Recuperación y borradores', { exact:true }).click();
  const expectedRecovery=(await read(a)).recoveries[0].state;
  await a.getByRole('button', { name:'Ver copias internas de recuperación', exact:true }).click();
  await a.evaluate(async()=>{
    const {Store}=await import('./src/store.mjs');const {initialState}=await import('./src/core.mjs');const s=new Store();await s.open();
    await s.transaction(['recovery'],stores=>stores.recovery.put({at:new Date().toISOString(),reason:'concurrent-earlier-key',state:initialState()},'000-first'));
    s.close();
  });
  const downloadEvent=a.waitForEvent('download');
  await a.locator('[data-action="recovery-download"][data-index="0"]').click();
  const download=await downloadEvent;
  const downloaded=JSON.parse(readFileSync(await download.path(),'utf8'));
  assert.deepEqual(downloaded.data,expectedRecovery,'Download must match the displayed snapshot even if another tab inserted an earlier recovery');
  results.push('Recovery downloads use the snapshot actually listed, unaffected by concurrent insertions; labels include timestamp and entry count.');
  console.log(`PASS ${results.length} data-safety scenarios (${browserName}):\n` + results.join('\n'));
} finally { await browser.close(); }
