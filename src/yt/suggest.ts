import { suggestProbePrefixes, type SuggestSignal } from '../core/keywordScore';
import { normalize } from '../core/text';

const cache = new Map<string, string[]>();

/** YouTube search autocomplete for a query. */
export async function suggest(query: string, locale: { hl: string; gl: string } = { hl: 'en', gl: 'US' }): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `${locale.hl}|${locale.gl}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&ie=utf-8&oe=utf-8&hl=${locale.hl}&gl=${locale.gl}&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Autocomplete returned ${response.status}`);
  const json = (await response.json()) as [string, string[]];
  const list = Array.isArray(json[1]) ? json[1].filter((s) => typeof s === 'string') : [];
  cache.set(key, list);
  return list;
}

/** Measures how early autocomplete offers the keyword and how many completions extend it. */
export async function suggestSignal(keyword: string, locale?: { hl: string; gl: string }): Promise<SuggestSignal> {
  const target = normalize(keyword);
  const completions = (await suggest(keyword, locale)).filter((s) => normalize(s) !== target && normalize(s).startsWith(target)).length;
  let earliestPrefix: number | null = null;
  for (const probe of suggestProbePrefixes(keyword)) {
    const offered = (await suggest(probe.prefix, locale)).some((s) => normalize(s) === target);
    if (offered) {
      earliestPrefix = probe.fraction;
      break;
    }
  }
  return { earliestPrefix, completions };
}

const QUESTION_PREFIXES = ['how to', 'what is', 'why', 'best', 'vs'];

/** Related searches: direct completions, then alphabet and question expansions. */
export async function expandKeyword(keyword: string, locale?: { hl: string; gl: string }, deep = false): Promise<string[]> {
  const base = keyword.trim();
  const seeds = [base, `${base} `, ...QUESTION_PREFIXES.map((p) => `${p} ${base}`)];
  if (deep) seeds.push(...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `${base} ${c}`));
  const out = new Map<string, string>();
  const target = normalize(base);
  for (let i = 0; i < seeds.length; i += 4) {
    const batch = await Promise.all(seeds.slice(i, i + 4).map((s) => suggest(s, locale).catch(() => [] as string[])));
    for (const list of batch) for (const s of list) if (normalize(s) !== target && !out.has(normalize(s))) out.set(normalize(s), s);
  }
  return [...out.values()];
}
