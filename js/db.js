// Tynt lag over IndexedDB. Alle skrivinger går i én transaksjon slik at
// f.eks. en flytting og historikken for den lagres samlet eller ikke i det hele tatt.

export const STORES = ['items', 'places', 'events', 'loans', 'packlists', 'blobs', 'meta'];
let db = null;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function open(name) {
  close();
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Databasen er låst av en annen fane.'));
  });
}

export function close() {
  if (db) db.close();
  db = null;
}

export function getAll(store) {
  return req(db.transaction(store).objectStore(store).getAll());
}

export function get(store, id) {
  return req(db.transaction(store).objectStore(store).get(id));
}

// ops: [{ store, put: obj } | { store, del: id } | { store, clear: true }]
export function write(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return Promise.resolve();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, 'readwrite');
    for (const o of ops) {
      const s = t.objectStore(o.store);
      if (o.clear) s.clear();
      else if (o.del !== undefined) s.delete(o.del);
      else s.put(o.put);
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Lagring avbrutt'));
  });
}
