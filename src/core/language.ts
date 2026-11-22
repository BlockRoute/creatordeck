import { words } from './text';

const SCRIPTS: { name: string; test: RegExp }[] = [
  { name: 'Japanese', test: /[\u3040-\u30ff]/ },
  { name: 'Korean', test: /[\uac00-\ud7af]/ },
  { name: 'Chinese', test: /[\u4e00-\u9fff]/ },
  { name: 'Arabic', test: /[\u0600-\u06ff]/ },
  { name: 'Hebrew', test: /[\u0590-\u05ff]/ },
  { name: 'Hindi', test: /[\u0900-\u097f]/ },
  { name: 'Thai', test: /[\u0e00-\u0e7f]/ },
  { name: 'Greek', test: /[\u0370-\u03ff]/ },
  { name: 'Russian', test: /[\u0400-\u04ff]/ },
];

const LATIN: Record<string, string> = {
  English: 'the and is are you this that with for have not what your how from they will',
  Spanish: 'el la los las de que y en un una por con para como pero más esta este',
  Portuguese: 'o a os as de que e em um uma por com para como mas não você isso',
  French: 'le la les de des et en un une pour avec que qui dans pas vous est sur',
  German: 'der die das und ist nicht mit für ein eine von zu auf ich sie wie auch',
  Italian: 'il lo la gli le di che e un una per con non come sono questo più',
  Dutch: 'de het een en van ik je dat niet is op voor met zijn maar hoe ook',
  Turkish: 've bir bu için ile de da ne çok gibi daha ama nasıl en var',
  Indonesian: 'yang dan di ini itu dengan untuk tidak dari ke cara saya akan ada',
};

const LATIN_SETS = Object.entries(LATIN).map(([name, list]) => ({ name, set: new Set(list.split(' ')) }));

export interface LanguageGuess {
  language: string;
  /** 0..1; low values mean the text was too short or mixed to call. */
  confidence: number;
}

/** A light heuristic: script ranges first, then stopword overlap for Latin-script languages. */
export function detectLanguage(text: string): LanguageGuess {
  const sample = text.slice(0, 4000);
  if (!sample.trim()) return { language: 'Unknown', confidence: 0 };
  const letters = sample.replace(/[^\p{L}]/gu, '');
  for (const script of SCRIPTS) {
    const matches = letters.match(new RegExp(script.test.source, 'g'))?.length ?? 0;
    if (letters.length && matches / letters.length > 0.3) return { language: script.name, confidence: Math.min(1, matches / letters.length + 0.3) };
  }
  const tokens = words(sample);
  if (tokens.length < 3) return { language: 'Unknown', confidence: 0 };
  const scores = LATIN_SETS.map(({ name, set }) => ({ name, hits: tokens.filter((t) => set.has(t)).length })).sort((a, b) => b.hits - a.hits);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.hits === 0) return { language: 'Unknown', confidence: 0 };
  const margin = (best.hits - (second?.hits ?? 0)) / best.hits;
  return { language: best.name, confidence: Math.min(1, (best.hits / tokens.length) * 3) * (0.5 + margin / 2) };
}

export interface LanguageReport {
  title: LanguageGuess;
  description: LanguageGuess;
  tags: LanguageGuess;
  consistent: boolean;
}

export function analyzeLanguages(input: { title: string; description: string; tags: string[] }): LanguageReport {
  const title = detectLanguage(input.title);
  const description = detectLanguage(input.description);
  const tags = detectLanguage(input.tags.join(' '));
  const known = [title, description, tags].filter((g) => g.language !== 'Unknown' && g.confidence >= 0.3).map((g) => g.language);
  return { title, description, tags, consistent: new Set(known).size <= 1 };
}
