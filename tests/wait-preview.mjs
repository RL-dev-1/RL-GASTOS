import {readFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';

const expected = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const base = process.env.TEST_BASE_URL;
if (!base) throw new Error('TEST_BASE_URL is required');
let matched = false;
for (let attempt = 0; attempt < 36; attempt++) {
  try {
    const response = await fetch(base + '/sw.js', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (response.ok && await response.text() === expected) { matched = true; break; }
  } catch { /* Deployment may still be building. */ }
  await setTimeout(5000);
}
if (!matched) throw new Error('The preview did not publish this app version in time');
console.log('PASS: published preview matches the tested app version.');
