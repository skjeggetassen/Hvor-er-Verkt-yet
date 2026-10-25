// Verktøysider: visning, skjema, og registrering fra bilder.

import { esc, toast, fmtDate, fmtDateTime, relDay, fmtKr, parseNum, fmtNum, resizeImage, todayISO, prettyCode } from './util.js';
import * as st from './store.js';
import { S } from './store.js';
import { badge, crumbs, thumb, confirmDialog, pickPlace, placeOptions, ICON, hydrate, alertDialog, codeLine } from './ui.js';
import { qrSVG } from './qr.js';
import { analyzeImage, MODELS, DEFAULT_MODEL, hasBuiltInAI } from './ai.js';
import { go, render, eventRow, bindUndo } from './app.js';

const UNC_LABEL = '<span class="unc" title="Usikker opplysning – kontroller">⚠️ usikker</span>';
const unc = (it, f) => ((it.uncertain || []).includes(f) ? ' ' + UNC_LABEL : '');

export function itemView(id) {
  const it = S.items.get(id);
  if (!it) return `<div class="empty"><h1>Fant ikke verktøyet</h1><p>Det kan være slettet.</p><a class="btn" href="#/sok">Til søk</a></div>`;
  const av = st.availability(it);
  const lc = st.lastConfirmed(it);
  const loan = av.loan;
  const isBulk = it.type === 'mengde';
  const evs = S.events.filter((e) => e.refs?.includes(id)).slice(0, 30);
  const row = (k, v, f) => (v ? `<div class="kv"><dt>${k}</dt><dd>${v}${f ? unc(it, f) : ''}</dd></div>` : '');
  const docs = it.docs || [];
  const maint = [...(it.maintenance || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const ownerTxt = it.owner === 'andre' ? `Andre${it.ownerName ? ': ' + esc(it.ownerName) : ''}` : st.OWNER[it.owner];
  const today = todayISO();
  return {
    title: it.name,
    html: `
    <div class="hero">
      <div class="gallery">${(it.photos || []).map((b) => `<button class="gimg" data-view="${esc(b)}">${thumb(b, '', 'photo')}</button>`).join('') || `<div class="photo ph">${isBulk ? ICON.bulk : ICON.item}</div>`}</div>
      <h1>${esc(it.name)}${unc(it, 'name')}</h1>
      <div class="meta">${badge(av)} ${codeLine(it.id)} ${it.source === 'bilde' ? '<span class="muted small">registrert fra bilde</span>' : ''}</div>
      ${it.uncertain?.length ? `<div class="warnbox card pad small">Noen opplysninger er markert som usikre fra bildetolkingen. Kontroller dem. <button class="btn small" id="clear-unc">Alt er kontrollert</button></div>` : ''}
    </div>

    <section class="card pad loc">
      <div class="kv"><dt>Sist registrert</dt><dd>${crumbs(it.placeId)}</dd></div>
      <div class="kv"><dt>Bekreftet</dt><dd>${esc(relDay(lc.at))} <span class="muted small">(${esc(fmtDateTime(lc.at))}${lc.via ? `, da kassen «${esc(lc.via.name)}» ble flyttet/bekreftet` : ''})</span></dd></div>
      <div class="kv"><dt>Fast plass</dt><dd>${it.homeId ? crumbs(it.homeId) : '<span class="muted">Ikke satt</span>'}${it.homeId && it.homeId === it.placeId ? ' <span class="ok">✓ ligger der</span>' : ''}</dd></div>
      ${loan ? `<div class="kv"><dt>Utlånt</dt><dd><a href="#/utlan/${esc(loan.id)}">Til <b>${esc(loan.borrower)}</b> siden ${esc(fmtDate(loan.at))}${loan.dueAt ? `, retur ${esc(fmtDate(loan.dueAt))}` : ''}</a>${st.loanState(loan) === 'forsinket' ? ' <span class="badge st-savnet">Forsinket</span>' : ''}</dd></div>` : ''}
    </section>

    <div class="actions-grid">
      <a class="btn primary" href="#/flytt?ids=item:${esc(id)}">↔️ Flytt</a>
      <button class="btn" id="confirm">✅ Ligger her</button>
      ${it.homeId && it.homeId !== it.placeId ? `<button class="btn" id="tohome">🏠 Tilbake på fast plass</button>` : ''}
      ${loan ? `<a class="btn" href="#/utlan/${esc(loan.id)}">📥 Registrer retur</a>` : av.available ? `<a class="btn" href="#/utlan/ny?ids=item:${esc(id)}">🤝 Lån ut</a>` : ''}
      <a class="btn" href="#/ting/${esc(id)}/rediger">✏️ Rediger</a>
      <a class="btn" href="#/etiketter?ids=${esc(id)}">🏷️ Etikett</a>
    </div>

    ${isBulk ? `
    <section class="card pad">
      <h2>Beholdning</h2>
      <div class="qtybig"><b>${esc(fmtNum(it.qty ?? 0))}</b> ${esc(it.unit)}${it.minQty != null && it.minQty !== '' ? ` <span class="muted">· minimum ${esc(fmtNum(it.minQty))}</span>` : ''}${unc(it, 'qty')}</div>
      ${st.shoppingList().some((x) => x.id === id) ? '<p class="badge st-reparasjon">Under minimum – står på innkjøpslisten</p>' : ''}
      <p class="muted small">Sist talt: ${it.qtyCheckedAt ? esc(fmtDateTime(it.qtyCheckedAt)) : 'aldri'}. Antallet er bare så riktig som registreringene.</p>
      <div class="btnrow">
        <button class="btn" data-q="-1">− 1 brukt</button>
        <button class="btn" data-q="-x">− Brukt …</button>
        <button class="btn" data-q="+x">+ Påfyll …</button>
        <button class="btn" data-q="set">🔢 Tell opp</button>
      </div>
    </section>` : ''}

    <section class="card pad">
      <h2>Opplysninger</h2>
      <dl>
        ${row('Kategori', esc(it.category), 'category')}
        ${row('Merke', esc(it.brand), 'brand')}
        ${row('Modell', esc(it.model), 'model')}
        ${row('Serienummer', esc(it.serial))}
        ${row('Eier', ownerTxt)}
        ${row('Kjøpt', esc(fmtDate(it.purchaseDate)))}
        ${row('Pris', esc(fmtKr(it.price)))}
        ${row('Garanti til', esc(fmtDate(it.warrantyUntil)))}
        ${row('Tilbehør', (it.accessories || []).map(esc).join(', '))}
        ${row('Notater', esc(it.notes).replace(/\n/g, '<br>'))}
      </dl>
      ${!it.category && !it.brand && !it.model && !it.notes ? '<p class="muted">Ingen flere opplysninger. <a href="#/ting/' + esc(id) + '/rediger">Legg til</a></p>' : ''}
    </section>

    <section class="card pad">
      <h2>Vedlikehold</h2>
      <p>Neste service/kontroll: ${it.serviceDue ? `<b class="${it.serviceDue < today ? 'warn' : ''}">${esc(fmtDate(it.serviceDue))}</b> (${esc(relDay(it.serviceDue))})` : '<span class="muted">ikke satt</span>'}</p>
      <ul class="evlist">${maint.map((m) => `<li class="ev"><span class="ev-i">🛠️</span><div class="grow"><b>${esc(st.MAINT_KINDS[m.kind] || m.kind)}</b> ${esc(fmtDate(m.date))}${m.cost ? ' · ' + esc(fmtKr(m.cost)) : ''}<br><small>${esc(m.note)}</small></div></li>`).join('')}</ul>
      <details><summary class="btn">+ Registrer service, reparasjon eller kontroll</summary>
        <form id="maint" class="stack">
          <div class="grid2">
            <label>Type<select name="kind">${Object.entries(st.MAINT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label>Dato<input type="date" name="date" value="${today}" required></label>
          </div>
          <label>Hva ble gjort<input name="note"></label>
          <div class="grid2">
            <label>Kostnad (kr)<input name="cost" inputmode="decimal"></label>
            <label>Neste frist<input type="date" name="next" value="${esc(it.serviceDue || '')}"></label>
          </div>
          <label>Status etterpå<select name="status"><option value="">Uendret (${esc(st.STATUS[it.status])})</option>${['tilgjengelig', 'reparasjon'].map((k) => `<option value="${k}">${st.STATUS[k]}</option>`).join('')}</select></label>
          <button class="btn primary">Lagre</button>
        </form>
      </details>
    </section>

    <section class="card pad">
      <h2>Kvitteringer og dokumenter</h2>
      <ul class="docs">${docs.map((d) => `<li><button class="link" data-view="${esc(d.blobId)}">📄 ${esc(st.DOC_KINDS[d.kind] || d.kind)}: ${esc(d.name)}</button> <button class="btn small ghost" data-rm="${esc(d.blobId)}" aria-label="Fjern">✕</button></li>`).join('') || '<li class="muted">Ingen dokumenter.</li>'}</ul>
      <div class="btnrow">
        <select id="doc-kind" aria-label="Dokumenttype">${Object.entries(st.DOC_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <label class="btn">+ Legg til dokument/bilde<input type="file" id="doc-file" accept="image/*,application/pdf" multiple hidden></label>
        <label class="btn">+ Flere bilder av verktøyet<input type="file" id="photo-file" accept="image/*" multiple hidden></label>
      </div>
    </section>

    <section class="card pad">
      <h2>QR-kode</h2>
      <div class="qrbox">${qrSVG(id, 140)}<div><p>Koden inneholder bare ID-en <b>${esc(prettyCode(id))}</b>, ingen andre opplysninger. Den endres aldri.</p></div></div>
    </section>

    <section class="card pad">
      <h2>Historikk</h2>
      <ul class="evlist">${evs.map(eventRow).join('') || '<li class="muted">Ingen hendelser.</li>'}</ul>
    </section>

    <button class="btn danger wide" id="del">Slett fra registeret</button>
    <p class="muted small center">Tips: Sett status «Kassert» i stedet for å slette hvis du vil beholde historikken.</p>`,
    mount(v) {
      const $ = (s) => v.querySelector(s);
      $('#confirm').onclick = async () => { await st.confirmLocation([{ id, kind: 'item' }]); toast('Plasseringen er bekreftet.'); render(); };
      $('#tohome') && ($('#tohome').onclick = async () => {
        const ev = await st.moveObjects([{ id, kind: 'item' }], it.homeId);
        toast('Lagt tilbake på fast plass.', { action: 'Angre', onAction: async () => { await st.undoMove(ev.id); render(); } });
        render();
      });
      $('#clear-unc') && ($('#clear-unc').onclick = async () => { await st.saveItem({ id, uncertain: [] }); render(); });
      v.querySelectorAll('[data-q]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.q;
        if (k === '-1') await st.adjustQty(id, { delta: -1, reason: 'brukt' });
        else {
          const n = parseNum(prompt(k === 'set' ? `Hvor mange ${it.unit} er det nå (talt)?` : k === '+x' ? `Hvor mange ${it.unit} fylles på?` : `Hvor mange ${it.unit} er brukt?`));
          if (n == null || n < 0) return;
          if (k === 'set') await st.adjustQty(id, { set: n });
          else await st.adjustQty(id, { delta: k === '+x' ? n : -n, reason: k === '+x' ? 'påfyll' : 'brukt' });
        }
        render();
      }));
      $('#maint').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        await st.addMaintenance(id, { kind: f.get('kind'), date: f.get('date'), note: f.get('note'), cost: parseNum(f.get('cost')) }, { nextDue: f.get('next') || '', newStatus: f.get('status') || null });
        toast('Registrert.');
        render();
      };
      $('#doc-file').onchange = async (e) => {
        const files = [...e.target.files];
        const prepared = await Promise.all(files.map(async (f) => (f.type.startsWith('image/') ? Object.assign(await resizeImage(f, 2000), { name: f.name }) : f)));
        await st.addItemFiles(id, prepared.map((b, i) => (b instanceof File ? b : new File([b], files[i].name.replace(/\.\w+$/, '.jpg'), { type: b.type }))), 'doc', $('#doc-kind').value);
        render();
      };
      $('#photo-file').onchange = async (e) => {
        const files = await Promise.all([...e.target.files].map((f) => resizeImage(f)));
        await st.addItemFiles(id, files, 'photo');
        render();
      };
      v.addEventListener('click', async (e) => {
        const vb = e.target.closest('[data-view]');
        if (vb) openBlob(vb.dataset.view);
        const rb = e.target.closest('[data-rm]');
        if (rb && (await confirmDialog('Fjerne dokumentet?', { ok: 'Fjern', danger: true }))) { await st.removeItemFile(id, rb.dataset.rm); render(); }
      });
      $('#del').onclick = async () => {
        if (!(await confirmDialog(`Slette «${it.name}» fra registeret? QR-koden slutter da å virke.`, { ok: 'Slett', danger: true }))) return;
        await st.deleteItem(id);
        toast('Slettet.');
        go('#/sok');
      };
      bindUndo(v);
    },
  };
}

async function openBlob(blobId) {
  const url = await st.blobURL(blobId);
  if (!url) return;
  const rec = await st.getBlob(blobId);
  if (rec?.mime?.startsWith('image/')) {
    const w = document.createElement('div');
    w.className = 'lightbox';
    w.innerHTML = `<img src="${url}" alt=""><button class="btn">Lukk</button>`;
    w.onclick = () => w.remove();
    document.body.appendChild(w);
  } else window.open(url, '_blank');
}

// ---------- Skjema ----------
export function itemForm(id, q = {}) {
  const old = id ? S.items.get(id) : null;
  if (id && !old) return '<div class="empty"><h1>Fant ikke verktøyet</h1></div>';
  const it = old ? { ...old } : { ...st.blankItem(), placeId: q.sted || S.meta.lastPlaceId || null, name: q.navn || '' };
  if (!old) it.homeId = it.placeId;
  const u = (f) => `<label class="uncbox"><input type="checkbox" name="unc_${f}" ${(it.uncertain || []).includes(f) ? 'checked' : ''}> usikker</label>`;
  const cats = st.categories();
  return {
    title: old ? `Rediger ${it.name}` : 'Nytt verktøy',
    html: `<h1>${old ? 'Rediger' : 'Legg til manuelt'}</h1>
    <form id="iform" class="stack">
      <div class="seg" role="radiogroup" aria-label="Type">
        <label><input type="radio" name="type" value="enkelt" ${it.type !== 'mengde' ? 'checked' : ''}><span>Enkeltverktøy<small>spores individuelt</small></span></label>
        <label><input type="radio" name="type" value="mengde" ${it.type === 'mengde' ? 'checked' : ''}><span>Mengdevare<small>bits, skruer, spiker …</small></span></label>
      </div>
      <label class="${(it.uncertain || []).includes('name') ? 'is-unc' : ''}">Navn *${u('name')}<input name="name" required value="${esc(it.name)}" placeholder="f.eks. Gjæresag"></label>
      ${!old ? `<label class="btn">📷 Legg til bilde<input type="file" name="photo" accept="image/*" capture="environment" hidden></label><div id="ph-prev" class="muted small"></div>` : ''}
      <div class="bulk-only grid3">
        <label class="${(it.uncertain || []).includes('qty') ? 'is-unc' : ''}">Antall${u('qty')}<input name="qty" inputmode="decimal" value="${esc(fmtNum(it.qty ?? 1))}"></label>
        <label>Enhet<input name="unit" value="${esc(it.unit || 'stk')}" list="units"></label>
        <label>Minimum<input name="minQty" inputmode="decimal" value="${esc(fmtNum(it.minQty ?? ''))}" placeholder="valgfritt"></label>
      </div>
      <datalist id="units"><option>stk</option><option>pk</option><option>eske</option><option>boks</option><option>m</option><option>l</option><option>kg</option><option>rull</option></datalist>
      <label class="${(it.uncertain || []).includes('category') ? 'is-unc' : ''}">Kategori${u('category')}<input name="category" value="${esc(it.category)}" list="cats" placeholder="f.eks. Elektroverktøy"></label>
      <datalist id="cats">${[...new Set([...cats, 'Elektroverktøy', 'Håndverktøy', 'Måleverktøy', 'Festemidler', 'Forbruksvarer', 'Verneutstyr', 'Maling og overflate'])].map((c) => `<option>${esc(c)}</option>`).join('')}</datalist>
      <div class="grid2">
        <label class="${(it.uncertain || []).includes('brand') ? 'is-unc' : ''}">Merke${u('brand')}<input name="brand" value="${esc(it.brand)}"></label>
        <label class="${(it.uncertain || []).includes('model') ? 'is-unc' : ''}">Modell${u('model')}<input name="model" value="${esc(it.model)}"></label>
      </div>
      <label>Serienummer<input name="serial" value="${esc(it.serial)}"></label>
      <div class="grid2">
        <label>Nåværende plassering<select name="placeId">${placeOptions(it.placeId, { none: 'Ingen plassering' })}</select></label>
        <label>Fast oppbevaringsplass<select name="homeId">${placeOptions(it.homeId, { none: 'Ikke satt' })}</select></label>
      </div>
      <a href="#/nytt-sted" class="small">+ Ny plassering eller kasse</a>
      <div class="grid2">
        <label>Eier<select name="owner">${Object.entries(st.OWNER).map(([k, v]) => `<option value="${k}" ${it.owner === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="owner-name">Eiers navn<input name="ownerName" value="${esc(it.ownerName)}"></label>
      </div>
      <label>Status<select name="status">${Object.entries(st.STATUS).filter(([k]) => k !== 'utlant' || it.status === 'utlant').map(([k, v]) => `<option value="${k}" ${it.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${it.status === 'utlant' ? '<p class="muted small">Status «Utlånt» endres ved å registrere retur.</p>' : ''}
      <details ${old && (old.purchaseDate || old.price || old.serviceDue || old.notes || old.accessories?.length) ? 'open' : ''}><summary>Kjøp, service, tilbehør og notater</summary>
        <div class="stack">
          <div class="grid2">
            <label>Kjøpsdato<input type="date" name="purchaseDate" value="${esc(it.purchaseDate)}"></label>
            <label>Pris (kr)<input name="price" inputmode="decimal" value="${esc(fmtNum(it.price ?? ''))}"></label>
          </div>
          <div class="grid2">
            <label>Neste service/kontroll<input type="date" name="serviceDue" value="${esc(it.serviceDue)}"></label>
            <label>Garanti til<input type="date" name="warrantyUntil" value="${esc(it.warrantyUntil)}"></label>
          </div>
          <label>Tilbehør (ett per linje)<textarea name="accessories" rows="3" placeholder="Lader&#10;2 batterier&#10;Koffert">${esc((it.accessories || []).join('\n'))}</textarea></label>
          <label>Notater<textarea name="notes" rows="3">${esc(it.notes)}</textarea></label>
          <p class="muted small">Kvitteringer, garantibevis og bruksanvisninger legger du til på verktøyets side etter lagring.</p>
        </div>
      </details>
      <div class="actions sticky"><a class="btn" href="${old ? '#/ting/' + esc(id) : 'javascript:history.back()'}">Avbryt</a><button class="btn primary">Lagre</button></div>
    </form>`,
    mount(v) {
      const form = v.querySelector('#iform');
      const sync = () => {
        const bulk = form.type.value === 'mengde';
        v.querySelector('.bulk-only').hidden = !bulk;
        v.querySelector('.owner-name').hidden = form.owner.value !== 'andre';
      };
      form.addEventListener('change', sync);
      sync();
      let photo = null;
      if (form.photo) form.photo.onchange = async (e) => {
        if (!e.target.files[0]) return;
        photo = await resizeImage(e.target.files[0]);
        v.querySelector('#ph-prev').innerHTML = `<img class="thumb" src="${URL.createObjectURL(photo)}" alt=""> Bilde lagt til`;
      };
      // Når nåværende plassering endres for nytt verktøy, følger fast plass med til den endres manuelt.
      let homeTouched = !!old;
      form.homeId.onchange = () => (homeTouched = true);
      form.placeId.addEventListener('change', () => { if (!homeTouched) form.homeId.value = form.placeId.value; });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const uncertain = ['name', 'category', 'brand', 'model', 'qty'].filter((k) => f.get('unc_' + k));
        const data = {
          id: old?.id,
          type: f.get('type'),
          name: f.get('name').trim(),
          category: f.get('category').trim(),
          brand: f.get('brand').trim(),
          model: f.get('model').trim(),
          serial: f.get('serial').trim(),
          placeId: f.get('placeId') || null,
          homeId: f.get('homeId') || null,
          owner: f.get('owner'),
          ownerName: f.get('owner') === 'andre' ? f.get('ownerName').trim() : '',
          status: f.get('status'),
          purchaseDate: f.get('purchaseDate'),
          price: parseNum(f.get('price')),
          serviceDue: f.get('serviceDue'),
          warrantyUntil: f.get('warrantyUntil'),
          accessories: f.get('accessories').split('\n').map((s) => s.trim()).filter(Boolean),
          notes: f.get('notes').trim(),
          uncertain,
        };
        if (data.type === 'mengde') {
          data.qty = parseNum(f.get('qty')) ?? 0;
          data.unit = f.get('unit').trim() || 'stk';
          data.minQty = parseNum(f.get('minQty'));
        } else {
          data.qty = 1;
          data.unit = 'stk';
          data.minQty = null;
        }
        const extra = [];
        if (photo) {
          const { id: bid, op } = await st.putBlobOp(photo, 'bilde.jpg');
          extra.push(op);
          data.photos = [bid];
        }
        if (!old) data.source = 'manuell';
        const saved = await st.saveItem(data, extra);
        if (data.placeId) st.setMeta('lastPlaceId', data.placeId);
        toast(old ? 'Endringene er lagret.' : `«${saved.name}» er registrert.`);
        go(`#/ting/${saved.id}`);
      };
    },
  };
}

// ---------- Registrering fra bilder ----------
let photoState = null;

export function photoView(q = {}) {
  if (!photoState || q.ny || q.sted) {
    photoState = { images: [], placeId: q.sted || S.meta.lastPlaceId || null };
    history.replaceState(null, '', '#/bilde');
  }
  const P = photoState;
  if (P.placeId && !S.places.has(P.placeId)) P.placeId = null;
  const hasKey = !!S.meta.apiKey || hasBuiltInAI();
  const model = S.meta.apiKey ? MODELS[S.meta.aiModel || DEFAULT_MODEL] || '' : 'Claude via claude.ai-kontoen din';
  const total = P.images.reduce((n, im) => n + im.rows.filter((r) => r.include && r.name.trim()).length, 0);
  const field = (i, j, f, label, val, attrs = '') => {
    const r = P.images[i].rows[j];
    const isU = r.uncertain.includes(f);
    return `<label class="${isU ? 'is-unc' : ''}">${label}${isU ? ' ' + UNC_LABEL : ''}<input data-i="${i}" data-j="${j}" data-f="${f}" value="${esc(val)}" ${attrs}></label>`;
  };
  return {
    title: 'Legg til fra bilde',
    keepScroll: P.images.length > 0,
    html: `<h1>Legg til fra bilde</h1>
    <p>Ta bilde av ett verktøy, en åpen kasse eller flere ting samtidig. Bildet lagres sammen med registreringen.</p>
    <div class="btnrow">
      <label class="btn primary">📷 Ta bilde<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
      <label class="btn">🖼️ Velg bilder<input type="file" accept="image/*" multiple id="lib" hidden></label>
    </div>
    <p class="small ${hasKey ? '' : 'muted'}">${hasKey ? `🤖 Bildetolking: ${esc(model)}. <b>Krever nett</b>${navigator.onLine ? '' : ' – du er uten nett nå, så du må registrere manuelt eller vente'}.` : '🤖 Bildetolking er ikke satt opp. Du kan registrere manuelt fra bildet, eller legge inn API-nøkkel under <a href="#/mer">Mer</a>.'}</p>
    <div class="card pad">
      <div class="kv"><dt>Legges i</dt><dd id="ph-place">${P.placeId ? crumbs(P.placeId) : '<span class="muted">Ingen plassering valgt</span>'}</dd></div>
      <button class="btn small" id="pick-place">Velg plassering</button>
    </div>
    ${P.images.map((im, i) => `
    <section class="card pad photo-card">
      <div class="ph-head"><img class="photo" src="${im.url}" alt="Bilde ${i + 1}"><button class="btn small ghost" data-rmimg="${i}" aria-label="Fjern bilde">✕</button></div>
      <label class="check"><input type="checkbox" data-asbox="${i}" ${im.asBox ? 'checked' : ''}> Bildet viser en åpen kasse – opprett kassen og legg tingene i den</label>
      ${im.asBox ? `<label>Navn på kassen<input data-boxname="${i}" value="${esc(im.boxName)}" placeholder="f.eks. Kasse 2"></label>` : ''}
      <div class="btnrow">
        ${hasKey ? `<button class="btn" data-ai="${i}" ${im.status === 'tolker' ? 'disabled' : ''}>${im.status === 'tolker' ? '⏳ Tolker …' : im.status === 'ferdig' ? '🤖 Tolk på nytt' : '🤖 Foreslå verktøy (krever nett)'}</button>` : ''}
        <button class="btn" data-addrow="${i}">+ Legg til manuelt</button>
      </div>
      ${im.err ? `<p class="errbox">${esc(im.err)}</p>` : ''}
      ${im.note ? `<p class="muted small">Merknad fra tolkingen: ${esc(im.note)}</p>` : ''}
      ${im.status === 'ferdig' && !im.rows.length ? '<p class="muted">Tolkingen fant ingen tydelige verktøy. Legg til manuelt.</p>' : ''}
      ${im.rows.length ? `<p class="small">Kontroller forslagene. Felter merket ⚠️ er usikre. Ingenting lagres før du trykker «Lagre».</p>` : ''}
      ${im.rows.map((r, j) => `
        <div class="sugg ${r.include ? '' : 'off'}">
          <div class="sugg-head"><label class="check"><input type="checkbox" data-i="${i}" data-j="${j}" data-f="include" ${r.include ? 'checked' : ''}> Ta med</label><button class="btn small ghost" data-rmrow="${i}:${j}" aria-label="Fjern rad">✕</button></div>
          ${field(i, j, 'name', 'Navn *', r.name)}
          <div class="grid3">
            ${field(i, j, 'qty', 'Antall', r.qty, 'inputmode="decimal"')}
            ${field(i, j, 'unit', 'Enhet', r.unit)}
            <label>Type<select data-i="${i}" data-j="${j}" data-f="type"><option value="enkelt" ${r.type === 'enkelt' ? 'selected' : ''}>Enkelt</option><option value="mengde" ${r.type === 'mengde' ? 'selected' : ''}>Mengde</option></select></label>
          </div>
          ${field(i, j, 'category', 'Kategori', r.category, 'list="cats2"')}
          <div class="grid2">${field(i, j, 'brand', 'Merke', r.brand)}${field(i, j, 'model', 'Modell', r.model)}</div>
          ${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}
          ${r.type === 'enkelt' && Number(r.qty) > 1 ? `<p class="muted small">Registreres som ${esc(r.qty)} separate verktøy.</p>` : ''}
        </div>`).join('')}
    </section>`).join('')}
    <datalist id="cats2">${st.categories().map((c) => `<option>${esc(c)}</option>`).join('')}</datalist>
    ${P.images.length ? `<div class="actions sticky"><button class="btn" id="ph-cancel">Forkast</button><button class="btn primary" id="ph-save" ${total ? '' : 'disabled'}>Lagre ${total} ${total === 1 ? 'registrering' : 'registreringer'}</button></div>` : ''}`,
    mount(v) {
      const rerender = () => render();
      // Oppdaterer lagreknappen uten å tegne siden på nytt (ellers kan et trykk på «Lagre» gå tapt).
      const updateTotal = () => {
        const b = v.querySelector('#ph-save');
        if (!b) return;
        const n = P.images.reduce((k, im) => k + im.rows.filter((r) => r.include && r.name.trim()).length, 0);
        b.disabled = !n;
        b.textContent = `Lagre ${n} ${n === 1 ? 'registrering' : 'registreringer'}`;
      };
      const addFiles = async (files) => {
        for (const f of files) {
          const blob = await resizeImage(f, 1600);
          P.images.push({ blob, url: URL.createObjectURL(blob), rows: [], status: 'ny', err: '', note: '', asBox: false, boxName: '' });
        }
        rerender();
        if (hasKey && navigator.onLine) P.images.forEach((im, i) => im.status === 'ny' && runAI(i));
      };
      const runAI = async (i) => {
        const im = P.images[i];
        im.status = 'tolker';
        im.err = '';
        rerender();
        try {
          const res = await analyzeImage(im.blob, { apiKey: S.meta.apiKey, model: S.meta.aiModel || DEFAULT_MODEL });
          im.rows = res.items;
          im.note = res.note;
          im.status = 'ferdig';
        } catch (err) {
          im.status = 'feil';
          im.err = err.message;
        }
        if (photoState === P && location.hash.startsWith('#/bilde')) rerender();
      };
      v.querySelector('#cam').onchange = (e) => addFiles([...e.target.files]);
      v.querySelector('#lib').onchange = (e) => addFiles([...e.target.files]);
      v.querySelector('#pick-place').onclick = async () => {
        const p = await pickPlace({ title: 'Hvor skal tingene registreres?', allowNone: true, current: P.placeId });
        if (p !== undefined) { P.placeId = p; rerender(); }
      };
      v.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.boxname) { P.images[t.dataset.boxname].boxName = t.value; return; }
        if (t.dataset.f && t.dataset.f !== 'include') {
          const r = P.images[t.dataset.i].rows[t.dataset.j];
          r[t.dataset.f] = t.value;
          // Brukeren har kontrollert feltet når det redigeres.
          r.uncertain = r.uncertain.filter((x) => x !== t.dataset.f);
          t.closest('label')?.classList.remove('is-unc');
          t.closest('label')?.querySelector('.unc')?.remove();
          updateTotal();
        }
      });
      v.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.asbox) { P.images[t.dataset.asbox].asBox = t.checked; rerender(); return; }
        if (t.dataset.f === 'include') { P.images[t.dataset.i].rows[t.dataset.j].include = t.checked; rerender(); }
        if (t.dataset.f === 'type') rerender();
      });
      v.addEventListener('click', (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.ai) runAI(Number(t.dataset.ai));
        if (t.dataset.addrow) { P.images[t.dataset.addrow].rows.push({ include: true, name: '', category: '', qty: 1, unit: 'stk', type: 'enkelt', brand: '', model: '', uncertain: [], note: '' }); rerender(); }
        if (t.dataset.rmrow) { const [i, j] = t.dataset.rmrow.split(':'); P.images[i].rows.splice(j, 1); rerender(); }
        if (t.dataset.rmimg) { P.images.splice(t.dataset.rmimg, 1); rerender(); }
      });
      const cancel = v.querySelector('#ph-cancel');
      if (cancel) cancel.onclick = async () => {
        if (await confirmDialog('Forkaste bildene og forslagene?', { ok: 'Forkast', danger: true })) { photoState = null; go('#/'); }
      };
      const save = v.querySelector('#ph-save');
      if (save) save.onclick = async () => {
        save.disabled = true;
        const created = [];
        let target = P.placeId;
        for (const im of P.images) {
          const rows = im.rows.filter((r) => r.include && r.name.trim());
          if (!rows.length) continue;
          const bid = await st.putBlob(im.blob, 'bilde.jpg');
          let place = P.placeId;
          if (im.asBox) {
            const box = await st.savePlace({ name: im.boxName.trim() || 'Ny kasse', kind: 'kasse', parentId: P.placeId || null, photo: bid });
            place = box.id;
            target = box.id;
          }
          for (const r of rows) {
            const qty = parseNum(r.qty) ?? 1;
            const n = r.type === 'enkelt' ? Math.max(1, Math.min(50, Math.round(qty))) : 1;
            for (let k = 0; k < n; k++) {
              const it = await st.saveItem({
                type: r.type, name: r.name.trim(), category: r.category.trim(), brand: r.brand.trim(), model: r.model.trim(),
                qty: r.type === 'mengde' ? qty : 1, unit: r.unit || 'stk', placeId: place, homeId: place, photos: [bid],
                uncertain: r.uncertain.filter((f) => !(f === 'qty' && r.type === 'enkelt')), source: 'bilde',
                notes: r.note && r.uncertain.length ? `Fra bildetolking: ${r.note}` : '',
              });
              created.push(it);
            }
          }
        }
        if (P.placeId) st.setMeta('lastPlaceId', P.placeId);
        photoState = null;
        toast(`${created.length} ${created.length === 1 ? 'registrering' : 'registreringer'} lagret.`);
        go(target ? `#/sted/${target}` : created.length === 1 ? `#/ting/${created[0].id}` : '#/sok');
      };
    },
  };
}
