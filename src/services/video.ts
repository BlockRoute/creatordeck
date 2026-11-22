import { parseIsoDuration } from '../core/text';
import { fetchVideosById } from '../yt/api';
import { fetchPlayerData, fetchVideoPage } from '../yt/innertube';
import { isConnected } from '../yt/oauth';

export interface VideoInsight {
  videoId: string;
  title: string;
  description: string;
  /** null when neither the watch page nor the Data API yielded tags. */
  tags: string[] | null;
  tagsSource: 'watch page' | 'Data API' | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  publishDate: string | null;
  ageDays: number | null;
  lengthSeconds: number | null;
  channelId: string;
  channelName: string;
  subscriberCount: number | null;
  category: string | null;
  hasCaptions: boolean | null;
  hasEndScreen: boolean | null;
  hasCards: boolean | null;
  hasHdThumbnail: boolean | null;
  viewsPerDay: number | null;
  /** (likes + comments) / views. */
  engagementRate: number | null;
}

export async function hasMaxResThumbnail(videoId: string): Promise<boolean | null> {
  try {
    const response = await fetch(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, { method: 'HEAD', credentials: 'omit' });
    return response.ok;
  } catch {
    return null;
  }
}

/** Gathers everything publicly knowable about a video, preferring exact numbers where available. */
export async function loadVideoInsight(videoId: string): Promise<VideoInsight> {
  const [page, player, hd, connected] = await Promise.all([
    fetchVideoPage(videoId).catch(() => null),
    fetchPlayerData(videoId).catch(() => null),
    hasMaxResThumbnail(videoId),
    isConnected(),
  ]);
  // The Data API returns tags for any public video, so it backs up the watch page when connected.
  const api = !player && connected ? ((await fetchVideosById([videoId]).catch(() => []))[0] ?? null) : null;
  if (!page && !player && !api) throw new Error('YouTube returned no data for this video. Check the link, or try again in a moment.');

  const publishDate = player?.publishDate ?? api?.publishedAt ?? page?.publishDate ?? null;
  const ageDays = publishDate ? Math.max(0.04, (Date.now() - Date.parse(publishDate)) / 86400_000) : null;
  const viewCount = player?.viewCount ?? api?.viewCount ?? page?.viewCount ?? null;
  const likeCount = api?.likeCount ?? page?.likeCount ?? null;
  const commentCount = api?.commentCount ?? page?.commentCount ?? null;
  return {
    videoId,
    title: player?.title ?? api?.title ?? page?.title ?? '',
    description: player?.description ?? api?.description ?? page?.description ?? '',
    tags: player ? player.tags : api ? api.tags : null,
    tagsSource: player ? 'watch page' : api ? 'Data API' : null,
    viewCount,
    likeCount,
    commentCount,
    publishDate,
    ageDays,
    lengthSeconds: player?.lengthSeconds ?? (api ? parseIsoDuration(api.duration) : null),
    channelId: player?.channelId ?? page?.channelId ?? '',
    channelName: player?.author ?? page?.channelName ?? '',
    subscriberCount: page?.subscriberCount ?? null,
    category: player?.category ?? null,
    hasCaptions: player ? player.hasCaptions : api?.hasCaptions ?? null,
    hasEndScreen: player ? player.hasEndScreen : null,
    hasCards: player ? player.hasCards : null,
    hasHdThumbnail: hd,
    viewsPerDay: viewCount !== null && ageDays !== null ? viewCount / ageDays : null,
    engagementRate: viewCount && likeCount !== null ? (likeCount + (commentCount ?? 0)) / viewCount : null,
  };
}
