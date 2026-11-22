import { addQuota, quotaCost, type QuotaState } from '../core/quota';
import { parseIsoDuration } from '../core/text';
import { getSettings } from '../shared/settings';
import { getStore, setStore, updateStore } from '../shared/storage';
import { KEYS, type ChannelInfo, type VideoMeta } from '../shared/types';
import { getAccessToken } from './oauth';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function query(params: Params | undefined): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined && value !== '') out.set(key, String(value));
  const text = out.toString();
  return text ? `?${text}` : '';
}

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  let response = await send(await getAccessToken());
  if (response.status === 401) response = await send(await getAccessToken(true));
  return response;
}

async function fail(response: Response): Promise<never> {
  const json = await response.json().catch(() => null);
  const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? 'unknown';
  const message = json?.error?.message ?? `Request failed with status ${response.status}`;
  throw new ApiError(reason === 'quotaExceeded' ? 'The daily YouTube API quota is used up. It resets at midnight Pacific time.' : message, response.status, reason);
}

/** Calls the YouTube Data API and records the quota cost of the request. */
export async function ytApi<T = Json>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', resource: string, options: { params?: Params; body?: unknown } = {}): Promise<T> {
  const settings = await getSettings();
  const base = settings.dev?.dataBase ?? 'https://www.googleapis.com/youtube/v3';
  const response = await authedFetch(`${base}/${resource}${query(options.params)}`, {
    method,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  await updateStore<QuotaState | null>(KEYS.quota, null, (state) => addQuota(state, quotaCost(method, resource)));
  if (!response.ok) return fail(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function bestThumb(thumbnails: Json): string {
  return thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? '';
}

export function toVideoMeta(item: Json): VideoMeta {
  return {
    id: item.id,
    title: item.snippet?.title ?? '',
    description: item.snippet?.description ?? '',
    tags: item.snippet?.tags ?? [],
    categoryId: item.snippet?.categoryId ?? '22',
    defaultLanguage: item.snippet?.defaultLanguage,
    privacyStatus: item.status?.privacyStatus ?? 'public',
    publishAt: item.status?.publishAt,
    publishedAt: item.snippet?.publishedAt ?? '',
    duration: item.contentDetails?.duration ?? '',
    thumbnail: bestThumb(item.snippet?.thumbnails),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    likeCount: Number(item.statistics?.likeCount ?? 0),
    commentCount: Number(item.statistics?.commentCount ?? 0),
    madeForKids: item.status?.madeForKids,
    hasCaptions: item.contentDetails?.caption === 'true',
  };
}

export function videoSeconds(video: VideoMeta): number {
  return parseIsoDuration(video.duration);
}

export function toChannelInfo(item: Json): ChannelInfo {
  return {
    id: item.id,
    title: item.snippet?.title ?? '',
    handle: item.snippet?.customUrl,
    thumbnail: item.snippet?.thumbnails?.default?.url,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? '',
    subscriberCount: Number(item.statistics?.subscriberCount ?? 0),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    videoCount: Number(item.statistics?.videoCount ?? 0),
  };
}

export async function fetchMyChannel(): Promise<ChannelInfo> {
  const json = await ytApi('GET', 'channels', { params: { part: 'snippet,contentDetails,statistics', mine: true } });
  const item = json.items?.[0];
  if (!item) throw new ApiError('This Google account has no YouTube channel.', 404, 'channelNotFound');
  const channel = toChannelInfo(item);
  await setStore(KEYS.channel, channel);
  return channel;
}

export async function getMyChannel(): Promise<ChannelInfo> {
  return (await getStore<ChannelInfo | null>(KEYS.channel, null)) ?? fetchMyChannel();
}

export async function fetchChannelsById(ids: string[]): Promise<ChannelInfo[]> {
  const out: ChannelInfo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const json = await ytApi('GET', 'channels', { params: { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(','), maxResults: 50 } });
    out.push(...(json.items ?? []).map(toChannelInfo));
  }
  return out;
}

const VIDEO_PARTS = 'snippet,status,statistics,contentDetails';

export async function fetchVideosById(ids: string[]): Promise<VideoMeta[]> {
  const out: VideoMeta[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const json = await ytApi('GET', 'videos', { params: { part: VIDEO_PARTS, id: ids.slice(i, i + 50).join(','), maxResults: 50 } });
    out.push(...(json.items ?? []).map(toVideoMeta));
  }
  return out;
}

export async function listPlaylistVideoIds(playlistId: string, onProgress?: (count: number) => void): Promise<{ videoId: string; itemId: string; position: number }[]> {
  const out: { videoId: string; itemId: string; position: number }[] = [];
  let pageToken: string | undefined;
  do {
    const json: Json = await ytApi('GET', 'playlistItems', { params: { part: 'snippet,contentDetails', playlistId, maxResults: 50, pageToken } });
    for (const item of json.items ?? []) out.push({ videoId: item.contentDetails.videoId, itemId: item.id, position: item.snippet?.position ?? out.length });
    onProgress?.(out.length);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export interface VideoLibrary {
  fetchedAt: number;
  items: VideoMeta[];
}

/** Loads every upload on the connected channel. Costs about 2 quota units per 50 videos. */
export async function refreshLibrary(onProgress?: (count: number) => void): Promise<VideoLibrary> {
  const channel = await fetchMyChannel();
  const ids = (await listPlaylistVideoIds(channel.uploadsPlaylistId, onProgress)).map((i) => i.videoId);
  const library = { fetchedAt: Date.now(), items: await fetchVideosById(ids) };
  await setStore(KEYS.videos, library);
  return library;
}

export async function getLibrary(maxAgeMs = 6 * 3600_000): Promise<VideoLibrary> {
  const cached = await getStore<VideoLibrary | null>(KEYS.videos, null);
  return cached && Date.now() - cached.fetchedAt < maxAgeMs ? cached : refreshLibrary();
}

async function patchLibrary(video: VideoMeta): Promise<void> {
  await updateStore<VideoLibrary | null>(KEYS.videos, null, (library) =>
    library ? { ...library, items: library.items.map((v) => (v.id === video.id ? video : v)) } : library,
  );
}

export interface SnippetChange {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
}

/**
 * Updates a video's title, description, tags or category. The current snippet is read first
 * and sent back in full, because the API clears any snippet field left out of an update.
 */
export async function updateVideoSnippet(videoId: string, change: SnippetChange): Promise<VideoMeta> {
  const current = (await ytApi('GET', 'videos', { params: { part: VIDEO_PARTS, id: videoId } })).items?.[0];
  if (!current) throw new ApiError(`Video ${videoId} was not found on this channel.`, 404, 'videoNotFound');
  const snippet = {
    title: change.title ?? current.snippet.title,
    description: change.description ?? current.snippet.description ?? '',
    tags: change.tags ?? current.snippet.tags ?? [],
    categoryId: change.categoryId ?? current.snippet.categoryId,
    ...(current.snippet.defaultLanguage ? { defaultLanguage: current.snippet.defaultLanguage } : {}),
    ...(current.snippet.defaultAudioLanguage ? { defaultAudioLanguage: current.snippet.defaultAudioLanguage } : {}),
  };
  const updated = await ytApi('PUT', 'videos', { params: { part: 'snippet' }, body: { id: videoId, snippet } });
  const meta = toVideoMeta({ ...current, snippet: { ...current.snippet, ...updated.snippet } });
  await patchLibrary(meta);
  return meta;
}

export interface StatusChange {
  privacyStatus?: 'public' | 'unlisted' | 'private';
  /** ISO timestamp; only valid while the video is private. Pass null to clear. */
  publishAt?: string | null;
}

export async function updateVideoStatus(videoId: string, change: StatusChange): Promise<VideoMeta> {
  const current = (await ytApi('GET', 'videos', { params: { part: VIDEO_PARTS, id: videoId } })).items?.[0];
  if (!current) throw new ApiError(`Video ${videoId} was not found on this channel.`, 404, 'videoNotFound');
  const status: Json = {
    privacyStatus: change.privacyStatus ?? current.status.privacyStatus,
    embeddable: current.status.embeddable,
    license: current.status.license,
    publicStatsViewable: current.status.publicStatsViewable,
    selfDeclaredMadeForKids: current.status.selfDeclaredMadeForKids ?? current.status.madeForKids ?? false,
  };
  const publishAt = change.publishAt === undefined ? current.status.publishAt : change.publishAt;
  if (publishAt && status.privacyStatus === 'private') status.publishAt = publishAt;
  const updated = await ytApi('PUT', 'videos', { params: { part: 'status' }, body: { id: videoId, status } });
  const meta = toVideoMeta({ ...current, status: { ...current.status, ...updated.status } });
  await patchLibrary(meta);
  return meta;
}

export async function setThumbnail(videoId: string, image: Blob): Promise<void> {
  const settings = await getSettings();
  const base = settings.dev?.uploadBase ?? 'https://www.googleapis.com/upload/youtube/v3';
  const response = await authedFetch(`${base}/thumbnails/set${query({ videoId, uploadType: 'media' })}`, {
    method: 'POST',
    headers: { 'content-type': image.type || 'image/jpeg' },
    body: image,
  });
  await updateStore<QuotaState | null>(KEYS.quota, null, (state) => addQuota(state, quotaCost('POST', 'thumbnails/set')));
  if (!response.ok) await fail(response);
}

export interface PlaylistInfo {
  id: string;
  title: string;
  itemCount: number;
  privacyStatus: string;
}

export async function listMyPlaylists(): Promise<PlaylistInfo[]> {
  const out: PlaylistInfo[] = [];
  let pageToken: string | undefined;
  do {
    const json: Json = await ytApi('GET', 'playlists', { params: { part: 'snippet,contentDetails,status', mine: true, maxResults: 50, pageToken } });
    for (const p of json.items ?? []) out.push({ id: p.id, title: p.snippet.title, itemCount: p.contentDetails?.itemCount ?? 0, privacyStatus: p.status?.privacyStatus ?? '' });
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function addToPlaylist(playlistId: string, videoId: string, position?: number): Promise<void> {
  await ytApi('POST', 'playlistItems', {
    params: { part: 'snippet' },
    body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, ...(position === undefined ? {} : { position }) } },
  });
}

export async function removePlaylistItem(itemId: string): Promise<void> {
  await ytApi('DELETE', 'playlistItems', { params: { id: itemId } });
}

export async function movePlaylistItem(playlistId: string, itemId: string, videoId: string, position: number): Promise<void> {
  await ytApi('PUT', 'playlistItems', {
    params: { part: 'snippet' },
    body: { id: itemId, snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, position } },
  });
}

export interface CommentRow {
  id: string;
  threadId: string;
  videoId: string;
  author: string;
  authorChannelId: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  replyCount: number;
}

export async function listChannelComments(channelId: string, limit = 500, onProgress?: (count: number) => void): Promise<CommentRow[]> {
  const out: CommentRow[] = [];
  let pageToken: string | undefined;
  do {
    const json: Json = await ytApi('GET', 'commentThreads', {
      params: { part: 'snippet', allThreadsRelatedToChannelId: channelId, maxResults: 100, order: 'time', textFormat: 'plainText', pageToken },
    });
    for (const thread of json.items ?? []) {
      const top = thread.snippet?.topLevelComment;
      if (!top) continue;
      out.push({
        id: top.id,
        threadId: thread.id,
        videoId: thread.snippet.videoId ?? top.snippet?.videoId ?? '',
        author: top.snippet.authorDisplayName ?? '',
        authorChannelId: top.snippet.authorChannelId?.value ?? '',
        text: top.snippet.textOriginal ?? top.snippet.textDisplay ?? '',
        likeCount: top.snippet.likeCount ?? 0,
        publishedAt: top.snippet.publishedAt ?? '',
        replyCount: thread.snippet.totalReplyCount ?? 0,
      });
    }
    onProgress?.(out.length);
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}

/** Removes comments by rejecting them, which takes many IDs per 50-unit call (deleting takes one each). */
export async function rejectComments(ids: string[], banAuthor = false): Promise<void> {
  for (let i = 0; i < ids.length; i += 40) {
    await ytApi('POST', 'comments/setModerationStatus', { params: { id: ids.slice(i, i + 40).join(','), moderationStatus: 'rejected', banAuthor } });
  }
}

export async function replyToComment(parentId: string, text: string): Promise<void> {
  await ytApi('POST', 'comments', { params: { part: 'snippet' }, body: { snippet: { parentId, textOriginal: text } } });
}

export async function setLocalizations(videoId: string, defaultLanguage: string, localizations: Record<string, { title: string; description: string }>): Promise<void> {
  const current = (await ytApi('GET', 'videos', { params: { part: 'snippet,localizations', id: videoId } })).items?.[0];
  if (!current) throw new ApiError(`Video ${videoId} was not found on this channel.`, 404, 'videoNotFound');
  await ytApi('PUT', 'videos', {
    params: { part: 'snippet,localizations' },
    body: {
      id: videoId,
      snippet: {
        title: current.snippet.title,
        description: current.snippet.description ?? '',
        tags: current.snippet.tags ?? [],
        categoryId: current.snippet.categoryId,
        defaultLanguage: current.snippet.defaultLanguage ?? defaultLanguage,
      },
      localizations: { ...(current.localizations ?? {}), ...localizations },
    },
  });
}
