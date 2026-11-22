# TubeBuddy extension teardown

A feature and integration map of the public TubeBuddy Chrome extension, used as the functional reference for CreatorDeck. It records what the product does and which surfaces it touches. No TubeBuddy code, markup, styles, images or word lists were copied into CreatorDeck.

## Subject and method

| | |
| --- | --- |
| Package | `TubeBuddy for YouTube`, Chrome Web Store ID `mhkhmbddkmdggbhaaaodilponhnccicb`, version `2271` |
| CRX SHA-256 | `42ed516f6c4c696ec6315ee62587497674e04a39d26404a426a17b44a304d2eb` |
| Unpacked tree SHA-256 (REA) | `8f7fc5c3e3414a4e0b83ec831dee0638751f03ea281da0bb4c72fdd3b056edea` |
| Tool | `rea-agents@6.9.0`, `analyze-javascript-application --detail summary` (static, nothing executed) |
| REA evidence | parent `ev_ba45c2cb850099cf20b420145eb69c803be9014c39e781f44e610559c7ca59f9`, summary view `ev_427f4914c68875687e41a448f0f0668998fee05a041c4d546c90b76e5c97dc93` |

REA parsed 66 of 68 JavaScript sources (1,114,934 AST nodes, 0 parse failures) and reported coverage as partial. Its request extractor covers `fetch`, not jQuery `ajax`, so it surfaced only a handful of network candidates in the first-party scripts. The endpoint lists below therefore come from a literal-string inventory of the same files (`rg` over the unpacked tree). Every line is tagged:

- **Observed**: a literal present in the shipped files.
- **Inferred**: a conclusion drawn from those literals; not seen executing.
- **Unknown**: not determinable from the package.

Nothing here was observed at runtime. The extension was never installed, run, or signed in to.

## Package layout (observed)

- Manifest V3. Permissions: `storage` only. Host permissions: `tubebuddy.com`, `*.youtube.com`, `*.google.com`, `*.twitter.com`, `*.facebook.com`, `*.reddit.com`.
- 893 files, 68 MB: 656 images, 91 third-party library files, 67 HTML templates in `modules/`, 43 fonts.
- Content scripts on every `*.youtube.com` page at `document_start`: about 40 libraries (jQuery, Highcharts, Chart.js, fabric, html2canvas, Vue, moment and others) followed by four first-party bundles, `tubebuddymaster1.js` to `tubebuddymaster4.js` (about 2.4 MB together). A Vue bundle (`tubebuddymastervue.js`) and a second bundle (`destContent.js`, 6.3 MB) load at `document_idle`.
- Extra content scripts on `tubebuddy.com` pass a sign-in token between the website and the extension. One more runs only on `studio.youtube.com`.
- The service worker is a thin message relay.

## How it gets its data

**Inferred architecture:** the extension is a client of two systems. It drives YouTube with the signed-in user's own browser session, and it gets scores, history and scheduling from TubeBuddy's servers.

### YouTube surfaces (observed literals)

| Surface | Literals found |
| --- | --- |
| Studio private API (`studio.youtube.com/youtubei/v1/...`) | `creator/list_creator_videos`, `creator/get_creator_videos`, `creator/list_creator_playlists`, `creator/get_creator_channels`, `creator/list_creator_info_cards`, `creator/get_creator_endscreens`, `video_manager/metadata_update`, `video_editor/edit_video`, `comment/get_comments`, `comment/perform_comment_action`, `yta_web/join`, `feature_eligibility/get_creator_feature_eligibility` |
| Public InnerTube (`www.youtube.com/youtubei/v1/...`) | `search`, `player`, `next`, `browse`, `get_panel` |
| Legacy AJAX pages | `cards_ajax`, `endscreen_ajax`, `comment_service_ajax`, `timedtext_video` |
| Autocomplete | `clients1.google.com/complete/search` |
| Google Trends | `trends/api/explore`, `trends/api/widgetdata/multiline`, `trends/api/widgetdata/comparedgeo`, `trending/rss` |
| Official Data API | only `youtube/v3/channels` and `youtube/v3/playlists` |
| Thumbnails | `i.ytimg.com`, `img.youtube.com` |

**Inferred:** almost all channel writes (metadata, cards, end screens, comment actions) go through Studio's private endpoints with the user's cookies, not through the official Data API. That is why the product can bulk-edit cards and end screens, which the official API does not expose.

### TubeBuddy backend (observed literals)

228 distinct `/api/...` paths in 55 groups. The largest groups: `youtubevideos`, `youtubechannel`, `youtubeapi`, `thumbnail`, `topics`, `taglists`, `launchpad`, `seoscore`, `searchrank`, `clickmagnet`, `abtests`, `scheduledmetaupdates`, `titlegenerator`, `tagscore`, `searchterm`, `videolytics`, `translate`, `uploaddefaults`, `comments`, `featuregating`.

**Inferred:** keyword and tag scores, search-volume numbers, rank history, A/B test scheduling and results, scheduled updates, AI generation and feature gating are computed or stored server-side. **Unknown:** how any of those scores are calculated. The formulas are not in the package.

## Feature map

Feature names come from the `modules/*.html` template filenames and their visible labels (observed). "Where" is inferred from URL literals and template names.

| Area | Tools | Where it appears | Data source (inferred) |
| --- | --- | --- | --- |
| Keyword research | Keyword Explorer, Search Explorer, related searches, variant comparison, trend chart | Overlay on any YouTube page; panel on search results | Autocomplete, InnerTube search, Google Trends, backend scores |
| Tags | Suggested tags, tag lists, tag sorter, tag translator, view and copy tags, tag search rankings | Studio video edit page; watch page panel | InnerTube, backend scores |
| Video optimisation | SEO Studio (title, description, tags, thumbnail, apply), best-practice checks, upload defaults, quick-edit toolbar | Studio edit and upload pages | Page fields, backend score |
| Video insight | Videolytics (stats, SEO, best practices, tags, social), compare with another video, advanced embed, share tracker | Watch page side panel | InnerTube player/next, backend |
| Channel insight | Channelytics, milestones, health report, valuation, competitors, brand alerts, retention analyser, best time to publish | Channel pages; web app links | Backend, Studio analytics join endpoint |
| Testing | A/B tests for thumbnail and metadata | Studio; web app | Backend scheduler plus Studio writes |
| Bulk tools | Find, replace and append; bulk thumbnail overlays; bulk cards; bulk end screens; card and end-screen templates; bulk copy; playlist actions | Studio content list | Studio private API |
| Scheduling | Scheduled metadata updates, scheduled publish, sunset videos | Studio video menu | Backend scheduler |
| Comments | Canned responses, comment filter, comment manager, word cloud, pick a winner | Studio comments; watch page | Studio comment endpoints |
| Thumbnails | Thumbnail generator (canvas editor), thumbnail analysis ("Click Magnet") | Studio edit page | Local canvas, backend |
| Other | Demonetisation check, kids-content centre, transcriptions, topic generator, publish to Facebook/Twitter, channel backup | Studio | Mixed |

Keyword Explorer's labels show a search-volume score, two competition scores (one adjusted for the user's channel), an overall score, result counts, exact-title matches in the top results, recent uploads, related searches and a 30-day/12-month interest chart (observed). SEO Studio is a four-step flow: title and description, tags, thumbnail, apply (observed). A template states that search-position checks cover the first 20 results (observed).

## What CreatorDeck does differently, and why

| Topic | TubeBuddy (inferred) | CreatorDeck |
| --- | --- | --- |
| Channel writes | Studio private endpoints with session cookies | Official YouTube Data API with the user's own OAuth client |
| Scores and volumes | Server-side, proprietary | Computed locally from public signals; formulas in `src/core/`; presented as estimates |
| A/B scheduling | Server-side | `chrome.alarms` in the browser; runs when Chrome is open |
| CTR data | Studio analytics | YouTube Reporting API bulk reports |
| Cards and end screens | Studio private endpoints | No official API; not automated |
| Page footprint | About 40 libraries and 9 MB of script on every YouTube page | One small content script; UI in an extension page |
| Accounts | TubeBuddy account and licence | None; no CreatorDeck server |

## Limits of this teardown

- Static only. Which code paths actually run, in what order, and what the servers return are unknown.
- REA's semantic coverage of the four classic-script bundles was limited (30 of 68 sources "limited", 40,499 semantic unknowns retained), so call-flow claims are not made here.
- The 6.3 MB `destContent.js` bundle (the newer "beta experience") was inventoried for endpoints but not mapped feature by feature.
