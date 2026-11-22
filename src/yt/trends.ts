export interface TrendPoint {
  time: number;
  label: string;
  value: number;
}

function stripGuard(text: string): string {
  return text.replace(/^\)\]\}',?\s*/, '');
}

export function parseTimeline(text: string): TrendPoint[] {
  const json = JSON.parse(stripGuard(text)) as { default?: { timelineData?: { time: string; formattedAxisTime?: string; formattedTime?: string; value: number[] }[] } };
  return (json.default?.timelineData ?? []).map((p) => ({
    time: Number(p.time) * 1000,
    label: p.formattedAxisTime ?? p.formattedTime ?? '',
    value: p.value[0] ?? 0,
  }));
}

/**
 * YouTube-search interest over time from Google Trends. Trends has no public API and rate-limits
 * anonymous clients, so this is best-effort: it resolves to null when Trends refuses the request.
 */
export async function youtubeInterest(keyword: string, options: { geo?: string; timeframe?: string } = {}): Promise<TrendPoint[] | null> {
  try {
    const request = {
      comparisonItem: [{ keyword, geo: options.geo ?? '', time: options.timeframe ?? 'today 12-m' }],
      category: 0,
      property: 'youtube',
    };
    const explore = await fetch(`https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(request))}`, {
      credentials: 'include',
    });
    if (!explore.ok) return null;
    const widgets = (JSON.parse(stripGuard(await explore.text())) as { widgets?: { id: string; token: string; request: unknown }[] }).widgets ?? [];
    const series = widgets.find((w) => w.id === 'TIMESERIES');
    if (!series) return null;
    const data = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(series.request))}&token=${encodeURIComponent(series.token)}`,
      { credentials: 'include' },
    );
    if (!data.ok) return null;
    const points = parseTimeline(await data.text());
    return points.length ? points : null;
  } catch {
    return null;
  }
}

/** Direction of the last quarter of the series against the first three quarters, as a ratio. */
export function trendDirection(points: TrendPoint[]): number | null {
  if (points.length < 8) return null;
  const cut = Math.floor(points.length * 0.75);
  const avg = (list: TrendPoint[]) => list.reduce((s, p) => s + p.value, 0) / Math.max(1, list.length);
  const before = avg(points.slice(0, cut));
  return before > 0 ? avg(points.slice(cut)) / before : null;
}
