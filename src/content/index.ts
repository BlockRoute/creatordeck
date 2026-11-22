const HOST_ID = 'creatordeck-root';

function videoPath(): string {
  const id = new URLSearchParams(location.search).get('v');
  if (id && /^[\w-]{11}$/.test(id)) return `/video/${id}`;
  if (location.hostname.startsWith('studio.youtube')) return '/seo';
  return '/';
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = 'button{font: 600 13px/1.2 system-ui, sans-serif; color: #fff; background: #5b4dff; border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.28);} button:hover{filter: brightness(1.08);}';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'CreatorDeck';
  button.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'open', path: videoPath() });
  });
  shadow.append(style, button);
  document.documentElement.append(host);
}

function remove(): void {
  document.getElementById(HOST_ID)?.remove();
}

async function sync(): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings as { showLauncher?: boolean } | undefined;
  if (settings?.showLauncher === false) remove();
  else mount();
}

void sync();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) void sync();
});
