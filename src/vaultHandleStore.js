const DB_NAME = "margins-vault";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "last-vault-directory";

export function hasFileSystemAccess(env = globalThis) {
  return Boolean(
    env &&
    typeof env.indexedDB !== "undefined" &&
    typeof env.FileSystemDirectoryHandle !== "undefined" &&
    typeof env.showDirectoryPicker === "function"
  );
}

export function vaultHandleStoreConfig() {
  return {
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    storeName: STORE_NAME,
    handleKey: HANDLE_KEY
  };
}

export async function loadVaultHandle(env = globalThis) {
  if (!hasIndexedDB(env)) {
    return null;
  }

  const db = await openVaultHandleDb(env.indexedDB);
  try {
    return await readValue(db, HANDLE_KEY);
  } finally {
    db.close();
  }
}

export async function saveVaultHandle(handle, env = globalThis) {
  if (!hasIndexedDB(env)) {
    return false;
  }
  if (!isDirectoryHandleLike(handle)) {
    throw new TypeError("saveVaultHandle requires a FileSystemDirectoryHandle-like value.");
  }

  const db = await openVaultHandleDb(env.indexedDB);
  try {
    await writeValue(db, HANDLE_KEY, handle);
    return true;
  } finally {
    db.close();
  }
}

export async function clearVaultHandle(env = globalThis) {
  if (!hasIndexedDB(env)) {
    return false;
  }

  const db = await openVaultHandleDb(env.indexedDB);
  try {
    await deleteValue(db, HANDLE_KEY);
    return true;
  } finally {
    db.close();
  }
}

function hasIndexedDB(env) {
  return Boolean(env && env.indexedDB && typeof env.indexedDB.open === "function");
}

function isDirectoryHandleLike(handle) {
  return Boolean(handle && typeof handle === "object" && handle.kind === "directory");
}

function openVaultHandleDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Opening the vault handle database was blocked."));
  });
}

function readValue(db, key) {
  return transact(db, "readonly", (store) => store.get(key));
}

function writeValue(db, key, value) {
  return transact(db, "readwrite", (store) => store.put(value, key));
}

function deleteValue(db, key) {
  return transact(db, "readwrite", (store) => store.delete(key));
}

function transact(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    let result;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result ?? null);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Vault handle transaction aborted."));
  });
}
