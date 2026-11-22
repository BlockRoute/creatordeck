import { useState } from 'react';
import { tagCharCount, TAGS_MAX_CHARS } from '../../core/seo';
import { uid, wordCoverage } from '../../core/text';
import { researchKeyword, suggestTags, type TagSuggestion } from '../../services/research';
import { KEYS, type TagList } from '../../shared/types';
import { Button, Card, CopyButton, Empty, Field, Notice, Page, Pill, Table, Tabs, errorMessage, useStore, useToast } from '../kit';
import { TagEditor, mergeTags, parseTagInput } from '../TagEditor';

function SuggestedTags() {
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ suggestions: TagSuggestion[]; videosRead: number; videosTried: number } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [, setLists] = useStore<TagList[]>(KEYS.tagLists, []);
  const toast = useToast();

  const run = async () => {
    if (!keyword.trim()) return;
    setBusy(true);
    setResult(null);
    setPicked([]);
    try {
      const report = await researchKeyword(keyword.trim());
      const ids = report.results.slice(0, 8).map((r) => r.videoId);
      setResult({ ...(await suggestTags(keyword.trim(), ids)), videosTried: ids.length });
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const fill = () => {
    const out: string[] = [];
    for (const s of result?.suggestions ?? []) {
      if (tagCharCount([...out, s.tag]) > TAGS_MAX_CHARS) break;
      out.push(s.tag);
    }
    setPicked(out);
  };

  return (
    <div className="stack">
      <Card title="Suggested tags" hint="Combines autocomplete phrases with the tags used by the videos that rank for your keyword.">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="grow">
            <Field label="Target keyword or working title">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. sourdough starter" aria-label="Target keyword" />
            </Field>
          </div>
          <Button variant="primary" type="submit" busy={busy} style={{ alignSelf: 'flex-end' }}>
            Suggest tags
          </Button>
        </form>
      </Card>
      {result ? (
        <Card
          title={`${result.suggestions.length} suggestions`}
          hint={
            result.videosRead
              ? `Read the tags of ${result.videosRead} of the top ${result.videosTried} videos.`
              : 'YouTube did not expose the tags of the ranking videos here, so these come from autocomplete only.'
          }
          actions={
            <>
              <Button variant="small" onClick={fill}>
                Fill to 500 characters
              </Button>
              <CopyButton text={picked.join(', ')} label={`Copy ${picked.length} picked`} />
              <Button
                variant="small"
                disabled={!picked.length}
                onClick={() => {
                  setLists((lists) => [...lists, { id: uid(), name: keyword.trim(), tags: picked, updatedAt: Date.now() }]);
                  toast('Saved as a tag list.', 'good');
                }}
              >
                Save as list
              </Button>
            </>
          }
        >
          <div className="small muted">
            Picked {picked.length} tags · {tagCharCount(picked)}/{TAGS_MAX_CHARS} characters
          </div>
          <Table
            rows={result.suggestions.slice(0, 80)}
            rowKey={(r) => r.tag}
            columns={[
              {
                key: 'pick',
                label: '',
                render: (r) => (
                  <input
                    type="checkbox"
                    aria-label={`Pick ${r.tag}`}
                    checked={picked.includes(r.tag)}
                    onChange={() => setPicked((list) => (list.includes(r.tag) ? list.filter((t) => t !== r.tag) : [...list, r.tag]))}
                  />
                ),
              },
              { key: 'tag', label: 'Tag', render: (r) => r.tag },
              { key: 'rel', label: 'Relevance', align: 'right', render: (r) => r.relevance },
              { key: 'used', label: 'Used by top videos', align: 'right', render: (r) => r.usedBy || '–' },
              { key: 'src', label: 'Source', render: (r) => (r.fromAutocomplete ? <Pill tone="accent">autocomplete</Pill> : <Pill>competitor tag</Pill>) },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

type SortMode = 'relevance' | 'alpha' | 'short' | 'long';

function TagSorter() {
  const [raw, setRaw] = useState('');
  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<SortMode>('relevance');
  const tags = mergeTags([], parseTagInput(raw));
  const sorted = [...tags].sort((a, b) => {
    if (mode === 'alpha') return a.localeCompare(b);
    if (mode === 'short') return a.length - b.length;
    if (mode === 'long') return b.length - a.length;
    return wordCoverage(b, keyword) - wordCoverage(a, keyword) || b.split(' ').length - a.split(' ').length;
  });
  const chars = tagCharCount(sorted);
  return (
    <Card title="Tag sorter and cleaner" hint="Paste tags to remove duplicates, check the character budget and put the most relevant first.">
      <Field label="Tags" hint="comma or line separated">
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="paste tags here" aria-label="Tags to sort" />
      </Field>
      <div className="grid c2">
        <Field label="Target keyword" hint="used for relevance order">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Sort keyword" />
        </Field>
        <Field label="Order">
          <select value={mode} onChange={(e) => setMode(e.target.value as SortMode)}>
            <option value="relevance">Most relevant to keyword first</option>
            <option value="alpha">Alphabetical</option>
            <option value="short">Shortest first</option>
            <option value="long">Longest first</option>
          </select>
        </Field>
      </div>
      {sorted.length ? (
        <>
          <div className="row between">
            <span className="small muted">
              {sorted.length} unique tags · <span className={chars > TAGS_MAX_CHARS ? 'bad' : ''}>{chars}</span>/{TAGS_MAX_CHARS} characters
            </span>
            <CopyButton text={sorted.join(', ')} label="Copy sorted" />
          </div>
          <div className="chips">
            {sorted.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function TagLists() {
  const [lists, setLists] = useStore<TagList[]>(KEYS.tagLists, []);
  const [name, setName] = useState('');
  const patch = (id: string, change: Partial<TagList>) => setLists((all) => all.map((l) => (l.id === id ? { ...l, ...change, updatedAt: Date.now() } : l)));
  return (
    <div className="stack">
      <Card title="Tag lists" hint="Reusable sets of tags. Apply them from SEO Studio, Bulk Edit and Upload Profiles.">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setLists((all) => [...all, { id: uid(), name: name.trim(), tags: [], updatedAt: Date.now() }]);
            setName('');
          }}
        >
          <div className="grow">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name" aria-label="New list name" />
          </div>
          <Button variant="primary" type="submit">
            Create list
          </Button>
        </form>
      </Card>
      {!lists.length ? <Empty title="No tag lists yet">Create one above, or save one from Keyword Explorer or Suggested tags.</Empty> : null}
      {lists.map((list) => (
        <Card
          key={list.id}
          title={list.name}
          actions={
            <Button variant="danger" onClick={() => setLists((all) => all.filter((l) => l.id !== list.id))}>
              Delete
            </Button>
          }
        >
          <TagEditor tags={list.tags} onChange={(tags) => patch(list.id, { tags })} />
        </Card>
      ))}
    </div>
  );
}

export function TagsPage() {
  const [tab, setTab] = useState<'suggest' | 'sort' | 'lists'>('suggest');
  return (
    <Page title="Tag Tools" subtitle="Find tags that match what people search for, tidy the ones you have, and keep reusable lists.">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'suggest', label: 'Suggested tags' },
          { value: 'sort', label: 'Sorter' },
          { value: 'lists', label: 'Tag lists' },
        ]}
      />
      {tab === 'suggest' ? <SuggestedTags /> : tab === 'sort' ? <TagSorter /> : <TagLists />}
      {tab === 'suggest' ? <Notice>Tags play a small role in ranking. Use them for spelling variants and close synonyms of your keyword.</Notice> : null}
    </Page>
  );
}
