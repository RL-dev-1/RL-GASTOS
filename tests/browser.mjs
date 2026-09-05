import { Store, ConflictError } from '../src/store.mjs';
import { initialState, saveMovement, clone, makeBackup, decodeBackup, totals, activeEntries } from '../src/core.mjs';
const result=document.getElementById('results');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const input=id=>({id,amount:500,type:'expense',categoryId:'cat_almuerzo',paymentMethodId:'pay_efectivo',note:'Prueba',raw:'500 almuerzo efectivo',occurredOn:'2026-09-05'});
document.getElementById('run').onclick=async()=>{
  result.textContent='';document.getElementById('run').disabled=true;
  let passed=0;const allStores=[],names=[];
  const make=(suffix,legacy={getItem:()=>null})=>{const name='rl-test-'+crypto.randomUUID()+'-'+suffix;names.push(name);const s=new Store({name,legacy});allStores.push(s);return s;};
  async function check(name,fn){try{await fn();result.textContent+='PASS '+name+'\n';passed++;}catch(e){result.textContent+='FAIL '+name+': '+e.message+'\n';throw e;}}
  try{
    const a=make('main');let current;
    await check('Instalación limpia, estado validado',async()=>{current=await a.open();assert(current.entries.length===0,'empty');});
    await check('Guardado confirmado y relectura',async()=>{current=await a.commit(saveMovement(current,input('A')),current.revision);assert((await a.read()).entries.length===1,'commit missing');});
    await check('Dos pestañas: la segunda escritura obsoleta se rechaza',async()=>{
      const b=new Store({name:a.name,legacy:{getItem:()=>null}});allStores.push(b);const stale=await b.open();
      current=await a.commit(saveMovement(current,input('B')),current.revision);let conflict=false;
      try{await b.commit(saveMovement(stale,input('C')),stale.revision);}catch(e){conflict=e instanceof ConflictError;}
      assert(conflict,'stale commit accepted');assert((await a.read()).entries.map(e=>e.id).join(',')==='A,B','data lost');
    });
    await check('Fallo simulado de almacenamiento aborta sin falso éxito',async()=>{
      const before=await a.read();let rejected=false;
      try{await a.transaction(['state'],(stores,tx)=>{stores.state.put({...before,entries:[]},'current');tx.failure=new DOMException('Simulated quota failure','QuotaExceededError');tx.abort();});}catch{rejected=true;}
      assert(rejected,'abort resolved');assert(JSON.stringify(await a.read())===JSON.stringify(before),'partial state');
    });
    await check('Importación inválida no modifica datos',async()=>{const before=await a.read(),bad=clone(before);bad.entries.push(clone(bad.entries[0]));let rejected=false;try{await a.commit(bad,before.revision);}catch{rejected=true;}assert(rejected,'duplicate accepted');assert(JSON.stringify(await a.read())===JSON.stringify(before),'state changed');});
    await check('Reemplazo y copia previa se confirman juntos',async()=>{const before=await a.read(),replacement=initialState();current=await a.commit(replacement,before.revision,{recovery:true});const copies=await a.recoveries();assert(copies.some(r=>r.reason==='before-replacement'&&r.state.entries.length===2),'backup missing');assert((await a.read()).entries.length===0,'replacement failed');});
    await check('Borrador persiste y se elimina con el guardado',async()=>{await a.draft({text:'pendiente'},'test-draft');assert((await a.getDraft('test-draft')).text==='pendiente','draft missing');current=await a.commit(saveMovement(current,input('D')),current.revision,{clearDraft:'test-draft'});assert(await a.getDraft('test-draft')===null,'draft not cleared');});
    await check('Backup restaurado conserva conteos y totales',async()=>{const before=await a.read();const decoded=decodeBackup(JSON.parse(JSON.stringify(makeBackup(before))));assert(JSON.stringify(totals(activeEntries(before)))===JSON.stringify(totals(activeEntries(decoded))),'totals changed');});
    await check('Migración local v2 no borra el almacenamiento original',async()=>{
      const seed=initialState(),entry={...input('legacy'),date:'2026-09-05T15:00:00Z',createdAt:'2026-09-05T15:00:00Z',updatedAt:'2026-09-05T15:00:00Z'};delete entry.occurredOn;
      const values={rl_manifest:{schemaVersion:2},rl_entries:[entry],rl_categories:seed.categories,rl_payment_methods:seed.paymentMethods,rl_budgets:{cat_almuerzo:10000}};
      const original=JSON.stringify(values);const legacy={getItem:k=>k in values?JSON.stringify(values[k]):null};const s=make('migration',legacy);const migrated=await s.open();assert(migrated.entries[0].id==='legacy','identity changed');assert(Object.keys(migrated.monthlyBudgets).length===0,'invented months');assert(JSON.stringify(values)===original,'legacy mutated');
    });
    await check('Datos antiguos corruptos no crean una instalación vacía',async()=>{const s=make('corrupt',{getItem:k=>k==='rl_entries'?'{broken':null});let failed=false;try{await s.open();}catch{failed=true;}assert(failed,'silently initialized');assert(await s.read()===null,'state written despite corruption');});
    result.textContent+='\n'+passed+' / 10 pruebas correctas';
  }catch(e){result.textContent+='\nDetenido: '+e.message;}
  finally{for(const s of allStores)s.close();for(const name of names)indexedDB.deleteDatabase(name);document.getElementById('run').disabled=false;}
};
