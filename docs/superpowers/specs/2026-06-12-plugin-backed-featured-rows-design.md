# Plugin-Backed Featured Rows

Date: 2026-06-12
Status: Approved

## Problem

This fork's custom home-screen featured rows (`genreRows.ts`: tag-driven "FeaturedRow" rows
plus random genre rows) broke when upstream was merged: `homesections.js` was refactored
into a `HomeSectionType` switch and the `loadGenreRows` call site was dropped. The import
remains, but the rows never render.

Separately, the [jellyfin-plugin-home-sections](https://github.com/IAmParadox27/jellyfin-plugin-home-sections)
plugin implements better versions of these rows (weighted genre selection, Because You
Watched, Watch Again, release-date-based Latest rows) plus Jellyseerr and Sonarr
integrations, all server-side.

## Decision

Install the home-sections plugin on the Jellyfin server and redo this fork's featured rows
as a renderer for the plugin's REST API. All external integrations (Jellyseerr, Sonarr) and
their credentials live in the plugin's server-side configuration; nothing secret ships in
the web bundle, and no proxy is needed because the client already talks to the Jellyfin
server cross-origin with its normal auth token.

The tag-based FeaturedRow mechanism is retired. Hand curation moves to Jellyfin
collections, rendered client-side from a list of collection names in `config.json`.

## Architecture

```
Browser (this fork, hosted on Cloudflare)
  |- native sections (resume, next up, ...)   unchanged
  |- collectionRows.ts --- Jellyfin API: collections by name from config.json
  |- pluginSections.ts --- GET /HomeScreen/Sections?userId=        (section list)
                       \-- GET /HomeScreen/Section/{type}?userId=&additionalData= (row items)

Jellyfin server (seedbox, plugin installed)
  Home Screen Sections plugin
    |- library sections (LatestMovies, LatestShows, BecauseYouWatched, WatchAgain, Genre)
    |- MyJellyseerrRequests --> Jellyseerr (URL + API key in plugin config)
    |- UpcomingShows -----------> Sonarr (URL + API key in plugin config)
    \- /HomeScreen/CachedImage/{key}  anonymous poster cache for external images
```

### Plugin API facts (verified against plugin source, v3 branch)

- `GET /HomeScreen/Sections?userId={guid}` with `[Authorize]`; called without `pageHash`
  it returns ALL enabled section instances in one response, ordered by the admin-configured
  `OrderIndex`. Each `HomeScreenSectionInfo` has: `Section` (type id), `DisplayText`,
  `AdditionalData` (e.g. movie id for BecauseYouWatched, genre name for Genre),
  `ViewMode` (`Portrait`/`Landscape`/`Square`/`Small`), `ContainerClass`, `OrderIndex`.
- `GET /HomeScreen/Section/{sectionType}?userId={guid}&additionalData=` with `[Authorize]`
  returns `QueryResult<BaseItemDto>`. Library-backed sections return real library items.
  UpcomingShows returns synthetic DTOs: random `Id`, `Name` = series title,
  `IndexNumber`/`ParentIndexNumber`, `PremiereDate`, and `ProviderIds` carrying
  `SonarrPoster` (relative URL to the plugin's image cache), `EpisodeInfo`, `FormattedDate`.
- `GET /HomeScreen/CachedImage/{key}` is anonymous, so poster URLs work in plain img tags
  when prefixed with the server address.
- Section enablement, order, and view mode are admin-controlled in plugin settings;
  per-user override can be disabled (`AllowUserOverride`). This satisfies the requirement
  that users cannot customize the rows.

## Components

### 1. `src/components/homesections/sections/pluginSections.ts` (new)

- `loadPluginSections(elem, apiClient, user, options)`:
  fetch the section list via `apiClient.getJSON(apiClient.getUrl('HomeScreen/Sections', { userId }))`.
  For each returned section info, append a `verticalSection hide` div containing the
  standard `sectionTitleContainer` + `emby-scroller` + `emby-itemscontainer` markup
  (same pattern as the other section loaders), with:
  - `fetchData` = GET `HomeScreen/Section/{Section}` with `userId` and `AdditionalData`
  - `getItemsHtml` = cardBuilder with shape from ViewMode:
    `Portrait` -> `getPortraitShape(overflow)`, anything else -> `getBackdropShape(overflow)`
  - Exception: `UpcomingShows` items are synthetic, so they bypass cardBuilder and use a
    minimal custom card renderer: poster from `ProviderIds.SonarrPoster` (absolute via
    `apiClient.serverAddress()`), series title, `EpisodeInfo` line, `FormattedDate`
    countdown line, non-clickable.
- Whitelist of renderable section types, so unexpected plugin sections cannot inject
  unsupported markup: `LatestMovies`, `LatestShows`, `BecauseYouWatched`, `WatchAgain`,
  `Genre`, `MyJellyseerrRequests`, `UpcomingShows`.
- ViewMode may serialize as string or number depending on server JSON options; handle both.
- Any failure (plugin not installed, endpoint error) logs to console and renders nothing.

### 2. `src/components/homesections/sections/collectionRows.ts` (new)

- `loadCollectionRows(elem, apiClient, user, options)`:
  read collection names from `config.json` key `featuredCollections: string[]` via a new
  `getFeaturedCollections()` in `webSettings.js` (and `featuredCollections?: string[]`
  on `WebConfig`).
- Fetch all collections once (`IncludeItemTypes: 'BoxSet'`, `Recursive: true`), then match
  configured names exactly (case-insensitive). For each match, render one landscape row
  titled with the collection name whose `fetchData` queries the collection's children
  (`ParentId: collection.Id`). Row order follows the order of names in `config.json`.
- Missing or empty collections are skipped silently.

### 3. `src/components/homesections/homesections.js` (edit)

- Restore the custom call site inside `loadSections`: after the native section promises
  are built, push `loadCollectionRows(...)` and `loadPluginSections(...)` so their DOM and
  `fetchData` hooks exist before the shared `resume()` call triggers data loading.
- Remove the dangling `loadGenreRows` import.

### 4. Deletions

- `src/components/homesections/sections/genreRows.ts` (superseded by plugin Genre section
  and collection rows).

### 5. `src/config.json` (edit)

- Add `"featuredCollections": []` (names filled in by Nathan; editable without rebuild).

## Server setup (manual, one-time)

1. Add the plugin repository manifest from the IAmParadox27 repo to Jellyfin
   (Dashboard -> Plugins -> Repositories), then install: File Transformation,
   Plugin Pages, Home Screen Sections. Restart Jellyfin.
2. In Home Screen Sections settings: set Jellyseerr URL + API key, Sonarr URL + API key.
3. Enable exactly: Latest Movies, Latest Shows, Because You Watched, Watch Again, Genre,
   My Requests, Upcoming Shows. Set view mode Portrait for My Requests and Upcoming Shows,
   Landscape for the rest. Disable Allow User Override. Set the desired order.
4. Do not enable the plugin's own home-screen replacement for the web UI; this fork
   ignores the server-served web client, so the toggle is irrelevant to it either way.

## Performance

- The custom loaders are fired from `loadSections` without being awaited, so the plugin's
  expensive section-list computation and external integrations never delay native rows.
  Each custom row resumes its own items container once its DOM exists; `dedupeInflight`
  collapses the rare double-trigger (shared resume sweep + self-resume) into one request.
- All custom-row responses (section list, per-row items, collection lookup) are cached in
  `localStorage` under `customRows:*` keys for 10 minutes (`ROW_CACHE_TTL_MS`), keyed by
  server and user, so app startup within the TTL renders rows instantly. Cache writes are
  best-effort; storage failures never break rows.

## Error handling

- Every row's data fetch is isolated; a failing row hides itself and logs to console.
- If the plugin is missing or down, the home screen renders native sections + carousel
  only - identical to stock behavior plus carousel.
- Jellyseerr/Sonarr outages degrade only their own rows (plugin returns empty results;
  empty rows stay hidden).

## Testing

- `npm run build:check` (tsc) and `npm run lint` must pass.
- Manual verification against the live server once the plugin is installed: section list
  fetch, row rendering in both desktop and TV layouts, Upcoming Shows custom cards,
  collection rows from config.json, and graceful behavior with the plugin disabled.

## Out of scope

- Music/book/audiobook sections, Discover/Trending, Top Ten, My List, person sections.
- The home carousel (unchanged).
- Native section loaders and their per-user ordering (unchanged).
- Any proxy or env-var key embedding (superseded by the plugin decision).
