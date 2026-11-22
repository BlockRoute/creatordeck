import { parseChapters } from './chapters';
import { TAGS_MAX_CHARS, tagCharCount } from './seo';
import { extractHashtags, extractLinks } from './text';

export interface VideoFacts {
  title: string;
  description: string;
  /** null when tags could not be read. */
  tags: string[] | null;
  durationSeconds: number | null;
  hasHdThumbnail: boolean | null;
  hasCaptions: boolean | null;
  hasEndScreen: boolean | null;
  hasCards: boolean | null;
}

export type PracticeStatus = 'pass' | 'fail' | 'unknown';

export interface PracticeCheck {
  id: string;
  label: string;
  status: PracticeStatus;
  detail: string;
}

function tri(value: boolean | null): PracticeStatus {
  return value === null ? 'unknown' : value ? 'pass' : 'fail';
}

export function auditBestPractices(facts: VideoFacts): PracticeCheck[] {
  const checks: PracticeCheck[] = [];
  const titleLength = facts.title.trim().length;
  checks.push({
    id: 'title-length',
    label: 'Title between 30 and 70 characters',
    status: titleLength >= 30 && titleLength <= 70 ? 'pass' : 'fail',
    detail: `${titleLength} characters`,
  });

  const descriptionLength = facts.description.trim().length;
  checks.push({
    id: 'description-length',
    label: 'Description of at least 250 characters',
    status: descriptionLength >= 250 ? 'pass' : 'fail',
    detail: `${descriptionLength} characters`,
  });

  const links = extractLinks(facts.description);
  checks.push({
    id: 'description-links',
    label: 'Description links to more content',
    status: links.length > 0 ? 'pass' : 'fail',
    detail: links.length ? `${links.length} link${links.length === 1 ? '' : 's'}` : 'No links found',
  });

  const hashtags = extractHashtags(`${facts.title} ${facts.description}`);
  checks.push({
    id: 'hashtags',
    label: 'One to fifteen hashtags',
    status: hashtags.length >= 1 && hashtags.length <= 15 ? 'pass' : 'fail',
    detail: hashtags.length > 15 ? `${hashtags.length} hashtags; YouTube ignores all of them above 15` : `${hashtags.length} hashtags`,
  });

  if (facts.tags === null) {
    checks.push({ id: 'tags', label: 'Tags use most of the 500 characters', status: 'unknown', detail: 'Tags could not be read' });
  } else {
    const chars = tagCharCount(facts.tags);
    checks.push({
      id: 'tags',
      label: 'Tags use most of the 500 characters',
      status: chars >= 200 && chars <= TAGS_MAX_CHARS ? 'pass' : 'fail',
      detail: `${facts.tags.length} tags, ${chars} characters`,
    });
  }

  const chapters = parseChapters(facts.description);
  const longEnough = facts.durationSeconds === null ? null : facts.durationSeconds >= 180;
  checks.push({
    id: 'chapters',
    label: 'Chapters for videos over three minutes',
    status: longEnough === false ? 'pass' : chapters.length >= 3 ? 'pass' : longEnough === null ? 'unknown' : 'fail',
    detail: longEnough === false ? 'Short video; chapters not needed' : `${chapters.length} chapter timestamps`,
  });

  checks.push({
    id: 'thumbnail',
    label: 'High-resolution custom thumbnail',
    status: tri(facts.hasHdThumbnail),
    detail: facts.hasHdThumbnail === null ? 'Not checked' : facts.hasHdThumbnail ? '1280x720 image present' : 'No 1280x720 thumbnail found',
  });
  checks.push({
    id: 'captions',
    label: 'Captions available',
    status: tri(facts.hasCaptions),
    detail: facts.hasCaptions === null ? 'Could not be read' : facts.hasCaptions ? 'Caption track present' : 'No caption track',
  });
  checks.push({
    id: 'end-screen',
    label: 'End screen added',
    status: tri(facts.hasEndScreen),
    detail: facts.hasEndScreen === null ? 'Could not be read' : facts.hasEndScreen ? 'End screen present' : 'No end screen',
  });
  checks.push({
    id: 'cards',
    label: 'Info cards added',
    status: tri(facts.hasCards),
    detail: facts.hasCards === null ? 'Could not be read' : facts.hasCards ? 'Cards present' : 'No cards',
  });
  return checks;
}

export function practiceSummary(checks: PracticeCheck[]): { passed: number; failed: number; unknown: number } {
  return {
    passed: checks.filter((c) => c.status === 'pass').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    unknown: checks.filter((c) => c.status === 'unknown').length,
  };
}
