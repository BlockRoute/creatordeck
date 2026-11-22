import { DESCRIPTION_MAX, TAGS_MAX_CHARS, TITLE_MAX, tagCharCount } from './seo';

export type BulkField = 'title' | 'description' | 'tags';

export type BulkOperation =
  | { kind: 'replace'; field: BulkField; find: string; replaceWith: string; regex: boolean; caseSensitive: boolean }
  | { kind: 'append'; field: 'title' | 'description'; text: string }
  | { kind: 'prepend'; field: 'title' | 'description'; text: string }
  | { kind: 'addTags'; tags: string[] }
  | { kind: 'removeTags'; tags: string[] };

export interface EditableVideo {
  id: string;
  title: string;
  description: string;
  tags: string[];
}

export interface BulkChange {
  id: string;
  before: EditableVideo;
  after: EditableVideo;
  changedFields: BulkField[];
  /** Reasons YouTube would reject the result; a change with problems is never applied. */
  problems: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(find: string, regex: boolean, caseSensitive: boolean): RegExp {
  return new RegExp(regex ? find : escapeRegExp(find), caseSensitive ? 'g' : 'gi');
}

function replaceIn(text: string, op: Extract<BulkOperation, { kind: 'replace' }>): string {
  if (!op.find) return text;
  const matcher = buildMatcher(op.find, op.regex, op.caseSensitive);
  // A function replacement keeps "$" in plain-text replacements literal.
  return op.regex ? text.replace(matcher, op.replaceWith) : text.replace(matcher, () => op.replaceWith);
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function applyOperation(video: EditableVideo, op: BulkOperation): EditableVideo {
  const next: EditableVideo = { ...video, tags: [...video.tags] };
  switch (op.kind) {
    case 'replace':
      if (op.field === 'tags') next.tags = dedupeTags(next.tags.map((t) => replaceIn(t, op)));
      else next[op.field] = replaceIn(next[op.field], op);
      return next;
    case 'append':
      if (op.field === 'description') next.description = next.description ? `${next.description}\n${op.text}` : op.text;
      else next.title = `${next.title}${op.text}`;
      return next;
    case 'prepend':
      if (op.field === 'description') next.description = next.description ? `${op.text}\n${next.description}` : op.text;
      else next.title = `${op.text}${next.title}`;
      return next;
    case 'addTags':
      next.tags = dedupeTags([...next.tags, ...op.tags]);
      return next;
    case 'removeTags': {
      const remove = new Set(op.tags.map((t) => t.trim().toLowerCase()));
      next.tags = next.tags.filter((t) => !remove.has(t.trim().toLowerCase()));
      return next;
    }
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

export function validateVideo(video: EditableVideo): string[] {
  const problems: string[] = [];
  if (!video.title.trim()) problems.push('Title would be empty.');
  if (video.title.length > TITLE_MAX) problems.push(`Title would be ${video.title.length} characters (limit ${TITLE_MAX}).`);
  if (/[<>]/.test(video.title)) problems.push('Title cannot contain < or >.');
  if (video.description.length > DESCRIPTION_MAX) {
    problems.push(`Description would be ${video.description.length} characters (limit ${DESCRIPTION_MAX}).`);
  }
  if (/[<>]/.test(video.description)) problems.push('Description cannot contain < or >.');
  const chars = tagCharCount(video.tags);
  if (chars > TAGS_MAX_CHARS) problems.push(`Tags would use ${chars} characters (limit ${TAGS_MAX_CHARS}).`);
  if (video.tags.some((t) => /[<>]/.test(t))) problems.push('Tags cannot contain < or >.');
  return problems;
}

/** Dry run: returns only the videos the operations would actually change. */
export function previewBulk(videos: EditableVideo[], operations: BulkOperation[]): BulkChange[] {
  const changes: BulkChange[] = [];
  for (const video of videos) {
    const after = operations.reduce(applyOperation, video);
    const changedFields: BulkField[] = [];
    if (after.title !== video.title) changedFields.push('title');
    if (after.description !== video.description) changedFields.push('description');
    if (after.tags.join('\u0001') !== video.tags.join('\u0001')) changedFields.push('tags');
    if (!changedFields.length) continue;
    changes.push({ id: video.id, before: video, after, changedFields, problems: validateVideo(after) });
  }
  return changes;
}
