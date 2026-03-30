// ═══════════════════════════════════════════════════════════════════
// APD Store — IndexedDB による APD ファイルの永続化
// ═══════════════════════════════════════════════════════════════════
// 使い方:
//   await tfApdStore.save(fileName, xmlText)  — APDを保存（同名は上書き）
//   await tfApdStore.load(id)                 — APDのXMLテキストを取得
//   await tfApdStore.list()                   — 保存済みAPD一覧（メタデータ）
//   await tfApdStore.remove(id)               — APDを削除
//   tfApdStore.getSelectedId()                — 現在選択中のAPD ID
//   tfApdStore.setSelectedId(id)              — APD IDを選択状態に設定
// ═══════════════════════════════════════════════════════════════════

window.tfApdStore = (() => {
  const DB_NAME = 'tfApdStore';
  const DB_VERSION = 1;
  const STORE_NAME = 'apds';
  const SELECTED_KEY = 'tfApdSelected';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      const store = t.objectStore(STORE_NAME);
      const result = fn(store);
      t.oncomplete = () => { db.close(); resolve(result._result ?? result); };
      t.onerror = () => { db.close(); reject(t.error); };
    }));
  }

  // メタデータを抽出（XMLを軽量パースしてフォーム数・台帳数等を取得）
  function extractMeta(xmlText, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { fileName, formCount: 0, ledgerCount: 0, scriptCount: 0, appLabel: '' };
    }

    const appEntry = [...doc.querySelectorAll('entries > entry')]
      .find(e => e.getAttribute('type') === 'APPLICATION')
      || doc.querySelector('entries > entry');
    const topElems = appEntry?.querySelector(':scope > elements');

    const count = (type) => {
      if (!topElems) return 0;
      const container = [...topElems.children].find(e => e.getAttribute('type') === type);
      const elems = container?.querySelector(':scope > elements');
      return elems ? elems.children.length : 0;
    };

    // フォーム数はFORM_LIST内のFORMSから取得
    let formCount = 0;
    if (topElems) {
      const fl = [...topElems.children].find(e => e.getAttribute('type') === 'FORM_LISTS');
      const flElems = fl?.querySelector(':scope > elements');
      if (flElems) {
        for (const list of flElems.children) {
          if (list.getAttribute('type') !== 'FORM_LIST') continue;
          const formsContainer = [...(list.querySelector(':scope > elements')?.children || [])]
            .find(e => e.getAttribute('type') === 'FORMS');
          const formsElems = formsContainer?.querySelector(':scope > elements');
          if (formsElems) formCount += formsElems.children.length;
        }
      }
    }

    return {
      fileName,
      appLabel: appEntry?.getAttribute('label') || '',
      formCount,
      ledgerCount: count('LEDGERS'),
      scriptCount: count('SCRIPTS'),
    };
  }

  return {
    async save(fileName, xmlText) {
      const meta = extractMeta(xmlText, fileName);
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readwrite');
        const store = t.objectStore(STORE_NAME);
        // 同名ファイルがあれば上書き
        const all = store.getAll();
        all.onsuccess = () => {
          const existing = all.result.find(r => r.fileName === fileName);
          const record = {
            ...(existing || {}),
            fileName,
            xmlText,
            ...meta,
            updatedAt: Date.now(),
          };
          const putReq = store.put(record);
          putReq.onsuccess = () => resolve(putReq.result);
        };
        t.oncomplete = () => db.close();
        t.onerror = () => { db.close(); reject(t.error); };
      });
    },

    async load(id) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readonly');
        const req = t.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        t.oncomplete = () => db.close();
        t.onerror = () => { db.close(); reject(t.error); };
      });
    },

    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readonly');
        const req = t.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          // メタデータのみ返す（xmlTextは除外して軽量化）
          resolve(req.result.map(({ xmlText, ...meta }) => meta)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        };
        t.oncomplete = () => db.close();
        t.onerror = () => { db.close(); reject(t.error); };
      });
    },

    async remove(id) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readwrite');
        t.objectStore(STORE_NAME).delete(id);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
      });
    },

    getSelectedId() {
      const v = sessionStorage.getItem(SELECTED_KEY);
      return v ? Number(v) : null;
    },

    setSelectedId(id) {
      if (id == null) sessionStorage.removeItem(SELECTED_KEY);
      else sessionStorage.setItem(SELECTED_KEY, String(id));
    },
  };
})();
