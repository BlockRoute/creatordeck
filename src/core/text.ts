const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have how i if in into is it its of on or that the their this to was ' +
    'what when where which who why will with you your vs my me we our they them he she his her do does did not no ' +
    'can just about than then so too very more most all any each out up down over under again new get got'
  ).split(' '),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'#+\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase());
}

/** True when the normalised phrase appears in the text on word boundaries. */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  return ` ${normalize(text)} `.includes(` ${p} `);
}

/** Share of the phrase's content words that appear anywhere in the text (0..1). */
export function wordCoverage(text: string, phrase: string): number {
  const target = contentWords(phrase);
  if (!target.length) return 0;
  const have = new Set(words(text));
  return target.filter((w) => have.has(w)).length / target.length;
}

export function countPhrase(text: string, phrase: string): number {
  const p = normalize(phrase);
  if (!p) return 0;
  const hay = ` ${normalize(text)} `;
  let count = 0;
  let at = hay.indexOf(` ${p} `);
  while (at !== -1) {
    count += 1;
    at = hay.indexOf(` ${p} `, at + p.length + 1);
  }
  return count;
}

export function wordFrequencies(texts: string[], limit = 100): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const w of contentWords(text)) {
      if (w.length < 3 || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)].map((m) => m[2] as string);
}

export function extractLinks(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
}

/** Compact number parser for YouTube strings such as "1.2M views", "31K", "95,385,192 views", "No views". */
export function parseCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = text.replace(/\u00a0/g, ' ').trim();
  if (/^no\b/i.test(t)) return 0;
  const m = t.match(/([\d][\d.,]*)\s*([KMB])?/i);
  if (!m) return null;
  const suffix = (m[2] ?? '').toUpperCase();
  const raw = m[1] as string;
  const value = suffix ? parseFloat(raw.replace(/,/g, '')) : parseFloat(raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (Number.isNaN(value)) return null;
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return Math.round(value * mult);
}

const UNIT_DAYS: Record<string, number> = {
  second: 1 / 86400,
  minute: 1 / 1440,
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30.44,
  year: 365.25,
};

/** "2 weeks ago", "Streamed 11 years ago" -> approximate age in days. */
export function parseAgeDays(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  return Number(m[1]) * (UNIT_DAYS[(m[2] as string).toLowerCase()] ?? 1);
}

/** "3:01", "1:02:03" -> seconds. */
export function parseClock(text: string | undefined | null): number | null {
  if (!text) return null;
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** ISO 8601 duration ("PT1H2M3S") -> seconds. */
export function parseIsoDuration(iso: string | undefined | null): number {
  if (!iso) return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
