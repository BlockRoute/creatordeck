# CreatorDeck

CreatorDeck is a Chrome extension for YouTube keyword research, video and channel insight, bulk editing, A/B tests and scheduling. The research tools work with no account. Editing your own videos uses your own Google API client and the official YouTube APIs.

Extension ID: `fmpimdpeplnjgloblobhjolpkghbnfih`

OAuth redirect URI (paste this into the Google client):

`https://fmpimdpeplnjgloblobhjolpkghbnfih.chromiumapp.org/`

## Install

1. Unzip `release/creatordeck.zip` (or use the `dist` folder from `npm run build`).
2. Open `chrome://extensions`, turn on Developer mode, and choose Load unpacked.
3. Select the unzipped folder.

Keyword Explorer, tags, Videolytics, Channelytics, competitor alerts, the SEO score, the thumbnail tools, chapters, comment formatting and the audits all work at this point.

The first keyword search opens a background tab on youtube.com. YouTube refuses these lookups when they come directly from an extension, so the request is made from that tab. You can leave the tab open; closing it just means the next search opens it again.

## Connect your channel

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type **Chrome extension** (or Web application) and set the redirect URI above.
2. Enable **YouTube Data API v3**, **YouTube Analytics API** and **YouTube Reporting API**.
3. In CreatorDeck → Settings, paste the client ID. Paste the client secret as well if you want a refresh token that survives restarts.
4. Connect, and approve `youtube.force-ssl` and `yt-analytics.readonly`.

A client without a secret uses a token that lasts about an hour and renews only while this browser is signed into Google. A testing-mode Google project expires refresh tokens after 7 days.

The default Data API quota is 10,000 units per day. Updating a video costs 50 units, so a day covers about 200 edits. CreatorDeck counts units locally and stops a bulk run when the quota error comes back.

## What needs the connection

Bulk find/replace/append, thumbnail upload and overlays, comment moderation and export, playlists, channel backup, scheduled edits, sunset, upload profiles, A/B tests, search-rank history, the health report, retention and best-time ranking of your library.

A/B tests rotate on a timer while Chrome is open. Click-through rate comes from a Reporting API job named `channel_reach_basic_a1`. The first report usually arrives about two days after the job is created; until then a test shows views and watch time. A winner needs 95% confidence and at least 500 impressions on each of the top two variants. Description and tag tests compare daily views, because those fields do not have an impression metric.

Scheduled jobs also run only while Chrome is open, and they catch up the next time it starts. Settings → Schedule can download a config for `node scripts/scheduler.mjs path/to/creatordeck-scheduler.json`, which applies due jobs from any machine that has Node. That file contains a refresh token. Keep it private.

## Optional AI

Settings → AI takes your own key for OpenAI, Anthropic, xAI, OpenRouter, Gemini, or any OpenAI-compatible base URL. Titles, ideas, Shorts suggestions, translation and a thumbnail critique then run from the AI page. A custom host has to be allowed when Chrome asks, because the extension only talks to hosts you permit.

## Known limits

Keyword scores are estimates from autocomplete and the public top results, not measured search volume. Google Trends is used when it answers and skipped when it rate-limits.

Tags on someone else's video are often hidden while signed out. Connecting the channel reads your own tags exactly.

Cards, end screens and Shorts linking are not in the public API. The Cards & end screens page sends them through the YouTube Studio session in this browser. That can fail when Studio changes, and it only works for the channel you are signed into. Confirm the video ID before applying.

There is no server. Nothing phones home.
