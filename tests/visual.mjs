import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8080',out=process.env.ARTIFACT_DIR||'artifacts';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'es-PY',timezoneId:'America/Asuncion',colorScheme:'light'}),page=await context.newPage();
 await page.goto(base+'/rl-gastos.html');await page.getByRole('heading',{name:'Tus gastos, en claro.'}).waitFor();
 await page.evaluate(async()=>{
  const {Store}=await import('./src/store.mjs');const {initialState,saveMovement,dayKey,monthKey}=await import('./src/core.mjs');const store=new Store();let current=await store.open(),s=initialState();
  for(const [i,amount,note,cat,pay] of [[1,48500,'Almuerzo en La Esquina','cat_almuerzo','pay_tc_itau_black'],[2,215000,'Compras del supermercado','cat_hogar','pay_debito_itau'],[3,32000,'Viaje al centro','cat_transporte','pay_efectivo'],[4,22000,'Café de la mañana','cat_desayuno','pay_efectivo']])s=saveMovement(s,{id:'demo-'+i,amount,note,raw:'Ejemplo ficticio',type:'expense',categoryId:cat,paymentMethodId:pay,occurredOn:dayKey()});
  s.monthlyBudgets[monthKey()]={cat_almuerzo:400000,cat_hogar:500000,cat_transporte:300000,cat_desayuno:200000};s.favorites=['demo-4'];s.settings.lastBackupGenerated=new Date().toISOString();await store.commit(s,current.revision);store.close();
 });
 await page.reload();await page.getByRole('heading',{name:'Tus gastos, en claro.'}).waitFor();
 await page.evaluate(()=>{document.querySelector('.lead .eyebrow').textContent='DEMO · DATOS FICTICIOS';});
 await page.screenshot({path:join(out,'rl-gastos-iphone.png'),animations:'disabled'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow');
 await page.getByRole('button',{name:'Registrar gasto',exact:false}).click();await page.getByRole('button',{name:'Usar formulario'}).click();await page.screenshot({path:join(out,'rl-gastos-registro.png'),animations:'disabled'});await page.getByRole('button',{name:'Cerrar y conservar borrador'}).click();
 await page.waitForFunction(()=>!document.getElementById('editor').open);
 await page.evaluate(()=>{document.querySelector('.lead .eyebrow').textContent='DEMO · DATOS FICTICIOS';});
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(out,'rl-gastos-oscuro.png'),animations:'disabled'});
 await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1280,height:920});await page.screenshot({path:join(out,'rl-gastos-escritorio.png'),animations:'disabled',fullPage:true});
 console.log('PASS: captures with synthetic data; mobile, dark, entry, desktop; no horizontal overflow.');
}finally{await browser.close();}
