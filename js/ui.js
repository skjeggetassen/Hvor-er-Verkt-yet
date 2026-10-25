// Felles byggeklosser for skjermbildene: kort, merker, dialoger og velgere.

import { esc, fmtDateTime, relDay, prettyCode, norm } from './util.js';
import { S, availability, placeAvailability, pathText, path, lastConfirmed, placeTree, blobURL, savePlace, itemsWithin, byName } from './store.js';

export const ICON = { item: '🔧', bulk: '🔩', sted: '📍', kasse: '📦', vehicle: '🚐' };
export const placeIcon = (p) => (p.kind === 'kasse' ? ICON.kasse : p.vehicle ? ICON.vehicle : ICON.sted);

export const badge = (av) => `<span class="badge st-${esc(av.code)}">${esc(av.label)}</span>`;

export function thumb(blobId, fallback = ICON.item, cls = 'thumb') {
  if (blobId) return `<img class="${cls}" data-blob="${esc(blobId)}" alt="">`;
  return `<div class="${cls} ph" aria-hidden="true">${fallback}</div>`;
}

export async function hydrate(root = document) {
  for (const img of root.querySelectorAll('img[data-blob]:not([src])')) {
    const url = await blobURL(img.dataset.blob);
    if (url) img.src = url;
    else img.replaceWith(Object.assign(document.createElement('div'), { className: img.className + ' ph', textContent: '🖼️' }));
  }
}

export function itemCard(it, { select = false, selected = false, extra = '' } = {}) {
  const av = availability(it);
  const lc = lastConfirmed(it);
  const home = it.homeId && it.homeId !== it.placeId ? `<div class="sub">Fast plass: ${esc(pathText(it.homeId))}</div>` : '';
  const qty = it.type === 'mengde' ? ` <span class="qty">${esc(String(it.qty ?? 0).replace('.', ','))} ${esc(it.unit)}</span>` : '';
  const where = av.loan ? `Hos ${esc(av.loan.borrower)} · registrert i ${esc(pathText(it.placeId))}` : esc(pathText(it.placeId));
  return `<div class="card item ${select ? 'selectable' : ''}" data-id="${esc(it.id)}">
    ${select ? `<input type="checkbox" class="sel" data-ref="item:${esc(it.id)}" ${selected ? 'checked' : ''} aria-label="Velg ${esc(it.name)}">` : ''}
    <a href="#/ting/${esc(it.id)}" class="card-link">
      ${thumb(it.photos?.[0], it.type === 'mengde' ? ICON.bulk : ICON.item)}
      <div class="card-body">
        <div class="title">${esc(it.name)}${qty}</div>
        <div class="where">📍 ${where}</div>
        ${home}
        <div class="meta">${badge(av)} <span class="muted">Bekreftet ${esc(relDay(lc.at))}${lc.via ? ` (kassen ${esc(lc.via.name)})` : ''}</span></div>
        ${extra}
      </div>
    </a>
  </div>`;
}

export function placeCard(p, { select = false, selected = false } = {}) {
  const n = itemsWithin(p.id).length;
  const av = placeAvailability(p);
  return `<div class="card place ${select ? 'selectable' : ''}" data-id="${esc(p.id)}">
    ${select ? `<input type="checkbox" class="sel" data-ref="place:${esc(p.id)}" ${selected ? 'checked' : ''} aria-label="Velg ${esc(p.name)}">` : ''}
    <a href="#/sted/${esc(p.id)}" class="card-link">
      ${thumb(p.photo, placeIcon(p))}
      <div class="card-body">
        <div class="title">${esc(p.name)}</div>
        <div class="where">${p.parentId ? '📍 ' + esc(pathText(p.parentId)) : p.kind === 'kasse' ? 'Kasse' : 'Plassering'}</div>
        <div class="meta">${av.available ? '' : badge(av)} <span class="muted">${n} ${n === 1 ? 'ting' : 'ting'}${p.lastAuditAt ? ' · kontrollert ' + esc(relDay(p.lastAuditAt)) : ''}</span></div>
      </div>
    </a>
  </div>`;
}

export function crumbs(placeId) {
  const ps = path(placeId);
  if (!ps.length) return '<span class="muted">Ingen plassering</span>';
  return ps.map((p) => `<a href="#/sted/${esc(p.id)}">${esc(p.name)}</a>`).join(' <span class="sep">→</span> ');
}

export const codeLine = (id) => `<span class="code">${esc(prettyCode(id))}</span>`;

// ---------- Dialoger ----------
export function modal(html, { cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  const close = () => {
    wrap.remove();
    if (!document.querySelector('.modal-wrap')) document.body.classList.remove('noscroll');
  };
  return { el: wrap.querySelector('.modal'), wrap, close };
}

export function confirmDialog(text, { ok = 'OK', cancel = 'Avbryt', danger = false } = {}) {
  return new Promise((res) => {
    const m = modal(`<p class="lead">${esc(text)}</p><div class="actions"><button class="btn" data-c>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-o>${esc(ok)}</button></div>`);
    m.el.querySelector('[data-c]').onclick = () => { m.close(); res(false); };
    m.el.querySelector('[data-o]').onclick = () => { m.close(); res(true); };
  });
}

export function alertDialog(text) {
  return confirmDialog(text, { ok: 'OK', cancel: 'Lukk' });
}

// Velg plassering (inkludert kasser). Returnerer ID, null (ingen plassering) eller undefined (avbrutt).
export function pickPlace({ title = 'Velg plassering', exclude = null, allowNone = false, current = null } = {}) {
  return new Promise((resolve) => {
    const m = modal(`
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost" data-x>Avbryt</button></div>
      <input type="search" class="pick-q" placeholder="Søk plassering eller kasse" aria-label="Søk plassering">
      <div class="pick-list"></div>
      <div class="pick-new">
        <details><summary class="btn">+ Ny plassering eller kasse</summary>
          <form class="stack">
            <input name="name" required placeholder="Navn, f.eks. Kasse 2">
            <select name="kind"><option value="sted">Plassering (hylle, rom, bil …)</option><option value="kasse">Kasse (flyttbar beholder)</option></select>
            <select name="parentId"><option value="">Øverste nivå</option>${placeTree().map(({ place, depth }) => `<option value="${esc(place.id)}">${'  '.repeat(depth)}${esc(place.name)}</option>`).join('')}</select>
            <button class="btn primary">Opprett og velg</button>
          </form>
        </details>
      </div>`, { cls: 'tall' });
    const list = m.el.querySelector('.pick-list');
    const done = (v) => { m.close(); resolve(v); };
    const render = (q = '') => {
      const nq = norm(q);
      const rows = placeTree().filter(({ place }) => {
        if (exclude && (place.id === exclude || path(place.id).some((p) => p.id === exclude))) return false;
        return !nq || norm(place.name).includes(nq) || norm(pathText(place.id)).includes(nq);
      });
      list.innerHTML = (allowNone ? `<button class="pick-row" data-v=""><span>🚫</span> Ingen plassering</button>` : '') +
        rows.map(({ place, depth }) => `<button class="pick-row ${place.id === current ? 'cur' : ''}" data-v="${esc(place.id)}" style="padding-left:${12 + (nq ? 0 : depth * 18)}px"><span>${placeIcon(place)}</span> ${esc(nq ? pathText(place.id) : place.name)}</button>`).join('') +
        (rows.length ? '' : '<p class="muted pad">Ingen plasseringer funnet. Opprett en ny nedenfor.</p>');
    };
    render();
    m.el.querySelector('.pick-q').oninput = (e) => render(e.target.value);
    list.onclick = (e) => {
      const b = e.target.closest('.pick-row');
      if (b) done(b.dataset.v || null);
    };
    m.el.querySelector('[data-x]').onclick = () => done(undefined);
    m.el.querySelector('.pick-new form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const p = await savePlace({ name: f.get('name').trim(), kind: f.get('kind'), parentId: f.get('parentId') || null });
      done(p.id);
    };
  });
}

// Velg flere verktøy og/eller kasser. Returnerer liste med { id, kind } eller null.
export function pickObjects({ title = 'Velg utstyr', initial = [], onlyAvailable = false, includeBoxes = true } = {}) {
  return new Promise((resolve) => {
    const sel = new Map(initial.map((r) => [r.id, r]));
    const m = modal(`
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost" data-x>Avbryt</button></div>
      <input type="search" class="pick-q" placeholder="Søk etter navn, merke, plassering …" aria-label="Søk">
      <div class="pick-list"></div>
      <div class="actions sticky"><span class="pick-count muted"></span><button class="btn primary" data-ok>Velg</button></div>`, { cls: 'tall' });
    const list = m.el.querySelector('.pick-list');
    const count = () => (m.el.querySelector('.pick-count').textContent = `${sel.size} valgt`);
    const render = (q = '') => {
      const nq = norm(q).split(/\s+/).filter(Boolean);
      const match = (s) => nq.every((t) => norm(s).includes(t));
      let items = [...S.items.values()].filter((i) => i.status !== 'kassert');
      if (onlyAvailable) items = items.filter((i) => availability(i).available);
      items = items.filter((i) => !nq.length || match([i.name, i.category, i.brand, i.model, i.serial, pathText(i.placeId)].join(' '))).sort(byName);
      let boxes = includeBoxes ? [...S.places.values()].filter((p) => p.kind === 'kasse') : [];
      if (onlyAvailable) boxes = boxes.filter((p) => placeAvailability(p).available);
      boxes = boxes.filter((p) => !nq.length || match(p.name + ' ' + pathText(p.id))).sort(byName);
      const row = (ref, icon, name, sub, av) => `<label class="pick-row check"><input type="checkbox" data-id="${esc(ref.id)}" data-kind="${ref.kind}" ${sel.has(ref.id) ? 'checked' : ''}><span>${icon}</span><span class="grow"><b>${esc(name)}</b><br><small class="muted">${esc(sub)}</small></span>${av && !av.available ? badge(av) : ''}</label>`;
      list.innerHTML =
        (boxes.length ? `<h3 class="pick-h">Kasser (flyttes med innhold)</h3>` + boxes.map((p) => row({ id: p.id, kind: 'place' }, ICON.kasse, p.name, `${p.parentId ? pathText(p.parentId) : 'Ingen plassering'} · ${itemsWithin(p.id).length} ting`, placeAvailability(p))).join('') : '') +
        (items.length ? `<h3 class="pick-h">Verktøy og utstyr</h3>` + items.slice(0, 300).map((i) => row({ id: i.id, kind: 'item' }, i.type === 'mengde' ? ICON.bulk : ICON.item, i.name, pathText(i.placeId), availability(i))).join('') : '') +
        (!items.length && !boxes.length ? '<p class="muted pad">Ingen treff.</p>' : '');
      count();
    };
    render();
    m.el.querySelector('.pick-q').oninput = (e) => render(e.target.value);
    list.onchange = (e) => {
      const c = e.target;
      if (c.checked) sel.set(c.dataset.id, { id: c.dataset.id, kind: c.dataset.kind });
      else sel.delete(c.dataset.id);
      count();
    };
    m.el.querySelector('[data-x]').onclick = () => { m.close(); resolve(null); };
    m.el.querySelector('[data-ok]').onclick = () => { m.close(); resolve([...sel.values()]); };
  });
}

export const fmtWhen = (v) => `${esc(fmtDateTime(v))}`;

export function placeOptions(selected, { none = 'Ingen' } = {}) {
  return `<option value="">${esc(none)}</option>` + placeTree().map(({ place, depth }) => `<option value="${esc(place.id)}" ${place.id === selected ? 'selected' : ''}>${'  '.repeat(depth)}${placeIcon(place)} ${esc(place.name)}</option>`).join('');
}
