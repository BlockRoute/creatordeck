import { useMemo, useState } from 'react';
import { auditBestPractices, practiceSummary } from '../../core/bestPractices';
import { auditMonetization } from '../../core/demonetization';
import { inferKeyword, scoreSeo } from '../../core/seo';
import { parseIsoDuration } from '../../core/text';
import { KEYS } from '../../shared/types';
import type { VideoLibrary } from '../../yt/api';
import { resolveChannelId } from '../../yt/innertube';
import { fetchFeed } from '../../yt/rss';
import { useConnection, useLibrary } from '../channel';
import { Button, Card, Empty, Notice, Page, Pill, Stat, Table, errorMessage, toneFor, useStore, useToast } from '../kit';

interface AuditRow {
  id: string;
  title: string;
  seo: number;
  keyword: string;
  failed: string[];
  risk: 'green' | 'yellow' | 'red';
  riskTerms: string[];
}

function audit(input: { id: string; title: string; description: string; tags: string[] | null; durationSeconds: number | null; hasCaptions: boolean | null; hasHdThumbnail: boolean | null }): AuditRow {
  const tags = input.tags ?? [];
  const keyword = inferKeyword(input.title, tags);
  const practices = auditBestPractices({ ...input, hasEndScreen: null, hasCards: null });
  const risk = auditMonetization({ title: input.title, description: input.description, tags });
  return {
    id: input.id,
    title: input.title,
    keyword,
    seo: scoreSeo({ title: input.title, description: input.description, tags, keyword }).score,
    failed: practices.filter((p) => p.status === 'fail').map((p) => p.label),
    risk: risk.rating,
    riskTerms: [...new Set(risk.hits.map((h) => h.term))],
  };
}

export function AuditPage() {
  const { connected } = useConnection();
  const { refresh, refreshing } = useLibrary();
  const [library] = useStore<VideoLibrary | null>(KEYS.videos, null);
  const [input, setInput] = useState('');
  const [publicRows, setPublicRows] = useState<AuditRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'all' | 'risk' | 'weak'>('all');
  const toast = useToast();

  const ownRows = useMemo(
    () =>
      (library?.items ?? []).map((v) =>
        audit({
          id: v.id,
          title: v.title,
          description: v.description,
          tags: v.tags,
          durationSeconds: parseIsoDuration(v.duration),
          hasCaptions: v.hasCaptions ?? null,
          hasHdThumbnail: /maxres/.test(v.thumbnail),
        }),
      ),
    [library],
  );
  const usingPublic = publicRows !== null;
  const rows = usingPublic ? publicRows : ownRows;
  const visible = rows.filter((r) => (show === 'risk' ? r.risk !== 'green' : show === 'weak' ? r.seo < 50 || r.failed.length >= 3 : true));

  const runPublic = async () => {
    setBusy(true);
    try {
      const id = await resolveChannelId(input);
      if (!id) throw new Error('That channel could not be found.');
      const feed = await fetchFeed(id);
      setPublicRows(feed.entries.map((e) => audit({ id: e.videoId, title: e.title, description: e.description, tags: null, durationSeconds: null, hasCaptions: null, hasHdThumbnail: null })));
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.seo, 0) / rows.length) : 0;
  return (
    <Page title="Channel Audit" subtitle="Run the best-practice, SEO and advertiser-friendliness checks across a whole channel and see which videos need attention first.">
      <div className="grid c2">
        <Card title="Your channel" hint="Every upload, with exact tags and caption status.">
          {connected ? (
            <div className="row">
              <Button variant="primary" busy={refreshing} onClick={() => void refresh().then(() => setPublicRows(null))}>
                {library ? 'Reload and audit my videos' : 'Load and audit my videos'}
              </Button>
              {library && usingPublic ? <Button onClick={() => setPublicRows(null)}>Show my videos</Button> : null}
            </div>
          ) : (
            <div className="muted small">
              <a href="#/settings">Connect your channel</a> to audit all of your uploads.
            </div>
          )}
        </Card>
        <Card title="Any channel" hint="The latest 15 videos from the public feed. Tags, captions and length are not available this way.">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void runPublic();
            }}
          >
            <div className="grow">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Channel URL, @handle or UC… ID" aria-label="Channel to audit" />
            </div>
            <Button type="submit" busy={busy}>
              Audit
            </Button>
          </form>
        </Card>
      </div>

      {!rows.length ? (
        <Empty title="Nothing audited yet">Load your videos or enter a channel above.</Empty>
      ) : (
        <>
          <div className="grid c4">
            <Card>
              <Stat label="Videos audited" value={rows.length} />
            </Card>
            <Card>
              <Stat label="Average SEO score" value={average} />
            </Card>
            <Card>
              <Stat label="Flagged for advertisers" value={rows.filter((r) => r.risk !== 'green').length} hint={`${rows.filter((r) => r.risk === 'red').length} high risk`} />
            </Card>
            <Card>
              <Stat label="Three or more fixes needed" value={rows.filter((r) => r.failed.length >= 3).length} />
            </Card>
          </div>
          {usingPublic ? <Notice>Public audit: checks that need tags, captions or video length are skipped, so scores run lower than they would with full data.</Notice> : null}
          <Card
            title={`${visible.length} videos`}
            actions={
              <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Audit filter" style={{ width: 220 }}>
                <option value="all">All videos</option>
                <option value="risk">Advertiser flags only</option>
                <option value="weak">Weakest first to fix</option>
              </select>
            }
          >
            <Table
              rows={[...visible].sort((a, b) => a.seo - b.seo).slice(0, 200)}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 't',
                  label: 'Video',
                  render: (r) => (
                    <div>
                      <a href={`#/seo/${r.id}`}>{r.title}</a>
                      {r.keyword ? <div className="small muted">Keyword: {r.keyword}</div> : null}
                    </div>
                  ),
                },
                { key: 's', label: 'SEO', align: 'right', render: (r) => <Pill tone={toneFor(r.seo)}>{r.seo}</Pill> },
                {
                  key: 'f',
                  label: 'To fix',
                  render: (r) =>
                    r.failed.length ? (
                      <span className="small">{r.failed.join(' · ')}</span>
                    ) : (
                      <span className="small muted">Nothing found</span>
                    ),
                },
                {
                  key: 'r',
                  label: 'Advertiser check',
                  render: (r) => (
                    <span>
                      <Pill tone={r.risk === 'green' ? 'good' : r.risk === 'yellow' ? 'warn' : 'bad'}>{r.risk === 'green' ? 'clear' : r.risk === 'yellow' ? 'review' : 'high risk'}</Pill>{' '}
                      <span className="small muted">{r.riskTerms.join(', ')}</span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
      <div className="small muted">
        {practiceSummary([]).passed === 0 ? 'The advertiser check flags words in metadata only. It does not see the video itself and is not a monetisation decision.' : ''}
      </div>
    </Page>
  );
}
