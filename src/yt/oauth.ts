import { getSettings } from '../shared/settings';
import { getStore, removeStore, setStore } from '../shared/storage';
import { KEYS } from '../shared/types';

export const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/yt-analytics.readonly'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface AuthState {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export class NotConnectedError extends Error {
  constructor(message = 'Connect your YouTube channel in Settings first.') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function launch(url: string, interactive: boolean): Promise<URL> {
  const result = await chrome.identity.launchWebAuthFlow({ url, interactive });
  if (!result) throw new NotConnectedError('Google sign-in was cancelled.');
  const redirected = new URL(result);
  const params = new URLSearchParams(redirected.hash.replace(/^#/, '') || redirected.search);
  const error = params.get('error');
  if (error) throw new NotConnectedError(`Google sign-in failed: ${error}`);
  return redirected;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await response.json();
  if (!response.ok) throw new NotConnectedError(`Google rejected the token request: ${json.error_description ?? json.error ?? response.status}`);
  return json;
}

/**
 * Signs in with the user's own Google OAuth client. With a client secret this uses the
 * authorisation-code flow with PKCE and keeps a refresh token, so scheduled jobs can run
 * unattended. Without one it uses the implicit flow and renews silently while the browser
 * is still signed in to Google.
 */
export async function connect(interactive = true): Promise<AuthState> {
  const settings = await getSettings();
  if (!settings.oauthClientId) throw new NotConnectedError('Add your Google OAuth client ID in Settings first.');
  const common = { client_id: settings.oauthClientId, redirect_uri: redirectUri(), scope: SCOPES.join(' '), include_granted_scopes: 'true' };

  let state: AuthState;
  if (settings.oauthClientSecret) {
    const { verifier, challenge } = await pkce();
    const query = new URLSearchParams({ ...common, response_type: 'code', access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256' });
    const redirected = await launch(`${AUTH_URL}?${query}`, interactive);
    const code = redirected.searchParams.get('code');
    if (!code) throw new NotConnectedError('Google did not return an authorisation code.');
    const token = await tokenRequest({
      client_id: settings.oauthClientId,
      client_secret: settings.oauthClientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    });
    state = { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000, refreshToken: token.refresh_token };
  } else {
    const query = new URLSearchParams({ ...common, response_type: 'token', ...(interactive ? {} : { prompt: 'none' }) });
    const redirected = await launch(`${AUTH_URL}?${query}`, interactive);
    const fragment = new URLSearchParams(redirected.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    if (!accessToken) throw new NotConnectedError('Google did not return an access token.');
    state = { accessToken, expiresAt: Date.now() + Number(fragment.get('expires_in') ?? 3600) * 1000 };
  }
  await setStore(KEYS.auth, state);
  return state;
}

async function refresh(state: AuthState): Promise<AuthState> {
  const settings = await getSettings();
  if (state.refreshToken && settings.oauthClientSecret) {
    const token = await tokenRequest({
      client_id: settings.oauthClientId,
      client_secret: settings.oauthClientSecret,
      refresh_token: state.refreshToken,
      grant_type: 'refresh_token',
    });
    const next = { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000, refreshToken: state.refreshToken };
    await setStore(KEYS.auth, next);
    return next;
  }
  return connect(false);
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  const settings = await getSettings();
  if (settings.dev?.token) return settings.dev.token;
  const state = await getStore<AuthState | null>(KEYS.auth, null);
  if (!state) throw new NotConnectedError();
  if (!forceRefresh && state.expiresAt - Date.now() > 60_000) return state.accessToken;
  return (await refresh(state)).accessToken;
}

export async function isConnected(): Promise<boolean> {
  const settings = await getSettings();
  return !!settings.dev?.token || !!(await getStore<AuthState | null>(KEYS.auth, null));
}

export async function disconnect(): Promise<void> {
  const state = await getStore<AuthState | null>(KEYS.auth, null);
  if (state?.accessToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(state.refreshToken ?? state.accessToken)}`, { method: 'POST' }).catch(() => undefined);
  }
  await removeStore(KEYS.auth);
  await removeStore(KEYS.channel);
  await removeStore(KEYS.videos);
}
