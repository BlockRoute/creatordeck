type Listener = (value: unknown) => void;

const memory = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function getStore<T>(key: string, fallback: T): Promise<T> {
  if (!hasChromeStorage()) return memory.has(key) ? (memory.get(key) as T) : fallback;
  const out = await chrome.storage.local.get(key);
  return key in out ? (out[key] as T) : fallback;
}

export async function setStore<T>(key: string, value: T): Promise<void> {
  if (!hasChromeStorage()) {
    memory.set(key, value);
    listeners.get(key)?.forEach((fn) => fn(value));
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

export async function removeStore(key: string): Promise<void> {
  if (!hasChromeStorage()) {
    memory.delete(key);
    return;
  }
  await chrome.storage.local.remove(key);
}

let chain: Promise<unknown> = Promise.resolve();

/** Read-modify-write, serialised within this context so concurrent updates do not clobber each other. */
export function updateStore<T>(key: string, fallback: T, fn: (current: T) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const next = await fn(await getStore(key, fallback));
    await setStore(key, next);
    return next;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function onStoreChange<T>(key: string, fn: (value: T | undefined) => void): () => void {
  if (!hasChromeStorage()) {
    const set = listeners.get(key) ?? new Set<Listener>();
    set.add(fn as Listener);
    listeners.set(key, set);
    return () => set.delete(fn as Listener);
  }
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && key in changes) fn(changes[key]?.newValue as T | undefined);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function resetMemoryStore(): void {
  memory.clear();
}
