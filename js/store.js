// Datamodell og forretningslogikk. Holder en kopi av dataene i minnet
// (registeret er lite nok) og skriver alle endringer til IndexedDB.

import * as db from './db.js';
import { nowISO, todayISO, randCode, norm, daysBetween, blobToDataURL, dataURLToBlob } from './util.js';

export const STATUS = {
  tilgjengelig: 'Tilgjengelig',
  utlant: 'Utlånt',
  reparasjon: 'Til reparasjon',
  savnet: 'Savnet',
  kassert: 'Kassert',
};
export const OWNER = { meg: 'Meg', arbeidsgiver: 'Arbeidsgiver', andre: 'Andre' };
export const DOC_KINDS = { kvittering: 'Kvittering', garanti: 'Garanti', bruksanvisning: 'Bruksanvisning', annet: 'Annet' };
export const MAINT_KINDS = { service: 'Service', reparasjon: 'Reparasjon', kontroll: 'Kontroll' };

export const S = {
  mode: 'meg',
  items: new Map(),
  places: new Map(),
  loans: new Map(),
  packlists: new Map(),
  events: [],
  meta: {},
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

const DB_NAMES = { meg: 'hvv-meg', demo: 'hvv-demo' };

export async function load(mode = 'meg') {
  S.mode = mode;
  await db.open(DB_NAMES[mode]);
  const [items, places, loans, packlists, events, meta] = await Promise.all(
    ['items', 'places', 'loans', 'packlists', 'events', 'meta'].map((s) => db.getAll(s))
  );
  S.items = new Map(items.map((x) => [x.id, x]));
  S.places = new Map(places.map((x) => [x.id, x]));
  S.loans = new Map(loans.map((x) => [x.id, x]));
  S.packlists = new Map(packlists.map((x) => [x.id, x]));
  S.events = events.sort((a, b) => (a.at < b.at ? 1 : -1));
  S.meta = Object.fromEntries(meta.map((m) => [m.id, m.value]));
  blobUrlCache.forEach((u) => URL.revokeObjectURL(u));
  blobUrlCache.clear();
  emit();
}

const MAPS = { items: 'items', places: 'places', loans: 'loans', packlists: 'packlists' };

// Skriver alle endringer i én transaksjon, og oppdaterer minnet først når lagringen lyktes.
async function commit(ops) {
  await db.write(ops);
  for (const o of ops) {
    if (MAPS[o.store]) {
      if (o.del !== undefined) S[o.store].delete(o.del);
      else S[o.store].set(o.put.id, o.put);
    } else if (o.store === 'events') {
      if (o.del !== undefined) S.events = S.events.filter((e) => e.id !== o.del);
      else {
        const i = S.events.findIndex((e) => e.id === o.put.id);
        if (i >= 0) S.events[i] = o.put;
        else S.events.unshift(o.put);
      }
    } else if (o.store === 'meta') {
      S.meta[o.put.id] = o.put.value;
    }
  }
  emit();
}

export const setMeta = (key, value) => commit([{ store: 'meta', put: { id: key, value } }]);

// ---------- ID-er ----------
// Stabile ID-er brukes i QR-kodene. De endres aldri, selv om navn eller plassering endres.
export function newObjectId(prefix) {
  for (;;) {
    const id = prefix + randCode(7);
    if (!S.items.has(id) && !S.places.has(id)) return id;
  }
}
const newId = (p) => p + randCode(10);

export function lookup(id) {
  if (S.items.has(id)) return { kind: 'item', obj: S.items.get(id) };
  if (S.places.has(id)) return { kind: 'place', obj: S.places.get(id) };
  return null;
}

function event(type, text, refs = [], data = {}) {
  return { store: 'events', put: { id: newId('E'), at: nowISO(), type, text, refs, data } };
}

// ---------- Bilder og vedlegg ----------
const blobUrlCache = new Map();

export async function putBlobOp(blob, name = '') {
  const id = newId('B');
  return { id, op: { store: 'blobs', put: { id, blob, mime: blob.type, name, at: nowISO() } } };
}

export async function putBlob(blob, name = '') {
  const { id, op } = await putBlobOp(blob, name);
  await db.write([op]);
  return id;
}

export async function blobURL(id) {
  if (!id) return null;
  if (blobUrlCache.has(id)) return blobUrlCache.get(id);
  const rec = await db.get('blobs', id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  blobUrlCache.set(id, url);
  return url;
}

export const getBlob = (id) => db.get('blobs', id);

function blobRefs() {
  const refs = new Set();
  for (const it of S.items.values()) {
    (it.photos || []).forEach((b) => refs.add(b));
    (it.docs || []).forEach((d) => refs.add(d.blobId));
  }
  for (const p of S.places.values()) if (p.photo) refs.add(p.photo);
  for (const l of S.loans.values()) (l.photos || []).forEach((b) => refs.add(b));
  return refs;
}

// ---------- Plasseringer ----------
export function path(placeId) {
  const out = [];
  const seen = new Set();
  let p = S.places.get(placeId);
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    out.unshift(p);
    p = S.places.get(p.parentId);
  }
  return out;
}

export const pathText = (placeId, sep = ' → ') => path(placeId).map((p) => p.name).join(sep) || 'Ingen plassering';

export function isWithin(placeId, ancestorId) {
  return path(placeId).some((p) => p.id === ancestorId);
}

export const children = (parentId) =>
  [...S.places.values()].filter((p) => (p.parentId || null) === (parentId || null)).sort(byName);

export const byName = (a, b) => a.name.localeCompare(b.name, 'nb');

export function placeTree() {
  const out = [];
  const walk = (pid, depth) => {
    for (const p of children(pid)) {
      out.push({ place: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export const itemsDirectlyIn = (placeId) => [...S.items.values()].filter((i) => i.placeId === placeId).sort(byName);

export const itemsWithin = (placeId) => [...S.items.values()].filter((i) => i.placeId && isWithin(i.placeId, placeId));

// En utlånt kasse gjør alt innholdet utilgjengelig.
export function loanedBoxAbove(placeId) {
  return path(placeId).find((p) => p.kind === 'kasse' && p.loanId) || null;
}

export function availability(item) {
  if (item.status && item.status !== 'tilgjengelig') {
    const loan = item.loanId ? S.loans.get(item.loanId) : null;
    return { code: item.status, available: false, label: STATUS[item.status], loan };
  }
  const box = item.placeId ? loanedBoxAbove(item.placeId) : null;
  if (box) {
    return { code: 'utlant', available: false, label: `Utlånt (i ${box.name})`, loan: S.loans.get(box.loanId), viaBox: box };
  }
  return { code: 'tilgjengelig', available: true, label: STATUS.tilgjengelig };
}

export function placeAvailability(place) {
  const box = loanedBoxAbove(place.id);
  if (box) return { code: 'utlant', available: false, label: box.id === place.id ? 'Utlånt' : `Utlånt (i ${box.name})`, loan: S.loans.get(box.loanId) };
  return { code: 'tilgjengelig', available: true, label: 'Tilgjengelig' };
}

// Siste bekreftelse: eget tidspunkt, eller når kassen den ligger i sist ble flyttet/bekreftet.
export function lastConfirmed(item) {
  let at = item.lastConfirmedAt || item.createdAt;
  let via = null;
  for (const p of path(item.placeId)) {
    if (p.kind === 'kasse' && p.lastConfirmedAt && p.lastConfirmedAt > at) {
      at = p.lastConfirmedAt;
      via = p;
    }
  }
  return { at, via };
}

export async function savePlace(data) {
  const isNew = !data.id || !S.places.has(data.id);
  const old = S.places.get(data.id);
  const p = {
    ...(old || {}),
    ...data,
    id: data.id || newObjectId(data.kind === 'kasse' ? 'K' : 'P'),
    updatedAt: nowISO(),
  };
  if (isNew) {
    p.createdAt = nowISO();
    p.lastConfirmedAt = p.createdAt;
  }
  if (p.parentId && (p.parentId === p.id || isWithin(p.parentId, p.id))) throw new Error('En plassering kan ikke ligge inni seg selv.');
  const ops = [{ store: 'places', put: p }];
  if (isNew) ops.push(event('opprettet', `${p.kind === 'kasse' ? 'Kasse' : 'Plassering'} «${p.name}» opprettet`, [p.id]));
  else if (old.parentId !== p.parentId) {
    ops.push(event('flytt', `«${p.name}» flyttet`, [p.id], { entries: [{ id: p.id, kind: 'place', from: old.parentId || null, to: p.parentId || null }], to: p.parentId || null }));
  }
  await commit(ops);
  return p;
}

export async function deletePlace(id) {
  const p = S.places.get(id);
  const kids = children(id);
  const items = itemsDirectlyIn(id);
  const ops = [];
  // Innhold flyttes opp ett nivå, så ingenting forsvinner.
  for (const k of kids) ops.push({ store: 'places', put: { ...k, parentId: p.parentId || null } });
  for (const i of items) ops.push({ store: 'items', put: { ...i, placeId: p.parentId || null } });
  for (const i of S.items.values()) if (i.homeId === id) ops.push({ store: 'items', put: { ...(ops.find((o) => o.put?.id === i.id)?.put || i), homeId: p.parentId || null } });
  ops.push({ store: 'places', del: id });
  ops.push(event('slettet', `«${p.name}» slettet. Innholdet ble flyttet til ${p.parentId ? pathText(p.parentId) : 'ingen plassering'}`, [id]));
  await commit(dedupe(ops));
}

function dedupe(ops) {
  const last = new Map();
  ops.forEach((o, i) => { if (o.put && o.store !== 'events') last.set(o.store + o.put.id, i); });
  return ops.filter((o, i) => !(o.put && o.store !== 'events') || last.get(o.store + o.put.id) === i);
}

// ---------- Verktøy ----------
export function blankItem() {
  return {
    type: 'enkelt', name: '', category: '', brand: '', model: '', serial: '', owner: 'meg', ownerName: '',
    placeId: null, homeId: null, status: 'tilgjengelig', purchaseDate: '', price: null, notes: '', accessories: [],
    serviceDue: '', warrantyUntil: '', photos: [], docs: [], qty: 1, unit: 'stk', minQty: null, uncertain: [],
    maintenance: [],
  };
}

export async function saveItem(data, extraOps = []) {
  const old = data.id ? S.items.get(data.id) : null;
  const now = nowISO();
  const it = { ...blankItem(), ...(old || {}), ...data, updatedAt: now };
  if (!old) {
    it.id = data.id || newObjectId('T');
    it.createdAt = now;
    it.lastConfirmedAt = now;
  }
  const ops = [...extraOps, { store: 'items', put: it }];
  if (!old) {
    ops.push(event('opprettet', `«${it.name}» registrert${it.placeId ? ' i ' + pathText(it.placeId) : ''}`, [it.id]));
  } else {
    if (old.placeId !== it.placeId) {
      it.lastConfirmedAt = now;
      ops.push(event('flytt', `«${it.name}» flyttet`, [it.id], { entries: [{ id: it.id, kind: 'item', from: old.placeId || null, to: it.placeId || null }], to: it.placeId || null }));
    }
    if (old.status !== it.status) ops.push(event('status', `«${it.name}»: ${STATUS[old.status]} → ${STATUS[it.status]}`, [it.id]));
    if (it.type === 'mengde' && old.qty !== it.qty) {
      ops.push(event('beholdning', `«${it.name}»: antall endret fra ${old.qty} til ${it.qty} ${it.unit}`, [it.id], { from: old.qty, to: it.qty }));
      it.qtyCheckedAt = now;
    }
  }
  await commit(ops);
  return S.items.get(it.id);
}

export async function deleteItem(id) {
  const it = S.items.get(id);
  const ops = [{ store: 'items', del: id }, event('slettet', `«${it.name}» slettet fra registeret`, [id])];
  await commit(ops);
  await cleanupBlobs();
}

async function cleanupBlobs() {
  const refs = blobRefs();
  const all = await db.getAll('blobs');
  const ops = all.filter((b) => !refs.has(b.id)).map((b) => ({ store: 'blobs', del: b.id }));
  if (ops.length) await db.write(ops);
}

export async function addItemFiles(itemId, files, kind = 'photo', docKind = 'annet') {
  const it = S.items.get(itemId);
  const ops = [];
  const photos = [...(it.photos || [])];
  const docs = [...(it.docs || [])];
  for (const f of files) {
    const { id, op } = await putBlobOp(f, f.name || '');
    ops.push(op);
    if (kind === 'photo') photos.push(id);
    else docs.push({ id: newId('D'), kind: docKind, name: f.name || DOC_KINDS[docKind], blobId: id, mime: f.type, at: nowISO() });
  }
  ops.push({ store: 'items', put: { ...it, photos, docs, updatedAt: nowISO() } });
  await commit(ops);
}

export async function removeItemFile(itemId, blobId) {
  const it = S.items.get(itemId);
  await commit([{ store: 'items', put: { ...it, photos: (it.photos || []).filter((b) => b !== blobId), docs: (it.docs || []).filter((d) => d.blobId !== blobId) } }]);
  await cleanupBlobs();
}

// ---------- Flytting ----------
// refs: [{ id, kind: 'item' | 'place' }]. Kasser flyttes med innholdet fordi innholdet peker på kassen.
export async function moveObjects(refs, toId, note = '') {
  toId = toId || null;
  const now = nowISO();
  const ops = [];
  const entries = [];
  for (const r of refs) {
    if (r.kind === 'item') {
      const it = S.items.get(r.id);
      if (!it) continue;
      entries.push({ id: it.id, kind: 'item', from: it.placeId || null, to: toId });
      ops.push({ store: 'items', put: { ...it, placeId: toId, lastConfirmedAt: now, updatedAt: now } });
    } else {
      const p = S.places.get(r.id);
      if (!p) continue;
      if (toId && (toId === p.id || isWithin(toId, p.id))) throw new Error(`«${p.name}» kan ikke flyttes inn i seg selv.`);
      entries.push({ id: p.id, kind: 'place', from: p.parentId || null, to: toId });
      ops.push({ store: 'places', put: { ...p, parentId: toId, lastConfirmedAt: now, updatedAt: now } });
    }
  }
  if (!entries.length) return null;
  const names = entries.map((e) => (e.kind === 'item' ? S.items.get(e.id) : S.places.get(e.id)).name);
  const ev = event('flytt', `${names.join(', ')} flyttet til ${toId ? pathText(toId) : 'ingen plassering'}`, entries.map((e) => e.id), { entries, to: toId, note });
  ops.push(ev);
  await commit(ops);
  return ev.put;
}

// Angre: setter tilbake bare det som fortsatt ligger der flyttingen la det.
export async function undoMove(eventId) {
  const ev = S.events.find((e) => e.id === eventId);
  if (!ev || ev.type !== 'flytt' || ev.data.undoneAt) return { reverted: 0, skipped: [] };
  const ops = [];
  const skipped = [];
  let reverted = 0;
  for (const e of ev.data.entries) {
    if (e.kind === 'item') {
      const it = S.items.get(e.id);
      if (!it || (it.placeId || null) !== e.to) { skipped.push(it?.name || e.id); continue; }
      ops.push({ store: 'items', put: { ...it, placeId: e.from, updatedAt: nowISO() } });
    } else {
      const p = S.places.get(e.id);
      if (!p || (p.parentId || null) !== e.to || (e.from && isWithin(e.from, p.id))) { skipped.push(p?.name || e.id); continue; }
      ops.push({ store: 'places', put: { ...p, parentId: e.from, updatedAt: nowISO() } });
    }
    reverted++;
  }
  ops.push({ store: 'events', put: { ...ev, data: { ...ev.data, undoneAt: nowISO() } } });
  ops.push(event('angret', `Angret: ${ev.text}`, ev.refs, { of: ev.id, skipped }));
  await commit(ops);
  return { reverted, skipped };
}

export async function confirmLocation(refs) {
  const now = nowISO();
  const ops = [];
  for (const r of refs) {
    const o = r.kind === 'item' ? S.items.get(r.id) : S.places.get(r.id);
    if (o) ops.push({ store: r.kind === 'item' ? 'items' : 'places', put: { ...o, lastConfirmedAt: now } });
  }
  ops.push(event('bekreftet', `Plassering bekreftet for ${ops.length} ${ops.length === 1 ? 'objekt' : 'objekter'}`, refs.map((r) => r.id)));
  await commit(ops);
}

// ---------- Utlån ----------
export async function createLoan({ borrower, at, dueAt, notes, photoFiles = [], refs }) {
  const ops = [];
  const photos = [];
  for (const f of photoFiles) {
    const { id, op } = await putBlobOp(f, f.name || 'overlevering');
    ops.push(op);
    photos.push(id);
  }
  const loan = { id: newId('L'), borrower: borrower.trim(), at: at || todayISO(), dueAt: dueAt || '', notes: notes || '', photos, refs, returns: {}, closedAt: null, createdAt: nowISO() };
  for (const r of refs) {
    if (r.kind === 'item') {
      const it = S.items.get(r.id);
      const av = availability(it);
      if (!av.available) throw new Error(`«${it.name}» er ikke tilgjengelig (${av.label}).`);
      ops.push({ store: 'items', put: { ...it, status: 'utlant', loanId: loan.id, updatedAt: nowISO() } });
    } else {
      const p = S.places.get(r.id);
      if (!placeAvailability(p).available) throw new Error(`«${p.name}» er allerede utlånt.`);
      ops.push({ store: 'places', put: { ...p, loanId: loan.id, updatedAt: nowISO() } });
    }
  }
  ops.push({ store: 'loans', put: loan });
  ops.push(event('utlan', `Utlånt til ${loan.borrower}: ${refs.map((r) => refName(r)).join(', ')}`, refs.map((r) => r.id), { loanId: loan.id }));
  await commit(ops);
  return loan;
}

export const refName = (r) => (r.kind === 'item' ? S.items.get(r.id)?.name : S.places.get(r.id)?.name) || '(slettet)';

// returns: [{ id, kind, placeId, missing: [tilbehør], note }]
export async function returnLoan(loanId, returns) {
  const loan = S.loans.get(loanId);
  const now = nowISO();
  const ops = [];
  const newReturns = { ...loan.returns };
  const entries = [];
  for (const r of returns) {
    newReturns[r.id] = { at: now, placeId: r.placeId || null, missing: r.missing || [], note: r.note || '' };
    if (r.kind === 'item') {
      const it = S.items.get(r.id);
      if (!it) continue;
      let notes = it.notes || '';
      if (r.missing?.length) notes = `${notes}${notes ? '\n' : ''}Mangler etter utlån til ${loan.borrower} (${now.slice(0, 10)}): ${r.missing.join(', ')}`;
      ops.push({ store: 'items', put: { ...it, status: 'tilgjengelig', loanId: null, placeId: r.placeId ?? it.placeId, lastConfirmedAt: now, notes, updatedAt: now } });
      if ((r.placeId ?? it.placeId) !== it.placeId) entries.push({ id: it.id, kind: 'item', from: it.placeId || null, to: r.placeId || null });
    } else {
      const p = S.places.get(r.id);
      if (!p) continue;
      ops.push({ store: 'places', put: { ...p, loanId: null, parentId: r.placeId ?? p.parentId, lastConfirmedAt: now, updatedAt: now } });
      if ((r.placeId ?? p.parentId) !== p.parentId) entries.push({ id: p.id, kind: 'place', from: p.parentId || null, to: r.placeId || null });
    }
  }
  const allBack = loan.refs.every((x) => newReturns[x.id]);
  ops.push({ store: 'loans', put: { ...loan, returns: newReturns, closedAt: allBack ? now : null } });
  const missingTxt = returns.filter((r) => r.missing?.length).map((r) => `${refName(r)}: mangler ${r.missing.join(', ')}`);
  ops.push(event('retur', `Retur fra ${loan.borrower}: ${returns.map(refName).join(', ')}${missingTxt.length ? ' (' + missingTxt.join('; ') + ')' : ''}`, returns.map((r) => r.id), { loanId, entries }));
  await commit(ops);
}

export function loanState(loan) {
  if (loan.closedAt) return 'returnert';
  if (loan.dueAt && loan.dueAt < todayISO()) return 'forsinket';
  return 'aktiv';
}

export const activeLoans = () => [...S.loans.values()].filter((l) => !l.closedAt).sort((a, b) => (a.dueAt || '9999') < (b.dueAt || '9999') ? -1 : 1);

// ---------- Beholdning ----------
export async function adjustQty(itemId, { delta, set, reason }) {
  const it = S.items.get(itemId);
  const from = Number(it.qty) || 0;
  const to = set != null ? set : Math.max(0, from + delta);
  const now = nowISO();
  const upd = { ...it, qty: to, updatedAt: now };
  if (set != null) upd.qtyCheckedAt = now;
  const txt = set != null ? `telt opp: ${to} ${it.unit}` : `${delta > 0 ? '+' : ''}${delta} ${it.unit} (${reason || 'endring'}), nå ${to}`;
  await commit([{ store: 'items', put: upd }, event('beholdning', `«${it.name}» ${txt}`, [it.id], { from, to, reason: reason || (set != null ? 'telling' : '') })]);
}

export const shoppingList = () =>
  [...S.items.values()].filter((i) => i.type === 'mengde' && i.status !== 'kassert' && i.minQty != null && i.minQty !== '' && Number(i.qty) < Number(i.minQty)).sort(byName);

// ---------- Kontroll ----------
// results: [{ id, state: 'ok'|'mangler'|'skadet'|null, counted }]
export async function saveAudit(placeId, results) {
  const now = nowISO();
  const ops = [];
  const summary = { ok: [], mangler: [], skadet: [], telt: [] };
  for (const r of results) {
    const it = S.items.get(r.id);
    if (!it || !r.state) continue;
    const upd = { ...it };
    if (r.state === 'ok') { upd.lastConfirmedAt = now; summary.ok.push(it.name); }
    if (r.state === 'mangler') { upd.status = 'savnet'; summary.mangler.push(it.name); }
    if (r.state === 'skadet') {
      upd.status = 'reparasjon';
      upd.lastConfirmedAt = now;
      upd.maintenance = [...(it.maintenance || []), { id: newId('M'), date: todayISO(), kind: 'reparasjon', note: 'Markert skadet ved kontroll' + (r.note ? ': ' + r.note : ''), cost: null }];
      summary.skadet.push(it.name);
    }
    if (it.type === 'mengde' && r.counted != null && r.counted !== '') {
      upd.qty = Number(r.counted);
      upd.qtyCheckedAt = now;
      summary.telt.push(`${it.name}: ${r.counted} ${it.unit}`);
    }
    upd.updatedAt = now;
    ops.push({ store: 'items', put: upd });
  }
  const p = S.places.get(placeId);
  ops.push({ store: 'places', put: { ...p, lastAuditAt: now, lastConfirmedAt: now } });
  const parts = [];
  if (summary.ok.length) parts.push(`${summary.ok.length} ok`);
  if (summary.mangler.length) parts.push(`mangler: ${summary.mangler.join(', ')}`);
  if (summary.skadet.length) parts.push(`skadet: ${summary.skadet.join(', ')}`);
  if (summary.telt.length) parts.push(`telt: ${summary.telt.join(', ')}`);
  ops.push(event('kontroll', `Kontroll av «${p.name}»: ${parts.join('; ') || 'ingen avkrysninger'}`, [placeId, ...results.filter((r) => r.state).map((r) => r.id)], summary));
  await commit(ops);
  return summary;
}

// ---------- Vedlikehold ----------
export async function addMaintenance(itemId, entry, { nextDue, newStatus } = {}) {
  const it = S.items.get(itemId);
  const upd = { ...it, maintenance: [...(it.maintenance || []), { id: newId('M'), ...entry }], updatedAt: nowISO() };
  if (nextDue !== undefined) upd.serviceDue = nextDue;
  if (newStatus) upd.status = newStatus;
  await commit([{ store: 'items', put: upd }, event('vedlikehold', `«${it.name}»: ${MAINT_KINDS[entry.kind]} registrert${entry.note ? ' – ' + entry.note : ''}`, [itemId])]);
}

export function followUps(days = 30) {
  const today = todayISO();
  const out = [];
  for (const it of S.items.values()) {
    if (it.status === 'kassert') continue;
    if (it.status === 'reparasjon') out.push({ item: it, reason: 'Til reparasjon', sort: 0 });
    else if (it.serviceDue) {
      const n = daysBetween(today, it.serviceDue);
      if (n < 0) out.push({ item: it, reason: `Service/kontroll forfalt ${-n} ${-n === 1 ? 'dag' : 'dager'} siden`, sort: 1 });
      else if (n <= days) out.push({ item: it, reason: `Service/kontroll om ${n} ${n === 1 ? 'dag' : 'dager'}`, sort: 2 + n });
    }
    if (it.warrantyUntil) {
      const n = daysBetween(today, it.warrantyUntil);
      if (n >= 0 && n <= days) out.push({ item: it, reason: `Garantien går ut om ${n} dager`, sort: 50 + n });
    }
  }
  return out.sort((a, b) => a.sort - b.sort);
}

// ---------- Pakkelister ----------
export async function savePacklist(data) {
  const old = data.id ? S.packlists.get(data.id) : null;
  const pl = { lines: [], notes: '', ...(old || {}), ...data, id: data.id || newId('PL'), updatedAt: nowISO() };
  if (!old) pl.createdAt = nowISO();
  await commit([{ store: 'packlists', put: pl }]);
  return pl;
}

export const deletePacklist = (id) => commit([{ store: 'packlists', del: id }]);

export function defaultVehicle() {
  const ps = [...S.places.values()];
  return ps.find((p) => p.vehicle) || ps.find((p) => /bil/i.test(p.name) && !p.parentId) || null;
}

// Vurderer hver linje mot registeret. «I bilen» betyr registrert der, ikke kontrollert pakket.
export function lineStatus(line, vehicleId) {
  const inCar = (placeId) => vehicleId && placeId && isWithin(placeId, vehicleId);
  if (line.kind === 'verktoy' || line.kind === 'vare') {
    const it = S.items.get(line.itemId);
    if (!it) return { code: 'ukjent', label: 'Verktøyet er slettet fra registeret' };
    const av = availability(it);
    if (!av.available) return { code: 'utilgjengelig', label: `Utilgjengelig: ${av.label}${av.loan ? ' til ' + av.loan.borrower : ''}`, item: it };
    if (it.type === 'mengde' && line.qty) {
      const need = Number(line.qty);
      const have = Number(it.qty) || 0;
      if (have < need) return { code: 'kjop', label: `Registrert ${have} ${it.unit}, trenger ${need} – må kjøpes`, item: it, where: it.placeId };
    }
    if (inCar(it.placeId)) return { code: 'ibil', label: 'Registrert i bilen', item: it, where: it.placeId };
    if (!it.placeId) return { code: 'hent', label: 'Må hentes – plassering ukjent', item: it };
    return { code: 'hent', label: `Må hentes fra ${pathText(it.placeId)}`, item: it, where: it.placeId };
  }
  if (line.kind === 'kategori') {
    const cands = [...S.items.values()].filter((i) => norm(i.category) === norm(line.text) || norm(i.name).includes(norm(line.text)));
    const avail = cands.filter((i) => availability(i).available);
    const car = avail.find((i) => inCar(i.placeId));
    if (car) return { code: 'ibil', label: `Registrert i bilen: ${car.name}`, item: car, where: car.placeId };
    if (avail.length) return { code: 'hent', label: `Må hentes: ${avail[0].name} i ${pathText(avail[0].placeId)}`, item: avail[0], where: avail[0].placeId };
    if (cands.length) return { code: 'utilgjengelig', label: `Ingen tilgjengelige (${cands.map((c) => c.name + ': ' + availability(c).label).join(', ')})` };
    return { code: 'laan', label: 'Ikke registrert – må kjøpes eller lånes' };
  }
  return { code: 'fri', label: line.buy ? 'Må kjøpes' : 'Ikke koblet til registeret – sjekk selv' };
}

// ---------- Søk ----------
export function search(q, f = {}) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const res = [];
  for (const it of S.items.values()) {
    if (f.status && f.status !== 'alle') {
      const av = availability(it);
      if (f.status === 'aktive' ? it.status === 'kassert' : av.code !== f.status) continue;
    } else if (!f.status && it.status === 'kassert' && !toks.length) continue;
    if (f.owner && it.owner !== f.owner) continue;
    if (f.place && !(it.placeId && isWithin(it.placeId, f.place))) continue;
    if (toks.length) {
      const hay = norm([it.name, it.category, it.brand, it.model, it.serial, it.notes, (it.accessories || []).join(' '), it.id, it.ownerName].join(' '));
      if (!toks.every((t) => hay.includes(t))) continue;
      const n = norm(it.name);
      it._score = n.startsWith(toks[0]) ? 0 : n.includes(toks[0]) ? 1 : 2;
    } else it._score = 0;
    res.push(it);
  }
  res.sort((a, b) => a._score - b._score || byName(a, b));
  let places = [];
  if (toks.length && !f.status && !f.owner) {
    places = [...S.places.values()].filter((p) => {
      if (f.place && !isWithin(p.id, f.place)) return false;
      const hay = norm([p.name, p.notes, p.id].join(' '));
      return toks.every((t) => hay.includes(t));
    }).sort(byName);
  }
  return { items: res, places };
}

export const categories = () => [...new Set([...S.items.values()].map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
export const borrowers = () => [...new Set([...S.loans.values()].map((l) => l.borrower))].sort((a, b) => a.localeCompare(b, 'nb'));

// ---------- Sikkerhetskopi ----------
export const BACKUP_FORMAT = 'hvor-er-verktoyet-backup';

export async function exportBackup() {
  const out = { format: BACKUP_FORMAT, version: 1, createdAt: nowISO(), mode: S.mode, stores: {} };
  for (const s of ['items', 'places', 'events', 'loans', 'packlists']) out.stores[s] = await db.getAll(s);
  // API-nøkkelen tas ikke med i sikkerhetskopien.
  out.stores.meta = (await db.getAll('meta')).filter((m) => !['apiKey'].includes(m.id));
  const blobs = await db.getAll('blobs');
  out.blobs = [];
  for (const b of blobs) out.blobs.push({ id: b.id, mime: b.mime, name: b.name, at: b.at, data: await blobToDataURL(b.blob) });
  return out;
}

export function validateBackup(data) {
  if (!data || data.format !== BACKUP_FORMAT || !data.stores) throw new Error('Filen er ikke en sikkerhetskopi fra «Hvor er verktøyet?».');
  if (data.version > 1) throw new Error('Sikkerhetskopien er laget av en nyere versjon av appen.');
  const ids = new Set();
  for (const s of ['items', 'places']) for (const o of data.stores[s] || []) {
    if (!o.id) throw new Error('Sikkerhetskopien mangler ID-er.');
    if (ids.has(o.id)) throw new Error(`Duplisert ID i sikkerhetskopien: ${o.id}`);
    ids.add(o.id);
  }
  return { items: (data.stores.items || []).length, places: (data.stores.places || []).length, loans: (data.stores.loans || []).length, images: (data.blobs || []).length, createdAt: data.createdAt };
}

// Erstatter alle data med innholdet i sikkerhetskopien. ID-ene (og dermed QR-kodene) beholdes uendret.
export async function importBackup(data) {
  validateBackup(data);
  const keepKey = S.meta.apiKey;
  const ops = [];
  for (const s of db.STORES) ops.push({ store: s, clear: true });
  for (const s of ['items', 'places', 'events', 'loans', 'packlists', 'meta']) for (const o of data.stores[s] || []) ops.push({ store: s, put: o });
  for (const b of data.blobs || []) ops.push({ store: 'blobs', put: { id: b.id, mime: b.mime, name: b.name, at: b.at, blob: await dataURLToBlob(b.data) } });
  if (keepKey) ops.push({ store: 'meta', put: { id: 'apiKey', value: keepKey } });
  ops.push({ store: 'meta', put: { id: 'restoredAt', value: nowISO() } });
  await db.write(ops);
  await load(S.mode);
}

export async function wipeAll() {
  await db.write(db.STORES.map((s) => ({ store: s, clear: true })));
  await load(S.mode);
}

// ---------- CSV ----------
export function exportCSV() {
  const cols = ['ID', 'Type', 'Navn', 'Kategori', 'Merke', 'Modell', 'Serienummer', 'Eier', 'Status', 'Nåværende plassering', 'Fast plass', 'Sist bekreftet', 'Antall', 'Enhet', 'Minimumsbeholdning', 'Kjøpsdato', 'Pris (kr)', 'Service/kontroll', 'Garanti til', 'Tilbehør', 'Notater'];
  const q = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.join(';')];
  for (const it of [...S.items.values()].sort(byName)) {
    const av = availability(it);
    rows.push([
      it.id, it.type === 'mengde' ? 'Mengdevare' : 'Enkeltverktøy', it.name, it.category, it.brand, it.model, it.serial,
      it.owner === 'andre' ? it.ownerName || 'Andre' : OWNER[it.owner], av.label, it.placeId ? pathText(it.placeId, ' > ') : '',
      it.homeId ? pathText(it.homeId, ' > ') : '', (lastConfirmed(it).at || '').slice(0, 16).replace('T', ' '),
      it.type === 'mengde' ? String(it.qty ?? '').replace('.', ',') : '', it.type === 'mengde' ? it.unit : '', it.minQty ?? '',
      it.purchaseDate, it.price != null ? String(it.price).replace('.', ',') : '', it.serviceDue, it.warrantyUntil,
      (it.accessories || []).join(', '), it.notes,
    ].map(q).join(';'));
  }
  return '﻿' + rows.join('\r\n');
}
