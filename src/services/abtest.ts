import { twoProportionTest, welchTest } from '../core/stats';
import { getStore, setStore, updateStore } from '../shared/storage';
import { KEYS, type Alert } from '../shared/types';
import { isoDay, videoDailyStats, type ReachData } from '../yt/analytics';
import { setThumbnail, updateVideoSnippet } from '../yt/api';
import { pushAlerts } from './channel';

export type VariantField = 'thumbnail' | 'title' | 'description' | 'tags';

export interface Variant {
  id: string;
  label: string;
  title?: string;
  description?: string;
  tags?: string[];
  thumbnailDataUrl?: string;
}

/** Inclusive start, exclusive end. A null end means the variant is still live. */
export interface Exposure {
  variantIndex: number;
  from: string;
  to: string | null;
}

export interface VariantStats {
  impressions: number;
  clicks: number;
  views: number;
  minutesWatched: number;
  /** One views figure per calendar day the variant was live and analytics had a row. */
  dailyViews: number[];
}

export interface VariantSnapshot {
  impressions: number;
  clicks: number;
  views: number;
  minutesWatched: number;
  days: number;
}

export interface VariantComparison {
  metric: 'ctr' | 'views';
  bestIndex: number;
  secondIndex: number;
  confidence: number;
  lift: number | null;
  significant: boolean;
  note: string;
}

export interface AbTest {
  id: string;
  videoId: string;
  videoTitle: string;
  field: VariantField;
  variants: Variant[];
  activeIndex: number;
  startedAt: number;
  status: 'running' | 'paused' | 'complete';
  minImpressions: number;
  confidenceTarget: number;
  rotationHours: number;
  lastRotationAt: number | null;
  exposures: Exposure[];
  winnerIndex: number | null;
  latest?: { at: number; stats: VariantSnapshot[]; comparison: VariantComparison | null };
}

export const MIN_IMPRESSIONS = 500;
export const CONFIDENCE = 0.95;

export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function eachDate(from: string, untilExclusive: string): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let guard = 0; cursor < untilExclusive && guard < 4000; guard += 1) {
    out.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return out;
}

export function exposureStats(
  exposures: Exposure[],
  variantCount: number,
  reach: Record<string, { impressions: number; ctr: number }> | undefined,
  daily: Record<string, { views: number; minutesWatched: number }>,
  today: string,
): VariantStats[] {
  const stats: VariantStats[] = Array.from({ length: variantCount }, () => ({
    impressions: 0,
    clicks: 0,
    views: 0,
    minutesWatched: 0,
    dailyViews: [],
  }));
  for (const exposure of exposures) {
    const bucket = stats[exposure.variantIndex];
    if (!bucket) continue;
    const end = exposure.to ?? shiftDate(today, 1);
    for (const date of eachDate(exposure.from, end)) {
      const day = reach?.[date];
      if (day) {
        bucket.impressions += day.impressions;
        bucket.clicks += day.impressions * day.ctr;
      }
      const views = daily[date];
      if (views) {
        bucket.views += views.views;
        bucket.minutesWatched += views.minutesWatched;
        bucket.dailyViews.push(views.views);
      }
    }
  }
  return stats;
}

function metricFor(field: VariantField): 'ctr' | 'views' {
  switch (field) {
    case 'thumbnail':
    case 'title':
      return 'ctr';
    case 'description':
    case 'tags':
      return 'views';
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/** Picks a winner only at the requested confidence, and only after each contender has enough evidence. */
export function compareVariants(field: VariantField, stats: VariantStats[], minImpressions: number, confidenceTarget: number): VariantComparison | null {
  if (stats.length < 2) return null;
  const metric = metricFor(field);
  const score = (s: VariantStats) => (metric === 'ctr' ? (s.impressions > 0 ? s.clicks / s.impressions : 0) : s.dailyViews.length ? s.views / s.dailyViews.length : 0);
  const ranked = stats.map((s, i) => ({ i, score: score(s) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || !second) return null;
  if (metric === 'ctr') {
    const weaker = stats[second.i];
    const stronger = stats[best.i];
    if (!weaker || !stronger) return null;
    const test = twoProportionTest(Math.round(weaker.clicks), Math.round(weaker.impressions), Math.round(stronger.clicks), Math.round(stronger.impressions));
    const enough = weaker.impressions >= minImpressions && stronger.impressions >= minImpressions;
    return {
      metric,
      bestIndex: best.i,
      secondIndex: second.i,
      confidence: test.confidence,
      lift: test.lift,
      significant: enough && test.confidence >= confidenceTarget && best.score !== second.score,
      note: enough ? '' : `Needs ${minImpressions.toLocaleString()} thumbnail impressions on each of the top two variants. Click-through data arrives from the Reporting API, usually starting about two days after the test begins.`,
    };
  }
  const weakerDays = stats[second.i]?.dailyViews ?? [];
  const strongerDays = stats[best.i]?.dailyViews ?? [];
  const test = welchTest(weakerDays, strongerDays);
  const enough = weakerDays.length >= 2 && strongerDays.length >= 2;
  return {
    metric,
    bestIndex: best.i,
    secondIndex: second.i,
    confidence: test.confidence,
    lift: test.lift,
    significant: enough && test.confidence >= confidenceTarget && best.score !== second.score,
    note: enough ? 'Compared on average daily views. Description and tag tests have no impression metric, so this is the fallback.' : 'Needs at least two days of view data on each of the top two variants.',
  };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta = '', data = ''] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function applyVariant(test: AbTest, index: number): Promise<void> {
  const variant = test.variants[index];
  if (!variant) throw new Error('That variant does not exist.');
  switch (test.field) {
    case 'title':
      if (!variant.title?.trim()) throw new Error(`${variant.label} has no title.`);
      await updateVideoSnippet(test.videoId, { title: variant.title });
      return;
    case 'description':
      if (variant.description == null) throw new Error(`${variant.label} has no description.`);
      await updateVideoSnippet(test.videoId, { description: variant.description });
      return;
    case 'tags':
      if (!variant.tags) throw new Error(`${variant.label} has no tags.`);
      await updateVideoSnippet(test.videoId, { tags: variant.tags });
      return;
    case 'thumbnail':
      if (!variant.thumbnailDataUrl) throw new Error(`${variant.label} has no thumbnail.`);
      await setThumbnail(test.videoId, dataUrlToBlob(variant.thumbnailDataUrl));
      return;
    default: {
      const exhaustive: never = test.field;
      throw new Error(exhaustive);
    }
  }
}

function closeExposure(test: AbTest, index: number, today: string): void {
  for (const exposure of test.exposures) {
    if (exposure.to == null && exposure.variantIndex !== index) exposure.to = today;
  }
  const open = test.exposures.find((e) => e.to == null && e.variantIndex === index);
  if (!open) test.exposures.push({ variantIndex: index, from: today, to: null });
}

export async function listTests(): Promise<AbTest[]> {
  return getStore<AbTest[]>(KEYS.abTests, []);
}

export async function saveTest(test: AbTest): Promise<void> {
  await updateStore<AbTest[]>(KEYS.abTests, [], (list) => [test, ...list.filter((t) => t.id !== test.id)]);
}

export async function deleteTest(id: string): Promise<void> {
  await updateStore<AbTest[]>(KEYS.abTests, [], (list) => list.filter((t) => t.id !== id));
}

/** Puts one variant live and records the exposure window. Does not declare a winner. */
export async function activateVariant(testId: string, index: number, now = Date.now()): Promise<void> {
  const tests = await listTests();
  const test = tests.find((t) => t.id === testId);
  if (!test) throw new Error('Test not found.');
  if (test.status === 'complete') throw new Error('This test is already finished.');
  await applyVariant(test, index);
  closeExposure(test, index, isoDay(new Date(now)));
  test.activeIndex = index;
  test.lastRotationAt = now;
  test.status = 'running';
  await setStore(KEYS.abTests, tests);
}

/** Rotates every running test whose variant has been live for its full window. A declared winner stops the rotation. */
export async function rotateDueTests(now = Date.now()): Promise<string[]> {
  const tests = await listTests();
  const notes: string[] = [];
  for (const test of tests) {
    if (test.status !== 'running' || test.winnerIndex != null || test.variants.length < 2) continue;
    const due = test.lastRotationAt == null || now - test.lastRotationAt >= test.rotationHours * 3_600_000;
    if (!due) continue;
    const next = test.lastRotationAt == null ? test.activeIndex : (test.activeIndex + 1) % test.variants.length;
    try {
      await applyVariant(test, next);
      closeExposure(test, next, isoDay(new Date(now)));
      test.activeIndex = next;
      test.lastRotationAt = now;
    } catch (error) {
      notes.push(`${test.videoTitle}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await setStore(KEYS.abTests, tests);
  return notes;
}

/** Pulls analytics for each live test and records a winner once the test clears the bar. */
export async function evaluateAbTests(now = Date.now()): Promise<void> {
  const tests = await listTests();
  const reach = await getStore<ReachData>(KEYS.reachData, {});
  const today = isoDay(new Date(now));
  const alerts: Alert[] = [];
  for (const test of tests) {
    if (test.status === 'paused' || test.winnerIndex != null || !test.exposures.length) continue;
    const start = [...test.exposures.map((e) => e.from)].sort()[0] ?? today;
    const daily = await videoDailyStats(test.videoId, start, today).catch(() => ({}));
    const stats = exposureStats(test.exposures, test.variants.length, reach[test.videoId], daily, today);
    const comparison = compareVariants(test.field, stats, test.minImpressions, test.confidenceTarget);
    test.latest = {
      at: now,
      stats: stats.map((s) => ({ impressions: s.impressions, clicks: s.clicks, views: s.views, minutesWatched: s.minutesWatched, days: s.dailyViews.length })),
      comparison,
    };
    if (comparison?.significant) {
      test.winnerIndex = comparison.bestIndex;
      const winner = test.variants[comparison.bestIndex];
      alerts.push({
        id: `ab-${test.id}`,
        kind: 'abtest',
        title: `A/B winner ready: ${test.videoTitle}`,
        body: `${winner?.label ?? 'A variant'} is ahead with ${Math.round(comparison.confidence * 100)}% confidence.`,
        at: now,
      });
    }
  }
  await setStore(KEYS.abTests, tests);
  await pushAlerts(alerts);
}

export async function applyWinner(testId: string, now = Date.now()): Promise<void> {
  const tests = await listTests();
  const test = tests.find((t) => t.id === testId);
  if (!test || test.winnerIndex == null) throw new Error('This test does not have a winner yet.');
  await applyVariant(test, test.winnerIndex);
  closeExposure(test, test.winnerIndex, isoDay(new Date(now)));
  test.activeIndex = test.winnerIndex;
  test.lastRotationAt = now;
  test.status = 'complete';
  await setStore(KEYS.abTests, tests);
}
