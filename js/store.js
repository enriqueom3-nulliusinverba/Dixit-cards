const DB_NAME = "estampas";
const DB_VERSION = 1;
const STORE = "cartas";
const SEED_FLAG = "estampas-muestra-v1";

function openDb() {
  if (!globalThis.indexedDB) {
    return Promise.reject(Object.assign(new Error("indexedDB no disponible"), { code: "unsupported" }));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listCards() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const rows = request.result || [];
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveCard(card) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).put(card);
    request.onsuccess = () => resolve(card);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error || request.error);
  });
}

export async function deleteCard(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function readFlag() {
  try {
    return localStorage.getItem(SEED_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeFlag() {
  try {
    localStorage.setItem(SEED_FLAG, "1");
  } catch {
    /* La muestra sigue en IndexedDB aunque el indicador no se pueda guardar. */
  }
}

export async function seedSampleIfNeeded(createBlob) {
  if (readFlag()) return false;
  const cards = await listCards();
  if (cards.length > 0) {
    writeFlag();
    return false;
  }
  const blob = await createBlob();
  await saveCard({
    id: "muestra",
    createdAt: Date.now(),
    blob,
    sample: true,
  });
  writeFlag();
  return true;
}
