// Local only: accepts a user-provided backup path; never copy the fixture into git.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { decodeBackup, makeBackup, totals, exportForChatGPT, activeEntries, entryDay, saveMovement, setDeleted } from '../src/core.mjs';
const path=process.argv[2];if(!path)throw new Error('Usage: node tests/verify-backup.mjs /path/to/backup.json');
const original=JSON.parse(readFileSync(path,'utf8'));
const migrated=decodeBackup(original);
assert.equal(migrated.entries.length,original.data.entries.length);
for(const entry of original.data.entries){const next=migrated.entries.find(e=>e.id===entry.id);for(const key of Object.keys(entry))assert.deepEqual(next[key],entry[key],`Field ${key} must remain intact`);}
assert.deepEqual(totals(activeEntries(migrated)),totals(original.data.entries));
assert.deepEqual(decodeBackup(JSON.parse(JSON.stringify(makeBackup(migrated)))),migrated);
const exported=exportForChatGPT(migrated);assert.equal(exported.controls.all.count,original.data.entries.length);
for(const [m,t] of Object.entries(exported.controls.byMonth))assert.deepEqual(t,totals(original.data.entries.filter(e=>entryDay(e).startsWith(m))));
const first=migrated.entries[0],edited=saveMovement(migrated,{...first,amount:first.amount+1},first.id);
assert.equal(edited.entries.length,migrated.entries.length);assert.equal(totals(activeEntries(edited)).expenses,totals(activeEntries(migrated)).expenses+1);
assert.equal(activeEntries(setDeleted(setDeleted(migrated,first.id,true),first.id,false)).length,migrated.entries.length);
console.log(`PASS: ${migrated.entries.length} records; every original field preserved; monthly totals reconciled; backup roundtrip; export; edit; trash/restore.`);
