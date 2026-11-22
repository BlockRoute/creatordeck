import { getStore, setStore } from '../shared/storage';
import { KEYS, type ChannelInfo } from '../shared/types';
import { syncReachReports } from '../yt/analytics';
import { isConnected } from '../yt/oauth';
import { evaluateAbTests, rotateDueTests } from './abtest';
import { checkBrandAlerts, checkCompetitorUploads } from './channel';
import { checkRanks } from './ranks';
import { runDueSchedules } from './schedule';

export interface JobState {
  lastCompetitorCheck: number;
  lastRankCheck: number;
  lastReachSync: number;
  lastAbEval: number;
}

const EMPTY: JobState = { lastCompetitorCheck: 0, lastRankCheck: 0, lastReachSync: 0, lastAbEval: 0 };

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`CreatorDeck ${label} failed`, error);
  }
}

/**
 * One pass of everything that should happen while Chrome is open: competitor feeds,
 * rank checks, due edits, A/B rotation and reach reports. Missed time is caught up
 * the next time Chrome starts; nothing here runs while the browser is closed.
 */
export async function tick(now = Date.now()): Promise<void> {
  const state = await getStore<JobState>(KEYS.jobState, EMPTY);
  if (now - state.lastCompetitorCheck > 60 * 60_000) {
    await step('competitor check', async () => {
      const channel = await getStore<ChannelInfo | null>(KEYS.channel, null);
      await checkCompetitorUploads();
      await checkBrandAlerts(channel?.id);
      state.lastCompetitorCheck = now;
    });
  }
  if (now - state.lastRankCheck > 20 * 60 * 60_000) {
    await step('rank check', async () => {
      await checkRanks();
      state.lastRankCheck = now;
    });
  }
  if (await isConnected().catch(() => false)) {
    await step('scheduled edits', () => runDueSchedules(now).then(() => undefined));
    await step('A/B rotation', () => rotateDueTests(now).then(() => undefined));
    if (now - state.lastReachSync > 6 * 60 * 60_000) {
      await step('reach sync', async () => {
        await syncReachReports();
        state.lastReachSync = now;
      });
    }
    if (now - state.lastAbEval > 6 * 60 * 60_000) {
      await step('A/B results', async () => {
        await evaluateAbTests(now);
        state.lastAbEval = now;
      });
    }
  }
  await setStore(KEYS.jobState, state);
}
