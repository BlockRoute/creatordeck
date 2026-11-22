import { useState } from 'react';
import { LLM_PRESETS } from '../../shared/llm';
import { DEFAULT_SETTINGS, type LlmProvider } from '../../shared/types';
import { fetchMyChannel } from '../../yt/api';
import { connect, disconnect, redirectUri } from '../../yt/oauth';
import { QuotaBadge, useConnection, useSettings } from '../channel';
import { Button, Card, CopyButton, Field, Notice, Page, Pill, errorMessage, useToast } from '../kit';

function redirect(): string {
  try {
    return redirectUri();
  } catch {
    return 'https://<extension-id>.chromiumapp.org/';
  }
}

export function SettingsPage() {
  const [settings, save] = useSettings();
  const { connected, channel } = useConnection();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const doConnect = async () => {
    setBusy(true);
    try {
      await connect(true);
      const info = await fetchMyChannel();
      toast(`Connected to ${info.title}.`, 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const preset = LLM_PRESETS[settings.llmProvider];
  return (
    <Page title="Settings" subtitle="Connect your channel, choose your region, and add an AI key if you want the AI tools.">
      <Card
        title="YouTube channel"
        hint="Needed for the tools that read or change your own videos. Research and insight tools work without it."
        actions={connected ? <Pill tone="good">Connected{channel ? `: ${channel.title}` : ''}</Pill> : <Pill>Not connected</Pill>}
      >
        <Notice>
          <strong>One-time setup, about ten minutes.</strong> CreatorDeck talks to YouTube through a Google OAuth client that belongs to you, so no third party sits between you and your channel.
          <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li>
              In <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a>, create a project.
            </li>
            <li>
              Enable three APIs: <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3</a>,{' '}
              <a href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank" rel="noreferrer">YouTube Analytics API</a> and{' '}
              <a href="https://console.cloud.google.com/apis/library/youtubereporting.googleapis.com" target="_blank" rel="noreferrer">YouTube Reporting API</a>.
            </li>
            <li>
              Configure the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">OAuth consent screen</a> (External) and add your own Google account as a test user.
            </li>
            <li>
              Create an <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">OAuth client</a> of type <em>Web application</em> with this authorised redirect URI:
              <div className="row" style={{ marginTop: 6 }}>
                <code>{redirect()}</code> <CopyButton text={redirect()} />
              </div>
            </li>
            <li>Paste the client ID (and, ideally, the client secret) below and press Connect.</li>
          </ol>
        </Notice>
        <div className="grid c2">
          <Field label="OAuth client ID">
            <input value={settings.oauthClientId} onChange={(e) => save({ oauthClientId: e.target.value.trim() })} placeholder="1234567890-abc.apps.googleusercontent.com" aria-label="OAuth client ID" />
          </Field>
          <Field label="OAuth client secret" hint="optional but recommended">
            <input type="password" value={settings.oauthClientSecret} onChange={(e) => save({ oauthClientSecret: e.target.value.trim() })} placeholder="GOCSPX-…" aria-label="OAuth client secret" />
          </Field>
        </div>
        <div className="small muted">
          With the secret, CreatorDeck keeps a refresh token and scheduled jobs (A/B rotations, timed updates) run without asking you to sign in again. Without it, access lasts an hour at a time and
          renews silently only while this browser is signed in to Google. Both are stored only in this browser. While your Google project is in "Testing", Google expires refresh tokens after 7 days;
          publish the consent screen to avoid weekly reconnects.
        </div>
        <div className="row">
          <Button variant="primary" busy={busy} disabled={!settings.oauthClientId} onClick={() => void doConnect()}>
            {connected ? 'Reconnect' : 'Connect channel'}
          </Button>
          {connected ? (
            <Button variant="danger" onClick={() => void disconnect().then(() => toast('Disconnected.', 'info'))}>
              Disconnect
            </Button>
          ) : null}
          <QuotaBadge />
        </div>
      </Card>

      <Card title="Region and language" hint="Used for search results, autocomplete and keyword scores.">
        <div className="grid c4">
          <Field label="Country code">
            <input value={settings.region} maxLength={2} onChange={(e) => save({ region: e.target.value.toUpperCase() })} aria-label="Country code" />
          </Field>
          <Field label="Language code">
            <input value={settings.language} maxLength={5} onChange={(e) => save({ language: e.target.value.toLowerCase() })} aria-label="Language code" />
          </Field>
          <Field label="RPM low ($)" hint="for revenue estimates">
            <input type="number" step="0.1" min="0" value={settings.rpmLow} onChange={(e) => save({ rpmLow: Number(e.target.value) || DEFAULT_SETTINGS.rpmLow })} aria-label="RPM low" />
          </Field>
          <Field label="RPM high ($)">
            <input type="number" step="0.1" min="0" value={settings.rpmHigh} onChange={(e) => save({ rpmHigh: Number(e.target.value) || DEFAULT_SETTINGS.rpmHigh })} aria-label="RPM high" />
          </Field>
        </div>
      </Card>

      <Card title="AI provider" hint="Optional. Powers the AI Tools page. Your key is stored in this browser and sent only to the provider you choose.">
        <div className="grid c2">
          <Field label="Provider">
            <select
              value={settings.llmProvider}
              onChange={(e) => {
                const provider = e.target.value as LlmProvider;
                save({ llmProvider: provider, llmBaseUrl: '', llmModel: '' });
              }}
              aria-label="AI provider"
            >
              {Object.entries(LLM_PRESETS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="API key">
            <input type="password" value={settings.llmApiKey} onChange={(e) => save({ llmApiKey: e.target.value.trim() })} aria-label="AI API key" />
          </Field>
          <Field label="Model" hint={preset.model ? `default ${preset.model}` : undefined}>
            <input value={settings.llmModel} onChange={(e) => save({ llmModel: e.target.value.trim() })} placeholder={preset.model} aria-label="AI model" />
          </Field>
          <Field label="Base URL" hint={preset.baseUrl ? `default ${preset.baseUrl}` : 'required for custom'}>
            <input value={settings.llmBaseUrl} onChange={(e) => save({ llmBaseUrl: e.target.value.trim() })} placeholder={preset.baseUrl} aria-label="AI base URL" />
          </Field>
        </div>
      </Card>

      <Card title="On YouTube pages">
        <label className="check">
          <input type="checkbox" checked={settings.showLauncher} onChange={(e) => save({ showLauncher: e.target.checked })} /> Show the CreatorDeck button on YouTube and YouTube Studio
        </label>
      </Card>
    </Page>
  );
}
