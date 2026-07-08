/* ============================================================
   db.js — All data storage for the app.

   Everything is saved in the browser using IndexedDB (a built-in
   database every browser has) so the app works with no server
   and no internet connection required after the page loads.

   Plain English: think of this file as the filing cabinet.
   Every other file asks THIS file to save or fetch information,
   instead of touching storage directly.
   ============================================================ */

const DB_NAME = "overageFundsCRM";
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("leads")) {
        const leads = db.createObjectStore("leads", { keyPath: "id" });
        leads.createIndex("state", "state", { unique: false });
        leads.createIndex("county", "county", { unique: false });
        leads.createIndex("status", "status", { unique: false });
        leads.createIndex("stateCounty", "stateCounty", { unique: false });
      }

      if (!db.objectStoreNames.contains("resources")) {
        const resources = db.createObjectStore("resources", { keyPath: "id" });
        resources.createIndex("stateCounty", "stateCounty", { unique: false });
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("uploads")) {
        db.createObjectStore("uploads", { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  // ---- generic helpers ----
  async put(storeName, value) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  },

  async get(storeName, key) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async clear(storeName) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  // ---- leads ----
  async getAllLeads() {
    return DB.getAll("leads");
  },
  async saveLead(lead) {
    return DB.put("leads", lead);
  },
  async deleteLead(id) {
    return DB.delete("leads", id);
  },

  // ---- resources (uploaded forms in the library) ----
  async getAllResources() {
    return DB.getAll("resources");
  },
  async saveResource(resource) {
    return DB.put("resources", resource);
  },
  async deleteResource(id) {
    return DB.delete("resources", id);
  },

  // ---- settings / meta ----
  async getSetting(key, fallback) {
    const row = await DB.get("meta", key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return DB.put("meta", { key, value });
  },

  // ---- full backup / restore (important: this is a browser-only app,
  // so exporting a backup file regularly is the user's safety net) ----
  async exportAll() {
    const [leads, resources, metaRows] = await Promise.all([
      DB.getAll("leads"),
      DB.getAll("resources"),
      DB.getAll("meta"),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      app: "overage-funds-crm",
      version: DB_VERSION,
      leads,
      resources,
      meta: metaRows,
    };
  },

  async importAll(data, { replace = false } = {}) {
    if (replace) {
      await Promise.all([DB.clear("leads"), DB.clear("resources"), DB.clear("meta")]);
    }
    const jobs = [];
    (data.leads || []).forEach((l) => jobs.push(DB.put("leads", l)));
    (data.resources || []).forEach((r) => jobs.push(DB.put("resources", r)));
    (data.meta || []).forEach((m) => jobs.push(DB.put("meta", m)));
    await Promise.all(jobs);
  },
};

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
