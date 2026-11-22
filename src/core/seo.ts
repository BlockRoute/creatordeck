import { clamp, containsPhrase, countPhrase, extractHashtags, extractLinks, normalize, wordCoverage, words } from './text';

export interface SeoInput {
  title: string;
  description: string;
  tags: string[];
  keyword: string;
}

export interface SeoCheck {
  id: string;
  label: string;
  /** 0..1 share of the weight earned. */
  score: number;
  weight: number;
  tip: string;
}

export interface SeoResult {
  score: number;
  checks: SeoCheck[];
}

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
export const TAGS_MAX_CHARS = 500;

/** YouTube counts tag characters with separators; tags containing spaces cost two extra for quotes. */
export function tagCharCount(tags: string[]): number {
  return tags.reduce((sum, tag, i) => sum + tag.length + (tag.includes(' ') ? 2 : 0) + (i > 0 ? 1 : 0), 0);
}

function check(id: string, label: string, weight: number, score: number, tip: string): SeoCheck {
  return { id, label, weight, score: clamp(score, 0, 1), tip };
}

export function scoreSeo(input: SeoInput): SeoResult {
  const { title, description, tags, keyword } = input;
  const kw = normalize(keyword);
  const checks: SeoCheck[] = [];
  const titleNorm = normalize(title);
  const descriptionOpening = description.slice(0, 200);

  if (kw) {
    const exact = containsPhrase(title, kw);
    const coverage = wordCoverage(title, kw);
    checks.push(
      check(
        'title-keyword',
        'Target keyword in title',
        22,
        exact ? 1 : coverage * 0.6,
        exact ? 'The title contains the exact keyword.' : 'Use the exact keyword phrase in the title.',
      ),
    );
    const position = titleNorm.indexOf(kw);
    checks.push(
      check(
        'title-keyword-early',
        'Keyword near the start of the title',
        6,
        position === -1 ? 0 : position <= 15 ? 1 : position <= 35 ? 0.5 : 0.2,
        'Lead with the keyword; the first words carry the most weight and survive truncation.',
      ),
    );
    const inOpening = containsPhrase(descriptionOpening, kw);
    checks.push(
      check(
        'description-keyword-opening',
        'Keyword in the first two lines of the description',
        12,
        inOpening ? 1 : wordCoverage(descriptionOpening, kw) * 0.5,
        'Mention the keyword in the first 200 characters; that part shows in search results.',
      ),
    );
    const mentions = countPhrase(description, kw);
    checks.push(
      check(
        'description-keyword-repeat',
        'Keyword repeated naturally in the description',
        6,
        mentions >= 2 && mentions <= 5 ? 1 : mentions === 1 ? 0.5 : mentions > 5 ? 0.4 : 0,
        mentions > 5 ? 'The keyword appears very often; trim repeats to avoid looking like stuffing.' : 'Use the keyword two to four times across the description.',
      ),
    );
    const tagNorms = tags.map(normalize);
    const tagExact = tagNorms.includes(kw);
    checks.push(
      check(
        'tag-keyword',
        'Keyword used as a tag',
        10,
        tagExact ? (tagNorms[0] === kw ? 1 : 0.8) : 0,
        tagExact ? 'Put the target keyword first in the tag list.' : 'Add the exact keyword as your first tag.',
      ),
    );
    const kwWords = new Set(words(kw));
    const related = tagNorms.filter((t) => t !== kw && words(t).some((w) => kwWords.has(w))).length;
    checks.push(
      check(
        'tag-variations',
        'Tags that vary the keyword',
        6,
        Math.min(1, related / 4),
        'Add four or more tags that extend or rephrase the keyword.',
      ),
    );
  }

  const titleLength = title.trim().length;
  checks.push(
    check(
      'title-length',
      'Title length',
      8,
      titleLength === 0 ? 0 : titleLength > TITLE_MAX ? 0 : titleLength >= 30 && titleLength <= 70 ? 1 : titleLength < 30 ? titleLength / 30 : 0.6,
      titleLength > 70 ? 'Titles over 70 characters are cut off in most places.' : 'Aim for 30 to 70 characters.',
    ),
  );

  const descriptionLength = description.trim().length;
  checks.push(
    check(
      'description-length',
      'Description length',
      10,
      descriptionLength > DESCRIPTION_MAX ? 0 : Math.min(1, descriptionLength / 500),
      'Write at least 500 characters describing what the video covers.',
    ),
  );

  const chars = tagCharCount(tags);
  checks.push(
    check(
      'tags-volume',
      'Tag space used',
      8,
      chars > TAGS_MAX_CHARS ? 0 : Math.min(1, chars / 300),
      chars > TAGS_MAX_CHARS ? 'Tags exceed the 500 character limit.' : 'Use 300 to 500 characters of tags.',
    ),
  );

  const multiWord = tags.filter((t) => t.trim().includes(' ')).length;
  checks.push(
    check(
      'tags-specific',
      'Specific multi-word tags',
      4,
      tags.length ? Math.min(1, multiWord / Math.max(3, tags.length * 0.5)) : 0,
      'Prefer specific phrases over single generic words.',
    ),
  );

  const hashtags = extractHashtags(description);
  checks.push(
    check(
      'hashtags',
      'Hashtags',
      4,
      hashtags.length > 15 ? 0 : hashtags.length >= 1 ? 1 : 0.3,
      hashtags.length > 15 ? 'More than 15 hashtags makes YouTube ignore all of them.' : 'Add one to three relevant hashtags.',
    ),
  );

  checks.push(
    check(
      'links',
      'Links or calls to action in the description',
      4,
      extractLinks(description).length > 0 ? 1 : 0,
      'Link to related videos, playlists or your site.',
    ),
  );

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.weight * c.score, 0);
  return { score: totalWeight ? Math.round((earned / totalWeight) * 100) : 0, checks };
}

/** Best guess at the keyword a video targets: the first tag that also appears in the title, else the first tag. */
export function inferKeyword(title: string, tags: string[]): string {
  const inTitle = tags.find((t) => t.trim().length > 2 && containsPhrase(title, t));
  return inTitle ?? tags[0] ?? '';
}
