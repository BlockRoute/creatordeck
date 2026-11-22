import { useState } from 'react';
import { formatCompact } from '../../core/text';
import { checkBrandAlerts, checkCompetitorUploads, loadChannelInsight, trackChannel, untrackChannel, type ChannelInsight } from '../../services/channel';
import { KEYS, type Alert, type TrackedChannel } from '../../shared/types';
import { useConnection } from '../channel';
import { Button, Card, Empty, Notice, Page, Pill, Table, Tabs, errorMessage, useStore, useToast } from '../kit';

function Scorecard({ tracked, mineId }: { tracked: TrackedChannel[]; mineId: string | null }) {
  const [rows, setRows] = useState<ChannelInsight[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    setRows([]);
    try {
      const ids = [...(mineId ? [mineId] : []), ...tracked.map((t) => t.id).filter((id) => id !== mineId)];
      for (const id of ids) {
        const insight = await loadChannelInsight(id);
        setRows((list) => [...list, insight]);
      }
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const best = (pick: (c: ChannelInsight) => number) => Math.max(...rows.map(pick));
  const cell = (c: ChannelInsight, pick: (c: ChannelInsight) => number, text?: string) => {
    const value = pick(c);
    return <span className={rows.length > 1 && value === best(pick) ? 'good' : ''}>{text ?? formatCompact(value)}</span>;
  };
  return (
    <Card
      title="Scorecard"
      hint="Side-by-side numbers for you and the channels you track. The best value in each column is highlighted."
      actions={
        <Button variant="primary" busy={busy} onClick={() => void run()} disabled={!tracked.length && !mineId}>
          {rows.length ? 'Refresh' : 'Build scorecard'}
        </Button>
      }
    >
      <Table
        rows={rows}
        rowKey={(r) => r.channel.id}
        empty={busy ? 'Loading channels…' : 'Press "Build scorecard" to load the latest numbers.'}
        columns={[
          {
            key: 'c',
            label: 'Channel',
            render: (r) => (
              <span>
                <a href={`#/channel/${r.channel.id}`}>{r.channel.title}</a> {r.channel.id === mineId ? <Pill tone="accent">you</Pill> : null}
              </span>
            ),
          },
          { key: 's', label: 'Subscribers', align: 'right', render: (r) => cell(r, (c) => c.exactSubscribers ?? c.channel.subscriberCount ?? 0) },
          { key: 'u', label: 'Uploads, 30 days', align: 'right', render: (r) => cell(r, (c) => c.uploadsLast30Days, String(r.uploadsLast30Days)) },
          { key: 'm', label: 'Median views', align: 'right', render: (r) => cell(r, (c) => c.medianViews) },
          {
            key: 'v',
            label: 'Views, 30 days',
            align: 'right',
            render: (r) => cell(r, (c) => c.monthlyViewsFromSnapshots ?? c.recentVideoViews, `${r.monthlyViewsFromSnapshots === null ? '≥ ' : ''}${formatCompact(r.monthlyViewsFromSnapshots ?? r.recentVideoViews)}`),
          },
          {
            key: 'g',
            label: 'Subscribers gained, 30 days',
            align: 'right',
            render: (r) => (r.monthlySubscribersFromSnapshots === null ? <span className="muted">needs history</span> : formatCompact(r.monthlySubscribersFromSnapshots)),
          },
        ]}
      />
      <Notice>"≥" marks a floor: views gathered so far by videos published in the last 30 days. It becomes a true 30-day figure once a few daily snapshots exist.</Notice>
    </Card>
  );
}

function AlertList({ alerts, onClear }: { alerts: Alert[]; onClear: () => void }) {
  if (!alerts.length) return <Empty title="No alerts yet">New uploads from tracked channels and new videos matching your brand terms appear here.</Empty>;
  return (
    <Card title={`${alerts.length} alerts`} actions={<Button onClick={onClear}>Clear all</Button>}>
      <Table
        rows={alerts}
        rowKey={(a) => a.id}
        columns={[
          { key: 'k', label: 'Type', render: (a) => <Pill tone={a.kind === 'upload' ? 'accent' : a.kind === 'brand' ? 'warn' : undefined}>{a.kind}</Pill> },
          {
            key: 't',
            label: 'Alert',
            render: (a) => (
              <div>
                <div>{a.title}</div>
                <div className="small muted">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.body}
                    </a>
                  ) : (
                    a.body
                  )}
                </div>
              </div>
            ),
          },
          { key: 'w', label: 'When', render: (a) => <span className="nowrap">{new Date(a.at).toLocaleString()}</span> },
        ]}
      />
    </Card>
  );
}

export function CompetitorsPage() {
  const [tracked] = useStore<TrackedChannel[]>(KEYS.tracked, []);
  const [alerts, setAlerts] = useStore<Alert[]>(KEYS.alerts, []);
  const [terms, setTerms] = useStore<string[]>(KEYS.brandTerms, []);
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<'channels' | 'alerts'>('channels');
  const { channel: mine } = useConnection();
  const toast = useToast();

  const add = async () => {
    if (!input.trim()) return;
    setBusy(true);
    try {
      const entry = await trackChannel(input.trim());
      toast(`Tracking ${entry.title}.`, 'good');
      setInput('');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const found = [...(await checkCompetitorUploads()), ...(await checkBrandAlerts(mine?.id))];
      toast(found.length ? `${found.length} new alert${found.length === 1 ? '' : 's'}.` : 'Nothing new.', found.length ? 'good' : 'info');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Page
      title="Competitors"
      subtitle="Track channels in your niche, compare them with yours, and get an alert when they upload or when someone publishes a video about your brand."
      actions={
        <Button busy={checking} onClick={() => void checkNow()}>
          Check for new uploads now
        </Button>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'channels', label: `Channels (${tracked.length})` },
          { value: 'alerts', label: `Alerts (${alerts.length})` },
        ]}
      />
      {tab === 'channels' ? (
        <>
          <Card title="Tracked channels" hint="Checked about once an hour while Chrome is open.">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div className="grow">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Channel URL, @handle or UC… ID" aria-label="Channel to track" />
              </div>
              <Button variant="primary" type="submit" busy={busy}>
                Track
              </Button>
            </form>
            <Table
              rows={tracked}
              rowKey={(t) => t.id}
              empty="No channels tracked yet."
              columns={[
                { key: 'a', label: '', render: (t) => (t.thumbnail ? <img src={t.thumbnail} alt="" width={32} height={32} style={{ borderRadius: '50%' }} /> : null) },
                { key: 't', label: 'Channel', render: (t) => <a href={`#/channel/${t.id}`}>{t.title}</a> },
                { key: 'h', label: 'Handle', render: (t) => <span className="muted">{t.handle ?? ''}</span> },
                { key: 'd', label: 'Tracked since', render: (t) => new Date(t.addedAt).toLocaleDateString() },
                {
                  key: 'x',
                  label: '',
                  align: 'right',
                  render: (t) => (
                    <Button variant="small" onClick={() => void untrackChannel(t.id)}>
                      Remove
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
          <Scorecard tracked={tracked} mineId={mine?.id ?? null} />
          <Card title="Brand alerts" hint="Search terms to watch. You get an alert when a new video from another channel shows up for one of them.">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (term.trim() && !terms.includes(term.trim())) setTerms([...terms, term.trim()]);
                setTerm('');
              }}
            >
              <div className="grow">
                <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Your channel or product name" aria-label="Brand term" />
              </div>
              <Button type="submit">Add term</Button>
            </form>
            <div className="chips">
              {terms.map((t) => (
                <span key={t} className="chip">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTerms(terms.filter((x) => x !== t))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <AlertList alerts={alerts} onClear={() => setAlerts([])} />
      )}
    </Page>
  );
}
