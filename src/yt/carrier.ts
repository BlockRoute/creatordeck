const START: Record<string, string> = {
  youtube: 'https://www.youtube.com/robots.txt',
  studio: 'https://studio.youtube.com/',
};

const tabs = new Map<string, number>();

function laneFor(url: string): keyof typeof START | null {
  const host = new URL(url).hostname;
  if (host === 'studio.youtube.com') return 'studio';
  if (host.endsWith('youtube.com')) return 'youtube';
  return null;
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('YouTube took too long to open.'));
    }, 25_000);
    const onUpdated = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function laneTab(lane: keyof typeof START): Promise<number> {
  const known = tabs.get(lane);
  if (known != null) {
    try {
      const tab = await chrome.tabs.get(known);
      if (tab.status === 'complete') return known;
    } catch {
      tabs.delete(lane);
    }
  }
  const created = await chrome.tabs.create({ url: START[lane], active: false });
  if (created.id == null) throw new Error('Could not open YouTube.');
  if (created.status !== 'complete') await waitForLoad(created.id);
  tabs.set(lane, created.id);
  return created.id;
}

/**
 * YouTube rejects InnerTube calls whose Origin is a chrome-extension URL.
 * Running the fetch inside a youtube.com document keeps the origin YouTube expects.
 */
export async function carrierFetch(url: string, method: string, headers: [string, string][], body: string | null, credentials: RequestCredentials): Promise<{ status: number; text: string }> {
  const lane = laneFor(url);
  if (!lane) {
    const response = await fetch(url, { method, headers: Object.fromEntries(headers), body: body ?? undefined, credentials });
    return { status: response.status, text: await response.text() };
  }
  const tabId = await laneTab(lane);
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (target: string, verb: string, headerList: [string, string][], payload: string | null, creds: RequestCredentials) => {
      const response = await fetch(target, { method: verb, credentials: creds, headers: Object.fromEntries(headerList), body: payload ?? undefined });
      return { status: response.status, text: await response.text() };
    },
    args: [url, method, headers, body, credentials],
  });
  const result = injected[0]?.result;
  if (!result) throw new Error('YouTube did not answer.');
  return result;
}
