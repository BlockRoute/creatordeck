import { useEffect, useState } from 'react';
import { bandFor, volumeLabel } from '../../core/keywordScore';
import { formatCompact, median, uid } from '../../core/text';
import { relatedKeywords, researchKeyword, type KeywordReport } from '../../services/research';
import { KEYS, type TagList } from '../../shared/types';
import type { VideoLibrary } from '../../yt/api';
import { suggest } from '../../yt/suggest';
import { trendDirection, youtubeInterest, type TrendPoint } from '../../yt/trends';
import { Button, Card, Empty, Field, Gauge, LineChart, Loading, Notice, Page, Pill, Stat, Table, Tabs, errorMessage, navigate, toneFor, useAsync, useRoute, useStore, useToast } from '../kit';

function useChannelMedian(): number | null {
  const [library] = useStore<VideoLibrary | null>(KEYS.videos, null);
  if (!library?.items.length) return null;
  return median(
    [...library.items]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 30)
      .map((v) => v.viewCount),
  );
}

function ScoreCards({ report }: { report: KeywordReport }) {
  const s = report.score;
  return (
    <Card>
      <div className="grid c4" style={{ alignItems: 'center' }}>
        <div>
          <Gauge value={s.weightedOverall ?? s.overall} label={s.weightedOverall === null ? 'Overall score' : 'Overall score for your channel'} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
            <Pill tone={toneFor(s.weightedOverall ?? s.overall)}>{bandFor(s.weightedOverall ?? s.overall)}</Pill>
          </div>
        </div>
        <Gauge value={s.volume} label={`Search demand · ${volumeLabel(s.volume)}`} />
        <Gauge value={s.competition} label="Competition" invert />
        <Gauge value={s.weightedCompetition} label="Competition for your channel" invert />
      </div>
      <Notice>
        These scores are estimates built from public signals (autocomplete, the current top 20 results and their view counts). They rank keywords against each other; they are not
        measured search volumes.{s.weightedCompetition === null ? ' Load your videos (Bulk Edit or Backup) to get the channel-adjusted scores.' : ''}
      </Notice>
    </Card>
  );
}

function TrendCard({ keyword }: { keyword: string }) {
  const trend = useAsync<TrendPoint[] | null>(() => youtubeInterest(keyword), [keyword]);
  const direction = trend.data ? trendDirection(trend.data) : null;
  return (
    <Card
      title="Interest over time"
      hint="YouTube search interest, past 12 months, from Google Trends"
      actions={direction !== null ? <Pill tone={direction >= 1.1 ? 'good' : direction <= 0.9 ? 'bad' : undefined}>{direction >= 1.1 ? 'Rising' : direction <= 0.9 ? 'Falling' : 'Steady'}</Pill> : null}
    >
      {trend.loading ? (
        <Loading label="Asking Google Trends" />
      ) : trend.data ? (
        <LineChart series={[{ label: keyword, points: trend.data.map((p) => ({ x: p.label, y: p.value })) }]} height={150} />
      ) : (
        <div className="muted small">
          Google Trends did not return data for this request (it rate-limits automated lookups).{' '}
          <a href={`https://trends.google.com/trends/explore?gprop=youtube&q=${encodeURIComponent(keyword)}`} target="_blank" rel="noreferrer">
            Open in Google Trends
          </a>
        </div>
      )}
    </Card>
  );
}

function Results({ report }: { report: KeywordReport }) {
  return (
    <Card title="Top results" hint={`${report.results.length} videos ranking now`}>
      <Table
        rows={report.results}
        rowKey={(r) => r.videoId}
        columns={[
          { key: 'n', label: '#', render: (_r, i) => <span className="muted">{i + 1}</span> },
          {
            key: 'title',
            label: 'Video',
            render: (r) => (
              <div>
                <a href={`#/video/${r.videoId}`}>{r.title}</a>
                <div className="small muted">
                  {r.channelName}
                  {r.verified ? ' · verified' : ''}
                </div>
              </div>
            ),
          },
          { key: 'views', label: 'Views', align: 'right', render: (r) => formatCompact(r.viewCount) },
          { key: 'age', label: 'Published', render: (r) => <span className="nowrap">{r.publishedText || '–'}</span> },
          { key: 'vpd', label: 'Views/day', align: 'right', render: (r) => (r.viewCount !== null && r.ageDays ? formatCompact(r.viewCount / Math.max(1, r.ageDays)) : '–') },
        ]}
      />
    </Card>
  );
}

function Related({ keyword, selected, onToggle }: { keyword: string; selected: string[]; onToggle: (k: string) => void }) {
  const [deep, setDeep] = useState(false);
  const related = useAsync(() => relatedKeywords(keyword, deep), [keyword, deep]);
  return (
    <Card
      title="Related searches"
      hint="From YouTube autocomplete. Select some to compare or save."
      actions={
        <Button variant="small" onClick={() => setDeep(true)} disabled={deep}>
          {deep ? 'Expanded A–Z' : 'Expand A–Z'}
        </Button>
      }
    >
      {related.loading ? <Loading /> : null}
      {related.error ? <Notice tone="bad">{related.error}</Notice> : null}
      <div className="chips">
        {(related.data ?? []).map((k) => (
          <span key={k} className={`chip clickable ${selected.includes(k) ? 'on' : ''}`} onClick={() => onToggle(k)}>
            {k}
            <button
              type="button"
              title="Explore this keyword"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/keywords?q=${encodeURIComponent(k)}`);
              }}
            >
              ↗
            </button>
          </span>
        ))}
      </div>
      {related.data && !related.data.length ? <div className="muted small">Autocomplete returned nothing for this phrase.</div> : null}
    </Card>
  );
}

function Compare({ keywords, channelMedian }: { keywords: string[]; channelMedian: number | null }) {
  const [rows, setRows] = useState<KeywordReport[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    setRows([]);
    try {
      for (const keyword of keywords) {
        const report = await researchKeyword(keyword, channelMedian);
        setRows((list) => [...list, report].sort((a, b) => (b.score.weightedOverall ?? b.score.overall) - (a.score.weightedOverall ?? a.score.overall)));
      }
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };
  if (keywords.length < 2) return <Empty title="Pick keywords to compare">Select two or more related searches on the Explore tab.</Empty>;
  return (
    <Card
      title={`Compare ${keywords.length} keywords`}
      hint="Each keyword costs one search and a few autocomplete lookups."
      actions={
        <Button variant="primary" busy={busy} onClick={() => void run()}>
          Score them
        </Button>
      }
    >
      <Table
        rows={rows}
        rowKey={(r) => r.keyword}
        empty={busy ? 'Scoring…' : 'Press "Score them" to rank the selected keywords.'}
        columns={[
          { key: 'k', label: 'Keyword', render: (r) => <a href={`#/keywords?q=${encodeURIComponent(r.keyword)}`}>{r.keyword}</a> },
          { key: 'o', label: 'Overall', align: 'right', render: (r) => <Pill tone={toneFor(r.score.weightedOverall ?? r.score.overall)}>{r.score.weightedOverall ?? r.score.overall}</Pill> },
          { key: 'v', label: 'Demand', align: 'right', render: (r) => r.score.volume },
          { key: 'c', label: 'Competition', align: 'right', render: (r) => r.score.weightedCompetition ?? r.score.competition },
          { key: 'm', label: 'Median views (top 10)', align: 'right', render: (r) => formatCompact(r.score.details.medianViews) },
          { key: 'e', label: 'Exact title matches', align: 'right', render: (r) => `${r.exactTitleMatches}/${r.results.length}` },
        ]}
      />
    </Card>
  );
}

export function KeywordsPage() {
  const route = useRoute();
  const q = route.query.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [hints, setHints] = useState<string[]>([]);
  const [tab, setTab] = useState<'explore' | 'compare'>('explore');
  const [selected, setSelected] = useState<string[]>([]);
  const [, setLists] = useStore<TagList[]>(KEYS.tagLists, []);
  const [history, setHistory] = useStore<string[]>(KEYS.keywordHistory, []);
  const channelMedian = useChannelMedian();
  const toast = useToast();
  const report = useAsync(() => researchKeyword(q, channelMedian), [q, channelMedian], !!q);

  useEffect(() => {
    setInput(q);
    setSelected([]);
    setTab('explore');
    if (q) setHistory((list) => [q, ...list.filter((k) => k !== q)].slice(0, 12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!input.trim() || input === q) {
      setHints([]);
      return;
    }
    const timer = setTimeout(() => void suggest(input).then(setHints, () => setHints([])), 180);
    return () => clearTimeout(timer);
  }, [input, q]);

  const go = (keyword: string) => keyword.trim() && navigate(`/keywords?q=${encodeURIComponent(keyword.trim())}`);
  const toggle = (k: string) => setSelected((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const saveList = () => {
    setLists((lists) => [...lists, { id: uid(), name: q, tags: [q, ...selected], updatedAt: Date.now() }]);
    toast(`Saved ${selected.length + 1} keywords as the tag list "${q}".`, 'good');
  };

  return (
    <Page title="Keyword Explorer" subtitle="See how much demand a search term has, how hard it is to rank for, and which related phrases are worth targeting.">
      <Card>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <div className="grow">
            <Field label="Keyword">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. how to tie a tie" list="kw-hints" autoFocus aria-label="Keyword" />
            </Field>
            <datalist id="kw-hints">
              {hints.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </div>
          <Button variant="primary" type="submit" style={{ alignSelf: 'flex-end' }}>
            Explore
          </Button>
        </form>
        {hints.length ? (
          <div className="chips">
            {hints.map((h) => (
              <span key={h} className="chip clickable" onClick={() => go(h)}>
                {h}
              </span>
            ))}
          </div>
        ) : !q && history.length ? (
          <div className="chips">
            <span className="muted small">Recent:</span>
            {history.map((h) => (
              <span key={h} className="chip clickable" onClick={() => go(h)}>
                {h}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      {!q ? <Empty title="Enter a keyword to begin">Suggestions appear as you type.</Empty> : null}
      {q && report.loading ? <Loading label={`Researching "${q}"`} /> : null}
      {report.error ? <Notice tone="bad">{report.error}</Notice> : null}
      {q && report.data ? (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'explore', label: 'Explore' },
              { value: 'compare', label: `Compare${selected.length ? ` (${selected.length + 1})` : ''}` },
            ]}
          />
          {tab === 'explore' ? (
            <>
              <ScoreCards report={report.data} />
              <div className="grid c4">
                <Card>
                  <Stat label="Search results" value={formatCompact(report.data.estimatedResults)} hint="YouTube's own estimate" />
                </Card>
                <Card>
                  <Stat label="Median views, top 10" value={formatCompact(report.data.score.details.medianViews)} hint={`${formatCompact(report.data.score.details.medianViewsPerDay)} views a day`} />
                </Card>
                <Card>
                  <Stat label="Exact title matches" value={`${report.data.exactTitleMatches} of ${report.data.results.length}`} hint="Top results using every word" />
                </Card>
                <Card>
                  <Stat label="Published this week" value={report.data.publishedLastWeek} hint="New videos in the top results" />
                </Card>
              </div>
              <div className="grid c2">
                <TrendCard keyword={q} />
                <Related keyword={q} selected={selected} onToggle={toggle} />
              </div>
              {selected.length ? (
                <Card>
                  <div className="row between">
                    <span>
                      {selected.length} related keyword{selected.length === 1 ? '' : 's'} selected
                    </span>
                    <div className="row">
                      <Button onClick={() => setSelected([])}>Clear</Button>
                      <Button onClick={saveList}>Save as tag list</Button>
                      <Button variant="primary" onClick={() => setTab('compare')}>
                        Compare
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : null}
              <Results report={report.data} />
            </>
          ) : (
            <Compare keywords={[q, ...selected]} channelMedian={channelMedian} />
          )}
        </>
      ) : null}
    </Page>
  );
}
