import { buildSeedCategories, buildSeedPaymentMethods } from './seeds.mjs';

export const SCHEMA = 3;
export const ZONE = 'America/Asuncion';
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const money = amount => '₲ ' + new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(amount);
export const fold = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function dayKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const monthKey = value => dayKey(value).slice(0, 7);
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
}
export const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function shiftMonth(key, delta) {
  const d = new Date(key + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
export const monthLabel = key => new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + '-15T12:00:00Z'));
export function sum(items) {
  const total = items.reduce((s, e) => s + e.amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error('El total excede el rango de cálculo seguro.');
  return total;
}
export const activeEntries = state => state.entries.filter(e => !e.deletedAt);
export const entryDay = e => e.occurredOn || dayKey(e.date);
export function inPeriod(e, { month, from, to, period } = {}, today = dayKey()) {
  const day = entryDay(e);
  if (period === 'today') return day === today;
  if (period === 'week') {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return day >= d.toISOString().slice(0, 10) && day <= today;
  }
  return (!month || day.startsWith(month)) && (!from || day >= from) && (!to || day <= to);
}
export function totals(entries) {
  const expenses = sum(entries.filter(e => e.type === 'expense'));
  const income = sum(entries.filter(e => e.type === 'income'));
  return { count: entries.length, expenses, income, net: income - expenses };
}
export function initialState() {
  return { schemaVersion: SCHEMA, revision: 0, entries: [], categories: buildSeedCategories(), paymentMethods: buildSeedPaymentMethods(), monthlyBudgets: {}, legacyBudgets: {}, reviewedMonths: [], favorites: [], settings: { theme: 'system', privacy: false }, createdAt: new Date().toISOString() };
}
const idPattern = /^[a-zA-Z0-9_-]{1,120}$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const validISO = v => typeof v === 'string' && isoPattern.test(v) && validDay(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
function ensure(condition, message) { if (!condition) throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function validateConfig(list, kind) {
  ensure(Array.isArray(list) && list.length > 0 && list.length <= 1000, `${kind}: lista inválida.`);
  const ids = new Set();
  for (const item of list) {
    ensure(object(item) && typeof item.id === 'string' && idPattern.test(item.id) && item.id.startsWith(kind === 'Categorías' ? 'cat_' : 'pay_') && !ids.has(item.id), `${kind}: identificador inválido o duplicado.`);
    ids.add(item.id);
    ensure(typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120, `${kind}: nombre inválido.`);
    ensure(item.keywords === undefined || (Array.isArray(item.keywords) && item.keywords.every(k => typeof k === 'string' && k.length <= 120)), `${kind}: palabras clave inválidas.`);
    ensure(item.active === undefined || typeof item.active === 'boolean', `${kind}: estado inválido.`);
    if (kind === 'Categorías') ensure(['expense', 'income'].includes(item.type), 'Tipo de categoría inválido.');
  }
}
function validateBudgets(budgets, categories) {
  ensure(object(budgets), 'Presupuestos inválidos.');
  for (const [id, amount] of Object.entries(budgets)) {
    ensure(categories.some(c => c.id === id && c.type === 'expense'), 'Presupuesto con categoría inexistente.');
    ensure(Number.isSafeInteger(amount) && amount >= 0, 'El presupuesto debe ser un entero no negativo.');
  }
  sum(Object.values(budgets).map(amount => ({ amount })));
}
export function validateState(state) {
  ensure(object(state) && state.schemaVersion === SCHEMA, 'Versión de datos no compatible.');
  ensure(Number.isSafeInteger(state.revision) && state.revision >= 0, 'Revisión inválida.');
  validateConfig(state.categories, 'Categorías'); validateConfig(state.paymentMethods, 'Medios');
  ensure(Array.isArray(state.entries) && state.entries.length <= 100000, 'Lista de movimientos inválida o demasiado grande.');
  const ids = new Set(), cats = new Map(state.categories.map(c => [c.id, c]));
  const pays = new Set(state.paymentMethods.map(p => p.id));
  for (const e of state.entries) {
    ensure(object(e) && typeof e.id === 'string' && idPattern.test(e.id) && !ids.has(e.id), 'Movimiento con identificador inválido o duplicado.'); ids.add(e.id);
    ensure(Number.isSafeInteger(e.amount) && e.amount > 0, 'El monto debe ser un entero positivo en guaraníes.');
    ensure(['expense', 'income'].includes(e.type) && cats.get(e.categoryId)?.type === e.type, 'Categoría incompatible con el movimiento.');
    ensure(e.type === 'income' ? e.paymentMethodId === null : pays.has(e.paymentMethodId), 'Medio de pago inválido.');
    ensure(validISO(e.date) && validDay(e.occurredOn), 'Fecha de movimiento inválida.');
    ensure(validISO(e.createdAt) && validISO(e.updatedAt), 'Fecha de auditoría inválida.');
    ensure(!e.deletedAt || validISO(e.deletedAt), 'Fecha de eliminación inválida.');
    ensure(Number.isSafeInteger(e.version) && e.version > 0, 'Revisión de movimiento inválida.');
    ensure(typeof e.note === 'string' && e.note.length <= 10000 && typeof e.raw === 'string' && e.raw.length <= 10000, 'Descripción inválida o demasiado larga.');
    ensure(e.subcategory === undefined || typeof e.subcategory === 'string', 'Subcategoría inválida.');
  }
  totals(activeEntries(state));
  ensure(object(state.monthlyBudgets), 'Presupuestos mensuales inválidos.');
  for (const [key, value] of Object.entries(state.monthlyBudgets)) { ensure(validMonth(key), 'Mes de presupuesto inválido.'); validateBudgets(value, state.categories); }
  validateBudgets(state.legacyBudgets || {}, state.categories);
  ensure(Array.isArray(state.reviewedMonths) && state.reviewedMonths.every(validMonth), 'Períodos revisados inválidos.');
  ensure(Array.isArray(state.favorites) && state.favorites.every(id => ids.has(id)), 'Favoritos inválidos.');
  ensure(object(state.settings) && ['system', 'light', 'dark'].includes(state.settings.theme) && typeof state.settings.privacy === 'boolean', 'Preferencias inválidas.');
  ensure(!state.settings.lastBackupGenerated || validISO(state.settings.lastBackupGenerated), 'Fecha de respaldo inválida.');
  return state;
}
export function decodeBackup(payload) {
  ensure(object(payload) && payload.app === 'RL Gastos' && payload.exportVersion === 1, 'Este archivo no es un backup compatible de RL Gastos.');
  ensure([2, SCHEMA].includes(payload.schemaVersion), 'Versión de backup no compatible. No se modificó nada.');
  const d = clone(payload.data); ensure(object(d), 'Backup sin datos.');
  if (payload.schemaVersion === SCHEMA) return validateState(d);
  const state = initialState();
  state.categories = d.categories; state.paymentMethods = d.paymentMethods;
  ensure(Array.isArray(d.entries), 'Backup sin movimientos válidos.');
  state.entries = d.entries.map(e => ({ ...e, occurredOn: e.occurredOn || (validISO(e.date) ? dayKey(e.date) : ''), createdAt: e.createdAt || e.date, updatedAt: e.updatedAt || e.date, version: 1, note: e.note ?? '', raw: e.raw ?? '' }));
  state.legacyBudgets = d.budgets || {};
  state.legacyMetadata = { manifest: d.manifest || null, alerted: d.alerted || {}, exportedAt: payload.exportedAt || null };
  state.migratedAt = new Date().toISOString();
  return validateState(state);
}
export const makeBackup = state => ({ app: 'RL Gastos', exportVersion: 1, schemaVersion: SCHEMA, exportedAt: new Date().toISOString(), data: clone(validateState(state)) });

export function parseAmountToken(token) {
  const text = token.toLowerCase().replace(/^₲\s*/, '').trim();
  const suffix = text.match(/^(\d+(?:[.,]\d{1,2})?)\s*([km])$/);
  let n;
  if (suffix) n = Math.round(Number(suffix[1].replace(',', '.')) * (suffix[2] === 'k' ? 1000 : 1000000));
  else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text) && !(text.includes('.') && text.includes(','))) n = Number(text.replace(/[.,]/g, ''));
  else if (/^\d+$/.test(text)) n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function infer(text, config) {
  const normalized = ' ' + fold(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const scores = config.filter(c => c.active !== false).map(c => ({ id: c.id, score: Math.max(0, ...[c.name, ...(c.keywords || [])].map(k => { const key = fold(k).replace(/[^a-z0-9]+/g, ' ').trim(); return key && normalized.includes(' ' + key + ' ') ? key.length : 0; })) })).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  return scores.length && (scores.length === 1 || scores[0].score > scores[1].score) ? scores[0].id : '';
}
export function parseLine(line, state, type = 'expense', today = dayKey()) {
  // Require the amount at the beginning; never search card numbers as a fallback.
  const match = line.trim().match(/^(?:₲\s*)?(\d[\d.,]*(?:\s*[kKmM]\b)?)(?:\s+|$)(.*)$/);
  const text = match ? match[2] : line;
  return { amount: match ? parseAmountToken(match[1]) : null, note: text.trim(), raw: line, type, occurredOn: today, categoryId: infer(text, state.categories.filter(c => c.type === type)), paymentMethodId: type === 'income' ? null : infer(text, state.paymentMethods), subcategory: '' };
}
export function possibleDuplicate(state, entry, ignoreId = '') {
  return activeEntries(state).some(e => e.id !== ignoreId && e.type === entry.type && e.amount === entry.amount && entryDay(e) === entry.occurredOn && e.categoryId === entry.categoryId && e.paymentMethodId === entry.paymentMethodId);
}
export function saveMovement(state, input, id = null) {
  const next = clone(state), now = new Date().toISOString();
  const index = id ? next.entries.findIndex(e => e.id === id && !e.deletedAt) : -1;
  if (id && index < 0) throw new Error('Ese movimiento ya no está disponible.');
  const old = index >= 0 ? next.entries[index] : null;
  const e = { ...old, ...input, id: old?.id || input.id || uid(), date: old && old.occurredOn === input.occurredOn ? old.date : input.occurredOn + 'T12:00:00-03:00', createdAt: old?.createdAt || now, updatedAt: now, version: (old?.version || 0) + 1, note: input.note || '', raw: input.raw || '' };
  if (index >= 0) next.entries[index] = e; else next.entries.push(e);
  next.reviewedMonths = next.reviewedMonths.filter(m => m !== e.occurredOn.slice(0, 7) && m !== old?.occurredOn.slice(0, 7));
  return validateState(next);
}
export function setDeleted(state, id, deleted) {
  const next = clone(state), e = next.entries.find(e => e.id === id);
  if (!e) throw new Error('Movimiento inexistente.');
  if (deleted) e.deletedAt = new Date().toISOString(); else delete e.deletedAt;
  e.updatedAt = new Date().toISOString(); e.version += 1;
  next.reviewedMonths = next.reviewedMonths.filter(m => m !== e.occurredOn.slice(0, 7));
  return validateState(next);
}
function csvCell(value) {
  let s = String(value ?? '');
  // Prevent descriptions from becoming formulas when opened in a spreadsheet.
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportCSV(state, selection = {}) {
  const rows = activeEntries(state).filter(e => inPeriod(e, selection)).sort((a,b) => entryDay(a).localeCompare(entryDay(b)) || a.id.localeCompare(b.id));
  const header = ['id','revision','fecha','tipo','moneda','monto','categoria_id','categoria','medio_id','medio','descripcion','subcategoria','creado','modificado'];
  return '\uFEFF' + [header, ...rows.map(e => [e.id, e.version, entryDay(e), e.type, 'PYG', e.amount, e.categoryId, state.categories.find(c => c.id === e.categoryId).name, e.paymentMethodId, state.paymentMethods.find(p => p.id === e.paymentMethodId)?.name || '', e.note, e.subcategory || '', e.createdAt, e.updatedAt])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function exportForChatGPT(state, selection = {}) {
  const selected = activeEntries(state).filter(e => inPeriod(e, selection));
  const byMonth = {};
  for (const m of [...new Set(activeEntries(state).map(e => entryDay(e).slice(0, 7)))].sort()) byMonth[m] = totals(activeEntries(state).filter(e => entryDay(e).startsWith(m)));
  return { format: 'rl-gastos-excel', formatVersion: 1, currency: 'PYG', timeZone: ZONE, exportedAt: new Date().toISOString(), selection, selectedIds: selected.map(e => e.id), controls: { selected: totals(selected), all: totals(activeEntries(state)), byMonth, deletedCount: state.entries.filter(e => e.deletedAt).length }, completeHistory: true, instructions: 'Conciliar por id y revision. No duplicar. Revisar eliminaciones y cambios de período. No asumir que una exportación fue incorporada al Excel. Los montos son enteros en PYG. Conservar fórmulas. Informar diferencias y controles.', data: clone(state) };
}
