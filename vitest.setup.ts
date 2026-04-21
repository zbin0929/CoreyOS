import '@testing-library/jest-dom/vitest';

// jsdom 29 ships without Storage by default; provide an in-memory shim so
// zustand/persist doesn't blow up when hydrating.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}
Object.defineProperty(window, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});
Object.defineProperty(window, 'sessionStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

// Tauri IPC shim — prevents `@tauri-apps/api` from throwing when called
// inside jsdom tests. Individual tests should mock invoke() explicitly.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
