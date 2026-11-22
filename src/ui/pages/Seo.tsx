import { useEffect, useState } from 'react';
import { auditMonetization } from '../../core/demonetization';
import { DESCRIPTION_MAX, TITLE_MAX, inferKeyword, scoreSeo } from '../../core/seo';
import { uid } from '../../core/text';
import { researchKeyword, suggestTags } from '../../services/research';
import { loadVideoInsight } from '../../services/video';
import { KEYS, type TagList } from '../../shared/types';
import { fetchVideosById, updateVideoSnippet } from '../../yt/api';
import { useConnection } from '../channel';
import { Button, Card, CopyButton, Field, Gauge, Loading, Notice, Page, Pill, errorMessage, useRoute, useStore, useToast } from '../kit';
import { TagEditor, mergeTags } from '../TagEditor';
import { SeoChecks, VideoInput } from './Video';

interface Draft {
  id: string;
  videoId: string;
  keyword: string;
  title: string;
  description: string;
  tags: string[];
  savedAt: number;
}

const BLANK = { keyword: '', title: '', description: '', tags: [] as string[] };

export function SeoPage() {
  const route = useRoute();
  const videoId = route.parts[1] ?? '';
  const { connected } = useConnection();
  const [form, setForm] = useState(BLANK);
  const [original, setOriginal] = useState<typeof BLANK | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagsUnavailable, setTagsUnavailable] = useState(false);
  const [busy, setBusy] = useState<'tags' | 'save' | null>(null);
  const [drafts, setDrafts] = useStore<Draft[]>(KEYS.seoDrafts, []);
  const [lists] = useStore<TagList[]>(KEYS.tagLists, []);
  const toast = useToast();

  useEffect(() => {
    if (!videoId) {
      setOriginal(null);
      return;
    }
    let live = true;
    setLoading(true);
    setLoadError(null);
    setTagsUnavailable(false);
    (async () => {
      // The Data API is exact for your own videos; the public route covers everything else.
      const own = connected ? ((await fetchVideosById([videoId]).catch(() => []))[0] ?? null) : null;
      const loaded = own ? { title: own.title, description: own.description, tags: own.tags } : await loadVideoInsight(videoId).then((v) => ({ title: v.title, description: v.description, tags: v.tags }));
      if (!live) return;
      const next = { keyword: inferKeyword(loaded.title, loaded.tags ?? []), title: loaded.title, description: loaded.description, tags: loaded.tags ?? [] };
      setTagsUnavailable(loaded.tags === null);
      setForm(next);
      setOriginal(next);
    })()
      .catch((error) => live && setLoadError(errorMessage(error)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [videoId, connected]);

  const seo = scoreSeo(form);
  const risk = auditMonetization(form);
  const dirty = !!original && (original.title !== form.title || original.description !== form.description || original.tags.join('|') !== form.tags.join('|'));
  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const addSuggested = async () => {
    if (!form.keyword.trim()) return toast('Enter a target keyword first.', 'warn');
    setBusy('tags');
    try {
      const report = await researchKeyword(form.keyword.trim());
      const { suggestions } = await suggestTags(form.keyword.trim(), report.results.slice(0, 5).map((r) => r.videoId));
      set({ tags: mergeTags(form.tags, suggestions.slice(0, 12).map((s) => s.tag)) });
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await updateVideoSnippet(videoId, { title: form.title, description: form.description, tags: form.tags });
      setOriginal(form);
      toast('Saved to YouTube.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () => {
    setDrafts((all) => [{ id: uid(), videoId, ...form, savedAt: Date.now() }, ...all].slice(0, 30));
    toast('Draft saved.', 'good');
  };

  return (
    <Page title="SEO Studio" subtitle="Write a title, description and tags around one target keyword, and watch the score respond as you type.">
      <Card title="Start from a video" hint="Optional. Leave empty to draft for a video you have not uploaded yet.">
        <VideoInput base="/seo" placeholder="Paste a video link or ID to load its current metadata" />
      </Card>
      {loading ? <Loading label="Loading the video" /> : null}
      {loadError ? <Notice tone="bad">{loadError}</Notice> : null}
      {tagsUnavailable ? <Notice tone="warn">The current tags could not be read, so the tag list starts empty. Connect your channel to load them exactly.</Notice> : null}

      <div className="grid c2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <Field label="Target keyword" hint="the search you want this video to rank for">
              <input value={form.keyword} onChange={(e) => set({ keyword: e.target.value })} placeholder="e.g. sourdough starter" aria-label="Target keyword" />
            </Field>
            {form.keyword.trim() ? <a href={`#/keywords?q=${encodeURIComponent(form.keyword.trim())}`}>Research this keyword</a> : null}
            <Field label="Title" hint={`${form.title.length}/${TITLE_MAX}`}>
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
            </Field>
            <Field label="Description" hint={`${form.description.length}/${DESCRIPTION_MAX}`}>
              <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={10} aria-label="Description" />
            </Field>
            <div className="row">
              <CopyButton text={form.title} label="Copy title" />
              <CopyButton text={form.description} label="Copy description" />
              {videoId ? <a href={`#/chapters/${videoId}`}>Edit chapters</a> : null}
            </div>
          </Card>
          <Card
            title="Tags"
            actions={
              <Button variant="small" busy={busy === 'tags'} onClick={() => void addSuggested()}>
                Add suggested tags
              </Button>
            }
          >
            <TagEditor tags={form.tags} onChange={(tags) => set({ tags })} />
            {lists.length ? (
              <div className="chips">
                <span className="small muted">Add from list:</span>
                {lists.map((l) => (
                  <span key={l.id} className="chip clickable" onClick={() => set({ tags: mergeTags(form.tags, l.tags) })}>
                    + {l.name} ({l.tags.length})
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="stack">
          <Card title="Score">
            <div className="row" style={{ gap: 18 }}>
              <Gauge value={seo.score} label="SEO score" />
              <div className="grow stack">
                <Pill tone={risk.rating === 'green' ? 'good' : risk.rating === 'yellow' ? 'warn' : 'bad'}>
                  Advertiser check: {risk.rating === 'green' ? 'nothing flagged' : `${risk.hits.length} term${risk.hits.length === 1 ? '' : 's'} flagged`}
                </Pill>
                {risk.hits.length ? <div className="small muted">{[...new Set(risk.hits.map((h) => h.term))].join(', ')}</div> : null}
                {!form.keyword.trim() ? <div className="small muted">Add a target keyword to unlock the keyword checks.</div> : null}
              </div>
            </div>
            <SeoChecks checks={seo.checks} />
          </Card>
          <Card title="Apply">
            <div className="row">
              <Button onClick={saveDraft}>Save draft</Button>
              {videoId && connected ? (
                <Button variant="primary" busy={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
                  Save to YouTube
                </Button>
              ) : null}
            </div>
            {videoId && !connected ? <div className="small muted">Connect your channel in Settings to save straight to YouTube. Until then, copy each field into YouTube Studio.</div> : null}
            {videoId && connected ? <div className="small muted">Saving costs 51 API quota units and only works for videos on your connected channel.</div> : null}
          </Card>
          {drafts.length ? (
            <Card title="Drafts">
              {drafts.map((d) => (
                <div key={d.id} className="row between">
                  <div className="grow truncate">
                    {d.title || d.keyword || 'Untitled'} <span className="muted small">· {new Date(d.savedAt).toLocaleString()}</span>
                  </div>
                  <div className="row">
                    <Button variant="small" onClick={() => setForm({ keyword: d.keyword, title: d.title, description: d.description, tags: d.tags })}>
                      Load
                    </Button>
                    <Button variant="small" onClick={() => setDrafts((all) => all.filter((x) => x.id !== d.id))}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
