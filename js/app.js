// Appskall: ruter, topplinje, startside, søk, historikk og innstillinger.

import { esc, debounce, toast, relDay, fmtDateTime, fmtDate, downloadBlob, todayISO, prettyCode } from './util.js';
import * as st from './store.js';
import { S } from './store.js';
import { hydrate, itemCard, placeCard, placeIcon, confirmDialog, alertDialog, placeOptions, badge } from './ui.js';
import { scan } from './qr.js';
import { MODELS, DEFAULT_MODEL } from './ai.js';
import * as items from './items.js';
import * as places from './places.js';
import * as ops from './ops.js';
import { seedDemo } from './demo.js';

const view = () => document.getElementById('view');

// ---------- Ruter ----------
const routes = [
  [/^$/, home],
  [/^sok$/, searchView],
  [/^ting\/([^/]+)$/, (m, q) => items.itemView(m[1], q)],
  [/^ting\/([^/]+)\/rediger$/, (m) => items.itemForm(m[1])],
  [/^ny$/, (m, q) => items.itemForm(null, q)],
  [/^bilde$/, (m, q) => items.photoView(q)],
  [/^steder$/, places.placesView],
  [/^sted\/([^/]+)$/, (m) => places.placeView(m[1])],
  [/^sted\/([^/]+)\/rediger$/, (m) => places.placeForm(m[1])],
  [/^nytt-sted$/, (m, q) => places.placeForm(null, q)],
  [/^kontroll\/([^/]+)$/, (m) => places.auditView(m[1])],
  [/^etiketter$/, (m, q) => places.labelsView(q)],
  [/^kode\/([^/]+)$/, (m) => openCode(m[1])],
  [/^flytt$/, (m, q) => ops.moveView(q)],
  [/^utlan$/, ops.loansView],
  [/^utlan\/ny$/, (m, q) => ops.loanForm(q)],
  [/^utlan\/([^/]+)$/, (m) => ops.loanView(m[1])],
  [/^pakkelister$/, ops.packlistsView],
  [/^pakkeliste\/([^/]+)$/, (m) => ops.packlistView(m[1])],
  [/^pakkeliste\/([^/]+)\/rediger$/, (m) => ops.packlistForm(m[1])],
  [/^innkjop$/, ops.shoppingView],
  [/^oppfolging$/, ops.followUpView],
  [/^historikk$/, historyView],
  [/^mer$/, settingsView],
];

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

export async function render() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, qs] = raw.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  let out = null;
  for (const [re, fn] of routes) {
    const m = p.match(re);
    if (m) { out = await fn(m, q); break; }
  }
  if (out == null) out = `<div class="empty"><h1>Fant ikke siden</h1><a class="btn" href="#/">Til startsiden</a></div>`;
  if (typeof out === 'string') out = { html: out };
  if (out.redirect) { location.replace('#/' + out.redirect); return; }
  const v = view();
  v.innerHTML = out.html;
  document.title = out.title ? `${out.title} – Hvor er verktøyet?` : 'Hvor er verktøyet?';
  updateNav(p);
  if (!out.keepScroll) window.scrollTo(0, 0);
  out.mount && (await out.mount(v));
  hydrate(v);
}

function updateNav(p) {
  const tab = p === '' ? 'home' : /^(sok|ting)/.test(p) ? 'sok' : /^(steder|sted|kontroll|nytt-sted)/.test(p) ? 'steder' : /^mer|historikk|innkjop|oppfolging|etiketter|pakke|utlan/.test(p) ? 'mer' : '';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}

function openCode(id) {
  const o = st.lookup(id);
  if (!o) return `<div class="empty"><h1>Ukjent kode</h1><p>${esc(prettyCode(id))} finnes ikke i registeret.</p><a class="btn" href="#/">Til startsiden</a></div>`;
  return { redirect: o.kind === 'item' ? `ting/${id}` : `sted/${id}` };
}

export async function scanAndOpen() {
  const id = await scan({ title: 'Skann QR-kode' });
  if (id) go(`#/kode/${id}`);
}

// ---------- Topplinje ----------
function renderChrome() {
  const demo = S.mode === 'demo';
  document.getElementById('demo-banner').hidden = !demo;
  const chip = document.getElementById('storage-chip');
  chip.textContent = navigator.onLine ? '📱 Kun lagret på denne enheten' : '📴 Uten nett · lagret på enheten';
}

// ---------- Startside ----------
function home() {
  const all = [...S.items.values()];
  const loans = st.activeLoans();
  const late = loans.filter((l) => st.loanState(l) === 'forsinket');
  const loanedCount = all.filter((i) => st.availability(i).code === 'utlant').length;
  const missing = all.filter((i) => i.status === 'savnet');
  const follow = st.followUps();
  const shop = st.shoppingList();
  const pinned = [...S.places.values()].filter((p) => p.pinned).sort(st.byName);
  const lists = [...S.packlists.values()].sort((a, b) => ((a.lastUsedAt || a.updatedAt) < (b.lastUsedAt || b.updatedAt) ? 1 : -1)).slice(0, 3);
  const noPlaces = S.places.size === 0;
  const lastBackup = S.meta.lastBackupAt;
  const backupWarn = S.mode !== 'demo' && all.length >= 5 && (!lastBackup || (Date.now() - new Date(lastBackup)) / 864e5 > 30);
  const tile = (href, n, label, cls = '') => `<a class="tile ${n ? cls : ''}" href="${href}"><b>${n}</b><span>${label}</span></a>`;

  return {
    html: `
    <form class="bigsearch" id="home-search" role="search">
      <label for="hq" class="sr">Hva leter du etter?</label>
      <input id="hq" type="search" placeholder="Hva leter du etter?" autocomplete="off" enterkeyhint="search">
      <button class="btn primary" aria-label="Søk">Søk</button>
    </form>
    <div class="quick">
      <button class="qbtn" id="q-scan"><span>📷</span>Skann QR-kode</button>
      <a class="qbtn" href="#/bilde"><span>🖼️</span>Legg til fra bilde</a>
      <a class="qbtn" href="#/flytt"><span>↔️</span>Flytt utstyr</a>
      <a class="qbtn" href="#/utlan/ny"><span>🤝</span>Registrer utlån</a>
    </div>
    <a class="btn wide" href="#/ny">+ Legg til manuelt</a>

    ${noPlaces ? `
    <section class="card pad onboard">
      <h2>Kom i gang</h2>
      <p>Registeret ditt er tomt. Start med plassene der utstyret ligger. Du kan endre navn og legge til flere senere.</p>
      <button class="btn primary wide" id="mk-default">Opprett «Servicebilen», «Garasjen» og «Verkstedet på jobb»</button>
      <a class="btn wide" href="#/nytt-sted">Lag egne plasseringer</a>
      <p class="muted small">Vil du se hvordan appen fungerer først? <a href="#/mer" id="to-demo">Prøv demomodus</a>. Eksempeldataene lagres separat og blandes aldri med ditt eget utstyr.</p>
    </section>` : ''}

    ${pinned.length ? `<section><h2>Snarveier</h2><div class="shortcuts">${pinned.map((p) => `<a class="shortcut" href="#/sted/${esc(p.id)}"><span>${placeIcon(p)}</span><b>${esc(p.name)}</b><small>${st.itemsWithin(p.id).length} ting</small></a>`).join('')}</div></section>` : ''}

    ${all.length || loans.length ? `<section><h2>Oversikt</h2><div class="tiles">
      ${tile('#/utlan', loanedCount, late.length ? `utlånt · <span class="warn">${late.length} forsinket</span>` : 'utlånt', late.length ? 'alert' : 'info')}
      ${tile('#/sok?status=savnet', missing.length, 'savnet', 'alert')}
      ${tile('#/oppfolging', follow.length, 'trenger oppfølging', 'warn')}
      ${tile('#/innkjop', shop.length, 'på innkjøpslisten', 'warn')}
    </div></section>` : ''}

    ${late.length ? `<section class="card pad alertbox"><h2>Forsinkede returer</h2>${late.map((l) => `<a class="row-link" href="#/utlan/${esc(l.id)}"><b>${esc(l.borrower)}</b> skulle levere ${esc(fmtDate(l.dueAt))}: ${esc(l.refs.map(st.refName).join(', '))}</a>`).join('')}</section>` : ''}

    <section><div class="h-row"><h2>Pakkelister</h2><a href="#/pakkelister">Alle</a></div>
      ${lists.length ? lists.map((pl) => `<a class="row-link card" href="#/pakkeliste/${esc(pl.id)}">🧰 <b>${esc(pl.name)}</b> <span class="muted">${pl.lines.length} linjer</span></a>`).join('') : `<p class="muted">Ingen pakkelister ennå. <a href="#/pakkelister">Lag en</a>.</p>`}
    </section>

    ${backupWarn ? `<section class="card pad warnbox"><b>Ta sikkerhetskopi.</b> ${lastBackup ? `Siste kopi ble tatt ${esc(relDay(lastBackup))}.` : 'Du har ikke tatt sikkerhetskopi ennå.'} Dataene ligger bare på denne enheten. <a href="#/mer">Ta kopi nå</a></section>` : ''}
    `,
    mount(v) {
      v.querySelector('#home-search').onsubmit = (e) => {
        e.preventDefault();
        go(`#/sok?q=${encodeURIComponent(v.querySelector('#hq').value.trim())}`);
      };
      v.querySelector('#q-scan').onclick = scanAndOpen;
      const mk = v.querySelector('#mk-default');
      if (mk) mk.onclick = async () => {
        const car = await st.savePlace({ name: 'Servicebilen', kind: 'sted', pinned: true, vehicle: true });
        await st.savePlace({ name: 'Garasjen', kind: 'sted', pinned: true });
        await st.savePlace({ name: 'Verkstedet på jobb', kind: 'sted', pinned: true });
        toast('Plasseringene er opprettet. Legg til hyller og kasser fra hver plassering.');
        go(`#/sted/${car.id}`);
      };
    },
  };
}

// ---------- Søk ----------
let selection = new Set();

function searchView(m, q) {
  const f = { place: q.sted || '', owner: q.eier || '', status: q.status || '' };
  return {
    title: 'Søk',
    html: `
    <form class="bigsearch" id="sform" role="search">
      <label for="sq" class="sr">Hva leter du etter?</label>
      <input id="sq" type="search" value="${esc(q.q || '')}" placeholder="Hva leter du etter?" autocomplete="off" enterkeyhint="search">
    </form>
    <details class="filters" ${f.place || f.owner || f.status ? 'open' : ''}><summary>Filter</summary>
      <div class="grid3">
        <label>Plassering<select id="f-place">${placeOptions(f.place, { none: 'Alle plasseringer' })}</select></label>
        <label>Eier<select id="f-owner"><option value="">Alle eiere</option>${Object.entries(st.OWNER).map(([k, v]) => `<option value="${k}" ${f.owner === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Status<select id="f-status"><option value="">Alle unntatt kassert</option>${Object.entries(st.STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}<option value="alle" ${f.status === 'alle' ? 'selected' : ''}>Alle, også kassert</option></select></label>
      </div>
    </details>
    <p class="muted small">Plasseringen er der utstyret sist ble registrert, flyttet eller bekreftet. Appen sporer ikke utstyr automatisk.</p>
    <div id="results"></div>
    <div class="selbar" id="selbar" hidden>
      <span id="selcount"></span>
      <button class="btn small" data-sel="flytt">Flytt</button>
      <button class="btn small" data-sel="utlan">Lån ut</button>
      <button class="btn small" data-sel="bekreft">Bekreft her</button>
      <button class="btn small" data-sel="etiketter">Etiketter</button>
      <button class="btn small ghost" data-sel="x" aria-label="Fjern valg">✕</button>
    </div>`,
    mount(v) {
      selection = new Set();
      const run = () => {
        const params = new URLSearchParams();
        const qq = v.querySelector('#sq').value.trim();
        if (qq) params.set('q', qq);
        const fp = v.querySelector('#f-place').value, fo = v.querySelector('#f-owner').value, fs = v.querySelector('#f-status').value;
        if (fp) params.set('sted', fp);
        if (fo) params.set('eier', fo);
        if (fs) params.set('status', fs);
        history.replaceState(null, '', '#/sok' + (params.toString() ? '?' + params : ''));
        const r = st.search(qq, { place: fp, owner: fo, status: fs });
        const box = v.querySelector('#results');
        const total = r.items.length + r.places.length;
        box.innerHTML = (qq || fp || fo || fs ? `<p class="muted">${total} treff</p>` : `<p class="muted">Alt registrert utstyr (${r.items.length})</p>`) +
          r.places.map((p) => placeCard(p, { select: p.kind === 'kasse', selected: selection.has('place:' + p.id) })).join('') +
          r.items.slice(0, 200).map((i) => itemCard(i, { select: true, selected: selection.has('item:' + i.id) })).join('') +
          (r.items.length > 200 ? `<p class="muted">Viser 200 av ${r.items.length}. Snevre inn søket.</p>` : '') +
          (!total && S.items.size ? `<div class="empty"><p>Ingen treff.</p><a class="btn" href="#/ny">+ Registrer «${esc(qq)}»</a></div>` : '') +
          (!S.items.size ? `<div class="empty"><p>Ingen utstyr registrert ennå.</p><a class="btn primary" href="#/bilde">Legg til fra bilde</a> <a class="btn" href="#/ny">Legg til manuelt</a></div>` : '');
        hydrate(box);
      };
      const upd = () => {
        const bar = v.querySelector('#selbar');
        bar.hidden = !selection.size;
        v.querySelector('#selcount').textContent = `${selection.size} valgt`;
      };
      v.querySelector('#sform').onsubmit = (e) => { e.preventDefault(); run(); v.querySelector('#sq').blur(); };
      v.querySelector('#sq').oninput = debounce(run, 150);
      v.querySelectorAll('.filters select').forEach((s) => (s.onchange = run));
      v.querySelector('#results').addEventListener('change', (e) => {
        if (!e.target.classList.contains('sel')) return;
        if (e.target.checked) selection.add(e.target.dataset.ref);
        else selection.delete(e.target.dataset.ref);
        upd();
      });
      v.querySelector('#selbar').onclick = async (e) => {
        const a = e.target.dataset.sel;
        if (!a) return;
        const ids = [...selection].join(',');
        if (a === 'x') { selection.clear(); v.querySelectorAll('.sel').forEach((c) => (c.checked = false)); upd(); return; }
        if (a === 'flytt') go(`#/flytt?ids=${ids}`);
        if (a === 'utlan') go(`#/utlan/ny?ids=${ids}`);
        if (a === 'etiketter') go(`#/etiketter?ids=${[...selection].map((s) => s.split(':')[1]).join(',')}`);
        if (a === 'bekreft') {
          await st.confirmLocation([...selection].map(parseRef));
          toast('Plasseringen er bekreftet.');
          run();
        }
      };
      run();
      if (!q.q && !f.place && !f.owner && !f.status) v.querySelector('#sq').focus();
    },
  };
}

export const parseRef = (s) => {
  const [kind, id] = s.split(':');
  return { kind, id };
};

// ---------- Historikk ----------
const EV_ICON = { opprettet: '➕', flytt: '↔️', angret: '↩️', bekreftet: '✅', utlan: '🤝', retur: '📥', beholdning: '🔢', kontroll: '☑️', status: '🏷️', vedlikehold: '🛠️', slettet: '🗑️' };

export function eventRow(e) {
  const canUndo = e.type === 'flytt' && !e.data?.undoneAt && e.data?.entries;
  return `<li class="ev"><span class="ev-i">${EV_ICON[e.type] || '•'}</span><div class="grow"><div>${esc(e.text)}</div><small class="muted">${esc(fmtDateTime(e.at))}${e.data?.undoneAt ? ' · angret' : ''}</small></div>${canUndo ? `<button class="btn small" data-undo="${esc(e.id)}">Angre</button>` : ''}</li>`;
}

export function bindUndo(root, after) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-undo]');
    if (!b) return;
    const r = await st.undoMove(b.dataset.undo);
    toast(r.skipped.length ? `Angret ${r.reverted}. Ikke angret (flyttet senere): ${r.skipped.join(', ')}` : 'Flyttingen er angret.');
    after ? after() : render();
  });
}

function historyView(m, q) {
  const types = { '': 'Alle hendelser', flytt: 'Flyttinger', utlan: 'Utlån', retur: 'Returer', kontroll: 'Kontroller', beholdning: 'Beholdning', vedlikehold: 'Vedlikehold' };
  const t = q.type || '';
  const evs = S.events.filter((e) => !t || e.type === t).slice(0, 300);
  return {
    title: 'Historikk',
    html: `<h1>Historikk</h1>
      <select id="h-type" aria-label="Type">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <ul class="evlist">${evs.map(eventRow).join('') || '<p class="muted">Ingen hendelser ennå.</p>'}</ul>`,
    mount(v) {
      v.querySelector('#h-type').onchange = (e) => go(`#/historikk${e.target.value ? '?type=' + e.target.value : ''}`);
      bindUndo(v);
    },
  };
}

// ---------- Innstillinger / mer ----------
async function settingsView() {
  let persisted = null, usage = '';
  try {
    persisted = await navigator.storage?.persisted?.();
    const est = await navigator.storage?.estimate?.();
    if (est) usage = `${(est.usage / 1048576).toFixed(1).replace('.', ',')} MB i bruk`;
  } catch { /* ikke støttet */ }
  const theme = localStorage.getItem('hvv-theme') || 'auto';
  const demo = S.mode === 'demo';
  return {
    title: 'Mer',
    html: `<h1>Mer</h1>
    <nav class="menu">
      <a href="#/steder">📍 Plasseringer og kasser</a>
      <a href="#/utlan">🤝 Utlån og retur</a>
      <a href="#/pakkelister">🧰 Pakkelister</a>
      <a href="#/innkjop">🛒 Innkjøpsliste</a>
      <a href="#/oppfolging">🛠️ Vedlikehold og oppfølging</a>
      <a href="#/historikk">🕘 Historikk</a>
      <a href="#/etiketter">🏷️ Skriv ut QR-etiketter</a>
    </nav>

    <section class="card pad">
      <h2>Lagring</h2>
      <p><b>Dataene lagres bare på denne enheten</b> (i nettleseren). De synkroniseres ikke til skyen eller til andre enheter. ${usage ? esc(usage) + '.' : ''}</p>
      <p>Varig lagring: ${persisted ? '✅ innvilget – nettleseren sletter ikke dataene ved plassmangel.' : '⚠️ ikke bekreftet. Nettleseren kan i verste fall rydde bort data. Installer appen på hjemskjermen og ta jevnlig sikkerhetskopi.'}</p>
      ${persisted ? '' : '<button class="btn" id="persist">Be om varig lagring</button>'}
      <p class="muted small">Siste sikkerhetskopi: ${S.meta.lastBackupAt ? esc(fmtDateTime(S.meta.lastBackupAt)) : 'aldri'}${S.meta.restoredAt ? ` · Sist gjenopprettet: ${esc(fmtDateTime(S.meta.restoredAt))}` : ''}</p>
      <div class="btnrow">
        <button class="btn primary" id="backup">Last ned sikkerhetskopi</button>
        <label class="btn">Gjenopprett fra fil<input type="file" accept=".json,application/json" id="restore" hidden></label>
        <button class="btn" id="csv">Eksporter register (CSV)</button>
      </div>
      <p class="muted small">Sikkerhetskopien inneholder alt: utstyr, bilder, kvitteringer, historikk, utlån og de faste QR-ID-ene. API-nøkkelen tas ikke med.</p>
    </section>

    <section class="card pad">
      <h2>Bildetolking (AI)</h2>
      <p>«Legg til fra bilde» kan foreslå verktøy automatisk med Claude fra Anthropic. Dette <b>krever nett og en egen API-nøkkel</b>, og hvert bilde koster litt (normalt noen få øre til en krone per bilde, avhengig av modell). Uten nøkkel kan du fortsatt ta bilde og registrere manuelt.</p>
      <ol class="small">
        <li>Lag konto på <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> og legg inn betalingskort/kreditt.</li>
        <li>Gå til «API Keys», lag en nøkkel og kopier den.</li>
        <li>Lim den inn her. Den lagres bare på denne enheten og sendes bare til api.anthropic.com sammen med bildet du vil tolke.</li>
      </ol>
      <form id="aiform" class="stack">
        <label>API-nøkkel<input type="password" name="key" autocomplete="off" value="${esc(S.meta.apiKey || '')}" placeholder="sk-ant-…"></label>
        <label>Modell<select name="model">${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${(S.meta.aiModel || DEFAULT_MODEL) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <div class="btnrow"><button class="btn primary">Lagre</button>${S.meta.apiKey ? '<button type="button" class="btn danger" id="delkey">Fjern nøkkel</button>' : ''}</div>
      </form>
    </section>

    <section class="card pad">
      <h2>Utseende og varsler</h2>
      <label>Fargetema<select id="theme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Følg enheten</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Lyst</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Mørkt</option></select></label>
      <p class="small">Påminnelser om utlån går bare til deg. Appen sender aldri meldinger til låntakeren. Forsinkede returer vises på startsiden, og du kan legge returdatoen i kalenderen din fra utlånet.</p>
      <label class="check"><input type="checkbox" id="notif" ${S.meta.notify ? 'checked' : ''}> Vis varsel på denne enheten om forsinkede returer når appen åpnes</label>
    </section>

    <section class="card pad">
      <h2>Demomodus</h2>
      ${demo
        ? `<p>Du er i <b>demomodus</b>. Endringer her påvirker ikke ditt eget register.</p><div class="btnrow"><button class="btn primary" id="demo-off">Avslutt demo – tilbake til mine data</button><button class="btn" id="demo-reset">Tilbakestill demodata</button></div>`
        : `<p>Prøv appen med eksempelutstyr. Demodataene ligger i en egen database og blandes aldri med ditt eget utstyr.</p><button class="btn" id="demo-on">Start demomodus</button>`}
    </section>

    <section class="card pad">
      <h2>Om appen og begrensninger</h2>
      <ul class="small">
        <li>Plassering er alltid «sist registrert». Appen bruker ikke GPS og vet ikke hvor ting faktisk er.</li>
        <li>Beholdning av forbruksvarer er bare så riktig som registreringene. Tell opp jevnlig i kontrollmodus.</li>
        <li>QR-kodene inneholder bare en ID (f.eks. HVV:T4K7M2Q). Den som skanner med en annen app ser ingenting om deg eller utstyret.</li>
        <li>Ingen synkronisering mellom enheter i denne versjonen. Bruk sikkerhetskopi for å flytte data.</li>
      </ul>
      ${demo ? '' : '<button class="btn danger" id="wipe">Slett alle mine data på denne enheten</button>'}
    </section>`,
    mount(v) {
      const $ = (s) => v.querySelector(s);
      $('#persist') && ($('#persist').onclick = async () => {
        const ok = await navigator.storage?.persist?.();
        toast(ok ? 'Varig lagring er innvilget.' : 'Nettleseren avslo. Installer appen på hjemskjermen og prøv igjen.');
        render();
      });
      $('#backup').onclick = async () => {
        const data = await st.exportBackup();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        downloadBlob(blob, `hvor-er-verktoyet-${S.mode === 'demo' ? 'demo-' : ''}${todayISO()}.json`);
        await st.setMeta('lastBackupAt', new Date().toISOString());
        toast(`Sikkerhetskopi lastet ned (${(blob.size / 1048576).toFixed(1).replace('.', ',')} MB).`);
      };
      $('#restore').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          const info = st.validateBackup(data);
          const ok = await confirmDialog(`Gjenopprette sikkerhetskopi fra ${fmtDateTime(info.createdAt)}? Den inneholder ${info.items} verktøy, ${info.places} plasseringer/kasser, ${info.loans} utlån og ${info.images} bilder/vedlegg. ALT som ligger i ${S.mode === 'demo' ? 'demodataene' : 'registeret ditt'} nå blir erstattet. QR-kodene fortsetter å virke.`, { ok: 'Gjenopprett', danger: true });
          if (!ok) return;
          await st.importBackup(data);
          toast('Sikkerhetskopien er gjenopprettet.');
          go('#/');
        } catch (err) {
          alertDialog(`Kunne ikke gjenopprette: ${err.message}`);
        } finally {
          e.target.value = '';
        }
      };
      $('#csv').onclick = () => downloadBlob(new Blob([st.exportCSV()], { type: 'text/csv;charset=utf-8' }), `verktoyregister-${todayISO()}.csv`);
      $('#aiform').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        await st.setMeta('apiKey', String(f.get('key')).trim());
        await st.setMeta('aiModel', f.get('model'));
        toast('Lagret.');
        render();
      };
      $('#delkey') && ($('#delkey').onclick = async () => { await st.setMeta('apiKey', ''); render(); });
      $('#theme').onchange = (e) => { localStorage.setItem('hvv-theme', e.target.value); applyTheme(); };
      $('#notif').onchange = async (e) => {
        if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { e.target.checked = false; toast('Varsler er ikke tillatt i nettleseren.'); return; }
        }
        if (e.target.checked && !('Notification' in window)) { e.target.checked = false; toast('Denne nettleseren støtter ikke varsler.'); return; }
        await st.setMeta('notify', e.target.checked);
      };
      $('#demo-on') && ($('#demo-on').onclick = () => switchMode('demo'));
      $('#demo-off') && ($('#demo-off').onclick = () => switchMode('meg'));
      $('#demo-reset') && ($('#demo-reset').onclick = async () => {
        await st.wipeAll();
        await seedDemo();
        toast('Demodataene er tilbakestilt.');
        go('#/');
      });
      $('#wipe') && ($('#wipe').onclick = async () => {
        if (!(await confirmDialog('Slette ALLE dine data på denne enheten? Dette kan ikke angres. Ta sikkerhetskopi først.', { ok: 'Fortsett', danger: true }))) return;
        if (!(await confirmDialog('Er du helt sikker? Alt utstyr, bilder og historikk slettes.', { ok: 'Slett alt', danger: true }))) return;
        await st.wipeAll();
        toast('Alle data er slettet.');
        go('#/');
      });
    },
  };
}

export async function switchMode(mode) {
  try { localStorage.setItem('hvv-mode', mode); } catch { /* ignorer */ }
  await st.load(mode);
  if (mode === 'demo' && !S.meta.demoSeeded) await seedDemo();
  renderChrome();
  toast(mode === 'demo' ? 'Demomodus: eksempeldata, ikke ditt utstyr.' : 'Tilbake til dine egne data.');
  go('#/');
}

function applyTheme() {
  const t = localStorage.getItem('hvv-theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function notifyLate() {
  if (!S.meta.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const late = st.activeLoans().filter((l) => st.loanState(l) === 'forsinket');
  const key = todayISO();
  if (!late.length || S.meta.notifiedOn === key) return;
  new Notification('Forsinkede utlån', { body: late.map((l) => `${l.borrower}: ${l.refs.map(st.refName).join(', ')}`).join('\n'), icon: 'icons/icon-192.png' });
  st.setMeta('notifiedOn', key);
}

// ---------- Oppstart ----------
async function init() {
  applyTheme();
  let mode = 'meg';
  try { mode = localStorage.getItem('hvv-mode') === 'demo' ? 'demo' : 'meg'; } catch { /* ignorer */ }
  try {
    await st.load(mode);
  } catch (err) {
    view().innerHTML = `<div class="empty"><h1>Kunne ikke åpne lagringen</h1><p>${esc(err.message)}</p><p>Privat nettlesing kan blokkere lagring.</p></div>`;
    return;
  }
  if (mode === 'demo' && !S.meta.demoSeeded) await seedDemo();
  renderChrome();
  window.addEventListener('online', renderChrome);
  window.addEventListener('offline', renderChrome);
  window.addEventListener('hashchange', render);
  document.getElementById('nav-scan').onclick = scanAndOpen;
  document.getElementById('demo-exit').onclick = () => switchMode('meg');
  document.getElementById('storage-chip').onclick = () => alertDialog('Dataene lagres bare i nettleseren på denne enheten og synkroniseres ikke. Ta sikkerhetskopi under «Mer» for å ha en kopi, eller for å flytte data til en annen enhet.');
  if (S.items.size && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  await render();
  notifyLate();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

st.onChange(() => { if (S.items.size === 1 && navigator.storage?.persist) navigator.storage.persist().catch(() => {}); });

window.HVV = { st, go, render, switchMode };
init();
