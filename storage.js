/*
 * Speak Loop · storage.js
 * 本机存储：优先 IndexedDB（容量大），不可用时退回 localStorage。
 */
(function (root) {
  'use strict';

  const DB_NAME = 'speak-loop';
  const STORE = 'kv';
  const LS_PREFIX = 'speak-loop:';
  let dbPromise = null;

  function hasIDB() {
    try { return !!root.indexedDB; } catch (e) { return false; }
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('无法打开本机数据库'));
      req.onblocked = () => reject(new Error('本机数据库被其他页面占用'));
    }).catch(err => { dbPromise = null; throw err; });
    return dbPromise;
  }

  function run(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('本机存储出错'));
      tx.onabort = () => reject(tx.error || new Error('本机存储被中止'));
    }));
  }

  async function get(key) {
    if (hasIDB()) {
      try { return await run('readonly', st => st.get(key)); } catch (e) { console.warn('IndexedDB 读取失败，改用 localStorage', e); }
    }
    const raw = root.localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  }

  async function set(key, value) {
    if (hasIDB()) {
      try { await run('readwrite', st => st.put(value, key)); return; } catch (e) { console.warn('IndexedDB 写入失败，改用 localStorage', e); }
    }
    root.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }

  async function del(key) {
    if (hasIDB()) {
      try { await run('readwrite', st => st.delete(key)); } catch (e) { console.warn(e); }
    }
    try { root.localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* ignore */ }
  }

  // 请求浏览器不要自动清理本站数据（iOS 主屏幕 App 尤其需要）
  async function persist() {
    try {
      if (root.navigator && root.navigator.storage && root.navigator.storage.persist) {
        return await root.navigator.storage.persist();
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  async function persisted() {
    try {
      if (root.navigator && root.navigator.storage && root.navigator.storage.persisted) {
        return await root.navigator.storage.persisted();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  root.SLStorage = { get, set, del, persist, persisted };
})(window);
