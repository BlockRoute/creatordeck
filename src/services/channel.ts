import { median } from '../core/text';
import { getStore, setStore, updateStore } from '../shared/storage';
import { KEYS, type Alert, type ChannelSnapshot, type TrackedChannel } from '../shared/types';
import { fetchChannelsById } from '../yt/api';
import { isoDay } from '../yt/analytics';
import { SEARCH_FILTER_THIS_WEEK_VIDEOS, fetchChannel, fetchChannelVideos, resolveChannelId, searchVideos, type ChannelPublic, type ChannelVideo } from '../yt/innertube';
import { isConnected } from '../yt/oauth';
import { fetchFeed, type FeedEntry } from '../yt/rss';

export interface ChannelInsight {
  channel: ChannelPublic;
  /** Exact lifetime views; only known through the Data API or stored snapshots. */
  totalViews: number | null;
  exactSubscribers: number | null;
  videos: ChannelVideo[];
  feed: FeedEntry[];
  medianViews: number;
  averageViews: number;
  uploadsLast30Days: number;
  /** Average days between the most recent uploads. */
  uploadCadenceDays: number | null;
  /** Views gathered so far by videos published in the last 30 days; a floor for monthly views. */
  recentVideoViews: number;
  /** Channel-wide views over the last 30 days from stored snapshots, when enough history exists. */
  monthlyViewsFromSnapshots: number | null;
  monthlySubscribersFromSnapshots: number | null;
  snapshots: ChannelSnapshot[];
}

type SnapshotStore = Record<string, ChannelSnapshot[]>;

function deltaOver(snapshots: ChannelSnapshot[], days: number, field: 'views' | 'subscribers'): number | null {
  const withValue = snapshots.filter((s) => s[field] !== null);
  const last = withValue[withValue.length - 1];
  if (!last) return null;
  const cutoff = Date.parse(last.date) - days * 86400_000;
  const first = withValue.find((s) => Date.parse(s.date) >= cutoff);
  if (!first || first === last) return null;
  const span = (Date.parse(last.date) - Date.parse(first.date)) / 86400_000;
  if (span < 3) return null;
  // Scale a shorter window up to the requested number of days.
  return Math.round((((last[field] as number) - (first[field] as number)) / span) * days);
}

export async function recordSnapshot(channelId: string, snapshot: Omit<ChannelSnapshot, 'date'>): Promise<ChannelSnapshot[]> {
  const date = isoDay(new Date());
  const all = await updateStore<SnapshotStore>(KEYS.snapshots, {}, (store) => {
    const list = (store[channelId] ?? []).filter((s) => s.date !== date);
    return { ...store, [channelId]: [...list, { date, ...snapshot }].slice(-400) };
  });
  return all[channelId] ?? [];
}

export async function loadChannelInsight(input: string): Promise<ChannelInsight> {
  const channelId = await resolveChannelId(input);
  if (!channelId) throw new Error('That channel could not be found. Paste a channel URL, an @handle or a UC... ID.');
  const [channel, videos, feed, connected] = await Promise.all([
    fetchChannel(channelId),
    fetchChannelVideos(channelId, 60).catch(() => [] as ChannelVideo[]),
    fetchFeed(channelId).catch(() => null),
    isConnected(),
  ]);
  if (!channel) throw new Error('YouTube returned no data for that channel.');
  const exact = connected ? ((await fetchChannelsById([channelId]).catch(() => []))[0] ?? null) : null;

  const snapshots = await recordSnapshot(channelId, {
    subscribers: exact?.subscriberCount ?? channel.subscriberCount,
    views: exact?.viewCount ?? null,
    videos: exact?.videoCount ?? channel.videoCount,
  });

  const entries = feed?.entries ?? [];
  const now = Date.now();
  const recent = entries.filter((e) => now - Date.parse(e.published) <= 30 * 86400_000);
  const dates = entries.map((e) => Date.parse(e.published)).sort((a, b) => b - a);
  const gaps = dates.slice(0, -1).map((d, i) => (d - (dates[i + 1] as number)) / 86400_000);
  const sample = videos.slice(0, 30).map((v) => v.viewCount).filter((v): v is number => v !== null);
  return {
    channel,
    totalViews: exact?.viewCount ?? null,
    exactSubscribers: exact?.subscriberCount ?? null,
    videos,
    feed: entries,
    medianViews: median(sample),
    averageViews: sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 0,
    uploadsLast30Days: recent.length,
    uploadCadenceDays: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    recentVideoViews: recent.reduce((sum, e) => sum + (e.views ?? 0), 0),
    monthlyViewsFromSnapshots: deltaOver(snapshots, 30, 'views'),
    monthlySubscribersFromSnapshots: deltaOver(snapshots, 30, 'subscribers'),
    snapshots,
  };
}

export async function getTracked(): Promise<TrackedChannel[]> {
  return getStore<TrackedChannel[]>(KEYS.tracked, []);
}

export async function trackChannel(input: string): Promise<TrackedChannel> {
  const id = await resolveChannelId(input);
  const channel = id ? await fetchChannel(id) : null;
  if (!channel) throw new Error('That channel could not be found.');
  const entry: TrackedChannel = { id: channel.id, title: channel.title, handle: channel.handle ?? undefined, thumbnail: channel.avatar ?? undefined, addedAt: Date.now() };
  await updateStore<TrackedChannel[]>(KEYS.tracked, [], (list) => (list.some((c) => c.id === entry.id) ? list : [...list, entry]));
  // Mark the current uploads as seen so only future ones raise alerts.
  const feed = await fetchFeed(channel.id).catch(() => null);
  await updateStore<Record<string, string[]>>(KEYS.seenUploads, {}, (seen) => ({ ...seen, [channel.id]: feed?.entries.map((e) => e.videoId) ?? [] }));
  return entry;
}

export async function untrackChannel(id: string): Promise<void> {
  await updateStore<TrackedChannel[]>(KEYS.tracked, [], (list) => list.filter((c) => c.id !== id));
}

export async function pushAlerts(alerts: Alert[]): Promise<void> {
  if (!alerts.length) return;
  await updateStore<Alert[]>(KEYS.alerts, [], (list) => [...alerts, ...list].slice(0, 300));
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  for (const alert of alerts.slice(0, 5)) {
    chrome.notifications.create(alert.id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: alert.title, message: alert.body });
  }
}

/** Polls each tracked channel's feed and raises an alert for every upload not seen before. */
export async function checkCompetitorUploads(): Promise<Alert[]> {
  const tracked = await getTracked();
  const seen = await getStore<Record<string, string[]>>(KEYS.seenUploads, {});
  const alerts: Alert[] = [];
  for (const channel of tracked) {
    const feed = await fetchFeed(channel.id).catch(() => null);
    if (!feed) continue;
    const known = new Set(seen[channel.id] ?? []);
    for (const entry of feed.entries) {
      if (known.has(entry.videoId)) continue;
      alerts.push({
        id: `upload-${entry.videoId}`,
        kind: 'upload',
        title: `${channel.title} uploaded a video`,
        body: entry.title,
        url: `https://www.youtube.com/watch?v=${entry.videoId}`,
        at: Date.parse(entry.published) || Date.now(),
      });
    }
    seen[channel.id] = [...new Set([...feed.entries.map((e) => e.videoId), ...known])].slice(0, 200);
  }
  await setStore(KEYS.seenUploads, seen);
  await pushAlerts(alerts);
  return alerts;
}

/** Searches this week's videos for each brand term and alerts on ones not seen before. */
export async function checkBrandAlerts(ownChannelId?: string): Promise<Alert[]> {
  const terms = await getStore<string[]>(KEYS.brandTerms, []);
  const seen = await getStore<Record<string, string[]>>(KEYS.seenUploads, {});
  const alerts: Alert[] = [];
  for (const term of terms) {
    const key = `brand:${term.toLowerCase()}`;
    const page = await searchVideos(term, { limit: 20, params: SEARCH_FILTER_THIS_WEEK_VIDEOS }).catch(() => null);
    if (!page) continue;
    const firstRun = !(key in seen);
    const known = new Set(seen[key] ?? []);
    for (const video of page.videos) {
      if (known.has(video.videoId) || video.channelId === ownChannelId) continue;
      if (!firstRun) {
        alerts.push({
          id: `brand-${video.videoId}`,
          kind: 'brand',
          title: `New video mentions "${term}"`,
          body: `${video.channelName}: ${video.title}`,
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          at: Date.now(),
        });
      }
    }
    seen[key] = [...new Set([...page.videos.map((v) => v.videoId), ...known])].slice(0, 300);
  }
  await setStore(KEYS.seenUploads, seen);
  await pushAlerts(alerts);
  return alerts;
}

export function nextMilestone(value: number): number {
  if (value < 100) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 7.5, 10]) if (step * magnitude > value) return step * magnitude;
  return 10 * magnitude;
}

export function valuation(monthlyViews: number, rpmLow: number, rpmHigh: number): { monthlyLow: number; monthlyHigh: number; valueLow: number; valueHigh: number } {
  const monthlyLow = (monthlyViews / 1000) * rpmLow;
  const monthlyHigh = (monthlyViews / 1000) * rpmHigh;
  // Content businesses commonly change hands for two to three years of earnings.
  return { monthlyLow, monthlyHigh, valueLow: monthlyLow * 24, valueHigh: monthlyHigh * 36 };
}
