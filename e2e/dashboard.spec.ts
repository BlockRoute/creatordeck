import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXTENSION_ID = 'fmpimdpeplnjgloblobhjolpkghbnfih';
const dist = path.resolve('dist');

test('loads the extension and exercises keyword research and SEO scoring', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'creatordeck-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extensionId = new URL(worker.url()).host;
    expect(extensionId).toBe(EXTENSION_ID);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#/seo`);
    await expect(page.getByRole('heading', { name: 'SEO Studio' })).toBeVisible();
    await page.getByLabel('Target keyword').fill('sourdough starter');
    await page.getByLabel('Title').fill('Sourdough starter for beginners');
    await page.getByLabel('Description').fill('Sourdough starter, step by step. Mix flour and water and wait.\nhttps://example.com\n#sourdough');
    const score = page.locator('.gauge .num').first();
    await expect(score).not.toHaveText('0');

    await page.goto(`chrome-extension://${EXTENSION_ID}/dashboard.html#/keywords?q=${encodeURIComponent('how to boil an egg')}`);
    await expect(page.getByRole('heading', { name: 'Keyword Explorer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top results' })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.gauge .num').first()).toBeVisible();
    const demand = await page.locator('.gauge .num').first().innerText();
    expect(Number(demand)).toBeGreaterThan(0);

    await page.goto(`chrome-extension://${EXTENSION_ID}/dashboard.html#/tags`);
    await expect(page.getByRole('heading', { name: 'Tag Tools' })).toBeVisible();
    await page.goto(`chrome-extension://${EXTENSION_ID}/dashboard.html#/settings`);
    await expect(page.getByText(EXTENSION_ID)).toBeVisible();

    const openRoutes = [
      ['/', 'CreatorDeck'],
      ['/video', 'Videolytics'],
      ['/channel', 'Channelytics'],
      ['/competitors', 'Competitors'],
      ['/audit', 'Channel Audit'],
      ['/analytics/timing', 'Best time to publish'],
      ['/thumbnails', 'Thumbnails'],
      ['/chapters', 'Chapter Editor'],
      ['/comments', 'Comments'],
      ['/studio', 'Cards, end screens and Shorts'],
      ['/ai', 'AI tools'],
      ['/rank', 'Search ranks'],
    ] as const;
    for (const [path, heading] of openRoutes) {
      await page.goto(`chrome-extension://${EXTENSION_ID}/dashboard.html#${path}`);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
    for (const path of ['/bulk', '/backup', '/overlays', '/playlists', '/ab', '/schedule', '/analytics/health', '/analytics/retention']) {
      await page.goto(`chrome-extension://${EXTENSION_ID}/dashboard.html#${path}`);
      await expect(page.getByText('Connect your channel to use this tool')).toBeVisible();
    }
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
});
