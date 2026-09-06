import { clone, initialState, decodeBackup, validateState } from './core.mjs';
export class ConflictError extends Error { constructor() { super('Hay cambios guardados desde otra pestaña. Recargá los datos antes de continuar; tu formulario sigue abierto.'); this.name = 'ConflictError'; } }
function legacyState(storage) {
  const read = key => { const raw = storage.getItem(key); return raw === null ? null : JSON.parse(raw); };
  const entries = read('rl_entries');
  const hasOtherData = read('rl_categories') || read('rl_payment_methods') || read('rl_budgets');
  if (entries === null && !hasOtherData) return initialState();
  const seed = initialState();
  if (entries && !Array.isArray(entries)) throw new Error('El historial antiguo está dañado. Importá el backup JSON para recuperarlo.');
  const manifest = read('rl_manifest');
  if (entries?.length && (!manifest || manifest.schemaVersion !== 2)) throw new Error('El almacenamiento antiguo necesita una migración compatible. Importá el backup JSON v2.');
  const data = { entries: entries || [], categories: read('rl_categories') || seed.categories, paymentMethods: read('rl_payment_methods') || seed.paymentMethods, budgets: read('rl_budgets') || {}, alerted: read('rl_alerted') || {}, manifest };
  const state = decodeBackup({ app: 'RL Gastos', exportVersion: 1, schemaVersion: 2, data });
  state.settings = { theme: read('rl_theme') || 'system', privacy: !!read('rl_privacy') };
  return validateState(state);
}
export class Store {
  constructor({ name = 'rl-gastos-v3', factory = indexedDB, legacy = localStorage } = {}) { this.name = name; this.factory = factory; this.legacy = legacy; }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('state'); db.createObjectStore('recovery'); db.createObjectStore('drafts'); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Cerrá otras pestañas de RL Gastos para actualizar su almacenamiento.'));
      request.onsuccess = () => resolve(request.result);
    });
    this.db.onversionchange = () => this.db.close();
    const existing = await this.read();
    if (existing) return validateState(existing);
    // Parse and validate before writing. Legacy localStorage remains untouched.
    const candidate = legacyState(this.legacy);
    return this.transaction(['state','recovery'], stores => {
      const req = stores.state.get('current');
      req.onsuccess = () => {
        if (req.result) return;
        stores.recovery.put({ at: new Date().toISOString(), reason: 'initial-migration', state: candidate }, 'initial-migration');
        stores.state.put(candidate, 'current');
      };
    }).then(() => this.read());
  }
  read() { return new Promise((resolve, reject) => { const tx = this.db.transaction('state', 'readonly'), req = tx.objectStore('state').get('current'); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }
  transaction(names, work) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = this.db.transaction(names, 'readwrite', { durability: 'strict' }); } catch { tx = this.db.transaction(names, 'readwrite'); }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.failure || tx.error || new Error('No se pudo guardar. Tu cambio no fue confirmado.'));
      tx.onerror = () => {}; // onabort is the final result; individual requests are not a commit.
      try { work(Object.fromEntries(names.map(n => [n, tx.objectStore(n)])), tx); } catch (e) { tx.failure = e; tx.abort(); }
    });
  }
  async commit(candidate, expectedRevision, { recovery = false, clearDraft = null, clearDraftToken = null } = {}) {
    const next = clone(validateState(candidate));
    next.revision = expectedRevision + 1;
    await this.transaction(['state','recovery','drafts'], (stores, tx) => {
      const req = stores.state.get('current');
      req.onsuccess = () => {
        const current = req.result;
        if ((current?.revision ?? -1) !== expectedRevision) { tx.failure = new ConflictError(); tx.abort(); return; }
        if (recovery && current) stores.recovery.put({ at: new Date().toISOString(), reason: 'before-replacement', state: current }, 'before-replacement');
        stores.state.put(next, 'current');
        if (clearDraft) this.deleteDraft(stores.drafts, clearDraft, clearDraftToken);
      };
    });
    return next;
  }
  deleteDraft(drafts, key, token) {
    if (!token) { drafts.delete(key); return; }
    const req = drafts.get(key);
    req.onsuccess = () => { if (req.result?.token === token) drafts.delete(key); };
  }
  async draft(value, key = 'entry', token = null) { return this.transaction(['drafts'], s => value === null ? this.deleteDraft(s.drafts, key, token) : s.drafts.put(value, key)); }
  getDraft(key = 'entry') { return new Promise((resolve, reject) => { const req = this.db.transaction('drafts').objectStore('drafts').get(key); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }
  drafts(kind = 'entry') { return new Promise((resolve, reject) => { const req = this.db.transaction('drafts').objectStore('drafts').getAll(); req.onsuccess = () => resolve(req.result.filter(d => (d.kind || 'entry') === kind)); req.onerror = () => reject(req.error); }); }
  recoveries() { return new Promise((resolve, reject) => { const req = this.db.transaction('recovery').objectStore('recovery').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  close() { this.db?.close(); }
}
