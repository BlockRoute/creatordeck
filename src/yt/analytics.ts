import { parseCsv } from '../core/csv';
import { getSettings } from '../shared/settings';
import { getStore, setStore } from '../shared/storage';
import { KEYS } from '../shared/types';
import { ApiError, authedFetch } from './api';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export type AnalyticsRow = Record<string, string | number>;

export function rowsToObjects(json: Json): AnalyticsRow[] {
  const headers: string[] = (json?.columnHeaders ?? []).map((h: Json) => h.name);
  return (json?.rows ?? []).map((row: (string | number)[]) => Object.fromEntries(headers.map((name, i) => [name, row[i] as string | number])));
}

async function getJson(url: string, init?: RequestInit): Promise<Json> {
  const response = await authedFetch(url, init);
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(json?.error?.message ?? `Request failed with status ${response.status}`, response.status, json?.error?.status ?? 'unknown');
  return json;
}

/** Runs a YouTube Analytics API report for the connected channel. */
export async function analyticsQuery(q: AnalyticsQuery): Promise<AnalyticsRow[]> {
  const settings = await getSettings();
  const base = settings.dev?.analyticsBase ?? 'https://youtubeanalytics.googleapis.com/v2';
  const params = new URLSearchParams({ ids: 'channel==MINE', startDate: q.startDate, endDate: q.endDate, metrics: q.metrics });
  if (q.dimensions) params.set('dimensions', q.dimensions);
  if (q.filters) params.set('filters', q.filters);
  if (q.sort) params.set('sort', q.sort);
  if (q.maxResults) params.set('maxResults', String(q.maxResults));
  return rowsToObjects(await getJson(`${base}/reports?${params}`));
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number, from: Date = new Date()): string {
  return isoDay(new Date(from.getTime() - days * 86400_000));
}

const REACH_REPORT = 'channel_reach_basic_a1';

export interface ReachDay {
  impressions: number;
  /** Click-through rate as a fraction, 0..1. */
  ctr: number;
}

/** videoId -> ISO date -> reach for that day. */
export type ReachData = Record<string, Record<string, ReachDay>>;

export interface ReportingState {
  jobId: string | null;
  jobCreatedAt: number | null;
  processedReportIds: string[];
  lastSync: number | null;
  lastError: string | null;
}

const EMPTY_REPORTING: ReportingState = { jobId: null, jobCreatedAt: null, processedReportIds: [], lastSync: null, lastError: null };

async function reportingBase(): Promise<string> {
  return (await getSettings()).dev?.reportingBase ?? 'https://youtubereporting.googleapis.com/v1';
}

/** Finds or creates the Reporting API job that produces daily impressions and click-through rate per video. */
export async function ensureReachJob(): Promise<ReportingState> {
  const state = await getStore<ReportingState>(KEYS.reporting, EMPTY_REPORTING);
  if (state.jobId) return state;
  const base = await reportingBase();
  const existing = ((await getJson(`${base}/jobs`)).jobs ?? []).find((j: Json) => j.reportTypeId === REACH_REPORT);
  const job = existing ?? (await getJson(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportTypeId: REACH_REPORT, name: 'CreatorDeck reach' }) }));
  const next = { ...state, jobId: job.id as string, jobCreatedAt: Date.parse(job.createTime ?? '') || Date.now() };
  await setStore(KEYS.reporting, next);
  return next;
}

/**
 * Converts one reach report into per-video days. The click-through column is documented as a
 * percentage but some reports carry fractions; a report with any value above 1 is read as
 * percentages, otherwise as fractions.
 */
export function parseReachReport(csv: string): { videoId: string; date: string; reach: ReachDay }[] {
  const rows = parseCsv(csv);
  const percent = rows.some((r) => Number(r.video_thumbnail_impressions_ctr) > 1);
  return rows
    .filter((r) => r.video_id && r.date)
    .map((r) => {
      const d = r.date as string;
      const ctr = Number(r.video_thumbnail_impressions_ctr) || 0;
      return {
        videoId: r.video_id as string,
        date: d.includes('-') ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        reach: { impressions: Number(r.video_thumbnail_impressions) || 0, ctr: percent ? ctr / 100 : ctr },
      };
    });
}

/** Downloads any new reach reports and merges them into local storage. Returns the number of new reports. */
export async function syncReachReports(): Promise<number> {
  let state = await ensureReachJob();
  const base = await reportingBase();
  let processed = 0;
  try {
    const data = await getStore<ReachData>(KEYS.reachData, {});
    let pageToken: string | undefined;
    do {
      const page: Json = await getJson(`${base}/jobs/${state.jobId}/reports${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const report of page.reports ?? []) {
        if (state.processedReportIds.includes(report.id)) continue;
        const response = await authedFetch(report.downloadUrl);
        if (!response.ok) throw new ApiError(`Report download failed with status ${response.status}`, response.status, 'reportDownload');
        for (const row of parseReachReport(await response.text())) {
          data[row.videoId] = { ...(data[row.videoId] ?? {}), [row.date]: row.reach };
        }
        state = { ...state, processedReportIds: [...state.processedReportIds, report.id as string] };
        processed += 1;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    await setStore(KEYS.reachData, data);
    state = { ...state, lastSync: Date.now(), lastError: null };
  } catch (error) {
    state = { ...state, lastError: error instanceof Error ? error.message : String(error) };
  }
  await setStore(KEYS.reporting, state);
  return processed;
}

/** Daily views and watch time for one video, keyed by ISO date. */
export async function videoDailyStats(videoId: string, startDate: string, endDate: string): Promise<Record<string, { views: number; minutesWatched: number; averageViewDuration: number }>> {
  const rows = await analyticsQuery({
    startDate,
    endDate,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration',
    dimensions: 'day',
    filters: `video==${videoId}`,
    sort: 'day',
  });
  return Object.fromEntries(
    rows.map((r) => [String(r.day), { views: Number(r.views), minutesWatched: Number(r.estimatedMinutesWatched), averageViewDuration: Number(r.averageViewDuration) }]),
  );
}
