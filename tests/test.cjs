// Ende-til-ende-tester i Chromium. Kjør: node tests/test.cjs (med appen servert på http://localhost:8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765/';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept('25'));
  await p.goto(BASE);
  await p.waitForSelector('#home-search');
  const E = (fn, arg) => p.evaluate(fn, arg);

  console.log('Kasser og flytting');
  const ids = await E(async () => {
    const st = HVV.st;
    const bil = await st.savePlace({ name: 'Servicebilen', kind: 'sted', vehicle: true });
    const hylle = await st.savePlace({ name: 'Venstre hylle', kind: 'sted', parentId: bil.id });
    const verksted = await st.savePlace({ name: 'Verkstedet', kind: 'sted' });
    const kasse = await st.savePlace({ name: 'Kasse 2', kind: 'kasse', parentId: verksted.id });
    const drill = await st.saveItem({ name: 'Drill', placeId: kasse.id, homeId: kasse.id, accessories: ['Lader', 'Batteri'] });
    const sag = await st.saveItem({ name: 'Gjæresag', placeId: verksted.id });
    const skruer = await st.saveItem({ name: 'Listeskruer', type: 'mengde', qty: 100, unit: 'stk', minQty: 50, placeId: kasse.id });
    return { bil: bil.id, hylle: hylle.id, verksted: verksted.id, kasse: kasse.id, drill: drill.id, sag: sag.id, skruer: skruer.id };
  });
  ok(/^K[0-9A-Z]{7}$/.test(ids.kasse) && /^T[0-9A-Z]{7}$/.test(ids.drill), 'stabile ID-er med typeprefiks');
  let r = await E(async (ids) => {
    const st = HVV.st;
    const ev = await st.moveObjects([{ id: ids.kasse, kind: 'place' }], ids.hylle);
    return { ev: ev.id, drillPath: st.pathText(st.S.items.get(ids.drill).placeId), inCar: st.isWithin(st.S.items.get(ids.drill).placeId, ids.bil), drillPlace: st.S.items.get(ids.drill).placeId };
  }, ids);
  ok(r.drillPath === 'Servicebilen → Venstre hylle → Kasse 2', 'innholdet følger kassen: ' + r.drillPath);
  ok(r.inCar && r.drillPlace === ids.kasse, 'drillen ligger fortsatt i kassen, nå i bilen');
  r = await E(async ({ ids, ev }) => { const st = HVV.st; const u = await st.undoMove(ev); return { u, p: st.pathText(st.S.items.get(ids.drill).placeId) }; }, { ids, ev: r.ev });
  ok(r.p === 'Verkstedet → Kasse 2' && r.u.reverted === 1, 'Angre setter kassen tilbake');
  r = await E(async (ids) => {
    const st = HVV.st;
    await st.moveObjects([{ id: ids.drill, kind: 'item' }], ids.verksted); // ta drillen ut av kassen
    await st.moveObjects([{ id: ids.kasse, kind: 'place' }], ids.bil);
    return { drill: st.pathText(st.S.items.get(ids.drill).placeId), skruer: st.pathText(st.S.items.get(ids.skruer).placeId), home: st.pathText(st.S.items.get(ids.drill).homeId) };
  }, ids);
  ok(r.drill === 'Verkstedet' && r.skruer === 'Servicebilen → Kasse 2', 'verktøy tatt ut av kassen får egen plassering og følger ikke kassen');
  ok(r.home === 'Servicebilen → Kasse 2', 'fast plass vises separat fra nåværende plassering');
  r = await E(async (ids) => { try { await HVV.st.moveObjects([{ id: ids.bil, kind: 'place' }], ids.kasse); return 'flyttet'; } catch (e) { return e.message; } }, ids);
  ok(/inn i seg selv/.test(r), 'kan ikke flytte en plassering inn i sin egen kasse');
  // Flytting via skjermbildet: flere ting samtidig + Angre i varselet
  await p.goto(BASE + `#/flytt?ids=item:${ids.drill},item:${ids.sag}`);
  await p.waitForSelector('#m-dest');
  await p.click('#m-dest');
  await p.click(`.pick-row[data-v="${ids.bil}"]`);
  await p.click('#m-go');
  await p.waitForTimeout(200);
  r = await E((ids) => [HVV.st.S.items.get(ids.drill).placeId, HVV.st.S.items.get(ids.sag).placeId], ids);
  ok(r[0] === ids.bil && r[1] === ids.bil, 'flytting av flere verktøy i ett grep fra skjermen');
  ok(await p.isVisible('#toast-act'), 'Angre-knapp vises etter flytting');
  await p.click('#toast-act');
  await p.waitForTimeout(200);
  r = await E((ids) => [HVV.st.S.items.get(ids.drill).placeId, HVV.st.S.items.get(ids.sag).placeId], ids);
  ok(r[0] === ids.verksted && r[1] === ids.verksted, 'Angre fra varselet setter begge tilbake');
  r = await E(() => HVV.st.S.events.filter((e) => e.type === 'flytt').map((e) => ({ t: e.text, at: e.at, n: e.data.entries.length, from: e.data.entries[0].from })));
  ok(r.length >= 4 && r.every((e) => e.at && e.n && 'from' in e), 'historikk med hva, fra, til og tidspunkt');

  console.log('Utlån og retur');
  r = await E(async (ids) => {
    const st = HVV.st;
    const loan = await st.createLoan({ borrower: 'Per', dueAt: '2020-01-01', refs: [{ id: ids.drill, kind: 'item' }] });
    const av = st.availability(st.S.items.get(ids.drill));
    let again = 'ok';
    try { await st.createLoan({ borrower: 'Ola', refs: [{ id: ids.drill, kind: 'item' }] }); } catch (e) { again = e.message; }
    const pl = await st.savePacklist({ name: 'Test', vehicleId: ids.bil, lines: [{ id: 'a', kind: 'verktoy', itemId: ids.drill }, { id: 'b', kind: 'kategori', text: 'drill' }] });
    const ls = pl.lines.map((l) => st.lineStatus(l, ids.bil).code);
    const s = st.search('drill', { status: 'utlant' }).items.length;
    return { loan: loan.id, av, again, ls, s, state: st.loanState(loan) };
  }, ids);
  ok(r.av.available === false && r.av.code === 'utlant', 'utlånt verktøy er utilgjengelig');
  ok(/ikke tilgjengelig/.test(r.again), 'utlånt verktøy kan ikke lånes ut på nytt');
  ok(r.ls[0] === 'utilgjengelig' && r.ls[1] === 'utilgjengelig', 'pakkeliste viser utlånt verktøy som utilgjengelig');
  ok(r.s === 1, 'søkefilter status=utlånt finner det');
  ok(r.state === 'forsinket', 'forsinket retur oppdages');
  await p.goto(BASE + '#/');
  await p.waitForTimeout(200);
  ok((await p.innerText('#view')).includes('Forsinkede returer'), 'startsiden viser forsinkede returer');
  await p.goto(BASE + `#/sok?q=drill`);
  await p.waitForTimeout(300);
  ok((await p.innerText('#results')).includes('Hos Per'), 'søkeresultat viser hvem som har lånt');
  // Retur via skjermen: kryss av ett tilbehør (mangler batteri), legg i bilen
  await p.goto(BASE + `#/utlan/${r.loan}`);
  await p.waitForSelector('#rform');
  await p.check(`[name="acc_${ids.drill}_0"]`);
  await p.selectOption(`[name="pl_${ids.drill}"]`, ids.bil);
  await p.click('#rform button.primary');
  await p.waitForSelector('.modal [data-o]');
  await p.click('.modal [data-o]');
  await p.waitForTimeout(300);
  r = await E(({ ids, loan }) => { const st = HVV.st; const it = st.S.items.get(ids.drill); return { av: st.availability(it).available, place: it.placeId, notes: it.notes, closed: !!st.S.loans.get(loan).closedAt }; }, { ids, loan: r.loan });
  ok(r.av && r.place === ids.bil && r.closed, 'retur gjør verktøyet tilgjengelig og legger det på valgt sted');
  ok(/Mangler etter utlån til Per.*Batteri/.test(r.notes), 'manglende tilbehør noteres på verktøyet');
  r = await E(async (ids) => {
    const st = HVV.st;
    const loan = await st.createLoan({ borrower: 'Kari', refs: [{ id: ids.kasse, kind: 'place' }] });
    const sk = st.availability(st.S.items.get(ids.skruer));
    await st.returnLoan(loan.id, [{ id: ids.kasse, kind: 'place', placeId: ids.verksted, missing: [] }]);
    return { sk, after: st.availability(st.S.items.get(ids.skruer)).available, where: st.pathText(st.S.items.get(ids.skruer).placeId) };
  }, ids);
  ok(r.sk.available === false && /Kasse 2/.test(r.sk.label), 'innhold i utlånt kasse er utilgjengelig');
  ok(r.after && r.where === 'Verkstedet → Kasse 2', 'retur av kasse frigjør innholdet og flytter kassen');

  console.log('Kontroll, beholdning og vedlikehold');
  r = await E(async (ids) => {
    const st = HVV.st;
    await st.adjustQty(ids.skruer, { delta: -60, reason: 'brukt' });
    const onList = st.shoppingList().some((i) => i.id === ids.skruer);
    await st.saveAudit(ids.verksted, [{ id: ids.sag, state: 'skadet' }, { id: ids.skruer, state: 'ok', counted: 30 }]);
    const sag = st.S.items.get(ids.sag);
    const pl = await st.savePacklist({ name: 'T2', vehicleId: ids.bil, lines: [{ id: 'x', kind: 'verktoy', itemId: ids.sag }] });
    return { onList, qty: st.S.items.get(ids.skruer).qty, sag: sag.status, line: st.lineStatus(pl.lines[0], ids.bil).code, follow: st.followUps().some((f) => f.item.id === ids.sag), audited: !!st.S.places.get(ids.verksted).lastAuditAt };
  }, ids);
  ok(r.onList, 'mengdevare under minimum havner på innkjøpslisten');
  ok(r.qty === 30 && r.audited, 'kontroll registrerer talt antall og dato for siste kontroll');
  ok(r.sag === 'reparasjon' && r.line === 'utilgjengelig' && r.follow, 'skadet → til reparasjon → utilgjengelig i pakkeliste og i oppfølging');

  console.log('QR-koder');
  r = await E(async (ids) => {
    const { qrSVG, parseScan, labelsPDF } = await import('./js/qr.js');
    const svg = qrSVG(ids.drill, 300);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 300, 300);
    const d = g.getImageData(0, 0, 300, 300);
    const text = jsQR(d.data, 300, 300).data;
    const pdf = labelsPDF([ids.drill, ids.kasse, ids.bil], 'standard');
    const head = await pdf.slice(0, 5).text();
    return { text, parsed: parseScan(text), manual: parseScan(ids.drill[0] + '-' + ids.drill.slice(1).toLowerCase()), pdf: pdf.size, head };
  }, ids);
  ok(r.text === 'HVV:' + ids.drill, 'QR-koden inneholder bare HVV:+ID: ' + r.text);
  ok(r.parsed === ids.drill && r.manual === ids.drill, 'skannet og manuelt inntastet kode tolkes til riktig ID');
  ok(r.head === '%PDF-' && r.pdf > 2000, 'etiketter lages som PDF');
  await E((ids) => HVV.st.savePlace({ id: ids.kasse, name: 'Omdøpt kasse' }), ids);
  await p.goto(BASE + `#/kode/${ids.kasse}`);
  await p.waitForTimeout(300);
  ok((await p.innerText('h1')).includes('Omdøpt kasse'), 'koden virker etter navneendring og flytting');

  console.log('Sikkerhetskopi og gjenoppretting');
  // Legg til bilde og kvittering
  await p.goto(BASE + `#/ting/${ids.drill}`);
  await p.waitForSelector('#photo-file', { state: 'attached' });
  const png = path.join(__dirname, 'tmp-photo.png');
  await p.screenshot({ path: png, clip: { x: 0, y: 0, width: 200, height: 200 } });
  await p.setInputFiles('#photo-file', png);
  await p.waitForTimeout(500);
  const before = await E(async () => {
    const st = HVV.st;
    return { items: [...st.S.items.keys()].sort(), places: [...st.S.places.keys()].sort(), events: st.S.events.length, loans: st.S.loans.size, photos: [...st.S.items.values()].flatMap((i) => i.photos || []) };
  });
  ok(before.photos.length === 1, 'bilde lagret på verktøyet');
  await p.goto(BASE + '#/mer');
  await p.waitForSelector('#backup');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backup')]);
  const bfile = path.join(__dirname, 'tmp-backup.json');
  await dl.saveAs(bfile);
  const bdata = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  ok(bdata.blobs.length === 1 && bdata.stores.items.length === before.items.length, 'sikkerhetskopien inneholder data og bilder');
  ok(!bdata.stores.meta.some((m) => m.id === 'apiKey'), 'API-nøkkel er ikke med i sikkerhetskopien');
  await E(() => HVV.st.wipeAll());
  ok(await E(() => HVV.st.S.items.size) === 0, 'alt slettet før gjenoppretting');
  await p.goto(BASE + '#/mer');
  await p.waitForSelector('#restore', { state: 'attached' });
  await p.setInputFiles('#restore', bfile);
  await p.waitForSelector('.modal [data-o]');
  await p.click('.modal [data-o]');
  await p.waitForTimeout(800);
  const after = await E(async () => {
    const st = HVV.st;
    const photos = [...st.S.items.values()].flatMap((i) => i.photos || []);
    const url = await st.blobURL(photos[0]);
    return { items: [...st.S.items.keys()].sort(), places: [...st.S.places.keys()].sort(), events: st.S.events.length, loans: st.S.loans.size, photos, img: !!url };
  });
  ok(JSON.stringify(after.items) === JSON.stringify(before.items) && JSON.stringify(after.places) === JSON.stringify(before.places), 'alle ID-er (QR-koder) er identiske etter gjenoppretting');
  ok(after.events === before.events && after.loans === before.loans, 'historikk og utlån er gjenopprettet');
  ok(after.photos[0] === before.photos[0] && after.img, 'bildet er gjenopprettet');
  await p.goto(BASE + `#/kode/${ids.drill}`);
  await p.waitForTimeout(300);
  ok((await p.innerText('h1')).includes('Drill'), 'QR-kode åpner riktig verktøy etter gjenoppretting');
  r = await E((ids) => { try { HVV.st.validateBackup({ format: 'x' }); return 'godtatt'; } catch (e) { return e.message; } }, ids);
  ok(/ikke en sikkerhetskopi/.test(r), 'ugyldig fil avvises uten å røre dataene');

  console.log('CSV');
  const csv = await E(() => HVV.st.exportCSV());
  ok(csv.startsWith('﻿ID;Type;Navn') && csv.includes('Servicebilen > Kasse 2') === false && csv.includes('Drill'), 'CSV med semikolon og norske kolonner');

  console.log('Bildetolking (simulert API-svar)');
  await E(() => HVV.st.setMeta('apiKey', 'sk-ant-test'));
  let reqBody = null;
  await p.route('https://api.anthropic.com/**', async (route) => {
    reqBody = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: reqBody.model, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ image_note: 'Bunnen av kassen er ikke synlig.', items: [
        { name: 'Hammer', category: 'Håndverktøy', quantity: 1, unit: 'stk', tracking: 'enkelt', brand: 'Estwing', model: '', uncertain: [], note: '' },
        { name: 'Bits', category: 'Festemidler', quantity: 20, unit: 'stk', tracking: 'mengde', brand: '', model: '', uncertain: ['quantity'], note: 'Vanskelig å telle' },
      ] }) }],
    }) });
  });
  await p.goto(BASE + `#/bilde?ny=1&sted=${ids.verksted}`);
  await p.waitForSelector('#lib', { state: 'attached' });
  await p.setInputFiles('#lib', png);
  await p.waitForSelector('.sugg', { timeout: 10000 });
  ok(reqBody && reqBody.model === 'claude-opus-5-5' && reqBody.messages[0].content[0].type === 'image', 'bildet sendes til Claude når nøkkel er satt');
  ok(await p.isVisible('.sugg .is-unc'), 'usikkert antall er markert');
  ok((await p.innerText('#view')).includes('Bunnen av kassen er ikke synlig'), 'merknad om skjulte deler vises');
  await p.fill('.sugg input[data-f="name"] >> nth=0', 'Snekkerhammer');
  await p.click('#ph-save');
  await p.waitForTimeout(500);
  r = await E(() => [...HVV.st.S.items.values()].filter((i) => i.source === 'bilde').map((i) => ({ n: i.name, u: i.uncertain, ph: i.photos.length, t: i.type, q: i.qty })));
  ok(r.length === 2 && r.some((x) => x.n === 'Snekkerhammer') && r.every((x) => x.ph === 1), 'forslag redigert før lagring, bildet beholdes');
  ok(r.find((x) => x.n === 'Bits').u.includes('qty') && r.find((x) => x.n === 'Bits').t === 'mengde', 'usikkerhet lagres på registreringen');

  console.log('Demomodus er adskilt');
  r = await E(async () => { const n = HVV.st.S.items.size; await HVV.switchMode('demo'); const d = HVV.st.S.items.size; const demoNames = [...HVV.st.S.items.values()].map((i) => i.name); await HVV.switchMode('meg'); return { n, d, back: HVV.st.S.items.size, mixed: demoNames.includes('Snekkerhammer') }; });
  ok(r.d > 0 && r.back === r.n && !r.mixed, `demodata (${r.d}) og egne data (${r.n}) blandes ikke`);

  console.log('Uten nett');
  await p.goto(BASE);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForTimeout(500);
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForSelector('#home-search', { timeout: 5000 }).catch(() => {});
  await p.goto(BASE + '#/sok?q=drill');
  await p.waitForTimeout(500);
  ok((await p.innerText('#view')).includes('Drill'), 'søk virker uten nett etter første innlasting');
  ok((await p.innerText('#storage-chip')).includes('Uten nett'), 'uten nett vises tydelig');
  await ctx.setOffline(false);

  for (const f of [png, bfile]) fs.unlinkSync(f);
  ok(errs.length === 0, 'ingen JavaScript-feil' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${pass} bestått, ${fail} feilet`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
