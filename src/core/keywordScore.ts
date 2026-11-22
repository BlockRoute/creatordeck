import { clamp, median, wordCoverage } from './text';

export interface ResultSignal {
  title: string;
  viewCount: number | null;
  ageDays: number | null;
  verified: boolean;
}

export interface SuggestSignal {
  /** Fraction of the keyword typed (0..1) when autocomplete first offered it; null if never offered. */
  earliestPrefix: number | null;
  /** How many autocomplete completions extend the full keyword. */
  completions: number;
}

export interface KeywordInput {
  keyword: string;
  results: ResultSignal[];
  estimatedResults: number | null;
  suggest: SuggestSignal;
  /** Median views of the user's own recent videos, when known. */
  channelMedianViews?: number | null;
}

export interface KeywordScore {
  volume: number;
  competition: number;
  weightedCompetition: number | null;
  overall: number;
  weightedOverall: number | null;
  band: ScoreBand;
  details: {
    medianViews: number;
    medianViewsPerDay: number;
    titleMatchShare: number;
    verifiedShare: number;
    freshShare: number;
    suggestScore: number;
  };
}

export type ScoreBand = 'Poor' | 'Fair' | 'Good' | 'Great' | 'Excellent';

export function bandFor(score: number): ScoreBand {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Great';
  if (score >= 50) return 'Good';
  if (score >= 30) return 'Fair';
  return 'Poor';
}

export function volumeLabel(volume: number): string {
  if (volume >= 80) return 'Very high';
  if (volume >= 60) return 'High';
  if (volume >= 40) return 'Medium';
  if (volume >= 20) return 'Low';
  return 'Very low';
}

function suggestScore(signal: SuggestSignal): number {
  const completionBonus = Math.min(15, signal.completions * 1.5);
  if (signal.earliestPrefix === null) return clamp(signal.completions > 0 ? 15 + completionBonus : 0);
  // Offered after typing 40% or less of the phrase -> strong demand; only at the very end -> weak.
  const base = signal.earliestPrefix <= 0.4 ? 85 : signal.earliestPrefix <= 0.7 ? 65 : 45;
  return clamp(base + completionBonus);
}

function combine(volume: number, competition: number): number {
  const raw = 0.5 * volume + 0.5 * (100 - competition);
  // A keyword almost nobody searches for is not a good target however empty the field is.
  const demandFactor = volume < 20 ? 0.5 + volume / 40 : 1;
  return Math.round(clamp(raw * demandFactor));
}

/**
 * Scores a keyword from public signals only. These are estimates of relative demand and
 * difficulty, not measured search volumes.
 */
export function scoreKeyword(input: KeywordInput): KeywordScore {
  const top = input.results.slice(0, 10);
  const views = top.map((r) => r.viewCount).filter((v): v is number => v !== null);
  const perDay = top
    .filter((r) => r.viewCount !== null && r.ageDays !== null)
    .map((r) => (r.viewCount as number) / Math.max(1, r.ageDays as number));

  const medianViews = median(views);
  const medianViewsPerDay = median(perDay);
  const titleMatchShare = top.length ? top.filter((r) => wordCoverage(r.title, input.keyword) === 1).length / top.length : 0;
  const verifiedShare = top.length ? top.filter((r) => r.verified).length / top.length : 0;
  const dated = top.filter((r) => r.ageDays !== null);
  const freshShare = dated.length ? dated.filter((r) => (r.ageDays as number) <= 90).length / dated.length : 0;

  const sScore = suggestScore(input.suggest);
  // 100,000 views a day across the top results maps to 100.
  const viewDemand = clamp((Math.log10(medianViewsPerDay + 1) / 5) * 100);
  const volume = Math.round(clamp(0.55 * sScore + 0.45 * viewDemand));

  const viewsScore = clamp((Math.log10(medianViews + 1) / 7) * 100);
  const resultsScore = input.estimatedResults ? clamp((Math.log10(input.estimatedResults + 1) / 8) * 100) : 50;
  const competition = Math.round(
    clamp(
      0.4 * viewsScore + 0.25 * titleMatchShare * 100 + 0.15 * verifiedShare * 100 + 0.1 * resultsScore + 0.1 * (1 - freshShare) * 100,
    ),
  );

  let weightedCompetition: number | null = null;
  if (input.channelMedianViews && input.channelMedianViews > 0 && medianViews > 0) {
    const ratio = input.channelMedianViews / medianViews;
    weightedCompetition = Math.round(clamp(competition - clamp(Math.log10(ratio) * 25, -30, 30)));
  }

  const overall = combine(volume, competition);
  return {
    volume,
    competition,
    weightedCompetition,
    overall,
    weightedOverall: weightedCompetition === null ? null : combine(volume, weightedCompetition),
    band: bandFor(overall),
    details: { medianViews, medianViewsPerDay, titleMatchShare, verifiedShare, freshShare, suggestScore: sScore },
  };
}

/** Prefixes to probe autocomplete with, as fractions of the keyword length, shortest first. */
export function suggestProbePrefixes(keyword: string): { prefix: string; fraction: number }[] {
  const k = keyword.trim();
  if (k.length < 4) return [];
  const out: { prefix: string; fraction: number }[] = [];
  for (const fraction of [0.4, 0.7, 0.9]) {
    const cut = Math.max(2, Math.floor(k.length * fraction));
    const prefix = k.slice(0, cut).trimEnd();
    if (prefix.length < k.length && !out.some((o) => o.prefix === prefix)) out.push({ prefix, fraction });
  }
  return out;
}
