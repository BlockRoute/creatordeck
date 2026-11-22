import { formatClock, parseClock } from './text';

export interface Chapter {
  seconds: number;
  title: string;
}

const LINE = /^\s*(?:[-*\u2022]\s*)?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-\u2013\u2014:|]?\s*(.+?)\s*$/;

/** Reads timestamp lines ("0:00 Intro", "1:02:03 - Wrap up") from a description. */
export function parseChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const seconds = parseClock(m[1]);
    if (seconds === null) continue;
    chapters.push({ seconds, title: (m[2] as string).trim() });
  }
  return chapters;
}

export function formatChapters(chapters: Chapter[]): string {
  return [...chapters]
    .sort((a, b) => a.seconds - b.seconds)
    .map((c) => `${formatClock(c.seconds)} ${c.title.trim()}`)
    .join('\n');
}

/** Checks YouTube's rules for automatic chapters. Returns human-readable problems; empty when valid. */
export function validateChapters(chapters: Chapter[], durationSeconds?: number | null): string[] {
  const problems: string[] = [];
  const sorted = [...chapters].sort((a, b) => a.seconds - b.seconds);
  if (sorted.length < 3) problems.push('YouTube needs at least three chapters.');
  if (sorted.length && sorted[0]?.seconds !== 0) problems.push('The first chapter must start at 0:00.');
  sorted.forEach((chapter, i) => {
    if (!chapter.title.trim()) problems.push(`The chapter at ${formatClock(chapter.seconds)} has no title.`);
    const next = sorted[i + 1];
    if (next && next.seconds - chapter.seconds < 10) {
      problems.push(`"${chapter.title || formatClock(chapter.seconds)}" is shorter than 10 seconds.`);
    }
  });
  if (JSON.stringify(sorted) !== JSON.stringify(chapters)) problems.push('Chapters are not in ascending order.');
  const last = sorted[sorted.length - 1];
  if (durationSeconds && last && last.seconds >= durationSeconds) problems.push('A chapter starts after the video ends.');
  if (durationSeconds && last && durationSeconds - last.seconds < 10) problems.push('The last chapter is shorter than 10 seconds.');
  return problems;
}

/** Replaces the existing chapter block in a description, or appends one. */
export function applyChapters(description: string, chapters: Chapter[]): string {
  const block = formatChapters(chapters);
  const out: string[] = [];
  let inserted = false;
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m && parseClock(m[1]) !== null) {
      if (!inserted) out.push(block);
      inserted = true;
      continue;
    }
    out.push(line);
  }
  if (inserted) return out.join('\n');
  return description.trim() ? `${description.trimEnd()}\n\n${block}` : block;
}
