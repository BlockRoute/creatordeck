import { parseAgeDays, parseClock, parseCount } from '../core/text';
import { publicFetch } from './publicFetch';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const DEFAULT_CLIENT_VERSION = '2.20261101.00.00';

export interface Locale {
  hl: string;
  gl: string;
}

let locale: Locale = { hl: 'en', gl: 'US' };

export function setLocale(next: Partial<Locale>): void {
  locale = { ...locale, ...next };
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

export async function innertube(endpoint: string, body: Record<string, unknown>): Promise<Json> {
  const response = await publicFetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Signed-out requests keep search results neutral rather than personalised.
    credentials: 'omit',
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: DEFAULT_CLIENT_VERSION, hl: locale.hl, gl: locale.gl } },
      ...body,
    }),
  });
  if (!response.ok) throw new YouTubeError(`YouTube returned ${response.status} for ${endpoint}`, response.status);
  return response.json();
}

export function textOf(node: Json): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.runs)) return node.runs.map((r: Json) => r.text ?? '').join('');
  return '';
}

export interface SearchVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  verified: boolean;
  viewCount: number | null;
  publishedText: string;
  ageDays: number | null;
  lengthSeconds: number | null;
  snippet: string;
  isLive: boolean;
}

export interface SearchPage {
  estimatedResults: number | null;
  videos: SearchVideo[];
  continuation: string | null;
}

function parseVideoRenderer(v: Json): SearchVideo | null {
  if (!v?.videoId) return null;
  const owner = v.ownerText ?? v.longBylineText ?? v.shortBylineText;
  const viewText = textOf(v.viewCountText);
  const isLive = /watching/i.test(viewText) || !v.lengthText;
  const publishedText = textOf(v.publishedTimeText);
  return {
    videoId: v.videoId,
    title: textOf(v.title),
    channelId: owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? '',
    channelName: textOf(owner),
    verified: (v.ownerBadges ?? []).some((b: Json) => /VERIFIED/.test(b?.metadataBadgeRenderer?.style ?? '')),
    viewCount: isLive && /watching/i.test(viewText) ? null : parseCount(viewText),
    publishedText,
    ageDays: parseAgeDays(publishedText),
    lengthSeconds: parseClock(textOf(v.lengthText)),
    snippet: (v.detailedMetadataSnippets ?? []).map((s: Json) => textOf(s.snippetText)).join(' '),
    isLive,
  };
}

function collectSearchItems(sections: Json[]): { videos: SearchVideo[]; continuation: string | null } {
  const videos: SearchVideo[] = [];
  let continuation: string | null = null;
  for (const section of sections ?? []) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const video = parseVideoRenderer(item.videoRenderer);
      if (video) videos.push(video);
    }
    const token = section?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (token) continuation = token;
  }
  return { videos, continuation };
}

export function parseSearch(json: Json): SearchPage {
  const sections =
    json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ??
    json?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ??
    [];
  const estimated = json?.estimatedResults ? Number(json.estimatedResults) : null;
  return { estimatedResults: Number.isFinite(estimated) ? estimated : null, ...collectSearchItems(sections) };
}

export const SEARCH_FILTER_THIS_WEEK_VIDEOS = 'EgQIAxAB';

/** Runs a YouTube search and follows continuations until `limit` videos are collected. */
export async function searchVideos(query: string, options: { limit?: number; params?: string } = {}): Promise<SearchPage> {
  const limit = options.limit ?? 20;
  const first = parseSearch(await innertube('search', { query, ...(options.params ? { params: options.params } : {}) }));
  const videos = [...first.videos];
  let continuation = first.continuation;
  let guard = 0;
  while (videos.length < limit && continuation && guard < 5) {
    guard += 1;
    const next = parseSearch(await innertube('search', { continuation }));
    if (!next.videos.length) break;
    for (const video of next.videos) if (!videos.some((v) => v.videoId === video.videoId)) videos.push(video);
    continuation = next.continuation;
  }
  return { estimatedResults: first.estimatedResults, videos: videos.slice(0, limit), continuation };
}

export interface VideoPage {
  videoId: string;
  title: string;
  description: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  dateText: string;
  publishDate: string | null;
  channelId: string;
  channelName: string;
  subscriberCount: number | null;
  channelVerified: boolean;
}

export function parseVideoPage(videoId: string, json: Json): VideoPage | null {
  const contents: Json[] = json?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
  const primary = contents.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const secondary = contents.find((c) => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
  if (!primary) return null;
  const owner = secondary?.owner?.videoOwnerRenderer;
  const raw = JSON.stringify(json);
  const likes = raw.match(/along with ([\d,.]+) other people/);
  const comments = raw.match(/"commentsEntryPointHeaderRenderer".{0,600}?"commentCount":\{"simpleText":"([^"]+)"/) ?? raw.match(/"contextualInfo":\{"runs":\[\{"text":"([^"]+)"/);
  const dateText = textOf(primary.dateText);
  const parsedDate = Date.parse(dateText.replace(/^(Premiered|Streamed live on|Published on)\s+/i, ''));
  return {
    videoId,
    title: textOf(primary.title),
    description: secondary?.attributedDescription?.content ?? textOf(secondary?.description),
    viewCount: parseCount(textOf(primary.viewCount?.videoViewCountRenderer?.viewCount)),
    likeCount: likes ? parseCount(likes[1]) : null,
    commentCount: comments ? parseCount(comments[1]) : null,
    dateText,
    publishDate: Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString(),
    channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? owner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? '',
    channelName: textOf(owner?.title),
    subscriberCount: parseCount(textOf(owner?.subscriberCountText)),
    channelVerified: (owner?.badges ?? []).some((b: Json) => /VERIFIED/.test(b?.metadataBadgeRenderer?.style ?? '')),
  };
}

export async function fetchVideoPage(videoId: string): Promise<VideoPage | null> {
  return parseVideoPage(videoId, await innertube('next', { videoId }));
}

export interface PlayerData {
  title: string;
  description: string;
  tags: string[];
  lengthSeconds: number | null;
  viewCount: number | null;
  channelId: string;
  author: string;
  publishDate: string | null;
  category: string | null;
  isLive: boolean;
  hasCaptions: boolean;
  hasEndScreen: boolean;
  hasCards: boolean;
  captionTracks: { languageCode: string; name: string; baseUrl: string; kind?: string }[];
}

/** Pulls the balanced JSON object that follows `marker` out of a page's HTML. */
export function extractJsonAfter(html: string, marker: string): Json | null {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parsePlayerResponse(player: Json): PlayerData | null {
  const details = player?.videoDetails;
  if (!details?.videoId) return null;
  const micro = player?.microformat?.playerMicroformatRenderer;
  const tracks: Json[] = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return {
    title: details.title ?? '',
    description: details.shortDescription ?? '',
    tags: Array.isArray(details.keywords) ? details.keywords : [],
    lengthSeconds: details.lengthSeconds ? Number(details.lengthSeconds) : null,
    viewCount: details.viewCount ? Number(details.viewCount) : null,
    channelId: details.channelId ?? '',
    author: details.author ?? '',
    publishDate: micro?.publishDate ?? micro?.uploadDate ?? null,
    category: micro?.category ?? null,
    isLive: !!details.isLiveContent,
    hasCaptions: tracks.length > 0,
    hasEndScreen: !!player?.endscreen,
    hasCards: !!player?.cards,
    captionTracks: tracks.map((t) => ({ languageCode: t.languageCode, name: textOf(t.name), baseUrl: t.baseUrl, kind: t.kind })),
  };
}

/**
 * Reads the player data embedded in a watch page. This is the only public place a video's
 * tags appear. YouTube withholds it from clients it suspects of automation, in which case
 * this resolves to null and callers fall back to the Data API or show tags as unavailable.
 */
export async function fetchPlayerData(videoId: string): Promise<PlayerData | null> {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=${locale.hl}`, { credentials: 'include' });
  if (!response.ok) return null;
  return parsePlayerResponse(extractJsonAfter(await response.text(), 'ytInitialPlayerResponse'));
}

export interface ChannelPublic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  viewCount: number | null;
  publishedText: string;
  ageDays: number | null;
  lengthSeconds: number | null;
}

/** Splits YouTube's channel keyword string, where multi-word keywords are double-quoted. */
export function parseChannelKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]) as string);
}

export function parseChannel(json: Json): ChannelPublic | null {
  const meta = json?.metadata?.channelMetadataRenderer;
  if (!meta?.externalId) return null;
  const rows: Json[] = json?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts = rows.flatMap((r) => r.metadataParts ?? []).map((p: Json) => textOf(p.text));
  const vanity: string | undefined = meta.vanityChannelUrl ?? meta.ownerUrls?.[0];
  const avatars: Json[] = meta.avatar?.thumbnails ?? [];
  return {
    id: meta.externalId,
    title: meta.title ?? '',
    description: meta.description ?? '',
    keywords: parseChannelKeywords(meta.keywords),
    handle: parts.find((p) => p.startsWith('@')) ?? vanity?.match(/@[\w.-]+/)?.[0] ?? null,
    avatar: avatars[avatars.length - 1]?.url ?? null,
    subscriberCount: parseCount(parts.find((p) => /subscriber/i.test(p))),
    videoCount: parseCount(parts.find((p) => /\bvideos?\b/i.test(p))),
  };
}

function parseLockup(lockup: Json): ChannelVideo | null {
  if (!lockup?.contentId || (lockup.contentType && lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
  const meta = lockup.metadata?.lockupMetadataViewModel;
  const parts: string[] = (meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [])
    .flatMap((r: Json) => r.metadataParts ?? [])
    .map((p: Json) => textOf(p.text));
  const badges: string[] = (lockup.contentImage?.thumbnailViewModel?.overlays ?? [])
    .flatMap((o: Json) => o.thumbnailBottomOverlayViewModel?.badges ?? o.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? [])
    .map((b: Json) => b.thumbnailBadgeViewModel?.text ?? '');
  const publishedText = parts.find((p) => /ago/i.test(p)) ?? '';
  return {
    videoId: lockup.contentId,
    title: textOf(meta?.title),
    viewCount: parseCount(parts.find((p) => /view/i.test(p))),
    publishedText,
    ageDays: parseAgeDays(publishedText),
    lengthSeconds: parseClock(badges.find((b) => /^\d+(:\d{2})+$/.test(b))),
  };
}

export function parseChannelVideos(json: Json): { videos: ChannelVideo[]; continuation: string | null } {
  const tabs: Json[] = json?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const grid = tabs.find((t) => t.tabRenderer?.selected)?.tabRenderer?.content?.richGridRenderer?.contents;
  const appended =
    json?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ??
    json?.onResponseReceivedActions?.[0]?.reloadContinuationItemsCommand?.continuationItems;
  const items: Json[] = grid ?? appended ?? [];
  const videos: ChannelVideo[] = [];
  let continuation: string | null = null;
  for (const item of items) {
    const content = item.richItemRenderer?.content;
    const legacy = content?.videoRenderer;
    const video = content?.lockupViewModel
      ? parseLockup(content.lockupViewModel)
      : legacy
        ? (() => {
            const v = parseVideoRenderer(legacy);
            return v ? { videoId: v.videoId, title: v.title, viewCount: v.viewCount, publishedText: v.publishedText, ageDays: v.ageDays, lengthSeconds: v.lengthSeconds } : null;
          })()
        : null;
    if (video) videos.push(video);
    const token = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (token) continuation = token;
  }
  return { videos, continuation };
}

const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';

/** Accepts a channel ID, a channel URL in any form, or an @handle, and returns the UC... ID. */
export async function resolveChannelId(input: string): Promise<string | null> {
  const value = input.trim();
  const direct = value.match(/(UC[\w-]{22})/);
  if (direct) return direct[1] as string;
  let url = value;
  if (!/^https?:\/\//.test(url)) url = `https://www.youtube.com/${url.startsWith('@') ? url : `@${url.replace(/^\/+/, '')}`}`;
  const json = await innertube('navigation/resolve_url', { url });
  return json?.endpoint?.browseEndpoint?.browseId ?? null;
}

export async function fetchChannel(channelId: string): Promise<ChannelPublic | null> {
  return parseChannel(await innertube('browse', { browseId: channelId }));
}

export async function fetchChannelVideos(channelId: string, limit = 30): Promise<ChannelVideo[]> {
  const first = parseChannelVideos(await innertube('browse', { browseId: channelId, params: VIDEOS_TAB_PARAMS }));
  const videos = [...first.videos];
  let continuation = first.continuation;
  let guard = 0;
  while (videos.length < limit && continuation && guard < 10) {
    guard += 1;
    const next = parseChannelVideos(await innertube('browse', { continuation }));
    if (!next.videos.length) break;
    videos.push(...next.videos);
    continuation = next.continuation;
  }
  return videos.slice(0, limit);
}

export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  const m = value.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? (m[1] as string) : null;
}
