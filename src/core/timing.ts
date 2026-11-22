import type { VideoMeta } from '../shared/types';

export interface PublishBucket {
  weekday: number;
  hour: number;
  samples: number;
  medianViewsPerDay: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? 'Unknown';
}

/**
 * Groups videos by the weekday and hour they were published (viewer-local is unknown,
 * so this uses the timestamps YouTube stored, which are UTC) and ranks buckets by
 * median views per day of age. Buckets with a single video are kept but sorted last
 * among equal rates.
 */
export function bestPublishBuckets(videos: Pick<VideoMeta, 'publishedAt' | 'viewCount'>[], now = Date.now()): PublishBucket[] {
  const groups = new Map<string, number[]>();
  for (const video of videos) {
    const published = Date.parse(video.publishedAt);
    if (Number.isNaN(published)) continue;
    const ageDays = Math.max(1, (now - published) / 86_400_000);
    const date = new Date(published);
    const key = `${date.getUTCDay()}-${date.getUTCHours()}`;
    const list = groups.get(key) ?? [];
    list.push(video.viewCount / ageDays);
    groups.set(key, list);
  }
  const buckets: PublishBucket[] = [];
  for (const [key, rates] of groups) {
    const [weekday, hour] = key.split('-').map(Number);
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    buckets.push({ weekday: weekday ?? 0, hour: hour ?? 0, samples: rates.length, medianViewsPerDay: median });
  }
  return buckets.sort((a, b) => b.medianViewsPerDay - a.medianViewsPerDay || b.samples - a.samples);
}
