import { scoreKeyword, type KeywordScore } from '../core/keywordScore';
import { normalize, wordCoverage } from '../core/text';
import { getSettings } from '../shared/settings';
import { fetchPlayerData, searchVideos, setLocale, type SearchVideo } from '../yt/innertube';
import { expandKeyword, suggestSignal } from '../yt/suggest';

export interface KeywordReport {
  keyword: string;
  score: KeywordScore;
  estimatedResults: number | null;
  results: SearchVideo[];
  exactTitleMatches: number;
  publishedLastWeek: number;
  fetchedAt: number;
}

async function locale(): Promise<{ hl: string; gl: string }> {
  const settings = await getSettings();
  const value = { hl: settings.language || 'en', gl: settings.region || 'US' };
  setLocale(value);
  return value;
}

const reportCache = new Map<string, KeywordReport>();

/** Researches one keyword: top 20 search results plus autocomplete evidence, scored locally. */
export async function researchKeyword(keyword: string, channelMedianViews?: number | null): Promise<KeywordReport> {
  const loc = await locale();
  const key = `${loc.hl}|${loc.gl}|${normalize(keyword)}|${channelMedianViews ?? ''}`;
  const cached = reportCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 15 * 60_000) return cached;
  const [page, signal] = await Promise.all([searchVideos(keyword, { limit: 20 }), suggestSignal(keyword, loc)]);
  const report: KeywordReport = {
    keyword,
    score: scoreKeyword({
      keyword,
      results: page.videos.map((v) => ({ title: v.title, viewCount: v.viewCount, ageDays: v.ageDays, verified: v.verified })),
      estimatedResults: page.estimatedResults,
      suggest: signal,
      channelMedianViews,
    }),
    estimatedResults: page.estimatedResults,
    results: page.videos,
    exactTitleMatches: page.videos.filter((v) => wordCoverage(v.title, keyword) === 1).length,
    publishedLastWeek: page.videos.filter((v) => v.ageDays !== null && v.ageDays <= 7).length,
    fetchedAt: Date.now(),
  };
  reportCache.set(key, report);
  return report;
}

export async function relatedKeywords(keyword: string, deep = false): Promise<string[]> {
  return expandKeyword(keyword, await locale(), deep);
}

export interface TagSuggestion {
  tag: string;
  /** How many of the analysed top videos use the tag. */
  usedBy: number;
  fromAutocomplete: boolean;
  relevance: number;
}

/**
 * Suggests tags for a keyword from two sources: autocomplete phrases, and the tags of the
 * videos currently ranking for it (when YouTube lets us read them).
 */
export async function suggestTags(keyword: string, topVideoIds: string[] = []): Promise<{ suggestions: TagSuggestion[]; videosRead: number }> {
  const related = await relatedKeywords(keyword);
  const map = new Map<string, TagSuggestion>();
  const add = (tag: string, patch: Partial<TagSuggestion>) => {
    const key = normalize(tag);
    if (!key || key.length > 60) return;
    const current = map.get(key) ?? { tag: tag.trim(), usedBy: 0, fromAutocomplete: false, relevance: 0 };
    map.set(key, { ...current, ...patch, usedBy: current.usedBy + (patch.usedBy ?? 0) });
  };
  add(keyword, { fromAutocomplete: true });
  related.forEach((r) => add(r, { fromAutocomplete: true }));
  let videosRead = 0;
  for (let i = 0; i < topVideoIds.length; i += 3) {
    const batch = await Promise.all(topVideoIds.slice(i, i + 3).map((id) => fetchPlayerData(id).catch(() => null)));
    for (const player of batch) {
      if (!player) continue;
      videosRead += 1;
      new Set(player.tags.map((t) => t.trim()).filter(Boolean)).forEach((t) => add(t, { usedBy: 1 }));
    }
  }
  const suggestions = [...map.values()]
    .map((s) => ({ ...s, relevance: Math.round(wordCoverage(s.tag, keyword) * 50 + Math.min(30, s.usedBy * 6) + (s.fromAutocomplete ? 20 : 0)) }))
    .sort((a, b) => b.relevance - a.relevance || a.tag.length - b.tag.length);
  return { suggestions, videosRead };
}

/** Where a video (or any video from a channel) ranks for a query; null when outside the checked depth. */
export async function findRank(query: string, target: { videoId?: string; channelId?: string }, depth = 50): Promise<{ position: number | null; video: SearchVideo | null; checked: number }> {
  await locale();
  const page = await searchVideos(query, { limit: depth });
  const index = page.videos.findIndex((v) => (target.videoId ? v.videoId === target.videoId : v.channelId === target.channelId));
  return { position: index === -1 ? null : index + 1, video: index === -1 ? null : (page.videos[index] ?? null), checked: page.videos.length };
}
