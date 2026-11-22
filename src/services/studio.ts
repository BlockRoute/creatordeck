import { publicFetch } from '../yt/publicFetch';

const ORIGIN = 'https://studio.youtube.com';

export type EndscreenElementInput =
  | { type: 'video'; videoType: 'best_for_viewer' | 'recent_upload' | 'fixed'; targetVideoId?: string; left: number; top: number; width: number; offsetMs?: number; durationMs?: number }
  | { type: 'playlist'; playlistId: string; left: number; top: number; width: number; offsetMs?: number; durationMs?: number }
  | { type: 'subscribe'; channelId: string; left: number; top: number; width: number; offsetMs?: number; durationMs?: number }
  | { type: 'channel'; channelId: string; message?: string; left: number; top: number; width: number; offsetMs?: number; durationMs?: number };

export type InfoCardInput =
  | { type: 'video'; targetVideoId: string; teaserStartMs?: number; customMessage?: string; teaserText?: string }
  | { type: 'playlist'; playlistId: string; teaserStartMs?: number; customMessage?: string; teaserText?: string }
  | { type: 'channel'; channelId: string; teaserStartMs?: number; customMessage?: string; teaserText?: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/;

function requireVideo(value: string | undefined, field: string): string {
  if (!value || !VIDEO_ID.test(value)) throw new Error(`${field} must be an 11-character video ID.`);
  return value;
}

function requireChannel(value: string | undefined, field: string): string {
  if (!value || !CHANNEL_ID.test(value)) throw new Error(`${field} must be a channel ID starting with UC.`);
  return value;
}

function layout(raw: { left: number; top: number; width: number; offsetMs?: number; durationMs?: number }, index: number): { offsetMs: number; durationMs: number; left: number; width: number; top: number } {
  const offsetMs = raw.offsetMs ?? 0;
  const durationMs = raw.durationMs ?? 20_000;
  if (offsetMs < 0 || durationMs < 5_000 || offsetMs + durationMs > 20_000) throw new Error(`Element ${index + 1} must fit inside the final 20 seconds.`);
  if (raw.left < 0 || raw.top < 0 || raw.width <= 0 || raw.left > 1 || raw.top > 1 || raw.width > 1 || raw.left + raw.width > 1) {
    throw new Error(`Element ${index + 1} is outside the frame.`);
  }
  return { offsetMs, durationMs, left: raw.left, width: raw.width, top: raw.top };
}

function videoTypeWire(value: 'best_for_viewer' | 'recent_upload' | 'fixed'): string {
  switch (value) {
    case 'best_for_viewer':
      return 'VIDEO_TYPE_BEST_FOR_VIEWER';
    case 'recent_upload':
      return 'VIDEO_TYPE_RECENT_UPLOAD';
    case 'fixed':
      return 'VIDEO_TYPE_FIXED';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

/** Builds the Studio edit_video end-screen body. Throws before any request when the layout is invalid. */
export function buildEndscreen(videoId: string, startMs: number, elements: EndscreenElementInput[]): Record<string, unknown> {
  const id = requireVideo(videoId, 'Video');
  if (startMs < 0) throw new Error('The end screen must start at or after 0.');
  if (elements.length < 1 || elements.length > 4) throw new Error('An end screen needs 1 to 4 elements.');
  const wire = elements.map((element, index) => {
    const box = layout(element, index);
    switch (element.type) {
      case 'video': {
        const video: Record<string, unknown> = { videoType: videoTypeWire(element.videoType) };
        if (element.videoType === 'fixed') video.encryptedVideoId = requireVideo(element.targetVideoId, 'Target video');
        else if (element.targetVideoId) throw new Error('A target video is only used when the element is a specific video.');
        return { ...box, videoEndscreenElement: video };
      }
      case 'playlist':
        if (!element.playlistId.trim()) throw new Error('A playlist element needs a playlist ID.');
        return { ...box, playlistEndscreenElement: { playlistId: element.playlistId.trim() } };
      case 'subscribe':
        return { ...box, channelEndscreenElement: { isSubscribe: true, channelId: requireChannel(element.channelId, 'Channel') } };
      case 'channel': {
        const channel: Record<string, unknown> = { isSubscribe: false, channelId: requireChannel(element.channelId, 'Channel') };
        if (element.message != null) {
          if (element.message.length > 30) throw new Error('A channel message can be at most 30 characters.');
          channel.metadata = element.message;
        }
        return { ...box, channelEndscreenElement: channel };
      }
      default: {
        const exhaustive: never = element;
        return exhaustive;
      }
    }
  });
  return {
    externalVideoId: id,
    endscreenEdit: {
      endscreen: { responseStatus: { statusCode: 'CREATOR_ENTITY_STATUS_OK' }, encryptedVideoId: id, startMs, elements: wire },
    },
  };
}

function cardText(value: string | undefined, field: string): string | undefined {
  if (value == null || value === '') return undefined;
  if (value.length > 30) throw new Error(`${field} can be at most 30 characters.`);
  return value;
}

/** Builds the Studio edit_video info-card body. */
export function buildInfoCards(videoId: string, cards: InfoCardInput[]): Record<string, unknown> {
  const id = requireVideo(videoId, 'Video');
  if (cards.length < 1 || cards.length > 5) throw new Error('A video can have 1 to 5 cards.');
  const wire = cards.map((card, index) => {
    const base: Record<string, unknown> = {
      videoId: id,
      teaserStartMs: String(card.teaserStartMs ?? 0),
      infoCardEntityId: `new-addition-${index}`,
    };
    const customMessage = cardText(card.customMessage, 'Card message');
    const teaserText = cardText(card.teaserText, 'Teaser');
    if (customMessage) base.customMessage = customMessage;
    if (teaserText) base.teaserText = teaserText;
    switch (card.type) {
      case 'video':
        return { ...base, videoInfoCard: { videoId: requireVideo(card.targetVideoId, 'Card video') } };
      case 'playlist':
        if (!card.playlistId.trim()) throw new Error('A playlist card needs a playlist ID.');
        return { ...base, playlistInfoCard: { fullPlaylistId: card.playlistId.trim() } };
      case 'channel':
        return { ...base, collaboratorInfoCard: { channelId: requireChannel(card.channelId, 'Card channel') } };
      default: {
        const exhaustive: never = card;
        return exhaustive;
      }
    }
  });
  return { externalVideoId: id, infoCardEdit: { infoCards: wire } };
}

/** Builds the Studio metadata update that links a Short to a long video. */
export function buildShortLink(shortId: string, relatedVideoId: string): Record<string, unknown> {
  const short = requireVideo(shortId, 'Short');
  const related = requireVideo(relatedVideoId, 'Related video');
  if (short === related) throw new Error('A Short cannot be linked to itself.');
  return {
    encryptedVideoId: short,
    videoReadMask: { videoLinkageShortsAttribution: { all: true } },
    videoLinkageShortsAttribution: { targetExternalVideoId: [related] },
  };
}

interface StudioSession {
  apiKey: string;
  clientVersion: string;
}

let sessionCache: StudioSession | null = null;

async function sapisidHash(): Promise<string> {
  const cookie = await chrome.cookies.get({ url: 'https://www.youtube.com/', name: 'SAPISID' });
  const value = cookie?.value;
  if (!value) throw new Error('Sign in to YouTube in this browser first. Studio actions use that session, not the API connection.');
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${timestamp} ${value} ${ORIGIN}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${timestamp}_${hex}`;
}

async function studioSession(): Promise<StudioSession> {
  if (sessionCache) return sessionCache;
  const response = await publicFetch(ORIGIN, { credentials: 'include' });
  const html = await response.text();
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const clientVersion = /"clientVersion":"([^"]+)"/.exec(html)?.[1] ?? '1.20261119.01.00';
  if (!apiKey) throw new Error('YouTube Studio did not return a session. Open studio.youtube.com while signed in, then try again.');
  sessionCache = { apiKey, clientVersion };
  return sessionCache;
}

async function studioPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const session = await studioSession();
  const auth = await sapisidHash();
  const response = await publicFetch(`${ORIGIN}/youtubei/v1/${path}?alt=json&key=${encodeURIComponent(session.apiKey)}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      authorization: auth,
      'content-type': 'application/json',
      'x-origin': ORIGIN,
      'x-youtube-client-name': '62',
      'x-youtube-client-version': session.clientVersion,
    },
    body: JSON.stringify({
      ...body,
      context: { client: { clientName: 'WEB_CREATOR', clientVersion: session.clientVersion, hl: 'en', gl: 'US' } },
    }),
  });
  const json = (await response.json().catch(() => null)) as { error?: { message?: string }; responseContext?: { webResponseContextExtensionData?: { challenge?: { type?: string } } } } | null;
  const challenge = json?.responseContext?.webResponseContextExtensionData?.challenge?.type;
  if (challenge) throw new Error('YouTube Studio asked for an extra sign-in check. Open Studio in this browser, complete it, and try again.');
  if (!response.ok) throw new Error(json?.error?.message ?? `Studio returned status ${response.status}.`);
  return json;
}

export async function readEndScreen(videoId: string): Promise<unknown> {
  return studioPost('creator/get_creator_endscreens', { encryptedVideoIds: [requireVideo(videoId, 'Video')] });
}

export async function applyEndscreen(videoId: string, startMs: number, elements: EndscreenElementInput[]): Promise<unknown> {
  return studioPost('video_editor/edit_video', buildEndscreen(videoId, startMs, elements));
}

export async function applyInfoCards(videoId: string, cards: InfoCardInput[]): Promise<unknown> {
  return studioPost('video_editor/edit_video', buildInfoCards(videoId, cards));
}

export async function linkShort(shortId: string, relatedVideoId: string): Promise<unknown> {
  return studioPost('video_manager/metadata_update', buildShortLink(shortId, relatedVideoId));
}
