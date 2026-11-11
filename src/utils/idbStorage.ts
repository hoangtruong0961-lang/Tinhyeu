import { Project, AppSettings } from '../types';
import { DEFAULT_PROJECTS } from './projectStorage';
import { DEFAULT_APP_SETTINGS } from './settingsStorage';
import { resolveApiUrl } from './apiUrl';

const DB_NAME = 'subtranslate_idb';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_SETTINGS = 'settings';
const STORE_MEDIA = 'media_files';

const PROJECTS_LS_KEY = 'subtranslate_capcut_projects_v1';
const SETTINGS_LS_KEY = 'subtranslate_app_settings_v1';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      db.onclose = () => {
        dbPromise = null;
      };

      db.onerror = () => {
        dbPromise = null;
      };

      // Wrap transaction function to clear dbPromise if it throws a closing error
      const originalTransaction = db.transaction;
      db.transaction = function (this: IDBDatabase, storeNames: any, mode?: any, options?: any) {
        try {
          return originalTransaction.call(this, storeNames, mode || 'readonly', options);
        } catch (err: any) {
          const errMsg = err?.message || '';
          if (
            err?.name === 'InvalidStateError' ||
            errMsg.includes('closing') ||
            errMsg.includes('closed')
          ) {
            console.warn('[IndexedDB] Connection closing/closed detected during transaction. Resetting dbPromise...');
            dbPromise = null;
          }
          throw err;
        }
      };

      resolve(db);
    };

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Initialize DB and migrate legacy data from localStorage if needed.
 */
export async function initStorageDB(): Promise<{ projects: Project[]; settings: AppSettings }> {
  try {
    // Request persistent storage so the browser will never evict stored video blobs
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().then((persisted) => {
        if (persisted) {
          console.log('[IndexedDB] Persistent storage successfully granted by browser.');
        }
      }).catch(() => {});
    }

    const db = await openDatabase();

    // 1. Check & load Projects from IDB
    let projects = await getAllProjectsFromDB(db);

    // If IDB has no projects, try migrating from localStorage or load default
    if (!projects || projects.length === 0) {
      let lsProjects: Project[] | null = null;
      try {
        const raw = localStorage.getItem(PROJECTS_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            lsProjects = parsed;
          }
        }
      } catch (e) {
        console.warn('Error reading projects from localStorage during migration:', e);
      }

      const initialProjects = lsProjects || DEFAULT_PROJECTS;
      for (const p of initialProjects) {
        await saveProjectToDB(p, db);
      }
      projects = initialProjects;
    }

    // 2. Check & load Settings from IDB
    let settings = await getSettingsFromDB(db);
    if (!settings) {
      let lsSettings: AppSettings | null = null;
      try {
        const raw = localStorage.getItem(SETTINGS_LS_KEY);
        if (raw) {
          lsSettings = JSON.parse(raw);
        }
      } catch (e) {
        console.warn('Error reading settings from localStorage during migration:', e);
      }
      const initialSettings = { ...DEFAULT_APP_SETTINGS, ...(lsSettings || {}) };
      await saveSettingsToDB(initialSettings, db);
      settings = initialSettings;
    }

    // Sync back to localStorage for fallback (trim subtitles to fit in 5MB limit)
    try {
      const trimmed = projects.map(p => ({ ...p, subtitles: [] }));
      localStorage.setItem(PROJECTS_LS_KEY, JSON.stringify(trimmed));
      localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(settings));
    } catch (_) {}

    return { projects, settings };
  } catch (err) {
    console.error('initStorageDB error, falling back to defaults:', err);
    return { projects: DEFAULT_PROJECTS, settings: DEFAULT_APP_SETTINGS };
  }
}

/**
 * Get all projects from IDB
 */
export async function getAllProjectsFromDB(existingDb?: IDBDatabase): Promise<Project[]> {
  try {
    const db = existingDb || (await openDatabase());
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();

      req.onsuccess = () => {
        const rawRes = (req.result as Project[]) || [];
        const res = rawRes.filter((p) => p && !p.id.startsWith('proj-sample-'));
        // Sort by updatedAt descending
        res.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(res);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('getAllProjectsFromDB error:', e);
    return [];
  }
}

/**
 * Save single project to IDB
 */
export async function saveProjectToDB(project: Project, existingDb?: IDBDatabase): Promise<void> {
  try {
    const db = existingDb || (await openDatabase());
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.put(project);

      req.onsuccess = () => {
        // Also update localStorage as fast sync backup (trim subtitles to prevent QuotaExceededError)
        try {
          getAllProjectsFromDB(db).then((all) => {
            const trimmed = all.map(p => ({ ...p, subtitles: [] }));
            localStorage.setItem(PROJECTS_LS_KEY, JSON.stringify(trimmed));
          });
        } catch (_) {}
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('saveProjectToDB error:', e);
  }
}

/**
 * Delete project from IDB
 */
export async function deleteProjectFromDB(id: string, existingDb?: IDBDatabase): Promise<Project[]> {
  try {
    const db = existingDb || (await openDatabase());
    // 1. Delete project metadata
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // 2. Delete media file if stored in IDB or OPFS
    const cachedUrl = activeMediaUrlCache.get(id);
    if (cachedUrl) {
      try { URL.revokeObjectURL(cachedUrl); } catch (_) {}
      activeMediaUrlCache.delete(id);
    }
    deleteMediaFromOPFS(id).catch(() => {});

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });

    const updated = await getAllProjectsFromDB(db);
    try {
      const trimmed = updated.map(p => ({ ...p, subtitles: [] }));
      localStorage.setItem(PROJECTS_LS_KEY, JSON.stringify(trimmed));
    } catch (_) {}
    return updated;
  } catch (e) {
    console.error('deleteProjectFromDB error:', e);
    return [];
  }
}

/**
 * Get App Settings from IDB
 */
export async function getSettingsFromDB(existingDb?: IDBDatabase): Promise<AppSettings | null> {
  try {
    const db = existingDb || (await openDatabase());
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.get('app_settings');

      req.onsuccess = () => {
        if (req.result && req.result.value) {
          resolve(req.result.value as AppSettings);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('getSettingsFromDB error:', e);
    return null;
  }
}

/**
 * Save App Settings to IDB
 */
export async function saveSettingsToDB(settings: AppSettings, existingDb?: IDBDatabase): Promise<void> {
  try {
    const db = existingDb || (await openDatabase());
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.put({ key: 'app_settings', value: settings, updatedAt: Date.now() });

      req.onsuccess = () => {
        try {
          localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(settings));
        } catch (_) {}
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('saveSettingsToDB error:', e);
  }
}

// In-memory cache of created Object URLs to prevent recreation of identical Blobs on every render
const activeMediaUrlCache = new Map<string, string>();

/**
 * Origin Private File System (OPFS) helpers for high-performance and permanent media storage.
 * Completely immune to IndexedDB transaction locks, version changes, and structured clone bugs.
 */
async function getOPFSMediaDir(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('media_store', { create: true });
  } catch (e) {
    return null;
  }
}

async function writeMediaToOPFS(id: string, file: Blob | File): Promise<boolean> {
  try {
    const dir = await getOPFSMediaDir();
    if (!dir) return false;
    const fileHandle = await dir.getFileHandle(`${id}.bin`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return true;
  } catch (e) {
    return false;
  }
}

async function readMediaFromOPFS(id: string): Promise<Blob | null> {
  try {
    const dir = await getOPFSMediaDir();
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(`${id}.bin`, { create: false });
    const file = await fileHandle.getFile();
    if (file && file.size > 0) {
      return file;
    }
    return null;
  } catch {
    return null;
  }
}

async function hasMediaInOPFS(id: string): Promise<boolean> {
  try {
    const dir = await getOPFSMediaDir();
    if (!dir) return false;
    const fileHandle = await dir.getFileHandle(`${id}.bin`, { create: false });
    const file = await fileHandle.getFile();
    return Boolean(file && file.size > 0);
  } catch {
    return false;
  }
}

export async function deleteMediaFromOPFS(id: string): Promise<void> {
  try {
    const dir = await getOPFSMediaDir();
    if (!dir) return;
    await dir.removeEntry(`${id}.bin`).catch(() => {});
  } catch {}
}

/**
 * Store Media / Video File permanently with dual-layer storage:
 * 1. OPFS (Origin Private File System) for direct SSD storage without IDB transaction limits
 * 2. IndexedDB STORE_MEDIA as fallback
 * 3. Detached Blob slicing to fix the WebKit/Safari file descriptor revocation bug.
 * Optionally stores under multiple alias IDs simultaneously (e.g. [projectId, clipId]).
 */
export async function storeMediaFileDB(
  id: string,
  file: File | Blob,
  additionalIds?: string[]
): Promise<string> {
  if (!id || !file) return '';

  // Request persistent storage so browser never evicts cached media
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Create a detached, immutable slice of the file to fix WebKit/Safari temporary file descriptor revocation
  const detachedBlob = file instanceof Blob ? file.slice(0, file.size, file.type || 'video/mp4') : file;

  // 1. Write to OPFS for persistent SSD storage
  const allTargetIds = [id, ...(additionalIds || []).filter((x) => x && x !== id)];
  for (const tid of allTargetIds) {
    writeMediaToOPFS(tid, detachedBlob).catch(() => {});
  }

  // 2. Dual-store to IndexedDB STORE_MEDIA as fallback
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      
      const record = {
        id,
        file: detachedBlob,
        type: detachedBlob.type || 'video/mp4',
        name: (file as File).name || 'video',
        size: detachedBlob.size,
        createdAt: Date.now(),
      };
      store.put(record);

      if (additionalIds && Array.isArray(additionalIds)) {
        for (const extraId of additionalIds) {
          if (extraId && extraId !== id) {
            store.put({
              ...record,
              id: extraId,
            });
          }
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[IndexedDB] DB store error (OPFS backup active):', e);
  }

  // 3. Cache object URL
  let objectUrl = activeMediaUrlCache.get(id);
  if (!objectUrl) {
    objectUrl = URL.createObjectURL(detachedBlob);
    activeMediaUrlCache.set(id, objectUrl);
  }
  if (additionalIds && Array.isArray(additionalIds)) {
    for (const extraId of additionalIds) {
      if (extraId) activeMediaUrlCache.set(extraId, objectUrl);
    }
  }

  console.log(`[Media Storage] Successfully saved media file for ${id}${additionalIds?.length ? ` (+${additionalIds.join(', ')})` : ''} (size: ${(detachedBlob.size / 1024 / 1024).toFixed(2)} MB)`);
  return objectUrl;
}

/**
 * Get Media / Video object URL from OPFS or IDB.
 * Accepts optional fallback IDs to query if primary ID is not found.
 * Re-uses cached Object URLs to prevent triggering unnecessary video reloads.
 */
export async function getMediaFileUrlDB(id: string, fallbackIds?: string[]): Promise<string | null> {
  if (!id) return null;
  const queryIds = [id, ...(fallbackIds || [])].filter(Boolean);

  // 1. Fast return from active memory cache if available
  for (const queryId of queryIds) {
    const cached = activeMediaUrlCache.get(queryId);
    if (cached) return cached;
  }

  // 2. Check OPFS first (lightning fast, immune to IDB errors)
  for (const queryId of queryIds) {
    try {
      const opfsBlob = await readMediaFromOPFS(queryId);
      if (opfsBlob && opfsBlob.size > 0) {
        const objUrl = URL.createObjectURL(opfsBlob);
        activeMediaUrlCache.set(queryId, objUrl);
        activeMediaUrlCache.set(id, objUrl);
        return objUrl;
      }
    } catch {}
  }

  // 3. Check IndexedDB fallback
  try {
    const db = await openDatabase();

    for (const queryId of queryIds) {
      const url = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(STORE_MEDIA, 'readonly');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.get(queryId);

        req.onsuccess = () => {
          if (req.result) {
            const fileBlob = req.result.file || req.result.blob || (req.result instanceof Blob ? req.result : null);
            if (fileBlob && fileBlob.size > 0) {
              const objUrl = URL.createObjectURL(fileBlob);
              activeMediaUrlCache.set(queryId, objUrl);
              activeMediaUrlCache.set(id, objUrl);
              resolve(objUrl);
              return;
            }
          }
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });

      if (url) return url;
    }

    return null;
  } catch (e) {
    console.error('getMediaFileUrlDB error:', e);
    return null;
  }
}

/**
 * Get raw Media Blob / File from OPFS or IDB.
 */
export async function getMediaFileBlobDB(id: string, fallbackIds?: string[]): Promise<Blob | File | null> {
  if (!id) return null;
  const queryIds = [id, ...(fallbackIds || [])].filter(Boolean);

  // 1. Check OPFS
  for (const queryId of queryIds) {
    const opfsBlob = await readMediaFromOPFS(queryId);
    if (opfsBlob && opfsBlob.size > 0) return opfsBlob;
  }

  // 2. Check IndexedDB
  try {
    const db = await openDatabase();
    for (const queryId of queryIds) {
      const blob = await new Promise<Blob | File | null>((resolve) => {
        const tx = db.transaction(STORE_MEDIA, 'readonly');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.get(queryId);

        req.onsuccess = () => {
          if (req.result) {
            const fileBlob = req.result.file || req.result.blob || (req.result instanceof Blob ? req.result : null);
            if (fileBlob && fileBlob.size > 0) {
              resolve(fileBlob);
              return;
            }
          }
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });

      if (blob) return blob;
    }
    return null;
  } catch (e) {
    console.error('getMediaFileBlobDB error:', e);
    return null;
  }
}

/**
 * Check if media file exists in OPFS or IDB for a given project/clip ID
 */
export async function hasMediaFileDB(id: string, fallbackIds?: string[]): Promise<boolean> {
  const queryIds = [id, ...(fallbackIds || [])].filter(Boolean);

  // Check active cache
  for (const queryId of queryIds) {
    if (activeMediaUrlCache.has(queryId)) return true;
  }

  // Check OPFS
  for (const queryId of queryIds) {
    const hasOpfs = await hasMediaInOPFS(queryId);
    if (hasOpfs) return true;
  }

  // Check IDB
  try {
    const db = await openDatabase();
    for (const queryId of queryIds) {
      const exists = await new Promise<boolean>((resolve) => {
        const tx = db.transaction(STORE_MEDIA, 'readonly');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.get(queryId);
        req.onsuccess = () => {
          const item = req.result;
          const blob = item ? (item.file || item.blob || (item instanceof Blob ? item : null)) : null;
          resolve(Boolean(blob && blob.size > 0));
        };
        req.onerror = () => resolve(false);
      });
      if (exists) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Cache and persist remote video (TikTok, Douyin, YouTube, CDN) into IndexedDB as a Blob.
 * Once cached, the video will NEVER die or expire, and works 100% offline.
 */
export async function cacheRemoteVideoToDB(
  id: string,
  url: string,
  onProgress?: (percent: number) => void,
  additionalIds?: string[]
): Promise<string | null> {
  if (!id || !url) return null;
  // If already a local blob URL or data URL, check if already in IndexedDB
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const existing = await getMediaFileUrlDB(id, additionalIds);
    if (existing) return existing;
    return null;
  }

  try {
    // Check if already in IndexedDB first
    const alreadySaved = await hasMediaFileDB(id, additionalIds);
    if (alreadySaved) {
      const localUrl = await getMediaFileUrlDB(id, additionalIds);
      if (localUrl) return localUrl;
    }

    console.log(`[Video Storage] Caching remote video to IndexedDB for project ${id}... URL: ${url.slice(0, 100)}`);

    // Prepare fetch URL: route through proxy if it's an external web URL to avoid CORS
    let targetFetchUrl = url;
    if (
      (url.startsWith('http://') || url.startsWith('https://')) &&
      !url.includes('/api/proxy-video')
    ) {
      targetFetchUrl = resolveApiUrl(`/api/proxy-video?url=${encodeURIComponent(url)}`);
    }

    let response = await fetch(targetFetchUrl).catch(() => null);
    if (!response || !response.ok) {
      // Fallback: If proxied URL fails, try direct URL
      if (targetFetchUrl !== url) {
        console.warn(`[Video Storage] Proxy fetch failed, retrying direct URL...`);
        const directRes = await fetch(url).catch(() => null);
        if (directRes && directRes.ok) {
          const blob = await directRes.blob();
          if (blob.size > 500) {
            const storedUrl = await storeMediaFileDB(id, blob, additionalIds);
            console.log(`[Video Storage] Video saved to IndexedDB successfully (${(blob.size / 1024 / 1024).toFixed(2)} MB)!`);
            if (onProgress) onProgress(100);
            return storedUrl;
          }
        }
      }
      throw new Error(`Failed to fetch video stream: HTTP ${response?.status || 'Network error'}`);
    }

    const blob = await response.blob();
    if (blob.size < 500) {
      throw new Error('Downloaded video stream is too small or invalid.');
    }

    const storedUrl = await storeMediaFileDB(id, blob, additionalIds);
    console.log(`[Video Storage] Video saved to IndexedDB successfully (${(blob.size / 1024 / 1024).toFixed(2)} MB)!`);
    if (onProgress) onProgress(100);
    return storedUrl;
  } catch (err: any) {
    console.warn(`[Video Storage] Auto-cache video to IndexedDB failed (non-critical, streaming continues):`, err?.message || err);
    return null;
  }
}

/**
 * Store ONNX model binary buffer (ArrayBuffer) with OPFS (Origin Private File System) priority & IDB fallback
 */
export async function storeModelBufferDB(key: string, buffer: ArrayBuffer, name?: string): Promise<void> {
  const fileName = `model-${key}.onnx`;
  // Try OPFS storage first
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      console.log(`[OPFS Storage] Successfully stored ${fileName} (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    }
  } catch (e) {
    console.warn('[OPFS Storage] Could not write to OPFS, using IndexedDB fallback:', e);
  }

  // Dual store to IndexedDB as fallback
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      const req = store.put({
        id: `model-${key}`,
        buffer,
        name: name || key,
        updatedAt: Date.now(),
      });

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('storeModelBufferDB error:', e);
  }
}

/**
 * Validate that an ArrayBuffer is a legitimate ONNX model (starts with protobuf message tag 0x08)
 */
export function isValidOnnxBuffer(buffer: ArrayBuffer | null | undefined): boolean {
  if (!buffer || buffer.byteLength < 100000) return false;
  const uint8 = new Uint8Array(buffer, 0, Math.min(128, buffer.byteLength));
  // Protobuf ONNX models start with valid protobuf field tags (e.g. 0x08, 0x0a, 0x12, 0x1a, 0x22, 0x3a)
  // Reject ASCII text errors: HTML, JSON, Git-LFS, XML
  if (uint8[0] === 0x3c || uint8[0] === 0x7b) { // '<' or '{'
    return false;
  }
  // Reject .ort flatbuffers (starts with 0x14 or contains ORTM magic header)
  if (uint8[0] === 0x14 || (uint8.length >= 8 && uint8[4] === 0x4f && uint8[5] === 0x52 && uint8[6] === 0x54 && uint8[7] === 0x4d)) {
    return false;
  }
  // Reject UTF-8 replacement character corruption \xEF\xBF\xBD
  if (uint8.length >= 9 && uint8[6] === 0xef && uint8[7] === 0xbf && uint8[8] === 0xbd) {
    return false;
  }

  const headStr = new TextDecoder('utf-8').decode(uint8.subarray(0, 64)).toLowerCase();
  if (
    headStr.startsWith('<!doctype') ||
    headStr.startsWith('<html') ||
    headStr.startsWith('{"') ||
    headStr.includes('<html') ||
    headStr.includes('<!doc') ||
    headStr.includes('git-lfs') ||
    headStr.includes('version https://') ||
    headStr.includes('404 not found') ||
    headStr.includes('access denied')
  ) {
    return false;
  }
  return true;
}

/**
 * Retrieve ONNX model binary buffer (ArrayBuffer) from OPFS priority or IDB fallback
 */
export async function getModelBufferDB(key: string): Promise<ArrayBuffer | null> {
  const isDict = key.includes('dict') || key.includes('keys');
  const fileName = isDict ? `model-${key}.txt` : `model-${key}.onnx`;

  // 1. Try OPFS first for instant SSD-to-RAM load (<1s)
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      const buf = await file.arrayBuffer();

      if (isDict) {
        if (buf.byteLength > 10) return buf;
      } else if (isValidOnnxBuffer(buf)) {
        console.log(`[OPFS Storage] Loaded valid ${fileName} directly from OPFS (${(buf.byteLength / 1024 / 1024).toFixed(2)} MB)`);
        return buf;
      } else {
        console.warn(`[OPFS Storage] Corrupted/invalid ONNX file detected in OPFS for ${fileName} (size=${buf.byteLength}, firstByte=0x${new Uint8Array(buf)[0]?.toString(16)}). Purging corrupted file.`);
        await root.removeEntry(fileName).catch(() => {});
      }
    }
  } catch (_e) {
    // OPFS file not found or not supported, continue to IDB fallback
  }

  // 2. Fallback to IndexedDB
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      const req = store.get(`model-${key}`);

      req.onsuccess = () => {
        if (req.result && req.result.buffer) {
          const buf = req.result.buffer as ArrayBuffer;
          if (isDict) {
            if (buf.byteLength > 10) return resolve(buf);
          } else if (isValidOnnxBuffer(buf)) {
            return resolve(buf);
          } else {
            console.warn(`[IndexedDB Storage] Corrupted ONNX model found for model-${key}. Purging.`);
            store.delete(`model-${key}`);
          }
        }
        resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('getModelBufferDB error:', e);
    return null;
  }
}

/**
 * Delete ONNX model binary buffer from OPFS & IDB
 */
export async function deleteModelBufferDB(key: string): Promise<void> {
  const fileNames = [`model-${key}.onnx`, `model-${key}.txt`];
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      for (const fn of fileNames) {
        await root.removeEntry(fn).catch(() => {});
      }
    }
  } catch (_e) {}

  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      const req = store.delete(`model-${key}`);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('deleteModelBufferDB error:', e);
  }
}

