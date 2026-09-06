import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { initialState, saveMovement, makeBackup } from '../src/core.mjs';
const require=createRequire(import.meta.url);
const browserType=require(process.env.PLAYWRIGHT_MODULE || 'playwright')[process.env.TEST_BROWSER || 'chromium'];
// Playwright service-worker/offline emulation is supported only in Chromium.
// https://playwright.dev/docs/service-workers
const offlineReload = (process.env.TEST_BROWSER || 'chromium') === 'chromium';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const temp=mkdtempSync(join(tmpdir(),'rl-e2e-'));
let seed=initialState();
for(let i=0;i<3;i++)seed=saveMovement(seed,{id:'sample-'+i,amount:1000*(i+1),type:'expense',categoryId:'cat_almuerzo',paymentMethodId:'pay_efectivo',note:'Ficticio '+i,raw:'Ejemplo',occurredOn:i<2?'2026-08-01':'2026-07-01'});
const fixture=join(temp,'fixture.json');writeFileSync(fixture,JSON.stringify(makeBackup(seed)));
const browser=await browserType.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'es-PY',timezoneId:'America/Asuncion'}),page=await context.newPage();
 await page.clock.setFixedTime(new Date('2026-09-05T15:00:00Z'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/tests/browser.html');await page.getByRole('button',{name:'Ejecutar pruebas'}).click();await page.waitForFunction(()=>/10 \/ 10|FAIL/.test(document.getElementById('results').textContent));assert.match(await page.locator('#results').innerText(),/10 \/ 10/);
 await page.goto(base+'/rl-gastos.html');await page.getByRole('heading',{name:'Resumen'}).waitFor();
 await page.getByRole('button',{name:'Registrar gasto',exact:false}).click();await page.locator('#quick-text').fill('500 almuerzo black 5881');await page.getByRole('button',{name:'Revisar registros'}).click();assert.equal(await page.locator('[name=amount]').inputValue(),'500');
 assert.equal(await page.locator('[name=subcategory]').isVisible(),false);
 await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('editor').open);await page.reload();await page.getByRole('heading',{name:'Resumen'}).waitFor();assert.match(await page.locator('main').innerText(),/1 movimiento/);
 await page.getByRole('button',{name:'Registrar gasto',exact:false}).click();await page.locator('#quick-text').fill('85000 almuerzo efectivo');await page.getByRole('button',{name:'Cerrar y conservar borrador'}).click();await page.reload();await page.getByRole('button',{name:'Continuar borrador pendiente'}).click();assert.equal(await page.locator('#quick-text').inputValue(),'85000 almuerzo efectivo');await page.getByRole('button',{name:'Cerrar y conservar borrador'}).click();
 await page.getByRole('button',{name:'Exportar',exact:true}).click();await page.locator('#import-file').setInputFiles(fixture);await page.getByRole('heading',{name:'Revisar restauración'}).waitFor();assert.match(await page.locator('#import-content').innerText(),/3 movimientos activos/);await page.getByRole('button',{name:'Restaurar este backup'}).click();await page.waitForFunction(()=>!document.getElementById('import-dialog').open);
 await page.locator('#month').fill('2026-08');await page.locator('#month').dispatchEvent('change');
 await page.locator('nav [data-tab=budgets]').click();await page.locator('#budget-cat_almuerzo').fill('10000');await page.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-write]')?.disabled);
 await page.locator('#month').fill('2026-07');await page.locator('#month').dispatchEvent('change');assert.equal(await page.locator('#budget-cat_almuerzo').inputValue(),'');
 await page.locator('#month').fill('2026-08');await page.locator('#month').dispatchEvent('change');assert.equal(await page.locator('#budget-cat_almuerzo').inputValue(),'10000');
 await page.locator('nav [data-tab=history]').click();page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-action=edit][data-id=sample-1]').click();
 // Cancelling replacement must preserve the pending new-entry draft.
 assert.equal(await page.locator('#editor').isVisible(),false);
 await page.locator('nav [data-tab=export]').click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar para ChatGPT'}).click();const downloaded=await downloadPromise;const exported=JSON.parse(readFileSync(await downloaded.path(),'utf8'));assert.equal(exported.controls.all.count,3);assert.equal(exported.controls.selected.count,2);
 await page.evaluate(()=>navigator.serviceWorker.ready);if(offlineReload)await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Resumen'}).waitFor();await page.getByRole('button',{name:'Registrar gasto',exact:false}).click();await page.getByRole('button',{name:'Revisar registros'}).click();await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('editor').open);await page.reload();await page.getByRole('heading',{name:'Resumen'}).waitFor();assert.match(await page.locator('main').innerText(),/85.000/);
 if(offlineReload)assert.equal(await page.evaluate(async()=>{try{await fetch('/uncached-probe-'+Date.now(),{cache:'no-store'});return false;}catch{return true;}}),true);
 await page.locator('nav [data-tab=history]').click();await page.locator('[data-action=edit]').first().click();await page.locator('[name=amount]').fill('86000');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('editor').open);assert.match(await page.locator('#history-list').innerText(),/86.000/);
 await page.locator('[data-action=edit]').first().click();await page.getByRole('button',{name:'Enviar a papelera'}).click();await page.waitForFunction(()=>!document.getElementById('editor').open);assert.equal(await page.locator('[data-action=edit]').count(),0);
 await page.getByRole('button',{name:'Papelera',exact:true}).click();await page.locator('[data-action=restore]').first().click();await page.getByRole('button',{name:'Ver activos',exact:true}).click();assert.match(await page.locator('#history-list').innerText(),/86.000/);
 // A second tab's edit must not be silently deleted by an already-open editor.
 await page.locator('[data-action=edit]').first().click();
 await page.evaluate(async()=>{
  const {Store}=await import('./src/store.mjs'),{saveMovement,dayKey}=await import('./src/core.mjs');
  const other=new Store();const current=await other.open();const entry=current.entries.find(e=>!e.deletedAt && e.occurredOn===dayKey());
  const saved=await other.commit(saveMovement(current,{...entry,note:'Cambio desde otra pestaña'},entry.id),current.revision);
  const broadcast=new BroadcastChannel('rl-gastos-v3');broadcast.postMessage({revision:saved.revision});broadcast.close();other.close();
 });
 await page.waitForFunction(()=>document.getElementById('form-error').textContent.includes('otra pestaña'));
 await page.getByRole('button',{name:'Enviar a papelera'}).click();
 await page.waitForFunction(()=>document.getElementById('form-error').textContent.includes('cambió mientras'));
 assert.equal(await page.locator('#editor').isVisible(),true);
 assert.equal(await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();const current=await s.open();s.close();return current.entries.some(e=>e.note==='Cambio desde otra pestaña' && !e.deletedAt);}),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log(offlineReload ? 'OFFLINE reopen/save/edit/restore verified in Chromium.' : 'WebKit: online flow verified; offline reopen requires real Safari validation.');
 console.log('PASS: storage suite; mobile registration; hidden conditional fields; reload; draft recovery; import; monthly budgets; draft replacement guard; export controls; reload/save/edit/trash/restore; stale deletion rejected; no overflow or page errors.');
}finally{await browser.close();rmSync(temp,{recursive:true,force:true});}
