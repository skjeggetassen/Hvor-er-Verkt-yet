// QR-koder: generering (SVG/PDF), tolking og skanning med kamera.
// Koden inneholder bare «HVV:» + stabil ID. Ingen navn, plassering eller andre opplysninger.

import { esc, normCode, prettyCode } from './util.js';
import { S, lookup, pathText } from './store.js';

export const payload = (id) => `HVV:${id}`;

function matrix(id) {
  const q = window.qrcode(0, 'M');
  q.addData(payload(id));
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}

export function qrSVG(id, px = 160) {
  const { n, dark } = matrix(id);
  const m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  const s = n + 2 * m;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR-kode ${esc(prettyCode(id))}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Tekst fra skanning → ID (eller null hvis det ikke er en kode fra appen).
export function parseScan(text) {
  const t = String(text || '').trim();
  let m = t.match(/^HVV:([0-9A-Z]{8})$/i) || t.match(/#\/kode\/([0-9A-Z]{8})/i);
  if (m) return m[1].toUpperCase();
  const n = normCode(t);
  if (/^[TKP][0-9A-Z]{7}$/.test(n)) return n;
  return null;
}

// ---------- Etiketter som PDF ----------
export const LAYOUTS = {
  standard: { label: 'Standard 70 × 37 mm (3 × 8 per A4-ark)', cols: 3, rows: 8, w: 70, h: 37 },
  stor: { label: 'Store 105 × 74 mm (2 × 4 per A4-ark)', cols: 2, rows: 4, w: 105, h: 74.25 },
};

export function labelsPDF(ids, layoutKey = 'standard', { lines = true } = {}) {
  const L = LAYOUTS[layoutKey];
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const mx = (210 - L.cols * L.w) / 2;
  const my = (297 - L.rows * L.h) / 2;
  const per = L.cols * L.rows;
  ids.forEach((id, i) => {
    if (i > 0 && i % per === 0) doc.addPage();
    const k = i % per;
    const x = mx + (k % L.cols) * L.w;
    const y = my + Math.floor(k / L.cols) * L.h;
    if (!id) return;
    if (lines) {
      doc.setDrawColor(200);
      doc.setLineWidth(0.1);
      doc.rect(x, y, L.w, L.h);
    }
    const pad = 3;
    const qs = L.h - 2 * pad;
    const { n, dark } = matrix(id);
    const cell = qs / (n + 2);
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) doc.rect(x + pad + (c + 1) * cell, y + pad + (r + 1) * cell, cell, cell, 'F');
    const tx = x + pad + qs + 2;
    const tw = L.w - (tx - x) - pad;
    const o = lookup(id);
    const name = o ? o.obj.name : id;
    const kind = !o ? '' : o.kind === 'item' ? 'Verktøy' : o.obj.kind === 'kasse' ? 'Kasse' : 'Plassering';
    const big = layoutKey === 'stor';
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(big ? 16 : 10.5);
    const nameLines = doc.splitTextToSize(name, tw).slice(0, big ? 4 : 3);
    doc.text(nameLines, tx, y + pad + (big ? 7 : 4.5));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(big ? 10 : 7.5);
    doc.text(kind, tx, y + L.h - pad - (big ? 7 : 4.5));
    doc.setFont('courier', 'bold');
    doc.setFontSize(big ? 13 : 9);
    doc.text(prettyCode(id), tx, y + L.h - pad - 0.5);
  });
  return doc.output('blob');
}

// ---------- Skanner ----------
// Åpner kamera i et overlegg. Returnerer ID-en til et kjent objekt, eller null ved avbryt.
export function scan({ title = 'Skann QR-kode', hint = '' } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'scanner';
    ov.innerHTML = `
      <div class="scan-head"><h2>${esc(title)}</h2><button class="btn ghost" data-x>Lukk</button></div>
      <div class="scan-view"><video playsinline muted></video><div class="scan-frame"></div></div>
      <p class="scan-msg" aria-live="polite">${esc(hint || 'Hold QR-koden innenfor rammen.')}</p>
      <form class="scan-manual">
        <label for="scan-code">Uten kamera: skriv inn koden under QR-koden</label>
        <div class="row"><input id="scan-code" autocomplete="off" autocapitalize="characters" placeholder="f.eks. T-4K7M2QX"><button class="btn primary">Åpne</button></div>
      </form>
      <label class="btn">Les QR-kode fra bilde<input type="file" accept="image/*" hidden data-file></label>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video');
    const msg = ov.querySelector('.scan-msg');
    let stream = null;
    let done = false;
    let timer = null;
    const finish = (id) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      ov.remove();
      resolve(id);
    };
    const handle = (text) => {
      const id = parseScan(text);
      if (!id) { msg.textContent = 'Dette er ikke en kode fra «Hvor er verktøyet?».'; return false; }
      if (!lookup(id)) { msg.textContent = `Koden ${prettyCode(id)} finnes ikke i registeret${S.mode === 'demo' ? ' (du er i demomodus)' : ''}.`; return false; }
      if (navigator.vibrate) navigator.vibrate(60);
      finish(id);
      return true;
    };
    ov.querySelector('[data-x]').onclick = () => finish(null);
    ov.querySelector('.scan-manual').onsubmit = (e) => {
      e.preventDefault();
      handle(ov.querySelector('#scan-code').value);
    };
    ov.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const bmp = await createImageBitmap(f);
      const res = decodeBitmap(bmp);
      if (!res) msg.textContent = 'Fant ingen QR-kode i bildet.';
      else handle(res);
    };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let detector = null;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = 'Kamera er ikke tilgjengelig her. Skriv inn koden eller søk i stedet.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (err) {
        msg.textContent = 'Fikk ikke tilgang til kameraet. Gi tillatelse i nettleseren, eller skriv inn koden.';
        return;
      }
      if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try {
          const fm = await window.BarcodeDetector.getSupportedFormats();
          if (fm.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch { detector = null; }
      }
      tick();
    };
    const tick = async () => {
      if (done) return;
      if (video.readyState >= 2) {
        try {
          let text = null;
          if (detector) {
            const codes = await detector.detect(video);
            text = codes[0]?.rawValue || null;
          } else {
            const s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = video.videoWidth * s;
            canvas.height = video.videoHeight * s;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
          }
          if (text && handle(text)) return;
        } catch { /* prøv neste bilde */ }
      }
      timer = setTimeout(tick, 150);
    };
    start();
  });
}

export function decodeBitmap(bmp) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  c.width = bmp.width * s;
  c.height = bmp.height * s;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
}

export const describe = (id) => {
  const o = lookup(id);
  if (!o) return id;
  return o.kind === 'item' ? `${o.obj.name} (${pathText(o.obj.placeId)})` : o.obj.name;
};
