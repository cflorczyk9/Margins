import assert from "node:assert/strict";
import test from "node:test";
import {
  clearVaultHandle,
  hasFileSystemAccess,
  loadVaultHandle,
  saveVaultHandle,
  vaultHandleStoreConfig
} from "../src/vaultHandleStore.js";

test("hasFileSystemAccess reports browser capability from an injected environment", () => {
  assert.equal(hasFileSystemAccess({}), false);
  assert.equal(hasFileSystemAccess({
    indexedDB: {},
    FileSystemDirectoryHandle: function FileSystemDirectoryHandle() {},
    showDirectoryPicker() {}
  }), true);
});

test("vaultHandleStoreConfig exposes stable IndexedDB names for browser integration", () => {
  assert.deepEqual(vaultHandleStoreConfig(), {
    dbName: "margins-vault",
    dbVersion: 1,
    storeName: "handles",
    handleKey: "last-vault-directory"
  });
});

test("browser-only vault handle functions are guarded without IndexedDB", async () => {
  assert.equal(await loadVaultHandle({}), null);
  assert.equal(await clearVaultHandle({}), false);
  assert.equal(await loadVaultHandle({ indexedDB: {} }), null);
});

test("saveVaultHandle validates directory-handle shape before storage", async () => {
  await assert.rejects(
    saveVaultHandle({ kind: "file" }, { indexedDB: { open() {} } }),
    /FileSystemDirectoryHandle-like/
  );
});
