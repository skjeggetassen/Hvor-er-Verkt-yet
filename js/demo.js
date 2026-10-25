// Eksempeldata for demomodus. Lagres i en egen database (hvv-demo) og blandes aldri med brukerens data.

import * as st from './store.js';
import { S } from './store.js';
import { todayISO } from './util.js';

const day = (n) => todayISO(new Date(Date.now() + n * 864e5));

export async function seedDemo() {
  if (S.mode !== 'demo') throw new Error('Demodata kan bare legges inn i demomodus.');
  const P = (name, o = {}) => st.savePlace({ name, kind: 'sted', ...o });
  const bil = await P('Servicebilen', { pinned: true, vehicle: true });
  const vh = await P('Venstre hylle', { parentId: bil.id });
  const hh = await P('Høyre hylle', { parentId: bil.id });
  const kasse2 = await st.savePlace({ name: 'Kasse 2', kind: 'kasse', parentId: vh.id });
  const garasje = await P('Garasjen', { pinned: true });
  const verksted = await P('Verkstedet på jobb', { pinned: true });
  const reol = await P('Reol A', { parentId: verksted.id });
  const skruekasse = await st.savePlace({ name: 'Skruekasse', kind: 'kasse', parentId: reol.id });
  await P('Midlertidig: Storgata 12', { notes: 'Rehabilitering bad, uke 44' });

  const I = (o) => st.saveItem({ owner: 'meg', ...o, homeId: o.homeId ?? o.placeId });
  await I({ name: 'Gjæresag', category: 'Elektroverktøy', brand: 'Makita', placeId: verksted.id, accessories: ['Sagblad 60T', 'Støvpose'], purchaseDate: day(-700), price: 6490, serviceDue: day(12) });
  await I({ name: 'Kompressor', category: 'Elektroverktøy', placeId: verksted.id, owner: 'arbeidsgiver', serviceDue: day(-3), notes: 'Tapp kondens etter bruk' });
  await I({ name: 'Dykkpistol', category: 'Elektroverktøy', placeId: verksted.id, owner: 'arbeidsgiver', accessories: ['Slange 10 m'] });
  const drill = await I({ name: 'Drill/skrutrekker 18V', category: 'Elektroverktøy', brand: 'DeWalt', serial: 'DEMO-123456', placeId: kasse2.id, accessories: ['Lader', '2 batterier', 'Koffert'], purchaseDate: day(-400), price: 2990 });
  await I({ name: 'Vater 60 cm', category: 'Måleverktøy', placeId: hh.id });
  await I({ name: 'Krysslaser', category: 'Måleverktøy', placeId: hh.id, warrantyUntil: day(20) });
  await I({ name: 'Multiverktøy', category: 'Elektroverktøy', placeId: kasse2.id, status: 'reparasjon', notes: 'Løs kontakt i bryter' });
  await I({ name: 'Fugeskum lavtrykk', type: 'mengde', category: 'Forbruksvarer', qty: 1, unit: 'boks', minQty: 3, placeId: hh.id });
  await I({ name: 'Bits PH2', type: 'mengde', category: 'Festemidler', qty: 14, unit: 'stk', minQty: 5, placeId: kasse2.id });
  await I({ name: 'Listeskruer 3,5×40', type: 'mengde', category: 'Festemidler', qty: 120, unit: 'stk', minQty: 200, placeId: skruekasse.id });
  await I({ name: 'Dykkspiker 50 mm', type: 'mengde', category: 'Festemidler', qty: 2, unit: 'eske', minQty: 1, placeId: skruekasse.id });
  const stige = await I({ name: 'Gardintrapp', category: 'Utstyr', placeId: garasje.id });
  await I({ name: 'Slagdrill', category: 'Elektroverktøy', placeId: garasje.id, status: 'savnet' });

  await st.createLoan({ borrower: 'Per (demo)', at: day(-9), dueAt: day(-2), notes: 'Til terrassen', refs: [{ id: stige.id, kind: 'item' }] });

  await st.savePacklist({
    name: 'Bytte glaslister', vehicleId: bil.id, lines: [
      { id: 'ln1', kind: 'verktoy', itemId: drill.id, packed: false, note: '' },
      { id: 'ln2', kind: 'kategori', text: 'Gjæresag', packed: false, note: '' },
      { id: 'ln3', kind: 'kategori', text: 'Dykkpistol', packed: false, note: '' },
      { id: 'ln4', kind: 'fri', text: 'Glasslister furu', qty: 12, unit: 'm', buy: true, packed: false, note: 'Måles på stedet' },
      { id: 'ln5', kind: 'fri', text: 'Maling', qty: 1, unit: 'l', buy: true, packed: false, note: 'NCS S 0502-Y' },
    ],
  });
  await st.setMeta('demoSeeded', true);
}
