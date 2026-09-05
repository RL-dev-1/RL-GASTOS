import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, clone, parseLine, parseAmountToken, saveMovement, setDeleted, makeBackup, decodeBackup, validateState, totals, activeEntries, inPeriod, dayKey, validDay, shiftMonth, exportCSV, exportForChatGPT, possibleDuplicate } from '../src/core.mjs';
const input = (overrides = {}) => ({ id:'test-entry',amount:85500,type:'expense',note:'Almuerzo con amigos',raw:'85.500 almuerzo efectivo',categoryId:'cat_almuerzo',paymentMethodId:'pay_efectivo',occurredOn:'2026-09-05',...overrides });
const fixture = () => saveMovement(initialState(),input());
test('amount formats and ambiguous formats',()=>{
  for(const [text,expected] of [['85.500',85500],['85,500',85500],['200k',200000],['1.5m',1500000],['1,5k',1500],['500',500]])assert.equal(parseAmountToken(text),expected);
  for(const text of ['1.500k','-500','0','100.50','9e9','Infinity','9007199254740992','1.000,000'])assert.equal(parseAmountToken(text),null,text);
});
test('card suffix never replaces leading amount and unknown data stays unresolved',()=>{
  const state=initialState();const e=parseLine('500 almuerzo black 5881',state);
  assert.equal(e.amount,500);assert.equal(e.paymentMethodId,'pay_tc_itau_black');
  const unknown=parseLine('500 cosa nueva',state);assert.equal(unknown.paymentMethodId,'');assert.equal(unknown.categoryId,'');
  assert.equal(parseLine('black 5881',state).amount,null);
});
test('keyword boundaries avoid incidental substring matches',()=>{assert.notEqual(parseLine('500 pantalla efectivo',initialState()).categoryId,'cat_desayuno');});
test('dates use Paraguay business day and reject impossible dates',()=>{
  assert.equal(dayKey('2026-09-01T01:00:00Z'),'2026-08-31');assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2024-02-29'),true);assert.equal(shiftMonth('2026-01',-1),'2025-12');
});
test('today and week exclude future entries including tomorrow',()=>{
  const e={occurredOn:'2026-09-06'};
  assert.equal(inPeriod(e,{period:'today'},'2026-09-05'),false);assert.equal(inPeriod(e,{period:'week'},'2026-09-05'),false);
  assert.equal(inPeriod({occurredOn:'2026-08-31'},{period:'week'},'2026-09-05'),true);
  assert.equal(inPeriod({occurredOn:'2026-08-30'},{period:'week'},'2026-09-05'),false);
});
test('v3 backup roundtrip includes favorites, trash and monthly budgets',()=>{
  let s=fixture();s.favorites=['test-entry'];s.monthlyBudgets['2026-09']={cat_almuerzo:300000};s=setDeleted(s,'test-entry',true);
  assert.deepEqual(decodeBackup(JSON.parse(JSON.stringify(makeBackup(s)))),s);
});
test('v2 migration preserves IDs and original fields without inventing monthly budgets',()=>{
  const s=fixture(),entry=s.entries[0];delete entry.version;delete entry.occurredOn;
  const payload={app:'RL Gastos',exportVersion:1,schemaVersion:2,data:{entries:s.entries,categories:s.categories,paymentMethods:s.paymentMethods,budgets:{cat_almuerzo:200000}}};
  const migrated=decodeBackup(payload);for(const [k,v] of Object.entries(entry))assert.deepEqual(migrated.entries[0][k],v);
  assert.deepEqual(migrated.monthlyBudgets,{});assert.equal(migrated.legacyBudgets.cat_almuerzo,200000);
});
test('strict import rejects duplicate IDs, broken references and unexpected versions',()=>{
  const bad=makeBackup(fixture());bad.data.entries.push(clone(bad.data.entries[0]));assert.throws(()=>decodeBackup(bad),/duplicado/);
  const ref=makeBackup(fixture());ref.data.entries[0].paymentMethodId='pay_missing';assert.throws(()=>decodeBackup(ref),/Medio/);
  const future=makeBackup(fixture());future.schemaVersion=999;assert.throws(()=>decodeBackup(future),/Versión/);
  const noid=makeBackup(fixture());delete noid.data.entries[0].id;assert.throws(()=>decodeBackup(noid),/identificador/);
});
test('strict import rejects fractional money, negative budgets and malformed metadata',()=>{
  for(const invalid of [NaN,Infinity,0,-1,0.5,Number.MAX_SAFE_INTEGER+1]){const s=fixture();s.entries[0].amount=invalid;assert.throws(()=>validateState(s));}
  for(const invalid of ['oops',-10,0.5]){const s=fixture();s.monthlyBudgets['2026-09']={cat_almuerzo:invalid};assert.throws(()=>validateState(s));}
  const s=fixture();s.categories[0].keywords=[{}];assert.throws(()=>validateState(s),/palabras/);
});
test('editing keeps identity and creation timestamp, invalidates both month reviews',()=>{
  const s=fixture();s.reviewedMonths=['2026-08','2026-09'];const e=s.entries[0];
  const next=saveMovement(s,input({amount:90000,occurredOn:'2026-08-31'}),'test-entry');
  assert.equal(next.entries[0].id,e.id);assert.equal(next.entries[0].createdAt,e.createdAt);assert.equal(next.entries[0].version,2);assert.deepEqual(next.reviewedMonths,[]);assert.equal(s.entries[0].amount,85500);
});
test('soft delete and restore preserve financial record',()=>{
  const s=fixture(),deleted=setDeleted(s,'test-entry',true);assert.equal(activeEntries(deleted).length,0);assert.equal(deleted.entries.length,1);
  const restored=setDeleted(deleted,'test-entry',false);assert.equal(totals(activeEntries(restored)).expenses,85500);assert.equal(restored.entries[0].version,3);
});
test('double submit with same operation identity cannot create a second entry',()=>{assert.throws(()=>saveMovement(fixture(),input()),/duplicado/);});
test('duplicate suggestions do not prevent legitimate distinct transactions',()=>{
  const s=fixture();assert.equal(possibleDuplicate(s,input()),true);const next=saveMovement(s,input({id:'second-entry'}));assert.equal(next.entries.length,2);
});
test('CSV has stable IDs and protects spreadsheet formulas while JSON remains lossless',()=>{
  const s=saveMovement(initialState(),input({note:'=1+1, "texto"\nsegunda línea'}));const csv=exportCSV(s);
  assert.match(csv,/"id","revision","fecha"/);assert.match(csv,/test-entry/);assert.match(csv,/'=1\+1/);assert.match(csv,/""texto""/);
  assert.equal(exportForChatGPT(s).data.entries[0].note,'=1+1, "texto"\nsegunda línea');
});
test('export carries selected totals, complete history and tombstones',()=>{
  let s=fixture();s=saveMovement(s,input({id:'august',amount:100,occurredOn:'2026-08-31'}));s=setDeleted(s,'august',true);
  const ex=exportForChatGPT(s,{month:'2026-09'});assert.equal(ex.controls.selected.expenses,85500);assert.equal(ex.controls.deletedCount,1);assert.equal(ex.data.entries.length,2);assert.equal(ex.completeHistory,true);
});
test('sum overflow is rejected before confirmation',()=>{assert.throws(()=>totals([{type:'expense',amount:Number.MAX_SAFE_INTEGER},{type:'expense',amount:1}]),/seguro/);});
