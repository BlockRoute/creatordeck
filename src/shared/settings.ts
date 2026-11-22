import { getStore, setStore } from './storage';
import { DEFAULT_SETTINGS, KEYS, type Settings } from './types';

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getStore<Partial<Settings>>(KEYS.settings, {})) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await setStore(KEYS.settings, next);
  return next;
}
