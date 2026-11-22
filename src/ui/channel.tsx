import { useState, type ReactNode } from 'react';
import { DAILY_QUOTA, quotaRemaining, type QuotaState } from '../core/quota';
import { formatCompact } from '../core/text';
import { KEYS, type ChannelInfo, type Settings, DEFAULT_SETTINGS } from '../shared/types';
import { refreshLibrary, type VideoLibrary } from '../yt/api';
import type { AuthState } from '../yt/oauth';
import { Button, Empty, Loading, Notice, errorMessage, useStore, useToast } from './kit';

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [stored, setStored, ready] = useStore<Partial<Settings>>(KEYS.settings, {});
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  return [merged, (patch) => setStored((current) => ({ ...current, ...patch })), ready];
}

export function useConnection(): { connected: boolean; channel: ChannelInfo | null; ready: boolean } {
  const [auth, , authReady] = useStore<AuthState | null>(KEYS.auth, null);
  const [channel, , channelReady] = useStore<ChannelInfo | null>(KEYS.channel, null);
  const [settings, , settingsReady] = useSettings();
  return { connected: !!auth || !!settings.dev?.token, channel, ready: authReady && channelReady && settingsReady };
}

export function useLibrary(): { library: VideoLibrary | null; refreshing: boolean; progress: number; refresh: () => Promise<void> } {
  const [library] = useStore<VideoLibrary | null>(KEYS.videos, null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState(0);
  const toast = useToast();
  const refresh = async () => {
    setRefreshing(true);
    setProgress(0);
    try {
      await refreshLibrary(setProgress);
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setRefreshing(false);
    }
  };
  return { library, refreshing, progress, refresh };
}

/** Wraps a page that needs the connected channel; shows how to connect otherwise. */
export function ConnectGate({ children }: { children: ReactNode }) {
  const { connected, ready } = useConnection();
  if (!ready) return <Loading />;
  if (connected) return <>{children}</>;
  return (
    <Empty title="Connect your channel to use this tool">
      <p>This tool reads or changes your own videos through the official YouTube API.</p>
      <p style={{ marginTop: 10 }}>
        <a href="#/settings">Open Settings to connect</a>
      </p>
    </Empty>
  );
}

/** Loads the video library on demand and renders children once it is available. */
export function LibraryGate({ children }: { children: (library: VideoLibrary, refresh: () => Promise<void>, refreshing: boolean) => ReactNode }) {
  const { library, refreshing, progress, refresh } = useLibrary();
  if (!library) {
    return (
      <Empty title="Load your videos">
        <p>CreatorDeck needs the list of your uploads. This costs about 2 API quota units per 50 videos.</p>
        <p style={{ marginTop: 12 }}>
          <Button variant="primary" busy={refreshing} onClick={() => void refresh()}>
            {refreshing ? `Loading… ${progress} videos` : 'Load my videos'}
          </Button>
        </p>
      </Empty>
    );
  }
  return <>{children(library, refresh, refreshing)}</>;
}

export function QuotaBadge() {
  const [quota] = useStore<QuotaState | null>(KEYS.quota, null);
  const remaining = quotaRemaining(quota);
  const tone = remaining < 500 ? 'bad' : remaining < 2500 ? 'warn' : '';
  return (
    <span className={`pill ${tone}`} title="YouTube Data API units left today (resets at midnight Pacific)">
      Quota {formatCompact(remaining)} / {formatCompact(DAILY_QUOTA)}
    </span>
  );
}

export function QuotaWarning({ cost }: { cost: number }) {
  const [quota] = useStore<QuotaState | null>(KEYS.quota, null);
  const remaining = quotaRemaining(quota);
  if (cost <= remaining) return null;
  return (
    <Notice tone="warn">
      This needs about {cost.toLocaleString()} quota units and {remaining.toLocaleString()} are left today. It will stop when the quota runs out; run the rest tomorrow.
    </Notice>
  );
}
