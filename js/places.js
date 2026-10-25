// Plasseringer og kasser: oversikt, innhold, skjema, kontrollmodus og etiketter.

import { esc, toast, fmtDateTime, relDay, resizeImage, downloadBlob, todayISO, parseNum, fmtNum, norm } from './util.js';
import * as st from './store.js';
import { S } from './store.js';
import { badge, crumbs, thumb, confirmDialog, pickPlace, placeOptions, placeIcon, itemCard, placeCard, codeLine, ICON } from './ui.js';
import { qrSVG, labelsPDF, LAYOUTS } from './qr.js';
import { go, render, eventRow, bindUndo } from './app.js';

export function placesView() {
  const tree = st.placeTree();
  return {
    title: 'Plasseringer',
    html: `<div class="h-row"><h1>Plasseringer og kasser</h1></div>
    <div class="btnrow"><a class="btn primary" href="#/nytt-sted">+ Ny plassering</a><a class="btn" href="#/nytt-sted?type=kasse">+ Ny kasse</a></div>
    <p class="muted small">Plasseringer kan ha undernivåer (bil → hylle → kasse). Kasser er flyttbare: flytter du en kasse, følger alt innholdet med.</p>
    <ul class="tree">${tree.map(({ place, depth }) => {
      const n = st.itemsDirectlyIn(place.id).length;
      const av = st.placeAvailability(place);
      return `<li style="--d:${depth}"><a href="#/sted/${esc(place.id)}"><span>${placeIcon(place)}</span><b>${esc(place.name)}</b><small class="muted">${n} ting</small>${!av.available && place.loanId ? badge(av) : ''}${place.pinned ? '<span title="Snarvei">⭐</span>' : ''}</a></li>`;
    }).join('') || '<p class="muted">Ingen plasseringer ennå.</p>'}</ul>
    ${st.itemsDirectlyIn(null).length ? `<h2>Uten plassering</h2>${st.itemsDirectlyIn(null).map((i) => itemCard(i)).join('')}` : ''}`,
  };
}

let placeSel = new Set();

export function placeView(id) {
  const p = S.places.get(id);
  if (!p) return `<div class="empty"><h1>Fant ikke plasseringen</h1><a class="btn" href="#/steder">Alle plasseringer</a></div>`;
  const isBox = p.kind === 'kasse';
  const kids = st.children(id);
  const direct = st.itemsDirectlyIn(id);
  const deep = st.itemsWithin(id);
  const av = st.placeAvailability(p);
  const evs = S.events.filter((e) => e.refs?.includes(id)).slice(0, 20);
  const nested = deep.length - direct.length;
  return {
    title: p.name,
    html: `
    <div class="hero">
      ${p.photo ? `<div class="gallery">${thumb(p.photo, '', 'photo')}</div>` : ''}
      <p class="crumbs">${p.parentId ? crumbs(p.parentId) + ' <span class="sep">→</span>' : ''}</p>
      <h1>${placeIcon(p)} ${esc(p.name)}</h1>
      <div class="meta">${isBox ? '<span class="badge">Kasse</span>' : ''} ${!av.available ? badge(av) : ''} ${codeLine(id)}</div>
      ${av.loan ? `<p><a href="#/utlan/${esc(av.loan.id)}">Utlånt til <b>${esc(av.loan.borrower)}</b> – innholdet er utilgjengelig</a></p>` : ''}
      <p class="muted small">${deep.length} ting totalt${nested ? ` (${nested} i underplasseringer)` : ''} · Sist kontrollert: ${p.lastAuditAt ? esc(relDay(p.lastAuditAt)) : 'aldri'}${isBox ? ` · Kassen sist flyttet/bekreftet ${esc(relDay(p.lastConfirmedAt))}` : ''}</p>
      ${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
    </div>

    <div class="actions-grid">
      <a class="btn primary" href="#/bilde?ny=1&sted=${esc(id)}">🖼️ Legg til fra bilde</a>
      <a class="btn" href="#/ny?sted=${esc(id)}">+ Legg til manuelt</a>
      ${isBox ? `<a class="btn" href="#/flytt?ids=place:${esc(id)}">↔️ Flytt kassen</a>` : ''}
      <a class="btn" href="#/kontroll/${esc(id)}">☑️ Kontroller innhold</a>
      ${isBox && av.available ? `<a class="btn" href="#/utlan/ny?ids=place:${esc(id)}">🤝 Lån ut kassen</a>` : ''}
      <a class="btn" href="#/nytt-sted?forelder=${esc(id)}">+ Underplassering</a>
      <a class="btn" href="#/nytt-sted?forelder=${esc(id)}&type=kasse">+ Kasse her</a>
      <a class="btn" href="#/etiketter?ids=${esc([id, ...kids.map((k) => k.id), ...direct.map((i) => i.id)].join(','))}">🏷️ Etiketter</a>
      <a class="btn" href="#/sted/${esc(id)}/rediger">✏️ Rediger</a>
    </div>

    ${kids.length ? `<h2>Underplasseringer og kasser</h2>${kids.map((k) => placeCard(k, { select: k.kind === 'kasse' })).join('')}` : ''}
    <h2>Innhold her</h2>
    ${direct.map((i) => itemCard(i, { select: true })).join('') || `<p class="muted">Ingen ting registrert direkte her.</p>`}
    ${nested ? `<details><summary>Vis alt i underplasseringer (${nested})</summary>${deep.filter((i) => i.placeId !== id).map((i) => itemCard(i)).join('')}</details>` : ''}

    <div class="selbar" id="selbar" hidden>
      <span id="selcount"></span>
      <button class="btn small" data-sel="flytt">Flytt / ta ut</button>
      <button class="btn small" data-sel="utlan">Lån ut</button>
      <button class="btn small" data-sel="bekreft">Ligger her</button>
    </div>

    <section class="card pad"><h2>QR-kode</h2><div class="qrbox">${qrSVG(id, 140)}<p>Skann for å åpne ${isBox ? 'kassen' : 'plasseringen'}, se innhold og flytte utstyr hit.</p></div></section>
    <section class="card pad"><h2>Historikk</h2><ul class="evlist">${evs.map(eventRow).join('') || '<li class="muted">Ingen hendelser.</li>'}</ul></section>
    <button class="btn danger wide" id="del">Slett ${isBox ? 'kassen' : 'plasseringen'}</button>`,
    mount(v) {
      placeSel = new Set();
      const bar = v.querySelector('#selbar');
      v.addEventListener('change', (e) => {
        if (!e.target.classList.contains('sel')) return;
        e.target.checked ? placeSel.add(e.target.dataset.ref) : placeSel.delete(e.target.dataset.ref);
        bar.hidden = !placeSel.size;
        v.querySelector('#selcount').textContent = `${placeSel.size} valgt`;
      });
      bar.onclick = async (e) => {
        const a = e.target.dataset.sel;
        const ids = [...placeSel].join(',');
        if (a === 'flytt') go(`#/flytt?ids=${ids}`);
        if (a === 'utlan') go(`#/utlan/ny?ids=${ids}`);
        if (a === 'bekreft') {
          await st.confirmLocation([...placeSel].map((s) => ({ kind: s.split(':')[0], id: s.split(':')[1] })));
          toast('Bekreftet.');
          render();
        }
      };
      v.querySelector('#del').onclick = async () => {
        const where = p.parentId ? st.pathText(p.parentId) : 'ingen plassering';
        if (!(await confirmDialog(`Slette «${p.name}»? ${deep.length || kids.length ? `Innholdet (${kids.length} underplasseringer og ${direct.length} ting) flyttes til ${where}.` : ''} QR-koden slutter å virke.`, { ok: 'Slett', danger: true }))) return;
        await st.deletePlace(id);
        toast('Slettet.');
        go(p.parentId ? `#/sted/${p.parentId}` : '#/steder');
      };
      bindUndo(v);
    },
  };
}

export function placeForm(id, q = {}) {
  const old = id ? S.places.get(id) : null;
  const p = old || { name: '', kind: q.type === 'kasse' ? 'kasse' : 'sted', parentId: q.forelder || null, pinned: false, vehicle: false, notes: '' };
  return {
    title: old ? `Rediger ${p.name}` : 'Ny plassering',
    html: `<h1>${old ? 'Rediger' : p.kind === 'kasse' ? 'Ny kasse' : 'Ny plassering'}</h1>
    <form id="pform" class="stack">
      <label>Navn *<input name="name" required value="${esc(p.name)}" placeholder="${p.kind === 'kasse' ? 'f.eks. Kasse 2' : 'f.eks. Venstre hylle'}"></label>
      <div class="seg">
        <label><input type="radio" name="kind" value="sted" ${p.kind !== 'kasse' ? 'checked' : ''}><span>Plassering<small>rom, bil, hylle, arbeidssted</small></span></label>
        <label><input type="radio" name="kind" value="kasse" ${p.kind === 'kasse' ? 'checked' : ''}><span>Kasse<small>flyttbar, innholdet følger med</small></span></label>
      </div>
      <label>Ligger i<select name="parentId">${placeOptions(p.parentId, { none: 'Øverste nivå' })}</select></label>
      <label class="check"><input type="checkbox" name="pinned" ${p.pinned ? 'checked' : ''}> Vis som snarvei på startsiden</label>
      <label class="check"><input type="checkbox" name="vehicle" ${p.vehicle ? 'checked' : ''}> Dette er et kjøretøy (brukes i pakkelister)</label>
      <label>Notater<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
      <label class="btn">📷 ${p.photo ? 'Bytt bilde' : 'Legg til bilde'}<input type="file" name="photo" accept="image/*" hidden></label>
      <div class="actions sticky"><a class="btn" href="javascript:history.back()">Avbryt</a><button class="btn primary">Lagre</button></div>
    </form>`,
    mount(v) {
      const form = v.querySelector('#pform');
      let photo = null;
      form.photo.onchange = async (e) => { if (e.target.files[0]) { photo = await resizeImage(e.target.files[0]); toast('Bilde valgt.'); } };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const data = { id: old?.id, name: f.get('name').trim(), kind: f.get('kind'), parentId: f.get('parentId') || null, pinned: !!f.get('pinned'), vehicle: !!f.get('vehicle'), notes: f.get('notes').trim() };
        if (photo) data.photo = await st.putBlob(photo, 'bilde.jpg');
        try {
          const saved = await st.savePlace(data);
          toast('Lagret.');
          go(`#/sted/${saved.id}`);
        } catch (err) {
          toast(err.message);
        }
      };
    },
  };
}

// ---------- Kontrollmodus ----------
export function auditView(id) {
  const p = S.places.get(id);
  if (!p) return '<div class="empty"><h1>Fant ikke plasseringen</h1></div>';
  const its = st.itemsWithin(id).filter((i) => i.status !== 'kassert').sort((a, b) => st.pathText(a.placeId).localeCompare(st.pathText(b.placeId), 'nb') || st.byName(a, b));
  const groups = new Map();
  for (const i of its) {
    const k = i.placeId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return {
    title: `Kontroll: ${p.name}`,
    html: `<h1>☑️ Kontroll av ${esc(p.name)}</h1>
    <p>Forventet innhold ifølge registeret: <b>${its.length}</b> ting. Kryss av det som faktisk er her. Det du ikke krysser av, blir ikke endret.</p>
    <p class="muted small">Sist kontrollert: ${p.lastAuditAt ? esc(fmtDateTime(p.lastAuditAt)) : 'aldri'}</p>
    ${its.length ? '<button class="btn" id="all-ok">Merk alle som ✓ her</button>' : '<p class="muted">Ingen ting er registrert her.</p>'}
    <form id="aform">
    ${[...groups.entries()].map(([pid, list]) => `
      ${pid !== id ? `<h3 class="grp">${esc(st.path(pid).slice(st.path(id).length).map((x) => x.name).join(' → '))}</h3>` : ''}
      ${list.map((i) => {
        const av = st.availability(i);
        return `<div class="audit-row" data-id="${esc(i.id)}">
          <div class="ar-top">${thumb(i.photos?.[0], i.type === 'mengde' ? ICON.bulk : ICON.item)}<div class="grow"><b>${esc(i.name)}</b>${i.type === 'mengde' ? `<br><small>Registrert: ${esc(fmtNum(i.qty))} ${esc(i.unit)}</small>` : ''}${!av.available ? '<br>' + badge(av) : ''}</div></div>
          <div class="tri" role="radiogroup" aria-label="${esc(i.name)}">
            <label><input type="radio" name="s_${esc(i.id)}" value="ok"><span>✓ Her</span></label>
            <label><input type="radio" name="s_${esc(i.id)}" value="mangler"><span>✗ Mangler</span></label>
            <label><input type="radio" name="s_${esc(i.id)}" value="skadet"><span>⚠ Skadet</span></label>
          </div>
          ${i.type === 'mengde' ? `<label class="small">Talt antall (valgfritt)<input name="c_${esc(i.id)}" inputmode="decimal" placeholder="${esc(fmtNum(i.qty))}"></label>` : ''}
          <input name="n_${esc(i.id)}" class="small" placeholder="Merknad (valgfritt)" hidden>
        </div>`;
      }).join('')}`).join('')}
    ${its.length ? '<div class="actions sticky"><a class="btn" href="#/sted/' + esc(id) + '">Avbryt</a><button class="btn primary">Lagre kontroll</button></div>' : ''}
    </form>
    <p class="muted small">«Mangler» setter status til savnet. «Skadet» setter status til reparasjon og gjør verktøyet utilgjengelig i pakkelister. Talt antall oppdaterer beholdningen.</p>`,
    mount(v) {
      const form = v.querySelector('#aform');
      const all = v.querySelector('#all-ok');
      if (all) all.onclick = () => form.querySelectorAll('input[value="ok"]').forEach((r) => (r.checked = true));
      form.addEventListener('change', (e) => {
        if (e.target.type !== 'radio') return;
        const row = e.target.closest('.audit-row');
        row.querySelector('[name^="n_"]').hidden = e.target.value === 'ok';
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const results = its.map((i) => ({ id: i.id, state: f.get('s_' + i.id) || (f.get('c_' + i.id) ? 'ok' : null), counted: parseNum(f.get('c_' + i.id)), note: f.get('n_' + i.id) || '' }));
        const s = await st.saveAudit(id, results);
        toast(`Kontroll lagret: ${s.ok.length} ok, ${s.mangler.length} mangler, ${s.skadet.length} skadet.`);
        go(`#/sted/${id}`);
      };
    },
  };
}

// ---------- Etiketter ----------
export function labelsView(q = {}) {
  const pre = new Set((q.ids || '').split(',').filter(Boolean));
  const tree = st.placeTree();
  const items = [...S.items.values()].filter((i) => i.status !== 'kassert').sort(st.byName);
  return {
    title: 'QR-etiketter',
    html: `<h1>🏷️ QR-etiketter</h1>
    <p>Velg hva du vil lage etiketter for. Etiketten viser navn, type og kode. QR-koden inneholder bare den faste ID-en.</p>
    <div class="stack">
      <label>Format<select id="layout">${Object.entries(LAYOUTS).map(([k, l]) => `<option value="${k}">${esc(l.label)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="lines" checked> Tynne skillelinjer (for vanlig papir)</label>
      <label>Startposisjon på arket (for delvis brukte etikettark)<input id="skip" type="number" min="1" value="1" inputmode="numeric"></label>
    </div>
    <input type="search" id="lq" placeholder="Filtrer …" aria-label="Filtrer">
    <div class="btnrow"><button class="btn small" id="lall">Velg alle synlige</button><button class="btn small" id="lnone">Fjern alle</button></div>
    <div id="llist">
      <h3>Plasseringer og kasser</h3>
      ${tree.map(({ place, depth }) => `<label class="pick-row check" data-s="${esc(norm(place.name))}" style="padding-left:${12 + depth * 16}px"><input type="checkbox" value="${esc(place.id)}" ${pre.has(place.id) ? 'checked' : ''}><span>${placeIcon(place)}</span> ${esc(place.name)}</label>`).join('') || '<p class="muted">Ingen.</p>'}
      <h3>Verktøy og utstyr</h3>
      ${items.map((i) => `<label class="pick-row check" data-s="${esc(norm(i.name + ' ' + st.pathText(i.placeId)))}"><input type="checkbox" value="${esc(i.id)}" ${pre.has(i.id) ? 'checked' : ''}><span>${i.type === 'mengde' ? ICON.bulk : ICON.item}</span><span class="grow">${esc(i.name)}<br><small class="muted">${esc(st.pathText(i.placeId))}</small></span></label>`).join('') || '<p class="muted">Ingen.</p>'}
    </div>
    <div class="actions sticky"><span id="lcount" class="muted"></span><button class="btn primary" id="mkpdf">Lag PDF</button></div>
    <p class="muted small">Skriv ut PDF-en i 100 % størrelse («faktisk størrelse»), ikke «tilpass til side».</p>`,
    mount(v) {
      const list = v.querySelector('#llist');
      const count = () => (v.querySelector('#lcount').textContent = `${list.querySelectorAll('input:checked').length} etiketter`);
      count();
      list.onchange = count;
      v.querySelector('#lq').oninput = (e) => {
        const t = norm(e.target.value);
        list.querySelectorAll('[data-s]').forEach((l) => (l.hidden = t && !l.dataset.s.includes(t)));
      };
      v.querySelector('#lall').onclick = () => { list.querySelectorAll('[data-s]:not([hidden]) input').forEach((c) => (c.checked = true)); count(); };
      v.querySelector('#lnone').onclick = () => { list.querySelectorAll('input').forEach((c) => (c.checked = false)); count(); };
      v.querySelector('#mkpdf').onclick = () => {
        const ids = [...list.querySelectorAll('input:checked')].map((c) => c.value);
        if (!ids.length) { toast('Velg minst én.'); return; }
        const skip = Math.max(0, (parseInt(v.querySelector('#skip').value, 10) || 1) - 1);
        const blob = labelsPDF([...Array(skip).fill(null), ...ids], v.querySelector('#layout').value, { lines: v.querySelector('#lines').checked });
        downloadBlob(blob, `qr-etiketter-${todayISO()}.pdf`);
      };
    },
  };
}
