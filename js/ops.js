// Handlinger: flytting, utlån og retur, pakkelister, innkjøpsliste og oppfølging.

import { esc, toast, fmtDate, fmtDateTime, relDay, todayISO, resizeImage, downloadBlob, parseNum, fmtNum, randCode } from './util.js';
import * as st from './store.js';
import { S } from './store.js';
import { badge, crumbs, thumb, confirmDialog, pickPlace, pickObjects, placeOptions, placeIcon, itemCard, ICON, hydrate } from './ui.js';
import { scan } from './qr.js';
import { go, render, eventRow, bindUndo, parseRef } from './app.js';

const refsFromQuery = (s) => (s || '').split(',').filter(Boolean).map(parseRef).filter((r) => (r.kind === 'item' ? S.items.has(r.id) : S.places.has(r.id)));

function refLine(r, { removable = false } = {}) {
  const o = r.kind === 'item' ? S.items.get(r.id) : S.places.get(r.id);
  const av = r.kind === 'item' ? st.availability(o) : st.placeAvailability(o);
  const icon = r.kind === 'item' ? (o.type === 'mengde' ? ICON.bulk : ICON.item) : placeIcon(o);
  const where = r.kind === 'item' ? st.pathText(o.placeId) : `${o.parentId ? st.pathText(o.parentId) : 'Øverste nivå'} · ${st.itemsWithin(o.id).length} ting følger med`;
  return `<li class="refline">${thumb(r.kind === 'item' ? o.photos?.[0] : o.photo, icon)}<div class="grow"><b>${esc(o.name)}</b><br><small class="muted">${esc(where)}</small>${!av.available ? ' ' + badge(av) : ''}</div>${removable ? `<button class="btn small ghost" data-rmref="${esc(r.id)}" aria-label="Fjern">✕</button>` : ''}</li>`;
}

// ---------- Flytting ----------
let mv = null;

export function moveView(q) {
  if (!mv || q.ids || q.ny || q.til) {
    mv = { refs: refsFromQuery(q.ids), to: q.til && S.places.has(q.til) ? q.til : undefined };
    history.replaceState(null, '', '#/flytt');
  }
  const recentTo = [...new Set(S.events.filter((e) => e.type === 'flytt' && e.data?.to).map((e) => e.data.to))].filter((id) => S.places.has(id)).slice(0, 4);
  const quick = [...new Set([...[...S.places.values()].filter((p) => p.pinned).map((p) => p.id), ...recentTo])].slice(0, 6);
  const recent = S.events.filter((e) => e.type === 'flytt').slice(0, 5);
  const loaned = mv.refs.filter((r) => r.kind === 'item' && st.availability(S.items.get(r.id)).code === 'utlant');
  return {
    title: 'Flytt utstyr',
    html: `<h1>↔️ Flytt utstyr</h1>
    <section class="card pad">
      <h2>1. Hva skal flyttes?</h2>
      <ul class="reflist">${mv.refs.map((r) => refLine(r, { removable: true })).join('') || '<li class="muted">Ingenting valgt ennå.</li>'}</ul>
      <div class="btnrow"><button class="btn" id="m-pick">+ Velg fra listen</button><button class="btn" id="m-scan">📷 Skann utstyr</button></div>
      ${loaned.length ? `<p class="warnbox small">${loaned.map((r) => esc(S.items.get(r.id).name)).join(', ')} er registrert som utlånt. Flyttingen endrer bare registrert plassering. Registrer retur for å gjøre det tilgjengelig.</p>` : ''}
    </section>
    <section class="card pad">
      <h2>2. Til hvor?</h2>
      <p class="dest">${mv.to === undefined ? '<span class="muted">Ikke valgt</span>' : mv.to === null ? 'Ingen plassering' : crumbs(mv.to)}</p>
      <div class="chips">${quick.map((id) => `<button class="chip ${mv.to === id ? 'on' : ''}" data-to="${esc(id)}">${placeIcon(S.places.get(id))} ${esc(S.places.get(id).name)}</button>`).join('')}</div>
      <div class="btnrow"><button class="btn" id="m-dest">Velg plassering</button><button class="btn" id="m-scandest">📷 Skann plassering/kasse</button></div>
    </section>
    <button class="btn primary wide big" id="m-go" ${mv.refs.length && mv.to !== undefined ? '' : 'disabled'}>Flytt ${mv.refs.length || ''} ${mv.refs.length === 1 ? 'ting' : 'ting'}${mv.to ? ' til ' + esc(S.places.get(mv.to).name) : ''}</button>
    <h2>Siste flyttinger</h2>
    <ul class="evlist">${recent.map(eventRow).join('') || '<li class="muted">Ingen ennå.</li>'}</ul>`,
    mount(v) {
      const $ = (s) => v.querySelector(s);
      const add = (refs) => { for (const r of refs) if (!mv.refs.some((x) => x.id === r.id)) mv.refs.push(r); };
      $('#m-pick').onclick = async () => {
        const r = await pickObjects({ title: 'Velg det som skal flyttes', initial: mv.refs });
        if (r) { mv.refs = r; render(); }
      };
      $('#m-scan').onclick = async () => {
        // Skann flere etter hverandre. Lukk skanneren når du er ferdig.
        for (;;) {
          const id = await scan({ title: `Skann utstyr eller kasse (${mv.refs.length} valgt)`, hint: 'Skann neste, eller trykk Lukk når du er ferdig.' });
          if (!id) break;
          const o = st.lookup(id);
          if (o.kind === 'place' && o.obj.kind !== 'kasse') { mv.to = id; toast(`Mål satt til ${o.obj.name}`); break; }
          add([{ id, kind: o.kind }]);
          toast(`La til ${o.obj.name}`, { ms: 1500 });
        }
        render();
      };
      $('#m-dest').onclick = async () => {
        const to = await pickPlace({ title: 'Flytt til', allowNone: true, current: mv.to });
        if (to !== undefined) { mv.to = to; render(); }
      };
      $('#m-scandest').onclick = async () => {
        const id = await scan({ title: 'Skann plasseringen eller kassen det skal til' });
        if (!id) return;
        const o = st.lookup(id);
        if (o.kind === 'item') { toast('Det er et verktøy. Skann en plassering eller kasse.'); return; }
        mv.to = id;
        render();
      };
      v.querySelectorAll('[data-to]').forEach((b) => (b.onclick = () => { mv.to = b.dataset.to; render(); }));
      v.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rmref]');
        if (b) { mv.refs = mv.refs.filter((r) => r.id !== b.dataset.rmref); render(); }
      });
      $('#m-go').onclick = async () => {
        try {
          const ev = await st.moveObjects(mv.refs, mv.to);
          mv = { refs: [], to: mv.to };
          toast(ev.text, { action: 'Angre', ms: 10000, onAction: async () => { const r = await st.undoMove(ev.id); toast(r.skipped.length ? `Delvis angret. Ikke angret: ${r.skipped.join(', ')}` : 'Flyttingen er angret.'); render(); } });
          render();
        } catch (err) {
          toast(err.message);
        }
      };
      bindUndo(v);
    },
  };
}

// ---------- Utlån ----------
export function loansView() {
  const active = st.activeLoans();
  const late = active.filter((l) => st.loanState(l) === 'forsinket');
  const closed = [...S.loans.values()].filter((l) => l.closedAt).sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
  const card = (l) => {
    const s = st.loanState(l);
    const out = l.refs.filter((r) => !l.returns[r.id]);
    return `<a class="card pad loan ${s}" href="#/utlan/${esc(l.id)}">
      <div class="h-row"><b>🤝 ${esc(l.borrower)}</b>${s === 'forsinket' ? '<span class="badge st-savnet">Forsinket</span>' : s === 'returnert' ? '<span class="badge">Returnert</span>' : '<span class="badge st-utlant">Ute</span>'}</div>
      <div>${esc((s === 'returnert' ? l.refs : out).map(st.refName).join(', '))}</div>
      <small class="muted">Utlånt ${esc(fmtDate(l.at))}${l.dueAt ? ` · retur ${esc(fmtDate(l.dueAt))} (${esc(relDay(l.dueAt))})` : ' · ingen avtalt returdato'}${s === 'returnert' ? ` · levert ${esc(fmtDate(l.closedAt))}` : ''}</small>
    </a>`;
  };
  return {
    title: 'Utlån',
    html: `<div class="h-row"><h1>🤝 Utlån</h1><a class="btn primary" href="#/utlan/ny">+ Nytt utlån</a></div>
    <p class="muted small">Påminnelser går bare til deg. Appen sender aldri meldinger til låntakeren.</p>
    ${late.length ? `<h2 class="warn">Forsinket (${late.length})</h2>${late.map(card).join('')}` : ''}
    <h2>Ute nå (${active.length - late.length})</h2>
    ${active.filter((l) => st.loanState(l) !== 'forsinket').map(card).join('') || '<p class="muted">Ingenting er utlånt.</p>'}
    ${closed.length ? `<details><summary>Tidligere utlån (${closed.length})</summary>${closed.slice(0, 100).map(card).join('')}</details>` : ''}`,
  };
}

let loanDraft = null;

export function loanForm(q) {
  if (!loanDraft || q.ids || q.ny) {
    loanDraft = { refs: refsFromQuery(q.ids), borrower: '', at: todayISO(), dueAt: '', notes: '', photo: null };
    history.replaceState(null, '', '#/utlan/ny');
  }
  const D = loanDraft;
  const blocked = D.refs.filter((r) => !(r.kind === 'item' ? st.availability(S.items.get(r.id)) : st.placeAvailability(S.places.get(r.id))).available);
  return {
    title: 'Registrer utlån',
    html: `<h1>🤝 Registrer utlån</h1>
    <form id="lform" class="stack">
      <label>Hvem låner? *<input name="borrower" required list="borrowers" value="${esc(D.borrower)}" autocomplete="off"></label>
      <datalist id="borrowers">${st.borrowers().map((b) => `<option>${esc(b)}</option>`).join('')}</datalist>
      <div><b>Hva lånes ut?</b>
        <ul class="reflist">${D.refs.map((r) => refLine(r, { removable: true })).join('') || '<li class="muted">Ingenting valgt.</li>'}</ul>
        <div class="btnrow"><button type="button" class="btn" id="l-pick">+ Velg verktøy eller kasser</button><button type="button" class="btn" id="l-scan">📷 Skann</button></div>
        ${blocked.length ? `<p class="errbox small">Ikke tilgjengelig og kan ikke lånes ut: ${blocked.map((r) => esc(st.refName(r))).join(', ')}</p>` : ''}
      </div>
      <div class="grid2">
        <label>Utlånsdato<input type="date" name="at" value="${esc(D.at)}" required></label>
        <label>Avtalt retur (valgfritt)<input type="date" name="dueAt" value="${esc(D.dueAt)}"></label>
      </div>
      <label>Notat<textarea name="notes" rows="2" placeholder="f.eks. tilstand ved overlevering">${esc(D.notes)}</textarea></label>
      <label class="btn">📷 Bilde ved overlevering${D.photo ? ' ✓' : ''}<input type="file" accept="image/*" capture="environment" name="photo" hidden></label>
      <div class="actions sticky"><a class="btn" href="#/utlan">Avbryt</a><button class="btn primary" ${D.refs.length && !blocked.length ? '' : 'disabled'}>Registrer utlån</button></div>
    </form>`,
    mount(v) {
      const form = v.querySelector('#lform');
      const keep = () => { const f = new FormData(form); D.borrower = f.get('borrower'); D.at = f.get('at'); D.dueAt = f.get('dueAt'); D.notes = f.get('notes'); };
      form.addEventListener('input', keep);
      v.querySelector('#l-pick').onclick = async () => {
        keep();
        const r = await pickObjects({ title: 'Hva lånes ut?', initial: D.refs, onlyAvailable: true });
        if (r) { D.refs = r; render(); }
      };
      v.querySelector('#l-scan').onclick = async () => {
        keep();
        const id = await scan({ title: 'Skann verktøy eller kasse som lånes ut' });
        if (!id) return;
        const o = st.lookup(id);
        if (o.kind === 'place' && o.obj.kind !== 'kasse') { toast('Bare verktøy og kasser kan lånes ut.'); return; }
        if (!D.refs.some((r) => r.id === id)) D.refs.push({ id, kind: o.kind });
        render();
      };
      v.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rmref]');
        if (b) { keep(); D.refs = D.refs.filter((r) => r.id !== b.dataset.rmref); render(); }
      });
      form.photo.onchange = async (e) => { if (e.target.files[0]) { keep(); D.photo = await resizeImage(e.target.files[0]); render(); } };
      form.onsubmit = async (e) => {
        e.preventDefault();
        keep();
        try {
          const loan = await st.createLoan({ borrower: D.borrower, at: D.at, dueAt: D.dueAt, notes: D.notes, photoFiles: D.photo ? [D.photo] : [], refs: D.refs });
          loanDraft = null;
          toast(`Utlånt til ${loan.borrower}.`);
          go(`#/utlan/${loan.id}`);
        } catch (err) {
          toast(err.message);
        }
      };
    },
  };
}

function icsFor(loan) {
  const d = loan.dueAt.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const what = loan.refs.map(st.refName).join(', ');
  const escI = (s) => s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hvor er verktoyet//NO', 'BEGIN:VEVENT', `UID:${loan.id}@hvor-er-verktoyet`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${escI(`Retur fra ${loan.borrower}: ${what}`)}`, `DESCRIPTION:${escI(`Utlånt ${fmtDate(loan.at)}. ${loan.notes || ''}`)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${escI('Retur av utlånt verktøy')}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function loanView(id) {
  const l = S.loans.get(id);
  if (!l) return '<div class="empty"><h1>Fant ikke utlånet</h1></div>';
  const s = st.loanState(l);
  const out = l.refs.filter((r) => !l.returns[r.id]);
  const done = l.refs.filter((r) => l.returns[r.id]);
  const defaultPlace = (r) => {
    const o = r.kind === 'item' ? S.items.get(r.id) : S.places.get(r.id);
    return r.kind === 'item' ? o?.homeId || o?.placeId : o?.parentId;
  };
  return {
    title: `Utlån: ${l.borrower}`,
    html: `<h1>🤝 ${esc(l.borrower)}</h1>
    <div class="meta">${s === 'forsinket' ? '<span class="badge st-savnet">Forsinket</span>' : s === 'returnert' ? '<span class="badge">Returnert</span>' : '<span class="badge st-utlant">Ute</span>'}</div>
    <section class="card pad">
      <div class="kv"><dt>Utlånt</dt><dd>${esc(fmtDate(l.at))}</dd></div>
      <div class="kv"><dt>Avtalt retur</dt><dd>${l.dueAt ? `${esc(fmtDate(l.dueAt))} (${esc(relDay(l.dueAt))})` : 'Ikke avtalt'}</dd></div>
      ${l.notes ? `<div class="kv"><dt>Notat</dt><dd>${esc(l.notes)}</dd></div>` : ''}
      ${l.photos?.length ? `<div class="gallery">${l.photos.map((b) => thumb(b, '', 'photo')).join('')}</div>` : ''}
      ${l.dueAt && !l.closedAt ? '<button class="btn small" id="ics">📅 Legg returdato i kalenderen min</button>' : ''}
    </section>
    ${out.length ? `
    <form id="rform" class="card pad stack">
      <h2>Registrer retur</h2>
      <p class="small">Kontroller at alt tilbehør er med, og velg hvor utstyret legges.</p>
      ${out.map((r) => {
        const o = r.kind === 'item' ? S.items.get(r.id) : S.places.get(r.id);
        if (!o) return '';
        const acc = r.kind === 'item' ? o.accessories || [] : [];
        const contents = r.kind === 'place' ? st.itemsWithin(o.id) : [];
        return `<fieldset class="ret" data-id="${esc(r.id)}" data-kind="${r.kind}">
          <label class="check big"><input type="checkbox" name="ret_${esc(r.id)}" checked> <b>${esc(o.name)}</b> er levert tilbake</label>
          ${acc.length ? `<div class="acc"><small>Tilbehør med tilbake:</small>${acc.map((a, i) => `<label class="check"><input type="checkbox" name="acc_${esc(r.id)}_${i}" data-acc="${esc(a)}"> ${esc(a)}</label>`).join('')}</div>` : ''}
          ${contents.length ? `<div class="acc"><small>Innhold i kassen (kryss av det som er med):</small>${contents.map((c) => `<label class="check"><input type="checkbox" name="box_${esc(r.id)}" value="${esc(c.id)}"> ${esc(c.name)}</label>`).join('')}</div>` : ''}
          <label>Legges i<select name="pl_${esc(r.id)}">${placeOptions(defaultPlace(r), { none: 'Ingen plassering' })}</select></label>
        </fieldset>`;
      }).join('')}
      <label>Notat ved retur<input name="note"></label>
      <button class="btn primary">Registrer retur</button>
    </form>` : ''}
    ${done.length ? `<section class="card pad"><h2>Levert tilbake</h2><ul class="reflist">${done.map((r) => { const ret = l.returns[r.id]; return `<li class="refline"><div class="grow"><b>${esc(st.refName(r))}</b><br><small class="muted">${esc(fmtDateTime(ret.at))} → ${esc(ret.placeId ? st.pathText(ret.placeId) : 'ingen plassering')}${ret.missing?.length ? ' · <b>mangler: ' + esc(ret.missing.join(', ')) + '</b>' : ''}</small></div></li>`; }).join('')}</ul></section>` : ''}`,
    mount(v) {
      const ics = v.querySelector('#ics');
      if (ics) ics.onclick = () => downloadBlob(new Blob([icsFor(l)], { type: 'text/calendar' }), `retur-${l.borrower.replace(/\W+/g, '-')}.ics`);
      const form = v.querySelector('#rform');
      if (!form) return;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const returns = [];
        const missingNotes = [];
        for (const fs of form.querySelectorAll('.ret')) {
          const rid = fs.dataset.id;
          if (!f.get('ret_' + rid)) continue;
          const missing = [...fs.querySelectorAll('[data-acc]')].filter((c) => !c.checked).map((c) => c.dataset.acc);
          if (fs.dataset.kind === 'place') {
            const got = new Set(f.getAll('box_' + rid));
            const contents = st.itemsWithin(rid);
            missing.push(...contents.filter((c) => !got.has(c.id)).map((c) => c.name));
          }
          if (missing.length) missingNotes.push(`${st.refName({ id: rid, kind: fs.dataset.kind })}: ${missing.join(', ')}`);
          returns.push({ id: rid, kind: fs.dataset.kind, placeId: f.get('pl_' + rid) || null, missing, note: f.get('note') });
        }
        if (!returns.length) { toast('Kryss av det som er levert tilbake.'); return; }
        if (missingNotes.length && !(await confirmDialog(`Ikke avkrysset som med tilbake: ${missingNotes.join('; ')}. Registrere retur likevel? Det som mangler noteres på verktøyet.`, { ok: 'Registrer' }))) return;
        await st.returnLoan(id, returns);
        toast('Retur registrert.');
        render();
      };
    },
  };
}

// ---------- Pakkelister ----------
const SUGGESTED = ['Bytte glaslister', 'Montere dør med karm', 'Male eller utbedre overflate', 'Justere dør', 'Måle kuv og kontrollere lodd'];

export function packlistsView() {
  const lists = [...S.packlists.values()].sort(st.byName);
  const missing = SUGGESTED.filter((n) => !lists.some((l) => l.name === n));
  return {
    title: 'Pakkelister',
    html: `<h1>🧰 Pakkelister</h1>
    <p class="muted small">Gjenbrukbare lister for oppdrag. Listen viser hva som er registrert i bilen, hva som må hentes, kjøpes eller lånes, og lar deg krysse av det du faktisk har pakket.</p>
    ${lists.map((pl) => {
      const veh = pl.vehicleId || st.defaultVehicle()?.id;
      const stt = pl.lines.map((ln) => st.lineStatus(ln, veh).code);
      const packed = pl.lines.filter((x) => x.packed).length;
      return `<a class="card pad row-link" href="#/pakkeliste/${esc(pl.id)}"><b>${esc(pl.name)}</b><small class="muted">${pl.lines.length} linjer · ${stt.filter((c) => c === 'ibil').length} i bilen · ${stt.filter((c) => c !== 'ibil' && c !== 'fri').length} mangler · ${packed} kontrollert pakket</small></a>`;
    }).join('') || '<p class="muted">Ingen pakkelister ennå.</p>'}
    <form id="newpl" class="card pad stack"><h2>Ny pakkeliste</h2><input name="name" required placeholder="Navn på oppdragstype"><button class="btn primary">Opprett</button>
    ${missing.length ? `<p class="small">Eller start med et navn (tom liste du fyller selv):</p><div class="chips">${missing.map((n) => `<button type="button" class="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}</form>`,
    mount(v) {
      const make = async (name) => {
        const pl = await st.savePacklist({ name, vehicleId: st.defaultVehicle()?.id || null, lines: [] });
        go(`#/pakkeliste/${pl.id}/rediger`);
      };
      v.querySelector('#newpl').onsubmit = (e) => { e.preventDefault(); make(new FormData(e.target).get('name').trim()); };
      v.querySelectorAll('[data-name]').forEach((b) => (b.onclick = () => make(b.dataset.name)));
    },
  };
}

const LINE_CLS = { ibil: 'ok', hent: 'warn', kjop: 'alert', laan: 'alert', utilgjengelig: 'alert', fri: 'info', ukjent: 'alert' };

export function packlistView(id) {
  const pl = S.packlists.get(id);
  if (!pl) return '<div class="empty"><h1>Fant ikke pakkelisten</h1></div>';
  const veh = pl.vehicleId && S.places.has(pl.vehicleId) ? pl.vehicleId : st.defaultVehicle()?.id;
  const rows = pl.lines.map((ln) => ({ ln, s: st.lineStatus(ln, veh) }));
  const cnt = (c) => rows.filter((r) => r.s.code === c).length;
  const packed = pl.lines.filter((l) => l.packed).length;
  const fetchable = rows.filter((r) => r.s.code === 'hent' && r.s.item && !r.ln.packed);
  const label = (ln) => {
    if (ln.kind === 'verktoy' || ln.kind === 'vare') {
      const it = S.items.get(ln.itemId);
      return `<a href="#/ting/${esc(ln.itemId)}">${esc(it?.name || '(slettet)')}</a>${ln.qty ? ` · ${esc(fmtNum(ln.qty))} ${esc(it?.unit || ln.unit || '')}` : ''}`;
    }
    if (ln.kind === 'kategori') return `${esc(ln.text)} <small class="muted">(hvilken som helst)</small>`;
    return `${esc(ln.text)}${ln.qty ? ` · ${esc(fmtNum(ln.qty))} ${esc(ln.unit || '')}` : ''}`;
  };
  return {
    title: pl.name,
    html: `<h1>🧰 ${esc(pl.name)}</h1>
    <label>Kjøretøy<select id="veh">${placeOptions(veh, { none: 'Velg kjøretøy' })}</select></label>
    <div class="tiles four">
      <div class="tile ok"><b>${cnt('ibil')}</b><span>registrert i bilen</span></div>
      <div class="tile warn"><b>${cnt('hent')}</b><span>må hentes</span></div>
      <div class="tile alert"><b>${cnt('kjop') + cnt('laan') + cnt('utilgjengelig') + cnt('ukjent') + rows.filter((r) => r.s.code === 'fri' && r.ln.buy).length}</b><span>kjøpes, lånes eller utilgjengelig</span></div>
      <div class="tile info"><b>${packed}/${pl.lines.length}</b><span>kontrollert pakket</span></div>
    </div>
    <p class="muted small">«Registrert i bilen» betyr at registeret sier det ligger der. «Pakket» krysser du av når du fysisk har sjekket at det er med.</p>
    ${pl.notes ? `<p>${esc(pl.notes)}</p>` : ''}
    <ul class="packlist">${rows.map(({ ln, s }) => `
      <li class="pline ${ln.packed ? 'packed' : ''}">
        <label class="pack"><input type="checkbox" data-pack="${esc(ln.id)}" ${ln.packed ? 'checked' : ''}><span>Pakket</span></label>
        <div class="grow">
          <div>${label(ln)}</div>
          ${ln.note ? `<small>${esc(ln.note)}</small><br>` : ''}
          <span class="lstat ${LINE_CLS[s.code]}">${esc(s.label)}</span>
        </div>
      </li>`).join('') || '<li class="muted">Listen er tom. Trykk «Rediger liste» for å legge til.</li>'}</ul>
    <div class="btnrow">
      <a class="btn" href="#/pakkeliste/${esc(id)}/rediger">✏️ Rediger liste</a>
      ${fetchable.length && veh ? `<button class="btn" id="fetch">↔️ Registrer ${fetchable.length} hentede ting som flyttet til bilen</button>` : ''}
      <button class="btn" id="reset">↺ Nullstill avkrysning (nytt oppdrag)</button>
    </div>`,
    mount(v) {
      v.querySelector('#veh').onchange = async (e) => { await st.savePacklist({ id, vehicleId: e.target.value || null }); render(); };
      v.querySelectorAll('[data-pack]').forEach((c) => (c.onchange = async () => {
        const lines = pl.lines.map((l) => (l.id === c.dataset.pack ? { ...l, packed: c.checked } : l));
        await st.savePacklist({ id, lines, lastUsedAt: new Date().toISOString() });
        render();
      }));
      const f = v.querySelector('#fetch');
      if (f) f.onclick = async () => {
        const refs = fetchable.map((r) => ({ id: r.s.item.id, kind: 'item' }));
        if (!(await confirmDialog(`Har du hentet ${fetchable.map((r) => r.s.item.name).join(', ')}? De registreres som flyttet til ${S.places.get(veh).name}.`, { ok: 'Ja, flytt' }))) return;
        const ev = await st.moveObjects(refs, veh, `Pakkeliste: ${pl.name}`);
        toast('Registrert i bilen.', { action: 'Angre', ms: 10000, onAction: async () => { await st.undoMove(ev.id); render(); } });
        render();
      };
      v.querySelector('#reset').onclick = async () => {
        await st.savePacklist({ id, lines: pl.lines.map((l) => ({ ...l, packed: false })) });
        render();
      };
    },
  };
}

export function packlistForm(id) {
  const pl = S.packlists.get(id);
  if (!pl) return '<div class="empty"><h1>Fant ikke pakkelisten</h1></div>';
  const lines = pl.lines;
  const kindLbl = { verktoy: 'Verktøy', vare: 'Fra beholdning', kategori: 'Hvilken som helst', fri: 'Forbruk / annet' };
  return {
    title: `Rediger ${pl.name}`,
    html: `<h1>Rediger pakkeliste</h1>
    <form id="plform" class="stack">
      <label>Navn<input name="name" value="${esc(pl.name)}" required></label>
      <label>Notater<textarea name="notes" rows="2">${esc(pl.notes || '')}</textarea></label>
      <ul class="lines">${lines.map((ln, i) => `
        <li class="lineedit" data-i="${i}">
          <div class="h-row"><small class="badge">${kindLbl[ln.kind]}</small><button type="button" class="btn small ghost" data-rm="${i}" aria-label="Fjern">✕</button></div>
          ${ln.kind === 'verktoy' || ln.kind === 'vare' ? `<b>${esc(S.items.get(ln.itemId)?.name || '(slettet)')}</b>` : `<input data-f="text" value="${esc(ln.text)}" placeholder="${ln.kind === 'kategori' ? 'f.eks. Vater' : 'f.eks. Fugeskum lavtrykk'}">`}
          ${ln.kind !== 'verktoy' && ln.kind !== 'kategori' ? `<div class="grid2"><input data-f="qty" value="${esc(fmtNum(ln.qty ?? ''))}" placeholder="Antall" inputmode="decimal">${ln.kind === 'fri' ? `<input data-f="unit" value="${esc(ln.unit || '')}" placeholder="Enhet">` : ''}</div>` : ''}
          <input data-f="note" value="${esc(ln.note || '')}" placeholder="Merknad, f.eks. NCS S 0502-Y">
          ${ln.kind === 'fri' ? `<label class="check"><input type="checkbox" data-f="buy" ${ln.buy ? 'checked' : ''}> Må kjøpes</label>` : ''}
        </li>`).join('')}</ul>
      <div class="btnrow">
        <button type="button" class="btn" id="add-tools">+ Verktøy fra registeret</button>
        <button type="button" class="btn" id="add-cat">+ Hvilken som helst av en type</button>
        <button type="button" class="btn" id="add-free">+ Forbruksvare eller prosjektbehov</button>
      </div>
      <div class="actions sticky"><button type="button" class="btn danger" id="del">Slett liste</button><button class="btn primary">Lagre</button></div>
    </form>`,
    mount(v) {
      const form = v.querySelector('#plform');
      const collect = () => {
        form.querySelectorAll('.lineedit').forEach((li) => {
          const ln = lines[li.dataset.i];
          li.querySelectorAll('[data-f]').forEach((inp) => {
            const k = inp.dataset.f;
            ln[k] = inp.type === 'checkbox' ? inp.checked : k === 'qty' ? parseNum(inp.value) : inp.value;
          });
        });
        pl.name = form.name.value;
        pl.notes = form.notes.value;
      };
      const save = async () => { collect(); await st.savePacklist({ id, name: pl.name.trim(), notes: pl.notes, lines }); };
      const newLine = (o) => ({ id: 'ln' + randCode(8), packed: false, note: '', qty: null, ...o });
      v.querySelector('#add-tools').onclick = async () => {
        collect();
        const r = await pickObjects({ title: 'Legg til verktøy', includeBoxes: false });
        if (!r) return;
        for (const x of r) {
          if (lines.some((l) => l.itemId === x.id)) continue;
          const it = S.items.get(x.id);
          lines.push(newLine({ kind: it.type === 'mengde' ? 'vare' : 'verktoy', itemId: x.id }));
        }
        await save();
        render();
      };
      v.querySelector('#add-cat').onclick = async () => { collect(); lines.push(newLine({ kind: 'kategori', text: '' })); await save(); render(); };
      v.querySelector('#add-free').onclick = async () => { collect(); lines.push(newLine({ kind: 'fri', text: '', unit: '', buy: true })); await save(); render(); };
      v.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-rm]');
        if (b) { collect(); lines.splice(Number(b.dataset.rm), 1); await save(); render(); }
      });
      v.querySelector('#del').onclick = async () => {
        if (!(await confirmDialog(`Slette pakkelisten «${pl.name}»?`, { ok: 'Slett', danger: true }))) return;
        await st.deletePacklist(id);
        go('#/pakkelister');
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        collect();
        // Tomme fritekstlinjer fjernes.
        const clean = lines.filter((l) => (l.kind === 'fri' || l.kind === 'kategori' ? l.text?.trim() : true));
        await st.savePacklist({ id, name: pl.name.trim(), notes: pl.notes, lines: clean });
        toast('Pakkelisten er lagret.');
        go(`#/pakkeliste/${id}`);
      };
    },
  };
}

// ---------- Innkjøp og oppfølging ----------
export function shoppingView() {
  const low = st.shoppingList();
  const fromLists = [];
  for (const pl of S.packlists.values()) {
    const veh = pl.vehicleId || st.defaultVehicle()?.id;
    for (const ln of pl.lines) {
      if (ln.packed) continue;
      const s = st.lineStatus(ln, veh);
      if ((ln.kind === 'fri' && ln.buy) || s.code === 'kjop') fromLists.push({ pl, ln, s });
    }
  }
  return {
    title: 'Innkjøpsliste',
    html: `<h1>🛒 Innkjøpsliste</h1>
    <h2>Under minimumsbeholdning</h2>
    <p class="muted small">Basert på registrert antall. Tell opp i kontrollmodus hvis du er usikker.</p>
    ${low.map((it) => `<div class="card pad shop"><div class="grow"><a href="#/ting/${esc(it.id)}"><b>${esc(it.name)}</b></a><br><small>${esc(fmtNum(it.qty))} ${esc(it.unit)} igjen · minimum ${esc(fmtNum(it.minQty))} · ${esc(st.pathText(it.placeId))}</small><br><small class="muted">Sist talt: ${it.qtyCheckedAt ? esc(relDay(it.qtyCheckedAt)) : 'aldri'}</small></div><button class="btn small" data-fill="${esc(it.id)}">+ Påfyll</button></div>`).join('') || '<p class="muted">Ingen varer under minimum.</p>'}
    <h2>Fra pakkelister</h2>
    ${fromLists.map(({ pl, ln, s }) => `<a class="card pad row-link" href="#/pakkeliste/${esc(pl.id)}"><b>${esc(ln.text || S.items.get(ln.itemId)?.name)}</b>${ln.qty ? ` · ${esc(fmtNum(ln.qty))} ${esc(ln.unit || '')}` : ''}${ln.note ? ` · ${esc(ln.note)}` : ''}<small class="muted">${esc(pl.name)} · ${esc(s.label)}</small></a>`).join('') || '<p class="muted">Ingenting å kjøpe fra pakkelistene.</p>'}`,
    mount(v) {
      v.querySelectorAll('[data-fill]').forEach((b) => (b.onclick = async () => {
        const it = S.items.get(b.dataset.fill);
        const n = parseNum(prompt(`Hvor mange ${it.unit} er kjøpt inn?`));
        if (n == null || n <= 0) return;
        await st.adjustQty(it.id, { delta: n, reason: 'innkjøp' });
        render();
      }));
    },
  };
}

export function followUpView() {
  const f = st.followUps(30);
  const missing = [...S.items.values()].filter((i) => i.status === 'savnet');
  return {
    title: 'Oppfølging',
    html: `<h1>🛠️ Vedlikehold og oppfølging</h1>
    <h2>Trenger oppfølging (neste 30 dager)</h2>
    ${f.map((x) => itemCard(x.item, { extra: `<div class="lstat warn">${esc(x.reason)}</div>` })).join('') || '<p class="muted">Ingenting som haster.</p>'}
    <h2>Savnet</h2>
    ${missing.map((i) => itemCard(i)).join('') || '<p class="muted">Ingenting er savnet.</p>'}
    <p class="muted small">Legg inn neste service- eller kontrolldato på verktøyets side. Verktøy til reparasjon vises som utilgjengelige i pakkelister.</p>`,
  };
}
