import { Store, ConflictError } from './store.mjs';
import { clone, uid, money, dayKey, monthKey, monthLabel, shiftMonth, activeEntries, entryDay, inPeriod, totals, parseLine, parseAmountToken, possibleDuplicate, saveMovement, setDeleted, makeBackup, decodeBackup, exportCSV, exportForChatGPT, validateState, validMonth } from './core.mjs';
import { MICA_SUBCATS } from './seeds.mjs';
import { icon } from './icons.mjs';

const $ = id => document.getElementById(id);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const movementCount = n => `${n} ${n === 1 ? 'movimiento' : 'movimientos'}`;
const amount = n => `<span class="private">${h(money(n))}</span>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const store = new Store();
let state = null, tab = 'home', selectedMonth = monthKey(), busy = false, draft = null, importCandidate = null, importRevision = null, waitingWorker = null;
let filters = { category: '', method: '', search: '', type: '', trash: false, from: '', to: '' }, historyLimit = 60;
const budgetDrafts = new Map();
const budgetFingerprint = values => JSON.stringify(Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b)));
let draftKey;
try { draftKey = sessionStorage.getItem('rl-draft-key') || uid(); sessionStorage.setItem('rl-draft-key', draftKey); } catch { draftKey = uid(); }
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('rl-gastos-v3') : null;
let noticeTimer;
let requestedUpdate = false;
const closingPanels = new WeakMap();
function openPanel(dialog) {
  if (dialog.open || closingPanels.has(dialog)) return;
  dialog.showModal();
  dialog.scrollTop = 0;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    dialog.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-in-out' });
  }
}
function closePanel(dialog) {
  if (closingPanels.has(dialog)) return closingPanels.get(dialog);
  if (!dialog.open) return Promise.resolve();
  const closing = (async () => {
    dialog.inert = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await dialog.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 220, easing: 'ease-in-out' }).finished.catch(() => {});
    }
    dialog.close();
    dialog.inert = false;
  })().finally(() => closingPanels.delete(dialog));
  closingPanels.set(dialog, closing);
  return closing;
}
async function dismissPanel(dialog) {
  if (busy || closingPanels.has(dialog)) return;
  if (dialog.id === 'editor') { captureEditor(); await persistDraft(); }
  if (dialog.id === 'import-dialog') importCandidate = null;
  await closePanel(dialog);
  render();
}
const backdropStarts = new WeakSet();
for (const dialog of document.querySelectorAll('dialog')) {
  const outside = e => { const r = dialog.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', e => { if (e.target === dialog && outside(e)) backdropStarts.add(dialog); else backdropStarts.delete(dialog); });
  dialog.addEventListener('pointerup', e => { if (backdropStarts.has(dialog) && e.target === dialog && outside(e)) dismissPanel(dialog).catch(err => notice(err.message, true)); backdropStarts.delete(dialog); });
  dialog.addEventListener('cancel', e => { e.preventDefault(); dismissPanel(dialog).catch(err => notice(err.message, true)); });
}
document.addEventListener('pointerdown', e => {
  document.querySelectorAll('details[open]').forEach(el => { if (!el.contains(e.target)) el.open = false; });
});
function notice(message, error = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; const dialog=document.querySelector('dialog[open]');if(dialog){let local=dialog.querySelector('[data-dialog-notice]');if(!local){local=document.createElement('p');local.dataset.dialogNotice='';dialog.firstElementChild.prepend(local);}local.className=error?'form-error':'hint';local.setAttribute('role',error?'alert':'status');local.textContent=message;} noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 14000 : 5000); }
function formError(message) { const el = $('form-error'); if (el && $('editor').open) { el.textContent = message; el.scrollIntoView({ block: 'nearest' }); } else notice(message, true); }
const catName = id => state.categories.find(c => c.id === id)?.name || id;
const payName = id => state.paymentMethods.find(p => p.id === id)?.name || '';
function applyTheme() { $('privacy').innerHTML = icon(state.settings.privacy ? 'hidden' : 'eye'); document.documentElement.dataset.theme = state.settings.theme; document.body.classList.toggle('privacy', state.settings.privacy); $('privacy').setAttribute('aria-label', state.settings.privacy ? 'Mostrar montos' : 'Ocultar montos en pantalla'); }
async function commit(next, message, options = {}) {
  if (busy) return false;
  busy = true;
  const locked = [...document.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled);
  locked.forEach(el => { el.disabled = true; });
  try {
    const result = await store.commit(next, state?.revision ?? -1, options);
    state = result;
    for (const [month, pending] of budgetDrafts) {
      if (pending.draftId === options.clearDraft && pending.token === options.clearDraftToken) budgetDrafts.delete(month);
    }
    channel?.postMessage({ revision: state.revision }); applyTheme(); render();
    if (message) notice(message); return true;
  } catch (e) { formError(e.message || 'No se pudo guardar. El formulario sigue disponible.'); if (e instanceof ConflictError) { const el = $('reload-data'); if (el) el.hidden = false; } return false; }
  finally { busy = false; locked.forEach(el => { if(el.isConnected) el.disabled = false; }); }
}
const title = (name, subtitle = '') => `<div class="lead"><h1>${name}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div>`;
function monthNav() { return `<div class="month-nav"><button data-action="month" data-delta="-1" aria-label="Mes anterior">${icon('left')}</button><label class="sr-only" for="month" hidden>Mes seleccionado</label><input id="month" aria-label="Mes seleccionado" type="month" value="${selectedMonth}"><button data-action="month" data-delta="1" aria-label="Mes siguiente">${icon('right')}</button></div>`; }
function rows(entries, { trash = false } = {}) {
  if (!entries.length) return `<div class="empty"><div class="empty-symbol">${icon(trash ? 'restore' : 'history')}</div><strong>${trash ? 'Papelera vacía' : 'Sin movimientos'}</strong>No hay registros en este período con los filtros actuales.</div>`;
  return entries.map(e => `<button class="movement" data-action="${trash ? 'restore' : 'edit'}" data-id="${h(e.id)}"><span class="movement-icon">${icon(trash ? 'restore' : e.type === 'income' ? 'income' : 'expense')}</span><span class="movement-main"><span class="movement-title">${h(e.note || catName(e.categoryId))}</span><span class="movement-meta">${h(catName(e.categoryId))}${e.subcategory ? ' · ' + h(MICA_SUBCATS.find(s => s.id === e.subcategory)?.label || e.subcategory) : ''} · ${h(payName(e.paymentMethodId) || 'Ingreso')} · ${entryDay(e).slice(8)}${trash ? ' · Restaurar' : ''}</span></span><span class="movement-amount ${e.type === 'income' ? 'income' : ''}">${e.type === 'income' ? '+' : ''}${amount(e.amount)}</span></button>`).join('');
}
const sorted = entries => [...entries].sort((a,b) => entryDay(b).localeCompare(entryDay(a)) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
function renderHome() {
  const entries = activeEntries(state).filter(e => inPeriod(e, { month: selectedMonth }));
  const total = totals(entries), budget = state.monthlyBudgets[selectedMonth];
  const limit = budget ? Object.values(budget).reduce((s,n) => s + n, 0) : null;
  const remaining = limit === null ? null : limit - total.expenses;
  const byCat = new Map(); entries.filter(e => e.type === 'expense').forEach(e => byCat.set(e.categoryId, (byCat.get(e.categoryId) || 0) + e.amount));
  const categories = [...byCat].sort((a,b) => b[1] - a[1]);
  const prev = shiftMonth(selectedMonth, -1), reviewed = state.reviewedMonths.includes(selectedMonth);
  let comparison = '';
  if (reviewed && state.reviewedMonths.includes(prev) && selectedMonth < monthKey()) {
    const previous = totals(activeEntries(state).filter(e => inPeriod(e, { month: prev }))).expenses;
    comparison = previous ? `${money(Math.abs(total.expenses - previous))} ${total.expenses > previous ? 'más' : 'menos'} que ${monthLabel(prev)}. Ambos meses revisados.` : 'El mes anterior revisado no tiene gastos.';
  }
  const favoriteRows = state.entries.filter(e => state.favorites.includes(e.id) && !e.deletedAt);
  const categoryRows = categories.length ? categories.map(([id, spent]) => `<button class="category" data-action="category" data-id="${h(id)}"><div class="row"><span>${h(catName(id))}</span><strong>${amount(spent)}</strong></div><div class="bar"><span style="width:${Math.round(spent / total.expenses * 100)}%"></span></div><div class="row small muted"><span>${Math.round(spent / total.expenses * 100)}% del gasto</span><span>${budget?.[id] ? 'Límite ' + amount(budget[id]) : 'Sin límite'}</span></div></button>`).join('') : '<p class="muted">Sin gastos en este mes.</p>';
  return title('Resumen') + monthNav() +
    (draft ? '<button class="button wide resume-button" data-action="resume">Continuar borrador pendiente</button>' : '') + `
    <div class="grid home-grid">
      <div class="home-summary">
        <section class="hero">
          <div class="row"><span class="eyebrow">Gastos del mes</span><span class="pill">${movementCount(total.count)}</span></div>
          <div class="amount private">${h(money(total.expenses))}</div>
          <div class="hero-footer">
            <div><span class="muted">Presupuesto restante</span><strong class="${remaining !== null && remaining < 0 ? 'danger' : ''}">${remaining === null ? 'Sin definir' : amount(remaining)}</strong></div>
            <div><span class="muted">${limit === null ? 'Presupuesto' : 'Límite del mes'}</span><strong>${limit === null ? '<button class="link-button" data-action="nav" data-tab="budgets">Definir →</button>' : amount(limit)}</strong></div>
          </div>
        </section>
        <div class="status-line"><span class="status-dot"></span><span>Guardado en este dispositivo</span><span aria-hidden="true">·</span><span>${reviewed ? 'Mes revisado' : 'Mes por revisar'}</span></div>
        ${comparison ? `<div class="hint private">${h(comparison)}</div>` : ''}
        ${total.income ? `<div class="card row"><span>Ingresos registrados</span><strong>${amount(total.income)}</strong></div>` : ''}
        ${favoriteRows.length ? '<div class="section-head"><h2>Favoritos</h2></div><div class="favorite-strip">' + favoriteRows.map(e => `<button class="button" data-action="repeat" data-id="${h(e.id)}">${h(e.note || catName(e.categoryId))}</button>`).join('') + '</div>' : ''}
      </div>
      <div class="home-recent">
        <div class="section-head"><h2>Últimos movimientos</h2><button class="link-button" data-action="nav" data-tab="history">Ver todos →</button></div>
        <div class="card">${rows(sorted(entries).slice(0,6))}</div>
        <div class="hint">${state.settings.lastBackupGenerated ? 'Último backup generado: ' + h(dayKey(state.settings.lastBackupGenerated)) + '. Comprobá que lo guardaste en Archivos.' : 'Sin backup externo generado.'}<br><button class="link-button" data-action="backup">Generar backup →</button></div>
      </div>
      <div class="home-categories">
        <div class="section-head"><h2>Gastos por categoría</h2><button class="link-button" data-action="nav" data-tab="budgets">Presupuestos →</button></div>
        <div class="card">${categoryRows}</div>
      </div>
    </div>`;
}
function filteredHistory() {
  return sorted(state.entries.filter(e => (!!e.deletedAt === filters.trash) && inPeriod(e, { month: filters.from || filters.to ? undefined : selectedMonth, from: filters.from, to: filters.to }) && (!filters.category || e.categoryId === filters.category) && (!filters.method || e.paymentMethodId === filters.method) && (!filters.type || e.type === filters.type) && (!filters.search || `${e.note} ${e.raw} ${catName(e.categoryId)} ${payName(e.paymentMethodId)} ${e.amount}`.toLocaleLowerCase('es').includes(filters.search.toLocaleLowerCase('es')))));
}
const options = (list, selected, placeholder = 'Elegir…') => `<option value="">${placeholder}</option>` + list.map(c => `<option value="${h(c.id)}" ${c.id === selected ? 'selected' : ''}>${h(c.name)}${c.active === false ? ' (archivada)' : ''}</option>`).join('');
function historyList() {
  const entries = filteredHistory(), total = totals(entries), groups = new Map();
  entries.slice(0,historyLimit).forEach(e => { const d = entryDay(e); if (!groups.has(d)) groups.set(d,[]); groups.get(d).push(e); });
  return `<div class="status-line">${movementCount(total.count)} · Gastos ${amount(total.expenses)}${total.income ? ' · Ingresos ' + amount(total.income) : ''}${filters.trash ? ' · Papelera' : ''}</div>` + (entries.length ? [...groups].map(([day,items]) => `<div class="day-heading">${h(day.split('-').reverse().join('/'))}</div><div class="card">${rows(items,{ trash:filters.trash })}</div>`).join('') : rows([])) + (entries.length > historyLimit ? '<button class="button wide" data-action="more">Mostrar más</button>' : '');
}
function renderHistory() {
  return title('Movimientos') + monthNav() + `<div class="filters"><input class="full" id="search" aria-label="Buscar movimientos" placeholder="Descripción, categoría o monto" value="${h(filters.search)}"><select id="filter-category" aria-label="Filtrar categoría">${options(state.categories,filters.category,'Todas las categorías')}</select><select id="filter-method" aria-label="Filtrar medio">${options(state.paymentMethods,filters.method,'Todos los medios')}</select><select id="filter-type" aria-label="Filtrar tipo"><option value="">Gastos e ingresos</option><option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Gastos</option><option value="income" ${filters.type === 'income' ? 'selected' : ''}>Ingresos</option></select><button class="button" data-action="trash">${filters.trash ? 'Ver activos' : 'Papelera'}</button></div><details><summary>Rango de fechas</summary><div class="form-row"><label>Desde<input type="date" id="filter-from" value="${filters.from}"></label><label>Hasta<input type="date" id="filter-to" value="${filters.to}"></label></div><button class="link-button" data-action="clear-filters">Restablecer filtros y volver al mes</button></details><div id="history-list">${historyList()}</div>`;
}
function budgetStatus(month) {
  const pending = budgetDrafts.get(month);
  if (pending) {
    if (pending.base !== budgetFingerprint(state.monthlyBudgets[month])) return 'El presupuesto guardado cambió. Tus montos siguen en el borrador; revisá el presupuesto guardado antes de reemplazarlo.';
    return pending.storageError || 'Cambios pendientes. Pulsá Guardar presupuesto para aplicarlos.';
  }
  return state.monthlyBudgets[month] ? 'Presupuesto guardado para ' + monthLabel(month) + '.' : 'Ingresá los límites y pulsá Guardar presupuesto.';
}
function budgetTotal(values) { return Object.values(values || {}).reduce((total, value) => total + (parseAmountToken(String(value)) || 0), 0); }
function updateBudgetFormStatus() {
  const form = $('budget-form');
  if (!form) return;
  $('budget-status').textContent = budgetStatus(form.dataset.month);
  $('discard-budget').hidden = !budgetDrafts.has(form.dataset.month);
}
function captureBudgetForm(form = $('budget-form')) {
  if (!form || busy) return null;
  const month = form.dataset.month, previous = budgetDrafts.get(month);
  const values = Object.fromEntries([...form.querySelectorAll('input[name]')].map(input => [input.name, input.value]));
  if (previous && JSON.stringify(previous.values) === JSON.stringify(values)) return previous;
  const pending = { kind:'budget', draftId:'budget-' + month, token:uid(), month, values, base:previous?.base ?? form.dataset.base, updatedAt:new Date().toISOString() };
  budgetDrafts.set(month, pending);
  $('budget-total').innerHTML = amount(budgetTotal(values));
  updateBudgetFormStatus();
  // Start the transaction on each edit, before iOS can suspend the page.
  store.draft(pending, pending.draftId).catch(() => {
    if (budgetDrafts.get(month) !== pending) return;
    pending.storageError = 'No se pudo conservar el borrador. Mantené la app abierta y volvé a intentar guardar.';
    updateBudgetFormStatus();
  });
  return pending;
}
async function submitBudget(form) {
  if (busy) return;
  const pending = captureBudgetForm(form), month = pending.month;
  if (pending.base !== budgetFingerprint(state.monthlyBudgets[month])) throw new Error('El presupuesto de este mes cambió. Tus montos siguen en el borrador. Usá «Descartar cambios y ver guardado» para revisarlo.');
  const values = {};
  for (const [id, value] of Object.entries(pending.values)) {
    const text = value.trim(), n = text === '' || /^0+$/.test(text) ? 0 : parseAmountToken(text);
    if (n === null) throw new Error('Revisá el monto de ' + catName(id) + '. Usá guaraníes enteros, por ejemplo 500.000.');
    values[id] = n;
  }
  const next = clone(state);
  next.monthlyBudgets[month] = values;
  validateState(next);
  await commit(next, 'Presupuesto guardado para ' + monthLabel(month) + '. Total: ' + money(budgetTotal(values)) + '.', { clearDraft:pending.draftId, clearDraftToken:pending.token });
}
function renderBudgets() {
  const saved = state.monthlyBudgets[selectedMonth], known = !!saved, pending = budgetDrafts.get(selectedMonth);
  const values = pending?.values || saved;
  const base = pending?.base ?? budgetFingerprint(saved);
  return title('Presupuestos', 'Límites de gasto por categoría y mes.') + monthNav() + `
    <div class="hint">${known ? 'Estos límites pertenecen solo a ' + h(monthLabel(selectedMonth)) + '.' : 'Este mes no tiene presupuesto definido.'}</div>
    <form id="budget-form" data-month="${selectedMonth}" data-base="${h(base)}">
      <div class="card">
        ${state.categories.filter(c => c.type === 'expense' && (c.active !== false || values?.[c.id] !== undefined)).map(c => `<div class="budget-row"><label for="budget-${h(c.id)}">${h(c.name)}${c.active === false ? ' (archivada)' : ''}</label><input id="budget-${h(c.id)}" name="${h(c.id)}" inputmode="numeric" aria-label="Presupuesto ${h(c.name)}" value="${h(values?.[c.id] ?? '')}" placeholder="Sin límite"></div>`).join('')}
        <p class="small muted">Vacío o cero: sin límite en esa categoría. El total es la suma de los límites definidos.</p>
        <div class="row"><strong>Total</strong><strong id="budget-total">${amount(budgetTotal(values))}</strong></div>
      </div>
      <p class="small muted" id="budget-status" role="status">${h(budgetStatus(selectedMonth))}</p>
      <div class="actions"><button class="button primary" type="submit" data-write>Guardar presupuesto</button><button class="button" type="button" data-action="copy-budget">Copiar mes anterior</button></div>
      <button class="link-button" id="discard-budget" type="button" data-action="discard-budget" ${pending ? '' : 'hidden'}>Descartar cambios y ver guardado</button>
      ${Object.keys(state.legacyBudgets).length ? '<button class="link-button" type="button" data-action="legacy-budget">Usar los límites de tu backup en este mes</button>' : ''}
    </form>
    <div class="card" style="margin-top:24px"><h2>Revisión del mes</h2><p class="muted">Marcalo cuando hayas comprobado que están todos los movimientos. Una modificación del mes vuelve a dejarlo pendiente.</p><button class="button" data-write data-action="review-month">${state.reviewedMonths.includes(selectedMonth) ? 'Quitar marca de revisado' : 'Marcar mes como revisado'}</button></div>`;
}
function renderExport() {
  const total = totals(activeEntries(state).filter(e => inPeriod(e,{ month:selectedMonth })));
  return title('Exportar', 'Archivos para ChatGPT, Excel y respaldo.') + monthNav() + '<button class="link-button" data-action="share-file">Compartir el último archivo generado →</button>' + `<div class="grid"><div class="stack"><section class="hero"><div class="eyebrow">${h(monthLabel(selectedMonth))}</div><div class="amount private">${h(money(total.expenses))}</div><p>${movementCount(total.count)} · Gastos del período</p><button class="button primary wide" data-action="chatgpt">Exportar para ChatGPT</button><p class="small muted">JSON con historial completo, selección del mes, IDs, revisiones y totales de control. Incluye la papelera para conciliar eliminaciones.</p></section><div class="card"><h2>CSV para Excel</h2><p class="muted">Columnas estables y montos numéricos en guaraníes. Contiene movimientos activos.</p><div class="actions"><button class="button" data-action="csv-month">Este mes</button><button class="button" data-action="csv-all">Todo el historial</button></div></div></div><div class="stack"><div class="card"><h2>Backup completo</h2><p class="muted">Conserva movimientos, papelera, favoritos, categorías y presupuestos. Guardalo en Archivos o iCloud.</p><button class="button wide" data-action="backup">Generar backup JSON</button><p class="small muted">Generar el archivo no confirma que quedó guardado fuera de la app.</p><button class="link-button" data-action="import">Restaurar un backup →</button></div><div class="card"><h2>Cómo llevarlo al Excel</h2><p>1. Exportá para ChatGPT.</p><p>2. Adjuntá el JSON y tu Excel.</p><p>3. Pedí conciliar por ID y verificar los totales.</p><div class="hint">Revisá los totales y las fórmulas del Excel antes de reemplazar el archivo original.</div></div><button class="link-button" data-action="print">Imprimir resumen del mes</button></div></div>`;
}
function render() { if (!state) return; $('main').innerHTML = `<div class="page-view">${({ home:renderHome, history:renderHistory, budgets:renderBudgets, export:renderExport })[tab]()}</div>`; document.querySelectorAll('.bottom-nav button').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); }); }
function navigate(next) { tab = next; historyLimit = 60; render(); $('main').scrollTo({ top:0 }); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('main').firstElementChild.animate([{opacity:.4},{opacity:1}],{duration:220,easing:'ease-in-out'}); }

function blankEntry() { return { id:uid(), amount:null, note:'', raw:'', categoryId:'', paymentMethodId:'', occurredOn:dayKey(), type:'expense', subcategory:'' }; }
async function persistDraft() {
  if (!draft) return;
  const value = { ...clone(draft), draftId:draftKey, updatedAt:new Date().toISOString() };
  try { await store.draft(value,draftKey); const el = $('draft-status'); if (el) el.textContent = 'Borrador guardado en este dispositivo'; }
  catch { const el = $('draft-status'); if (el) { el.textContent = 'No se pudo guardar el borrador. Exportalo antes de cerrar.'; el.classList.add('danger'); } }
}
function captureEditor() {
  if (!draft) return;
  if (draft.mode === 'quick') { draft.text = $('quick-text')?.value || ''; draft.type = $('quick-type')?.value || 'expense'; }
  else draft.items = [...document.querySelectorAll('[data-entry-form]')].map((form,i) => { const get = name => form.querySelector(`[name="${name}"]`).value; return { ...draft.items[i], amount:parseAmountToken(get('amount')), amountText:get('amount'), note:get('note'), categoryId:get('category'), paymentMethodId:get('type') === 'income' ? null : get('method'), occurredOn:get('day'), type:get('type'), subcategory:get('subcategory') }; });
}
function openEditor(existing = null, repeat = false) {
  if (!state) return;
  if (existing) {
    if (draft && !confirm('Hay un borrador pendiente. ¿Reemplazarlo con este movimiento?')) return;
    const item = clone(existing); if (repeat) { item.id = uid(); item.occurredOn = dayKey(); delete item.deletedAt; }
    draft = { mode:'form', editId:repeat ? null : existing.id, editVersion:repeat ? null : existing.version, original:repeat ? null : clone(existing), items:[item] };
  } else if (!draft) draft = { mode:'quick', text:'', type:'expense' };
  renderEditor(); if (!$('editor').open) openPanel($('editor'));
  persistDraft();
}
function entryForm(item,index) {
  return `<div class="batch-row" data-entry-form="${index}">${draft.items.length > 1 ? `<div class="row"><h3>Movimiento ${index+1}</h3><button class="link-button" data-action="remove-batch" data-index="${index}">Quitar</button></div>` : ''}<label>Monto en guaraníes<input class="amount-input" name="amount" inputmode="numeric" placeholder="0" value="${h(item.amountText ?? item.amount ?? '')}" required></label><label>Descripción<input name="note" maxlength="10000" placeholder="¿En qué fue?" value="${h(item.note)}"></label><div class="form-row"><label>Tipo<select name="type"><option value="expense" ${item.type==='expense'?'selected':''}>Gasto</option><option value="income" ${item.type==='income'?'selected':''}>Ingreso</option></select></label><label>Fecha<input type="date" name="day" value="${h(item.occurredOn)}" required></label></div><label>Categoría<select name="category" required>${options(state.categories.filter(c => c.type === item.type && (c.active!==false || c.id===item.categoryId)),item.categoryId,'Elegí una categoría')}</select></label><label ${item.type==='income'?'hidden':''}>Medio de pago<select name="method" ${item.type==='income'?'':'required'}>${options(state.paymentMethods.filter(p => p.active!==false || p.id===item.paymentMethodId),item.paymentMethodId,'Elegí cómo pagaste')}</select></label><label ${item.categoryId==='cat_salida_mica'?'':'hidden'}>Detalle de Salida Mica<select name="subcategory"><option value="">Sin detalle</option>${MICA_SUBCATS.map(s => `<option value="${s.id}" ${s.id===item.subcategory?'selected':''}>${h(s.label)}</option>`).join('')}${item.subcategory && !MICA_SUBCATS.some(s=>s.id===item.subcategory)?`<option selected value="${h(item.subcategory)}">${h(item.subcategory)}</option>`:''}</select></label>${possibleDuplicate(state,item,draft.editId) ? '<p class="warning small">Hay un movimiento similar. Podés guardarlo si es otro gasto.</p>' : ''}</div>`;
}
function renderEditor() {
  const quick = draft.mode === 'quick';
  $('editor-content').innerHTML = `<div class="dialog-top"><h2 id="editor-title">${draft.editId ? 'Editar movimiento' : 'Registrar'}</h2><button class="icon-button" data-action="close-editor" aria-label="Cerrar y conservar borrador">${icon('close')}</button></div><div id="form-error" class="form-error" role="alert"></div><button id="reload-data" hidden class="button" data-action="reload">Recargar datos guardados</button>${quick ? `<p class="muted">Empezá por el monto. Revisás todo antes de guardar.</p><label>Tipo<select id="quick-type"><option value="expense" ${draft.type==='expense'?'selected':''}>Gasto</option><option value="income" ${draft.type==='income'?'selected':''}>Ingreso</option></select></label><label>Uno o varios movimientos<textarea id="quick-text" rows="4" placeholder="85.500 almuerzo itaú black&#10;200k ropa atlas">${h(draft.text)}</textarea></label><div class="actions"><button class="button primary" data-action="parse">Revisar registros</button><button class="button" data-action="manual">Usar formulario</button></div>` : `<form id="movement-form">${draft.items.map(entryForm).join('')}<div class="dialog-footer"><button class="button primary wide" type="submit" data-write>${draft.editId ? 'Guardar cambios' : 'Guardar ' + (draft.items.length > 1 ? draft.items.length + ' movimientos' : 'movimiento')}</button></div></form>`}<div id="draft-status" class="draft-status"></div><div class="actions"><button class="link-button" data-action="export-draft">Exportar borrador</button><button class="link-button danger" data-action="discard-draft">Descartar borrador</button></div>${draft.editId ? `<div class="actions"><button class="button" data-action="favorite" data-id="${h(draft.editId)}" data-write>${state.favorites.includes(draft.editId)?'Quitar favorito':'Guardar favorito'}</button><button class="button danger" data-action="delete" data-id="${h(draft.editId)}" data-write>Enviar a papelera</button></div><p class="small muted">ID ${h(draft.editId)} · Revisión ${draft.editVersion}</p>` : ''}`;
}
function assertEditedMovementCurrent() {
  if (draft.editId && (state.entries.find(e => e.id === draft.editId)?.version !== draft.editVersion || (draft.original && JSON.stringify(state.entries.find(e => e.id === draft.editId)) !== JSON.stringify(draft.original)))) throw new Error('Este movimiento cambió mientras lo editabas. Exportá el borrador y abrí la versión actual para comparar.');
}
async function submitMovements() {
  if (busy) return;
  captureEditor();
  try {
    assertEditedMovementCurrent();
    let candidate = state, duplicate = false;
    for (const item of draft.items) {
      if (item.occurredOn > dayKey()) throw new Error('Usá la fecha de un gasto realizado. Los gastos futuros no se registran como realizados.');
      if (possibleDuplicate(candidate,item,draft.editId)) duplicate = true;
      const clean = clone(item); delete clean.amountText;
      if (clean.categoryId !== 'cat_salida_mica') delete clean.subcategory;
      candidate = saveMovement(candidate,clean,draft.editId);
    }
    if (duplicate && !confirm('Hay movimientos similares por fecha, monto, categoría y medio. ¿Confirmás que son gastos distintos?')) return;
    if (await commit(candidate,'Guardado en este dispositivo.',{ clearDraft:draftKey })) { draft = null; await closePanel($('editor')); render(); }
  } catch (e) { formError(e.message); }
}

let latestFile = null;
function download(content, name, type) {
  const blob = new Blob([content],{ type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  latestFile = new File([blob],name,{ type });
}
async function generateBackup() {
  if (!state) return;
  download(JSON.stringify(makeBackup(state),null,2),`rl_gastos_backup_${dayKey()}.json`,'application/json');
  const next=clone(state); next.settings.lastBackupGenerated=new Date().toISOString();
  await commit(next,'Archivo generado. Guardalo fuera de la app.');
}
function settingsHTML() {
  return `<div class="dialog-top"><h2 id="settings-title">Ajustes</h2><button class="icon-button" data-action="close-settings" aria-label="Cerrar ajustes">${icon('close')}</button></div><label>Apariencia<select id="theme">${['system','light','dark'].map((v,i)=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${['Sistema','Claro','Oscuro'][i]}</option>`).join('')}</select></label><div class="hint">Los datos se guardan en este dispositivo. Conservá un backup externo para cambiar de teléfono o recuperarte de un borrado.</div><button class="button wide" data-action="backup">Generar backup</button><button class="link-button" data-action="share-file">Compartir último archivo generado</button><button class="link-button" data-action="persistent">Solicitar conservación del almacenamiento</button><p class="small muted">El navegador puede concederla o no. No reemplaza un backup.</p><details><summary>Categorías y medios de pago</summary><p class="small muted">Archivar conserva los movimientos y los presupuestos históricos.</p><div id="config-list">${state.categories.map(c=>configRow(c,'category')).join('')}${state.paymentMethods.map(c=>configRow(c,'method')).join('')}</div><form id="config-form"><h3 style="margin-top:18px">Agregar o editar</h3><input type="hidden" id="config-id"><label>Clase<select id="config-kind"><option value="expense">Categoría de gasto</option><option value="income">Categoría de ingreso</option><option value="method">Medio de pago</option></select></label><label>Nombre<input id="config-name" maxlength="120" required></label><label>Palabras clave, separadas por coma<input id="config-keywords" maxlength="2000"></label><button class="button" type="submit" data-write>Guardar</button></form></details><details><summary>Recuperación y borradores</summary><button class="link-button" data-action="recoveries">Ver copias internas de recuperación</button><div id="recoveries-list"></div><button class="link-button" data-action="drafts">Ver borradores guardados</button><div id="drafts-list"></div></details><p class="small muted">RL Gastos 3.0 · ${movementCount(activeEntries(state).length)} ${activeEntries(state).length === 1 ? 'activo' : 'activos'} · Revisión ${state.revision}</p>`;
}
function configRow(c,kind) { return `<div class="config-item"><div class="row"><span>${h(c.name)} <small class="muted">${c.active===false?'Archivada':''}</small></span><button class="link-button" data-action="config-edit" data-id="${h(c.id)}" data-kind="${kind}">Editar</button></div><button class="link-button" data-action="archive" data-write data-id="${h(c.id)}" data-kind="${kind}">${c.active===false?'Reactivar':'Archivar'}</button></div>`; }
function showSettings() { $('settings-content').innerHTML=settingsHTML(); if (!$('settings').open) openPanel($('settings')); }
async function prepareImport(file) {
  try {
    if (file.size > 25000000) throw new Error('El archivo supera 25 MB. No se importó nada.');
    importCandidate = decodeBackup(JSON.parse(await file.text())); importRevision = state?.revision ?? -1;
    const total=totals(activeEntries(importCandidate)), existing=state ? totals(activeEntries(state)) : { count:0 };
    $('import-content').innerHTML=`<div class="dialog-top"><h2 id="import-title">Revisar restauración</h2><button class="icon-button" data-action="close-import" aria-label="Cancelar importación">${icon('close')}</button></div><p>Archivo: ${h(file.name)}</p><div class="card"><p><strong>${movementCount(total.count)} ${total.count === 1 ? 'activo' : 'activos'}</strong></p><p>Gastos ${amount(total.expenses)}</p><p>Ingresos ${amount(total.income)}</p><p>${importCandidate.entries.filter(e=>e.deletedAt).length} en papelera</p></div><div class="hint">Reemplazará los ${existing.count} movimientos actuales. Antes se guardará una copia interna del estado actual, dentro de la misma transacción. No fusiona historiales.</div><div id="import-error" class="form-error" role="alert"></div><button class="button primary wide" data-write data-action="confirm-import">Restaurar este backup</button>`;
    openPanel($('import-dialog'));
  } catch(e) { notice(e.message || 'Archivo inválido.',true); }
  finally { $('import-file').value=''; }
}
async function refreshData() {
  const latest=await store.read();
  if (!latest || latest.revision===state?.revision) return;
  state=validateState(latest); applyTheme(); render();
  if ($('editor').open) formError('Se cargaron cambios de otra pestaña. Tu borrador se conserva; comprobá sus datos antes de guardar.');
}
channel?.addEventListener('message',()=>refreshData().catch(e=>notice(e.message,true)));

document.addEventListener('input',e=>{
  if (e.target.closest('#editor')) { captureEditor(); persistDraft(); }
  if (e.target.id==='search') { filters.search=e.target.value; historyLimit=60; $('history-list').innerHTML=historyList(); }
  if (e.target.closest('#budget-form')) captureBudgetForm();
});
document.addEventListener('change', async e=>{
  try {
    if (e.target.closest('#budget-form')) captureBudgetForm();
    if (e.target.id==='month') { if (validMonth(e.target.value)) { selectedMonth=e.target.value; filters.from=''; filters.to=''; render(); } }
    if (e.target.id.startsWith('filter-')) { const key={ 'filter-category':'category','filter-method':'method','filter-type':'type','filter-from':'from','filter-to':'to' }[e.target.id]; filters[key]=e.target.value; historyLimit=60; $('history-list').innerHTML=historyList(); }
    if (e.target.closest('#editor') && ['type','category'].includes(e.target.name)) { captureEditor(); const item=draft.items[Number(e.target.closest('[data-entry-form]').dataset.entryForm)]; if(e.target.name==='type'){item.categoryId='';item.paymentMethodId=item.type==='income'?null:'';} renderEditor(); persistDraft(); }
    if(e.target.id==='theme'){const next=clone(state);next.settings.theme=e.target.value;await commit(next,'Apariencia guardada.');}
    if(e.target.id==='import-file' && e.target.files[0]) await prepareImport(e.target.files[0]);
  }catch(err){notice(err.message,true);}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  try {
    if(e.target.id==='movement-form') return await submitMovements();
    if(e.target.id==='budget-form') return await submitBudget(e.target);
    if(e.target.id==='config-form') { const next=clone(state), kind=$('config-kind').value,id=$('config-id').value,name=$('config-name').value.trim(),keywords=$('config-keywords').value.split(',').map(k=>k.trim()).filter(Boolean);const list=kind==='method'?next.paymentMethods:next.categories; const original=list.find(c=>c.id===id); if(list.some(c=>c.id!==id && c.name.toLocaleLowerCase()===name.toLocaleLowerCase() && (kind==='method'||c.type===kind))) throw new Error('Ese nombre ya existe.'); const item={...original,id:id||((kind==='method'?'pay_':'cat_')+uid()),name,keywords,active:original?.active??true,updatedAt:new Date().toISOString()};if(kind!=='method')item.type=original?.type||kind;if(original)list[list.indexOf(original)]=item;else list.push(item);validateState(next);if(await commit(next,'Configuración guardada.')) showSettings(); }
  }catch(err){formError(err.message);}
});
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]'); if(!button || button.disabled) return;
  const { action,id }=button.dataset;
  try {
    if(action==='nav') navigate(button.dataset.tab);
    if(action==='retry') location.reload();
    if(action==='month'){selectedMonth=shiftMonth(selectedMonth,Number(button.dataset.delta));filters.from='';filters.to='';render();}
    if(action==='add'||action==='resume') openEditor();
    if(action==='edit'||action==='repeat') openEditor(state.entries.find(x=>x.id===id),action==='repeat');
    if(action==='close-editor'){captureEditor();await persistDraft();await closePanel($('editor'));render();}
    if(action==='manual'){captureEditor();draft={mode:'form',editId:null,items:[{...blankEntry(),...parseLine(draft.text||'',state,draft.type||'expense')}]};renderEditor();persistDraft();}
    if(action==='parse'){captureEditor();const lines=draft.text.split('\n').map(l=>l.trim()).filter(Boolean);if(!lines.length)throw new Error('Escribí un monto y una descripción.');if(lines.length>100)throw new Error('Revisemos hasta 100 movimientos por carga.');draft={mode:'form',editId:null,items:lines.map(line=>({...blankEntry(),...parseLine(line,state,draft.type)}))};renderEditor();persistDraft();}
    if(action==='remove-batch'){captureEditor();draft.items.splice(Number(button.dataset.index),1);if(!draft.items.length)draft={mode:'quick',text:'',type:'expense'};renderEditor();persistDraft();}
    if(action==='discard-draft' && confirm('¿Descartar este borrador? Los movimientos guardados no cambian.')){await store.draft(null,draftKey);draft=null;await closePanel($('editor'));render();}
    if(action==='export-draft'){captureEditor();download(JSON.stringify({app:'RL Gastos',kind:'draft',draft},null,2),'rl_gastos_borrador.json','application/json');}
    if(action==='reload'){await refreshData();$('reload-data').hidden=true;}
    if(action==='delete'){assertEditedMovementCurrent();if(await commit(setDeleted(state,id,true),'Movimiento enviado a papelera.',{clearDraft:draftKey})){draft=null;await closePanel($('editor'));render();}}
    if(action==='restore') await commit(setDeleted(state,id,false),'Movimiento restaurado.');
    if(action==='favorite'){const next=clone(state);next.favorites=next.favorites.includes(id)?next.favorites.filter(x=>x!==id):[...next.favorites,id];if(await commit(next,'Favoritos actualizados.'))renderEditor();}
    if(action==='category'){filters={category:id,method:'',search:'',type:'expense',trash:false,from:'',to:''};navigate('history');}
    if(action==='trash'){filters.trash=!filters.trash;render();}
    if(action==='more'){historyLimit+=60;$('history-list').innerHTML=historyList();}
    if(action==='clear-filters'){filters={category:'',method:'',search:'',type:'',trash:false,from:'',to:''};render();}
    if(action==='copy-budget'||action==='legacy-budget'){const values=action==='legacy-budget'?state.legacyBudgets:state.monthlyBudgets[shiftMonth(selectedMonth,-1)];if(!values)throw new Error('El mes anterior no tiene presupuesto definido.');document.querySelectorAll('#budget-form input').forEach(input=>{input.value=values[input.name]??'';});captureBudgetForm();notice('Límites copiados al formulario. Revisalos y guardá.');}
    if(action==='discard-budget'){const pending=budgetDrafts.get(selectedMonth);if(pending && confirm('¿Descartar los cambios de este mes y volver al presupuesto guardado?')){await store.draft(null,pending.draftId,pending.token);budgetDrafts.delete(selectedMonth);render();}}
    if(action==='review-month'){const next=clone(state);next.reviewedMonths=next.reviewedMonths.includes(selectedMonth)?next.reviewedMonths.filter(m=>m!==selectedMonth):[...next.reviewedMonths,selectedMonth];await commit(next,'Estado de revisión guardado.');}
    if(action==='backup') await generateBackup();
    if(action==='chatgpt'){download(JSON.stringify(exportForChatGPT(state,{month:selectedMonth}),null,2),`rl_gastos_chatgpt_${selectedMonth}.json`,'application/json');notice('Exportación generada. Incluye historial completo y controles.');}
    if(action==='csv-month'||action==='csv-all'){download(exportCSV(state,action==='csv-month'?{month:selectedMonth}:{}),`rl_gastos_${action==='csv-month'?selectedMonth:'historial'}.csv`,'text/csv;charset=utf-8');notice('CSV generado.');}
    if(action==='settings')showSettings();
    if(action==='close-settings')await closePanel($('settings'));
    if(action==='import')$('import-file').click();
    if(action==='close-import'){await closePanel($('import-dialog'));importCandidate=null;}
    if(action==='confirm-import'&&importCandidate){if((state?.revision??-1)!==importRevision)throw new Error('Los datos cambiaron desde la vista previa. Volvé a seleccionar el backup para revisar la restauración.');if(await commit(importCandidate,'Backup restaurado.',{recovery:true})){importCandidate=null;await closePanel($('import-dialog'));await closePanel($('settings'));selectedMonth=monthKey();render();}else $('import-error').textContent=$('notice').textContent;}
    if(action==='archive'){const next=clone(state),list=button.dataset.kind==='category'?next.categories:next.paymentMethods,c=list.find(c=>c.id===id);if(c.active!==false && list.filter(x=>x.active!==false && x.type===c.type).length<=1)throw new Error('Conservá al menos una opción activa de este tipo.');c.active=c.active===false;c.updatedAt=new Date().toISOString();if(await commit(next,'Estado actualizado.'))showSettings();}
    if(action==='config-edit'){const c=(button.dataset.kind==='category'?state.categories:state.paymentMethods).find(c=>c.id===id);$('config-id').value=id;$('config-name').value=c.name;$('config-kind').value=c.type||'method';$('config-kind').disabled=true;$('config-keywords').value=(c.keywords||[]).join(', ');$('config-name').focus();}
    if(action==='persistent'){const granted=await navigator.storage?.persist?.();notice(granted?'El navegador concedió conservación del almacenamiento. Mantené igualmente un backup.':'El navegador no concedió conservación adicional. Guardá un backup externo.');}
    if(action==='share-file'){if(!latestFile)throw new Error('Generá primero el archivo que querés compartir.');if(navigator.canShare?.({files:[latestFile]}))await navigator.share({files:[latestFile],title:'RL Gastos'});else notice('Compartir no está disponible aquí. Usá el archivo descargado.');}
    if(action==='recoveries'){const list=await store.recoveries();$('recoveries-list').innerHTML=list.map((r,i)=>`<button class="link-button" data-action="recovery-download" data-index="${i}">${h(r.reason)} · ${h(dayKey(r.at))} · Descargar</button>`).join('')||'Sin copias internas.';}
    if(action==='recovery-download'){const list=await store.recoveries();download(JSON.stringify(makeBackup(list[Number(button.dataset.index)].state),null,2),'rl_gastos_recuperacion.json','application/json');}
    if(action==='drafts'){const list=await store.drafts();$('drafts-list').innerHTML=list.map((d,i)=>`<button class="link-button" data-action="draft-load" data-index="${i}">Borrador ${h(d.updatedAt?.slice(0,16)||'')} · Abrir</button>`).join('')||'Sin borradores.';}
    if(action==='draft-load'){const list=await store.drafts();draft=list[Number(button.dataset.index)];draftKey=draft.draftId||draftKey;await closePanel($('settings'));openEditor();}
    if(action==='update'){if(busy)throw new Error('Esperá a que termine el guardado.');if(draft){captureEditor();await store.draft(draft,draftKey);}requestedUpdate=true;if(waitingWorker)waitingWorker.postMessage({type:'SKIP_WAITING'});else location.reload();}
    if(action==='print'){const entries=activeEntries(state).filter(e=>inPeriod(e,{month:selectedMonth}));const t=totals(entries);$('main').innerHTML=title('Extracto mensual',h(monthLabel(selectedMonth)))+`<p>${movementCount(t.count)} · Gastos ${amount(t.expenses)} · Ingresos ${amount(t.income)}</p><div class="card">${rows(sorted(entries))}</div>`;window.print();render();}
  }catch(err){if(err.name!=='AbortError')formError(err.message);}
});
$('privacy').addEventListener('click',async()=>{if(!state)return;const next=clone(state);next.settings.privacy=!next.settings.privacy;await commit(next,'');});

document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&draft){captureEditor();persistDraft();}else if(document.visibilityState==='visible')refreshData().catch(e=>notice(e.message,true));});
let lastDay=dayKey();setInterval(()=>{if(lastDay!==dayKey()){lastDay=dayKey();render();}},60000);
async function start() {
  try {
    state=await store.open();applyTheme();draft=await store.getDraft(draftKey);
    if(!draft){const list=await store.drafts();draft=list.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0]||null;if(draft?.draftId)draftKey=draft.draftId;}
    for (const pending of await store.drafts('budget')) {
      if (validMonth(pending.month) && pending.values && typeof pending.base === 'string') budgetDrafts.set(pending.month, pending);
    }
    render();
    const last=state.settings.lastBackupGenerated;
    if(activeEntries(state).length && (!last || Date.now()-Date.parse(last)>7*86400000))notice('Backup pendiente. Generá una copia en Exportar.');
  }catch(e){$('main').innerHTML=`<div class="card"><h1>No pudimos abrir tus datos</h1><p>${h(e.message)}</p><p>Conservá los datos del navegador. Podés recuperar tu backup JSON.</p><button class="button" data-action="import">Importar backup</button><button class="button" data-action="retry">Reintentar</button></div>`;}
  if('serviceWorker' in navigator){try{const hadController=!!navigator.serviceWorker.controller;const reg=await navigator.serviceWorker.register('./sw.js');const pending=()=>{if(reg.waiting){waitingWorker=reg.waiting;$('update').hidden=false;}};pending();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',pending));navigator.serviceWorker.addEventListener('controllerchange',()=>{if(requestedUpdate)location.reload();else if(hadController){waitingWorker=null;$('update').hidden=false;}});reg.update().catch(()=>{});}catch{notice('La app abrió, pero no se pudo preparar el acceso sin conexión.',true);}}
}
start();
