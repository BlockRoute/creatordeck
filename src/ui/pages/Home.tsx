import { quotaRemaining } from '../../core/quota';
import { formatCompact } from '../../core/text';
import { KEYS, type Alert, type TrackedChannel } from '../../shared/types';
import type { QuotaState } from '../../core/quota';
import { navigate, Page, Card, Stat, Pill, Empty, useStore } from '../kit';
import { QuotaBadge, useConnection } from '../channel';

const LINKS: { path: string; title: string; detail: string }[] = [
  { path: '/keywords', title: 'Keyword Explorer', detail: 'Demand, competition and related searches. No sign-in.' },
  { path: '/seo', title: 'SEO Studio', detail: 'Score a title, description and tags as you type.' },
  { path: '/video', title: 'Videolytics', detail: 'Public stats, tags and a best-practice audit.' },
  { path: '/thumbnails', title: 'Thumbnails', detail: 'Build one, or score a file you already have.' },
  { path: '/competitors', title: 'Competitors', detail: 'Track channels and get an alert on new uploads.' },
  { path: '/bulk', title: 'Bulk edit', detail: 'Find, replace and append across your videos, with a backup first.' },
  { path: '/ab', title: 'A/B tests', detail: 'Rotate a title or thumbnail and keep the winner.' },
  { path: '/analytics/health', title: 'Health report', detail: 'The last 28 days, once the channel is connected.' },
];

export function HomePage() {
  const { connected, channel } = useConnection();
  const [alerts] = useStore<Alert[]>(KEYS.alerts, []);
  const [quota] = useStore<QuotaState | null>(KEYS.quota, null);
  const [tracked] = useStore<TrackedChannel[]>(KEYS.tracked, []);
  const unread = alerts.filter((a) => !a.read).slice(0, 6);
  return (
    <Page
      title="CreatorDeck"
      subtitle="Research, editing and scheduling for one YouTube channel. The research tools work immediately. Editing your own videos starts after you connect a Google API client in Settings."
      actions={<QuotaBadge />}
    >
      <div className="grid c3">
        <Stat label="Channel" value={connected && channel ? channel.title : 'Not connected'} hint={connected && channel ? `${formatCompact(channel.subscriberCount)} subscribers` : 'Settings → Connect'} />
        <Stat label="Quota left today" value={formatCompact(quotaRemaining(quota))} hint="YouTube Data API units, resets midnight Pacific" />
        <Stat label="Tracked channels" value={String(tracked.length)} hint="Upload alerts check about once an hour while Chrome is open" />
      </div>
      <Card title="Start here">
        <div className="grid c2">
          {LINKS.map((link) => (
            <button key={link.path} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate(link.path)}>
              <strong>{link.title}</strong>
              <div className="muted small">{link.detail}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Recent alerts" actions={<a href="#/competitors">Competitor alerts</a>}>
        {unread.length ? (
          <div className="stack">
            {unread.map((alert) => (
              <div key={alert.id} className="row between">
                <div>
                  <strong>{alert.title}</strong>
                  <div className="muted small">{alert.body}</div>
                </div>
                <Pill>{alert.kind}</Pill>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No alerts yet">Competitor uploads, brand mentions and finished A/B tests show up here.</Empty>
        )}
      </Card>
    </Page>
  );
}
