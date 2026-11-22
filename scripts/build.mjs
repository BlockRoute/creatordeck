import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// The public key pins the extension ID (fmpimdpeplnjgloblobhjolpkghbnfih) so the
// OAuth redirect URI stays the same on every machine that loads the unpacked build.
const PUBLIC_KEY = readFileSync(resolve(root, 'scripts/extension-key.txt'), 'utf8').trim();

const define = { 'process.env.NODE_ENV': '"production"' };

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  root: resolve(root, 'src/ui'),
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'chrome120',
    rollupOptions: { input: resolve(root, 'src/ui/dashboard.html') },
  },
});

async function single(entry, fileName, format) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    define,
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: 'chrome120',
      lib: { entry: resolve(root, entry), formats: [format], name: 'CreatorDeck', fileName: () => fileName },
    },
  });
}

await single('src/background/index.ts', 'background.js', 'es');
await single('src/content/index.ts', 'content.js', 'iife');

cpSync(resolve(root, 'public'), dist, { recursive: true });

const manifest = {
  manifest_version: 3,
  name: 'CreatorDeck',
  short_name: 'CreatorDeck',
  version: pkg.version,
  description: pkg.description,
  key: PUBLIC_KEY,
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_title: 'Open CreatorDeck' },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'identity', 'cookies', 'sidePanel', 'scripting'],
  side_panel: { default_path: 'dashboard.html' },
  host_permissions: [
    'https://*.youtube.com/*',
    'https://*.ytimg.com/*',
    'https://*.ggpht.com/*',
    'https://*.googleusercontent.com/*',
    'https://suggestqueries.google.com/*',
    'https://trends.google.com/*',
    'https://www.googleapis.com/*',
    'https://youtubeanalytics.googleapis.com/*',
    'https://youtubereporting.googleapis.com/*',
    'https://oauth2.googleapis.com/*',
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://api.x.ai/*',
    'https://openrouter.ai/*',
    'https://generativelanguage.googleapis.com/*',
  ],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  content_scripts: [{ matches: ['https://*.youtube.com/*'], js: ['content.js'], run_at: 'document_idle' }],
  web_accessible_resources: [
    { resources: ['dashboard.html', 'assets/*', 'icons/*'], matches: ['https://*.youtube.com/*'] },
  ],
};

writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Built CreatorDeck ${pkg.version} -> ${dist}`);
