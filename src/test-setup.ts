// src/test-setup.ts
import "@testing-library/jest-dom/vitest";

/**
 * In-memory Web Storage for jsdom that behaves like a browser's `localStorage`:
 * - the Storage API (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), with values stored as strings;
 * - stored keys are own enumerable properties, so `Object.keys(localStorage)` (used by `clearSavedSetups()`),
 *   `for…in`, `"key" in localStorage` and `localStorage.key(i)` all see the same keys, in insertion order;
 * - the API methods are not enumerable, exactly like on `Storage.prototype`.
 */
export function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  const api: Storage = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      const value = store.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };

  const isApi = (property: string | symbol) => typeof property === "symbol" || property in api;

  return new Proxy(api, {
    get(target, property, receiver) {
      if (isApi(property)) return Reflect.get(target, property, receiver);
      return store.get(property as string);
    },
    set(target, property, value) {
      if (isApi(property)) return false;
      store.set(property as string, String(value));
      return true;
    },
    has(target, property) {
      return isApi(property) || store.has(property as string);
    },
    deleteProperty(target, property) {
      if (isApi(property)) return false;
      store.delete(property as string);
      return true;
    },
    ownKeys() {
      return [...store.keys()];
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property !== "string" || !store.has(property)) return undefined;
      return { value: store.get(property), writable: true, enumerable: true, configurable: true };
    },
  });
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: createMemoryStorage(),
  });
}
