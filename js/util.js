// Små hjelpefunksjoner: formatering, ID-er, bilder, filer.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const nowISO = () => new Date().toISOString();

export function todayISO(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const dFmt = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
const tFmt = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' });

// Datoer lagres som 'YYYY-MM-DD' (kun dato) eller full ISO-tid.
function toDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export function fmtDate(v) {
  const d = toDate(v);
  return d ? dFmt.format(d) : '';
}

export function fmtDateTime(v) {
  const d = toDate(v);
  return d ? `${dFmt.format(d)} kl. ${tFmt.format(d)}` : '';
}

export function daysBetween(a, b) {
  const da = toDate(a), db = toDate(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function relDay(v) {
  if (!v) return 'aldri';
  const n = daysBetween(v, new Date());
  if (n === 0) return 'i dag';
  if (n === 1) return 'i går';
  if (n > 1 && n < 60) return `for ${n} dager siden`;
  if (n === -1) return 'i morgen';
  if (n < -1 && n > -60) return `om ${-n} dager`;
  return fmtDate(v);
}

const kr = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK' });
export const fmtKr = (n) => (n == null || n === '' || isNaN(n) ? '' : kr.format(Number(n)));

export function parseNum(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s|kr|nok/gi, '').replace(/ /g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
}

export const fmtNum = (n) => (n == null ? '' : String(n).replace('.', ','));

// Crockford base32 uten lett forvekslbare tegn (ingen I, L, O, U).
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randCode(len = 7) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHA[x % 32];
  return s;
}

// Normaliserer manuelt inntastet kode: små bokstaver, mellomrom, bindestrek, O->0, I/L->1.
export function normCode(s) {
  let t = String(s || '').trim().toUpperCase();
  t = t.replace(/^HVV:/, '');
  t = t.replace(/[^0-9A-Z]/g, '');
  if (!t) return '';
  // Første tegn er typeprefiks (T/K/P) og beholdes; resten tolkes som Crockford.
  return t[0] + t.slice(1).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

export const prettyCode = (id) => (id ? `${id[0]}-${id.slice(1)}` : '');

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Når appen kjører som Artifact på claude.ai, går nedlastinger via plattformens lagre-dialog.
const dlCap = typeof window !== 'undefined' && window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

export async function downloadBlob(blob, filename) {
  const cap = await dlCap;
  if (cap) {
    try {
      await cap.save({ filename, data: blob });
    } catch (e) {
      if (e?.code !== 'declined') toast(`Kunne ikke lagre filen: ${e?.message || e}`);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  const [head, data] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Skalerer et bilde ned (lagring og AI-tolking) og returnerer JPEG-blob.
export async function resizeImage(file, max = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/')) return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width, h = bmp.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', quality));
}

let toastTimer;
export function toast(msg, { action, onAction, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn small" id="toast-act">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (action) {
    el.querySelector('#toast-act').onclick = () => {
      el.classList.remove('show');
      onAction && onAction();
    };
  }
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFC');
