import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const browserName=process.env.TEST_BROWSER||'chromium';
const browserType=require(process.env.PLAYWRIGHT_MODULE||'playwright')[browserName];
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8080',out=process.env.ARTIFACT_DIR||'artifacts';
mkdirSync(out,{recursive:true});
const browser=await browserType.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const report=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'es-PY',timezoneId:'America/Asuncion',colorScheme:'light'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-09-06T15:00:00Z'));
 await page.goto(base+'/rl-gastos.html');await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();
 await page.evaluate(async()=>{
  const {Store}=await import('./src/store.mjs');const {initialState,saveMovement,dayKey,monthKey}=await import('./src/core.mjs');const store=new Store();let current=await store.open(),s=initialState();
  for(const [i,amount,note,cat,pay] of [[1,48500,'Almuerzo','cat_almuerzo','pay_tc_itau_black'],[2,215000,'Supermercado','cat_hogar','pay_debito_itau'],[3,32000,'Viaje al centro','cat_transporte','pay_efectivo'],[4,22000,'Café','cat_desayuno','pay_efectivo'],[5,85000,'Cena del sábado','cat_cena','pay_tc_itau_black'],[6,149000,'Compras para la casa','cat_hogar','pay_debito_itau']])s=saveMovement(s,{id:'demo-'+i,amount,note,raw:'Datos ficticios para revisión visual',type:'expense',categoryId:cat,paymentMethodId:pay,occurredOn:dayKey()});
  s.monthlyBudgets[monthKey()]={cat_almuerzo:400000,cat_hogar:600000,cat_transporte:300000,cat_desayuno:200000};s.favorites=['demo-4'];s.settings.lastBackupGenerated=new Date().toISOString();await store.commit(s,current.revision);store.close();
 });
 await page.reload();await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();
 async function audit(label) {
  const result=await page.evaluate(()=>{
   const main=document.querySelector('main'),nav=document.querySelector('.app-navigation'),header=document.querySelector('.topbar');
   const a=main.getBoundingClientRect(),b=nav.getBoundingClientRect(),h=header.getBoundingClientRect();
   const overlap=(x,y)=>Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1;
   const bad=[];
   if(overlap(a,b)||overlap(a,h))bad.push('Navigation or header overlaps main');
   if(document.documentElement.scrollWidth>innerWidth+1||main.scrollWidth>main.clientWidth+1)bad.push('Horizontal overflow');
   const dialog=document.querySelector('dialog[open]');
   if(dialog){const r=dialog.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1||dialog.scrollWidth>dialog.clientWidth+1)bad.push('Dialog clipped '+JSON.stringify({left:r.left,right:r.right,top:r.top,bottom:r.bottom,sw:dialog.scrollWidth,cw:dialog.clientWidth,viewport:[innerWidth,innerHeight]}));}
   const area=dialog||main;
   for(const row of area.querySelectorAll('.movement,.budget-row,.form-row,.dialog-top,.hero-footer')){
    const boxes=[...row.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlap(boxes[i],boxes[j]))bad.push('Children overlap in '+row.className);
   }
   // No opaque interface color with a green-dominant hue.
   const green=[];
   for(const el of document.querySelectorAll('body *')){
    if(!el.getClientRects().length)continue;
    const style=getComputedStyle(el);
    for(const key of ['color','backgroundColor','borderTopColor']){const rgb=style[key].match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);if(rgb){const [,r,g,b,alpha]=rgb;if((alpha===undefined||+alpha>0)&&+g>+r+18&&+g>+b+18)green.push(style[key]);}}
   }
   return {bad,green:[...new Set(green)]};
  });
  assert.deepEqual(result.bad,[],label);assert.deepEqual(result.green,[],label+' green palette');
  assert.doesNotMatch(await page.locator('body').innerText(),/Todo empieza|Un registro a la vez|Cada movimiento cuenta|Tu día, en claro/i);
  report.push({label,passed:true});
 }
 async function capture(name){await page.screenshot({path:join(out,`${browserName}-${name}.png`),animations:'disabled'});}
 async function dismissOutside(id){const r=await page.locator('#'+id).boundingBox();assert.ok(r.y>0,'There must be reachable backdrop');await page.mouse.click(2,2);await page.locator('#'+id).waitFor({state:'hidden'});}
 for(const [width,height] of [[320,568],[390,844],[430,932],[768,1024],[1024,768],[1440,960],[844,390]]) {
  await page.setViewportSize({width,height});
  await page.locator('nav [data-tab=home]').click();await audit(`${width}x${height} home`);await capture(`${width}-home`);
  for(const section of ['history','budgets','export']){await page.locator(`nav [data-tab=${section}]`).click();await audit(`${width} ${section}`);if(width===390||width===1440)await capture(`${width}-${section}`);}
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();await audit(`${width} settings`);
  await page.locator('#theme').selectOption('dark');await audit(`${width} dark settings`);
  await page.getByText('Categorías y medios de pago',{exact:true}).click();await audit(`${width} expanded settings`);
  await page.locator('#settings-title').click();assert.equal(await page.locator('#settings details[open]').count(),0);
  await dismissOutside('settings');
  await page.locator('nav [data-tab=home]').click();await audit(`${width} dark home`);if(width===390||width===1440)await capture(`${width}-dark`);
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();await page.locator('#theme').selectOption('light');await page.getByRole('button',{name:'Cerrar ajustes'}).click();await page.locator('#settings').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Registrar gasto',exact:true}).click();await page.locator('#quick-text').fill('500 almuerzo black 5881');await dismissOutside('editor');
  await page.getByRole('button',{name:'Registrar gasto',exact:true}).click();assert.equal(await page.locator('#quick-text').inputValue(),'500 almuerzo black 5881');
  await page.getByRole('button',{name:'Revisar registros'}).click();await audit(`${width} form`);
  await page.locator('[name=category]').selectOption('cat_salida_mica');assert.equal(await page.locator('[name=subcategory]').isVisible(),true);await audit(`${width} conditional field`);
  if(width===390||width===1440)await capture(`${width}-form`);
  await page.locator('[name=category]').selectOption('cat_almuerzo');assert.equal(await page.locator('[name=subcategory]').isVisible(),false);
  await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
  // Remove only this synthetic test entry through the app's recoverable trash.
  await page.locator('nav [data-tab=history]').click();await page.locator('[data-action=edit]').filter({hasText:'almuerzo black 5881'}).click();await page.getByRole('button',{name:'Enviar a papelera'}).click();await page.locator('#editor').waitFor({state:'hidden'});
 }
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Ajustes',exact:true}).click();await page.keyboard.press('Escape');await page.locator('#settings').waitFor({state:'hidden'});}
 report.push({label:'Reduced motion: panels reopen and Escape dismisses',passed:true});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(async()=>{
  const {Store}=await import('./src/store.mjs'),{saveMovement,dayKey}=await import('./src/core.mjs');const store=new Store(),s=await store.open();
  s.categories[0].name='Categoría con un nombre de prueba muy largo para comprobar ajustes y movimientos';
  const next=saveMovement(s,{id:'stress-large',amount:123456789012,type:'expense',categoryId:s.categories[0].id,paymentMethodId:s.paymentMethods[0].id,note:'DescripciónExtensaSinEspacios'.repeat(12),raw:'Demo',occurredOn:dayKey()});await store.commit(next,s.revision);store.close();
 });
 await page.reload();await page.getByRole('heading',{name:'Resumen',exact:true}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await audit(`${width} long labels and large totals`);await page.locator('nav [data-tab=history]').click();await audit(`${width} long movement`);await page.locator('nav [data-tab=home]').click();}
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,`${browserName}-layout-report.json`),JSON.stringify(report,null,2));
 console.log(`PASS: ${report.length} layout/interaction checks in ${browserName}: seven viewports, all screens, dark/light, native select changes, outside click, draft preservation, Escape, reduced motion, long labels, large amounts. Demo data only.`);
}finally{await browser.close();}
