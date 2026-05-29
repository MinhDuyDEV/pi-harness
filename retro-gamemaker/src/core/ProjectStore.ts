/**
 * ProjectStore — IndexedDB persistence for projects.
 *
 * Stores project JSON blobs keyed by project id.
 * Provides list, save, load, and delete operations.
 */

import { ProjectJSON } from './Project';

const DB_NAME = 'retro-gamemaker';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('modifiedAt', 'meta.modifiedAt', { unique: false });
        store.createIndex('name', 'meta.name', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface ProjectSummary {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  modifiedAt: string;
  formatVersion: number;
  /** First sprite as a small data-URL thumbnail (generated on save) */
  thumbnail?: string;
  /** Palette count for display */
  paletteSize: number;
  /** Tilemap dimensions */
  mapWidth: number;
  mapHeight: number;
}

export class ProjectStore {
  /**
   * Save a project JSON blob to IndexedDB.
   */
  static async save(project: ProjectJSON): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load a project by its id.
   */
  static async load(id: string): Promise<ProjectJSON> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) {
          reject(new Error(`Project not found: ${id}`));
        } else {
          resolve(request.result as ProjectJSON);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * List all projects (metadata only, no full data).
   */
  static async list(): Promise<ProjectSummary[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = (request.result as ProjectJSON[]).map((p) => ({
          id: p.meta.id,
          name: p.meta.name,
          author: p.meta.author ?? '',
          createdAt: p.meta.createdAt,
          modifiedAt: p.meta.modifiedAt,
          formatVersion: p.formatVersion,
          paletteSize: p.palette?.length ?? 0,
          mapWidth: p.tilemap?.width ?? 0,
          mapHeight: p.tilemap?.height ?? 0,
        }));
        // Sort by modifiedAt descending (most recent first)
        results.sort(
          (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
        );
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a project by id.
   */
  static async delete(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Check if IndexedDB is available in this browser.
   */
  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }
}
