import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AbPage } from './pages/AbTests';
import { AiPage } from './pages/Ai';
import { AnalyticsPage } from './pages/Analytics';
import { AuditPage } from './pages/Audit';
import { BackupPage } from './pages/Backup';
import { BulkPage } from './pages/Bulk';
import { ChannelPage } from './pages/Channel';
import { ChaptersPage } from './pages/Chapters';
import { CommentsPage } from './pages/Comments';
import { CompetitorsPage } from './pages/Competitors';
import { HomePage } from './pages/Home';
import { KeywordsPage } from './pages/Keywords';
import { OverlaysPage } from './pages/Overlays';
import { PlaylistsPage } from './pages/Playlists';
import { RankPage } from './pages/Rank';
import { SchedulePage } from './pages/Schedule';
import { SeoPage } from './pages/Seo';
import { SettingsPage } from './pages/Settings';
import { StudioPage } from './pages/StudioTools';
import { TagsPage } from './pages/Tags';
import { ThumbnailsPage } from './pages/Thumbnails';
import { VideoPage } from './pages/Video';
import { Empty, ToastProvider, isEmbedded, navigate, useRoute } from './kit';
import './styles.css';

const NAV: { group: string; items: { path: string; label: string }[] }[] = [
  { group: 'Research', items: [
    { path: '/', label: 'Home' },
    { path: '/keywords', label: 'Keyword Explorer' },
    { path: '/tags', label: 'Tags' },
    { path: '/rank', label: 'Search ranks' },
  ]},
  { group: 'Insight', items: [
    { path: '/video', label: 'Videolytics' },
    { path: '/channel', label: 'Channelytics' },
    { path: '/competitors', label: 'Competitors' },
    { path: '/audit', label: 'Audit' },
    { path: '/analytics/health', label: 'Health' },
    { path: '/analytics/retention', label: 'Retention' },
    { path: '/analytics/timing', label: 'Best time' },
  ]},
  { group: 'Edit', items: [
    { path: '/seo', label: 'SEO Studio' },
    { path: '/thumbnails', label: 'Thumbnails' },
    { path: '/overlays', label: 'Overlays' },
    { path: '/chapters', label: 'Chapters' },
    { path: '/comments', label: 'Comments' },
    { path: '/bulk', label: 'Bulk edit' },
    { path: '/playlists', label: 'Playlists' },
    { path: '/studio', label: 'Cards & end screens' },
  ]},
  { group: 'Automate', items: [
    { path: '/ab', label: 'A/B tests' },
    { path: '/schedule', label: 'Schedule' },
    { path: '/backup', label: 'Backup' },
    { path: '/ai', label: 'AI tools' },
  ]},
  { group: '', items: [{ path: '/settings', label: 'Settings' }] },
];

function isActive(path: string, current: string): boolean {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(`${path}/`);
}

function Screen() {
  const route = useRoute();
  const root = route.parts[0];
  switch (root) {
    case undefined:
      return <HomePage />;
    case 'keywords':
      return <KeywordsPage />;
    case 'tags':
      return <TagsPage />;
    case 'rank':
      return <RankPage />;
    case 'video':
      return <VideoPage />;
    case 'channel':
      return <ChannelPage />;
    case 'competitors':
      return <CompetitorsPage />;
    case 'audit':
      return <AuditPage />;
    case 'analytics':
      return <AnalyticsPage section={route.parts[1] ?? 'health'} />;
    case 'seo':
      return <SeoPage />;
    case 'thumbnails':
      return <ThumbnailsPage />;
    case 'overlays':
      return <OverlaysPage />;
    case 'chapters':
      return <ChaptersPage />;
    case 'comments':
      return <CommentsPage />;
    case 'bulk':
      return <BulkPage />;
    case 'playlists':
      return <PlaylistsPage />;
    case 'studio':
      return <StudioPage />;
    case 'ab':
      return <AbPage />;
    case 'schedule':
      return <SchedulePage />;
    case 'backup':
      return <BackupPage />;
    case 'ai':
      return <AiPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <Empty title="That page does not exist" />;
  }
}

function Shell() {
  const route = useRoute();
  const [narrow, setNarrow] = useState(() => window.innerWidth < 860);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 860);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
    const storage = chrome.storage.session;
    void storage.get('pendingRoute').then((data) => {
      const pending = data.pendingRoute;
      if (typeof pending === 'string' && pending.startsWith('/')) {
        navigate(pending);
        void storage.remove('pendingRoute');
      }
    });
  }, []);
  const embedded = isEmbedded || narrow;
  const flat = NAV.flatMap((group) => group.items);
  return (
    <div className={embedded ? 'shell embed' : 'shell'}>
      {embedded ? (
        <div className="embed-bar">
          <img src="icons/icon32.png" alt="" width={22} height={22} />
          <select aria-label="Page" value={flat.find((item) => isActive(item.path, route.path))?.path ?? '/'} onChange={(e) => navigate(e.target.value)}>
            {flat.map((item) => (
              <option key={item.path} value={item.path}>{item.label}</option>
            ))}
          </select>
          <a href={typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('dashboard.html') : 'dashboard.html'} target="_blank" rel="noreferrer">Open</a>
        </div>
      ) : (
        <aside className="sidebar">
          <div className="brand"><img src="icons/icon32.png" alt="" />CreatorDeck</div>
          {NAV.map((group) => (
            <div key={group.group || 'settings'}>
              {group.group ? <div className="nav-group">{group.group}</div> : null}
              {group.items.map((item) => (
                <a key={item.path} className={isActive(item.path, route.path) ? 'nav-item active' : 'nav-item'} href={`#${item.path}`}>{item.label}</a>
              ))}
            </div>
          ))}
        </aside>
      )}
      <main className="main">
        <Screen />
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ToastProvider><Shell /></ToastProvider>);
