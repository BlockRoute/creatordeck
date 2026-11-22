import { useEffect, useState } from 'react';
import { TAGS_MAX_CHARS, tagCharCount } from '../core/seo';
import { suggest } from '../yt/suggest';
import { CopyButton } from './kit';

export function parseTagInput(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTags(current: string[], added: string[]): string[] {
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const out = [...current];
  for (const tag of added) {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag.trim());
  }
  return out;
}

/** Tag chips with comma/Enter entry, live autocomplete suggestions and the 500-character budget. */
export function TagEditor({ tags, onChange, label = 'Tags' }: { tags: string[]; onChange: (tags: string[]) => void; label?: string }) {
  const [draft, setDraft] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const used = tagCharCount(tags);

  useEffect(() => {
    if (draft.trim().length < 2) {
      setHints([]);
      return;
    }
    const timer = setTimeout(() => void suggest(draft).then(setHints, () => setHints([])), 200);
    return () => clearTimeout(timer);
  }, [draft]);

  const add = (text: string) => {
    onChange(mergeTags(tags, parseTagInput(text)));
    setDraft('');
    setHints([]);
  };

  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">
          {label} · {tags.length} tags · <span className={used > TAGS_MAX_CHARS ? 'bad' : ''}>{used}</span>/{TAGS_MAX_CHARS} characters
        </span>
        <div className="row">
          <CopyButton text={tags.join(', ')} label="Copy all" />
        </div>
      </div>
      <div className="chips">
        {tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        placeholder="Type a tag and press Enter (commas add several)"
        aria-label="Add tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            add(text);
          }
        }}
      />
      {hints.length ? (
        <div className="chips">
          <span className="small muted">Autocomplete:</span>
          {hints
            .filter((h) => !tags.some((t) => t.toLowerCase() === h.toLowerCase()))
            .map((h) => (
              <span key={h} className="chip clickable" onClick={() => add(h)}>
                + {h}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}
