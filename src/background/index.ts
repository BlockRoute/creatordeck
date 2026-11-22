import { complete } from '../services/ai';
import { tick } from '../services/jobs';
import { carrierFetch } from '../yt/carrier';

const ALARM = 'creatordeck-tick';

function openDashboard(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

function openPanel(tabId: number | undefined, path: string): void {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  void chrome.storage.session.set({ pendingRoute: safe }).then(() => {
    if (tabId == null) {
      openDashboard();
      return;
    }
    void chrome.sidePanel.open({ tabId }).catch(() => openDashboard());
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(ALARM, { periodInMinutes: 30 });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void tick();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(ALARM, { periodInMinutes: 30 });
  void tick();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick();
});

chrome.action.onClicked.addListener((tab) => {
  openPanel(tab.id, '/');
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'open' && 'path' in message && typeof message.path === 'string') {
    openPanel(sender.tab?.id, message.path);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'llm-complete' && 'prompt' in message && typeof message.prompt === 'string') {
    const image = 'imageDataUrl' in message && typeof message.imageDataUrl === 'string' ? message.imageDataUrl : undefined;
    void complete(message.prompt, image)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === 'yt-fetch' && 'url' in message && typeof message.url === 'string') {
    const method = 'method' in message && typeof message.method === 'string' ? message.method : 'GET';
    const headers = 'headers' in message && Array.isArray(message.headers) ? (message.headers as [string, string][]) : [];
    const body = 'body' in message && typeof message.body === 'string' ? message.body : null;
    const credentials = 'credentials' in message && typeof message.credentials === 'string' ? (message.credentials as RequestCredentials) : 'omit';
    void carrierFetch(message.url, method, headers, body, credentials)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
});
