import { describe, expect, it } from 'vitest';
import { applyChapters, validateChapters } from '../src/core/chapters';
import { parseCsv, toCsv } from '../src/core/csv';
import { auditMonetization } from '../src/core/demonetization';
import { previewBulk } from '../src/core/findReplace';
import { scoreKeyword } from '../src/core/keywordScore';
import { addQuota, quotaRemaining } from '../src/core/quota';
import { scoreSeo, tagCharCount } from '../src/core/seo';
import { twoProportionTest } from '../src/core/stats';
import { parseAgeDays, parseCount } from '../src/core/text';
import { measureThumbnail } from '../src/core/thumbnail';
import { bestPublishBuckets } from '../src/core/timing';
import { compareVariants, eachDate, exposureStats } from '../src/services/abtest';
import { parseJsonBlock } from '../src/services/ai';
import { profileChange } from '../src/services/schedule';
import { buildEndscreen, buildInfoCards, buildShortLink } from '../src/services/studio';
import { parseReachReport } from '../src/yt/analytics';
import { parseFeed } from '../src/yt/rss';

describe('scoring and text', () => {
  it('scores a keyword-led title above an empty one', () => {
    const keyword = 'sourdough starter';
    const strong = scoreSeo({
      title: 'Sourdough starter for beginners',
      description: `${keyword}\n\n${'Mix flour and water, then wait. '.repeat(30)}\nhttps://example.com\n#sourdough`,
      tags: ['sourdough starter', 'bread baking', 'starter recipe'],
      keyword,
    });
    const weak = scoreSeo({ title: 'Hello', description: 'x', tags: [], keyword });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeLessThanOrEqual(100);
  });

  it('counts quoted tags with spaces toward the 500 character limit', () => {
    expect(tagCharCount(['a b', 'c'])).toBe(3 + 2 + 1 + 1);
  });

  it('turns public search signals into a 0-100 keyword score', () => {
    const score = scoreKeyword({
      keyword: 'how to boil eggs',
      estimatedResults: 1_000_000,
      suggest: { earliestPrefix: 0.4, completions: 8 },
      results: [
        { title: 'How to boil eggs', viewCount: 1_200_000, ageDays: 400, verified: true },
        { title: 'Boiling eggs the easy way', viewCount: 80_000, ageDays: 20, verified: false },
      ],
    });
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.volume).toBeGreaterThan(0);
  });

  it('parses YouTube counts and ages', () => {
    expect(parseCount('1.2M views')).toBe(1_200_000);
    expect(parseCount('95,385,192 views')).toBe(95_385_192);
    expect(parseCount('No views')).toBe(0);
    expect(parseAgeDays('2 weeks ago')).toBe(14);
    expect(parseAgeDays('3 hours ago')).toBeCloseTo(3 / 24, 5);
  });
});

describe('edits', () => {
  it('keeps a dollar sign literal in a plain find and replace', () => {
    const [change] = previewBulk([{ id: 'a', title: 'Hello $world', description: '', tags: ['one'] }], [
      { kind: 'replace', field: 'title', find: '$world', replaceWith: 'there', regex: false, caseSensitive: false },
    ]);
    expect(change?.after.title).toBe('Hello there');
    expect(change?.problems).toEqual([]);
  });

  it('rejects a title that would exceed 100 characters', () => {
    const [change] = previewBulk([{ id: 'a', title: 'Hi', description: '', tags: [] }], [
      { kind: 'append', field: 'title', text: 'x'.repeat(100) },
    ]);
    expect(change?.problems.length).toBeGreaterThan(0);
  });

  it('validates chapters and writes them into a description', () => {
    const chapters = [
      { seconds: 0, title: 'Intro' },
      { seconds: 15, title: 'Mix' },
      { seconds: 40, title: 'Bake' },
    ];
    expect(validateChapters(chapters, 120)).toEqual([]);
    expect(validateChapters([{ seconds: 5, title: 'Late' }, { seconds: 20, title: 'A' }, { seconds: 40, title: 'B' }], 120).length).toBeGreaterThan(0);
    expect(applyChapters('Watch this.\n', chapters)).toContain('0:00 Intro');
  });

  it('appends a profile suffix once', () => {
    const once = profileChange({ description: 'Hello', tags: ['a'] }, { id: 'p', name: 'P', descriptionSuffix: 'Subscribe', tags: ['a', 'b'], categoryId: '22' });
    expect(once.description).toBe('Hello\n\nSubscribe');
    expect(once.tags).toEqual(['a', 'b']);
    const twice = profileChange({ description: once.description ?? '', tags: once.tags ?? [] }, { id: 'p', name: 'P', descriptionSuffix: 'Subscribe', tags: ['b'], categoryId: '' });
    expect(twice.description).toBe('Hello\n\nSubscribe');
  });
});

describe('stats and quota', () => {
  it('calls an obvious click-through gap significant', () => {
    const test = twoProportionTest(20, 1000, 80, 1000);
    expect(test.confidence).toBeGreaterThan(0.95);
    expect(test.lift).toBeCloseTo(3, 5);
    const tie = twoProportionTest(50, 1000, 50, 1000);
    expect(tie.confidence).toBeLessThan(0.01);
  });

  it('requires 500 impressions before a variant can win', () => {
    const stats = [
      { impressions: 400, clicks: 40, views: 40, minutesWatched: 10, dailyViews: [40] },
      { impressions: 1000, clicks: 20, views: 20, minutesWatched: 8, dailyViews: [20] },
    ];
    const early = compareVariants('thumbnail', stats, 500, 0.95);
    expect(early?.significant).toBe(false);
    const ready = compareVariants('thumbnail', [
      { impressions: 1000, clicks: 20, views: 0, minutesWatched: 0, dailyViews: [] },
      { impressions: 1000, clicks: 80, views: 0, minutesWatched: 0, dailyViews: [] },
    ], 500, 0.95);
    expect(ready?.significant).toBe(true);
    expect(ready?.bestIndex).toBe(1);
  });

  it('sums a variant only on the days it was live', () => {
    expect(eachDate('2026-01-01', '2026-01-04')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    const stats = exposureStats(
      [{ variantIndex: 0, from: '2026-01-01', to: '2026-01-03' }, { variantIndex: 1, from: '2026-01-03', to: null }],
      2,
      { '2026-01-01': { impressions: 10, ctr: 0.1 }, '2026-01-03': { impressions: 7, ctr: 0.5 } },
      { '2026-01-01': { views: 4, minutesWatched: 1 }, '2026-01-03': { views: 9, minutesWatched: 2 } },
      '2026-01-03',
    );
    expect(stats[0]?.impressions).toBe(10);
    expect(stats[1]?.impressions).toBe(7);
    expect(stats[1]?.views).toBe(9);
  });

  it('resets the quota counter on the next Pacific day', () => {
    const first = new Date('2026-03-01T20:00:00Z');
    const next = new Date('2026-03-02T20:00:00Z');
    const state = addQuota({ day: '2026-03-01', used: 100 }, 50, first);
    expect(state.used).toBe(150);
    expect(quotaRemaining(state, next)).toBe(10000);
  });
});

describe('parsers', () => {
  it('round-trips quoted csv', () => {
    const text = toCsv([{ name: 'a, b', note: 'say "hi"' }]);
    const [row] = parseCsv(text);
    expect(row?.name).toBe('a, b');
    expect(row?.note).toBe('say "hi"');
  });

  it('flags a high-risk word in the title and ignores a clean one', () => {
    expect(auditMonetization({ title: 'How to bake bread', description: '', tags: [] }).rating).toBe('green');
    expect(auditMonetization({ title: 'A murder mystery recap', description: '', tags: [] }).rating).toBe('red');
  });

  it('measures a flat image as low contrast', () => {
    const data = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i += 1) {
      data[i * 4] = 220;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 255;
    }
    const metrics = measureThumbnail({ width: 8, height: 8, data });
    expect(metrics.contrast).toBeLessThan(1);
    expect(metrics.colorfulness).toBeGreaterThan(20);
  });

  it('reads a channel feed and a reach report', () => {
    const feed = parseFeed(`<feed><title>Ada</title><yt:channelId>UC123</yt:channelId><entry><yt:videoId>abcdefghijk</yt:videoId><title>New</title><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated><media:statistics views="12"/><media:description>Hi</media:description></entry></feed>`);
    expect(feed.channelId).toBe('UC123');
    expect(feed.entries[0]?.views).toBe(12);
    const percent = parseReachReport('date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20260102,abcdefghijk,1000,4.5\n');
    expect(percent[0]?.reach.ctr).toBeCloseTo(0.045);
    const fraction = parseReachReport('date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n2026-01-02,abcdefghijk,1000,0.045\n');
    expect(fraction[0]?.reach.ctr).toBeCloseTo(0.045);
  });

  it('pulls JSON out of a fenced model reply', () => {
    expect(parseJsonBlock<string[]>('Sure:\n```json\n["One","Two"]\n```')).toEqual(['One', 'Two']);
  });
});

describe('studio payloads', () => {
  it('builds an end screen, cards and a short link, and rejects a bad layout', () => {
    const endscreen = buildEndscreen('abcdefghijk', 1000, [
      { type: 'video', videoType: 'best_for_viewer', left: 0.02, top: 0.5, width: 0.3 },
      { type: 'subscribe', channelId: 'UCabcdefghijklmnopqrstuv', left: 0.8, top: 0.55, width: 0.15 },
    ]);
    expect(JSON.stringify(endscreen)).toContain('VIDEO_TYPE_BEST_FOR_VIEWER');
    expect(() => buildEndscreen('abcdefghijk', 0, [])).toThrow();
    const cards = buildInfoCards('abcdefghijk', [{ type: 'video', targetVideoId: 'zzzzzzzzzzz', teaserStartMs: 1000 }]);
    expect(JSON.stringify(cards)).toContain('zzzzzzzzzzz');
    const link = buildShortLink('abcdefghijk', 'zzzzzzzzzzz');
    expect(JSON.stringify(link)).toContain('zzzzzzzzzzz');
    expect(() => buildShortLink('abcdefghijk', 'abcdefghijk')).toThrow();
  });
});

describe('publish time', () => {
  it('ranks the hour whose videos earn more views per day', () => {
    const buckets = bestPublishBuckets(
      [
        { publishedAt: '2026-01-05T15:00:00Z', viewCount: 1000 },
        { publishedAt: '2026-01-12T15:00:00Z', viewCount: 1000 },
        { publishedAt: '2026-01-06T03:00:00Z', viewCount: 10 },
      ],
      Date.parse('2026-02-01T00:00:00Z'),
    );
    expect(buckets[0]?.hour).toBe(15);
    expect(buckets[0]?.samples).toBe(2);
  });
});
