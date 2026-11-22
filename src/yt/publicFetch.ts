import { carrierFetch } from './carrier';

function inServiceWorker(): boolean {
  return typeof document === 'undefined' && typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function headerEntries(headers: HeadersInit | undefined): [string, string][] {
  if (!headers) return [];
  return [...new Headers(headers).entries()];
}

/**
 * Fetches a URL, routing YouTube and Studio calls through a page on that site so the
 * request origin is accepted. Everywhere else, including Node tests, this is a normal fetch.
 */
export async function publicFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const host = new URL(url).hostname;
  const direct = !host.endsWith('youtube.com') || typeof chrome === 'undefined' || !chrome.runtime?.id;
  if (direct) return fetch(url, init);
  const method = init.method ?? 'GET';
  const headers = headerEntries(init.headers);
  const body = typeof init.body === 'string' ? init.body : null;
  const credentials = init.credentials ?? 'same-origin';
  const result = inServiceWorker()
    ? await carrierFetch(url, method, headers, body, credentials)
    : await askBackground(url, method, headers, body, credentials);
  return new Response(result.text, { status: result.status });
}

async function askBackground(url: string, method: string, headers: [string, string][], body: string | null, credentials: RequestCredentials): Promise<{ status: number; text: string }> {
  const result = (await chrome.runtime.sendMessage({ type: 'yt-fetch', url, method, headers, body, credentials })) as
    | { ok: true; status: number; text: string }
    | { ok: false; error: string }
    | undefined;
  if (!result || !result.ok) throw new Error(result && 'error' in result ? result.error : 'YouTube request failed.');
  return result;
}
