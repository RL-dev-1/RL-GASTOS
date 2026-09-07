import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {initialState, saveMovement, makeBackup} from '../src/core.mjs';
const require=createRequire(import.meta.url), browserName=process.env.TEST_BROWSER||'chromium';
const browser=await require(process.env.PLAYWRIGHT_MODULE||'playwright')[browserName].launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8080', out=process.env.ARTIFACT_DIR||'artifacts', results=[];
mkdirSync(out,{recursive:true});
const sample={id:'sample',amount:85000,type:'expense',categoryId:'cat_almuerzo',paymentMethodId:'pay_efectivo',note:'Café manual',raw:'',occurredOn:'2026-09-05'};
const seed=saveMovement(initialState(),sample);
const backupFile=data=>({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeBackup(data),null,2))});
async function check(name,fn){
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'es-PY',timezoneId:'America/Asuncion',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-09-07T15:00:00Z'));
 try{await page.goto(base+'/rl-gastos.html');await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();await fn(page,context);assert.deepEqual(errors,[]);results.push(name);console.log('PASS '+name);}
 catch(e){await page.screenshot({path:`${out}/${browserName}-regression-failure.png`});throw e;}
 finally{await context.close();}
}
const read=page=>page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();const data=await s.read(),drafts=await s.drafts(),copies=await s.recoveries();s.close();return {data,drafts,copies};});
const background=page=>page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));delete document.visibilityState;});
const reload=async page=>{await page.reload();await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();};
async function quick(page,text){await page.getByRole('button',{name:'Registrar gasto',exact:true}).click();await page.locator('#quick-text').fill(text);}
async function closeEditor(page){await page.getByRole('button',{name:'Cerrar y conservar borrador'}).click();await page.locator('#editor').waitFor({state:'hidden'});}
async function seedPage(page,data=seed){await page.evaluate(async data=>{const {Store}=await import('./src/store.mjs');const s=new Store(),before=await s.open();await s.commit(data,before.revision);s.close();},data);await reload(page);}
try{
 await check('Opening and reloading preserve all existing v3 data and legacy storage',async page=>{
   const state=structuredClone(seed);state.favorites=['sample'];state.monthlyBudgets['2026-09']={cat_almuerzo:100000};state.reviewedMonths=['2026-08'];
   state.entries.push({...state.entries[0],id:'trashed',deletedAt:'2026-09-06T15:00:00Z',version:3});
   await seedPage(page,state);await page.evaluate(()=>localStorage.setItem('rl_entries','legacy-preserved'));
   const before=(await read(page)).data;await reload(page);await background(page);await reload(page);
   assert.deepEqual((await read(page)).data,before);assert.equal(await page.evaluate(()=>localStorage.getItem('rl_entries')),'legacy-preserved');
 });
 for(const mode of ['quick','form'])await check(`Recovered ${mode} draft survives background and update before opening editor`,async page=>{
   await quick(page,'85000 almuerzo efectivo');if(mode==='form')await page.getByRole('button',{name:'Revisar registros'}).click();await closeEditor(page);
   const before=(await read(page)).drafts;await reload(page);await background(page);assert.deepEqual((await read(page)).drafts,before);
   await page.evaluate(()=>document.getElementById('update').hidden=false);
   await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForLoadState();await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();
   await page.getByRole('button',{name:'Continuar borrador pendiente'}).click();
   assert.equal(await page.locator(mode==='quick'?'#quick-text':'[name=amount]').inputValue(),mode==='quick'?'85000 almuerzo efectivo':'85000');
 });
 await check('Legacy draft without token remains readable and clears only after successful save',async page=>{
   await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();await s.draft({draftId:'legacy',mode:'quick',text:'12000 almuerzo efectivo',type:'expense'},'legacy');s.close();});
   await reload(page);await page.getByRole('button',{name:'Continuar borrador pendiente'}).click();await page.getByRole('button',{name:'Revisar registros'}).click();await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
   const stored=await read(page);assert.equal(stored.data.entries[0].amount,12000);assert.equal(stored.drafts.length,0);
 });
 await check('Saving A does not delete the newer pending draft from B',async(a,context)=>{
   await quick(a,'100 almuerzo efectivo');await a.getByRole('button',{name:'Revisar registros'}).click();
   const b=await context.newPage();await b.goto(base+'/rl-gastos.html');await b.getByRole('button',{name:'Continuar borrador pendiente'}).click();await b.locator('[name=amount]').fill('200');await b.locator('[name=note]').fill('B pendiente');
   await b.waitForFunction(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();const list=await s.drafts();s.close();return list.some(d=>d.items?.[0]?.note==='B pendiente');});
   await a.getByRole('button',{name:'Guardar movimiento',exact:true}).click();await a.locator('#editor').waitFor({state:'hidden'});
   const stored=await read(a);assert.equal(stored.data.entries[0].amount,100);assert(stored.drafts.some(d=>d.items?.[0]?.amount===200&&d.items[0].note==='B pendiente'));
 });
 await check('Concurrent draft edits preserve the displaced version as a recoverable copy',async(a,context)=>{
   await quick(a,'100 almuerzo efectivo');await a.getByRole('button',{name:'Revisar registros'}).click();const b=await context.newPage();await b.goto(base+'/rl-gastos.html');await b.getByRole('button',{name:'Continuar borrador pendiente'}).click();await b.locator('[name=note]').fill('Cambio B');
   await b.waitForFunction(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();const d=await s.drafts();s.close();return d.some(x=>x.items?.[0]?.note==='Cambio B');});
   await a.locator('[name=note]').fill('Cambio A');await closeEditor(a);const stored=await read(a);
   assert(stored.drafts.some(d=>d.items?.[0]?.note==='Cambio B'&&d.conflictCopy));assert(stored.drafts.some(d=>d.items?.[0]?.note==='Cambio A'));
 });
 await check('Failed draft write keeps the editor open and retry preserves the pending text',async page=>{
   await quick(page,'100 almuerzo efectivo');await closeEditor(page);await page.getByRole('button',{name:'Continuar borrador pendiente'}).click();
   await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const original=Store.prototype.saveEntryDraft;window.failDraft=true;Store.prototype.saveEntryDraft=function(...args){return window.failDraft?Promise.reject(new Error('Simulated write failure')):original.apply(this,args);};});
   await page.locator('#quick-text').fill('200 almuerzo efectivo');await page.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('No se pudo'));
   await page.getByRole('button',{name:'Cerrar y conservar borrador'}).click();assert.equal(await page.locator('#editor').isVisible(),true);assert.equal(await page.locator('#quick-text').inputValue(),'200 almuerzo efectivo');assert.equal((await read(page)).data.entries.length,0);
   await page.evaluate(()=>window.failDraft=false);await closeEditor(page);await reload(page);await page.getByRole('button',{name:'Continuar borrador pendiente'}).click();assert.equal(await page.locator('#quick-text').inputValue(),'200 almuerzo efectivo');
 });
 await check('An edit committed by another tab during the draft write cannot be overwritten',async page=>{
   await seedPage(page);await page.locator('nav [data-tab=history]').click();await page.locator('[data-action=edit]').click();await page.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('Borrador guardado'));
   await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const original=Store.prototype.saveEntryDraft;Store.prototype.saveEntryDraft=async function(...args){Store.prototype.saveEntryDraft=original;await new Promise(resolve=>window.releaseDraft=resolve);return original.apply(this,args);};});
   await page.locator('[name=note]').fill('Stale local edit');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
   await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const {saveMovement}=await import('./src/core.mjs');const s=new Store(),state=await s.open();const next=await s.commit(saveMovement(state,{...state.entries[0],note:'Newer saved edit'},'sample'),state.revision);s.close();const c=new BroadcastChannel('rl-gastos-v3');c.postMessage({revision:next.revision});c.close();});
   await page.waitForFunction(()=>document.getElementById('form-error').textContent.includes('otra pestaña'));await page.evaluate(()=>window.releaseDraft());await page.waitForFunction(()=>document.getElementById('form-error').textContent.includes('cambió mientras'));
   assert.equal((await read(page)).data.entries[0].note,'Newer saved edit');assert.equal(await page.locator('#editor').isVisible(),true);
 });
 for(const revision of [7,'damaged'])await check(`Recover damaged state with revision ${revision} and retain the original`,async page=>{
   await page.evaluate(async revision=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();await s.transaction(['state'],stores=>stores.state.put({schemaVersion:3,revision,entries:[{invalid:true}]},'current'));s.close();},revision);
   await page.reload();await page.getByRole('heading',{name:'No pudimos abrir tus datos'}).waitFor();await page.locator('#import-file').setInputFiles(backupFile(seed));await page.getByRole('button',{name:'Restaurar este backup'}).click();await page.locator('#import-dialog').waitFor({state:'hidden'});
   const stored=await read(page);assert.deepEqual(stored.data.entries,seed.entries);assert(stored.copies.some(c=>c.reason==='damaged-state'&&c.state.revision===revision));assert(stored.copies.some(c=>c.reason==='initial-migration'));
   await page.getByRole('button',{name:'Ajustes',exact:true}).click();await page.getByText('Recuperación y borradores',{exact:true}).click();await page.getByRole('button',{name:'Ver copias internas de recuperación'}).click();
   const download=page.waitForEvent('download');await page.getByRole('button',{name:/damaged-state/}).click();assert.equal((await download).suggestedFilename(),'rl_gastos_recuperacion.json');
 });
 await check('Recovery rejects a changed raw snapshot and abort remains atomic',async page=>{
   const result=await page.evaluate(async()=>{
     const {Store,ConflictError}=await import('./src/store.mjs');const {initialState}=await import('./src/core.mjs');const s=new Store();await s.open();const old={revision:7,invalid:true},newer={revision:7,invalid:'newer'};
     await s.transaction(['state'],st=>st.state.put(old,'current'));const observed=await s.read();await s.transaction(['state'],st=>st.state.put(newer,'current'));let conflict=false;
     try{await s.recover(initialState(),observed);}catch(e){conflict=e instanceof ConflictError;}
     const unchanged=JSON.stringify(await s.read())===JSON.stringify(newer),copiesBefore=await s.recoveries();
     const original=s.transaction.bind(s);s.transaction=(names,work)=>original(names,(stores,tx)=>{work(stores,tx);tx.abort();});let failed=false;
     try{await s.recover(initialState(),newer);}catch{failed=true;}
     const atomic=JSON.stringify(await s.read())===JSON.stringify(newer)&&JSON.stringify(await s.recoveries())===JSON.stringify(copiesBefore);s.close();return {conflict,unchanged,failed,atomic};
   });assert.deepEqual(result,{conflict:true,unchanged:true,failed:true,atomic:true});
 });
 await check('Generated backup larger than 25 MB restores without truncating notes or entries',async page=>{
   const data=structuredClone(seed),text='ñ'.repeat(10000);data.entries=Array.from({length:700},(_,i)=>({...data.entries[0],id:'large-'+i,note:text,raw:text}));const file=backupFile(data);assert(file.buffer.length>25000000);
   await page.locator('#import-file').setInputFiles(file);await page.getByRole('heading',{name:'Revisar restauración'}).waitFor();await page.getByRole('button',{name:'Restaurar este backup'}).click();await page.locator('#import-dialog').waitFor({state:'hidden'});
   const result=await page.evaluate(async()=>{const {Store}=await import('./src/store.mjs');const s=new Store();await s.open();const d=await s.read();s.close();return {count:d.entries.length,total:d.entries.reduce((n,e)=>n+e.amount,0),notes:d.entries.every(e=>e.note==='ñ'.repeat(10000)&&e.raw===e.note)};});
   assert.deepEqual(result,{count:700,total:700*85000,notes:true});
 });
 await check('Budget scope, formatted search, privacy and keyboard flow stay consistent',async page=>{
   await seedPage(page);await page.locator('nav [data-tab=budgets]').click();await page.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Presupuesto guardado'));
   await page.locator('nav [data-tab=home]').click();assert.match(await page.locator('.hero').innerText(),/Sin definir/);assert.doesNotMatch(await page.locator('.hero').innerText(),/-85/);
   await page.locator('nav [data-tab=budgets]').click();await page.locator('#budget-cat_almuerzo').fill('100000');await page.locator('#privacy').click();await page.waitForFunction(()=>document.getElementById('privacy').getAttribute('aria-label')==='Mostrar montos');
   assert.equal(await page.locator('#budget-cat_almuerzo').getAttribute('type'),'password');assert.equal(await page.locator('#budget-cat_almuerzo').inputValue(),'100000');await page.locator('#privacy').click();await page.waitForFunction(()=>document.getElementById('budget-cat_almuerzo').type==='text');
   await page.locator('nav [data-tab=history]').click();await page.locator('#search').fill('85.000');assert.equal(await page.locator('[data-action=edit]').count(),1);await page.locator('#search').fill('cafe');assert.equal(await page.locator('[data-action=edit]').count(),1);
   await page.locator('[data-action=edit]').click();await page.locator('[name=category]').focus();await page.locator('[name=category]').selectOption('cat_hogar');assert.equal(await page.evaluate(()=>document.activeElement.name),'category');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.name),'method');
   await page.locator('[name=type]').focus();await page.locator('[name=type]').selectOption('income');assert.equal(await page.evaluate(()=>document.activeElement.name),'type');assert.equal(await page.locator('[name=method]').isVisible(),false);
   await page.locator('[name=type]').selectOption('expense');assert.equal(await page.locator('[name=method]').isVisible(),true);await page.locator('[name=category]').selectOption('cat_salida_mica');assert.equal(await page.locator('[name=subcategory]').isVisible(),true);
   await closeEditor(page);await page.locator('#search').fill('');await page.getByText('Rango de fechas',{exact:true}).click();await page.locator('#filter-from').fill('2026-09-10');await page.locator('#filter-to').fill('2026-09-01');assert.match(await page.locator('#history-list').innerText(),/Desde debe ser anterior/);
   await page.screenshot({path:`${out}/${browserName}-regression-ui.png`});
 });
 writeFileSync(`${out}/${browserName}-regression-report.json`,JSON.stringify(results,null,2));console.log(`PASS ${results.length} regression scenarios (${browserName}); synthetic data only.`);
}finally{await browser.close();}
