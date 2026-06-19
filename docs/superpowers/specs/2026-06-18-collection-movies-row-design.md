# "More from [Collection]" row on movie detail pages

Date: 2026-06-18
Status: Approved (design)

## Goal

On a movie details page, show a row of other movies from the same TMDB
collection (franchise) that exist in the local library, placed below Cast &
Crew. This replaces the need to browse a visible Collections library while
still surfacing the TMDB collection data produced by the TMDB Box Sets plugin.

## Background and constraints

- The TMDB Box Sets plugin materializes TMDB `belongs_to_collection` data
  **only as Jellyfin BoxSets**. There is no per-movie franchise/collection
  field: `BaseItemDto` exposes only the movie's own `ProviderIds`, `Genres`,
  and `Tags`.
- Jellyfin has **no reverse-lookup API** for "which BoxSet contains this
  movie." The collection API only supports create/add/remove, and the items
  query has no `boxSetIds` / `anyProviderIdEquals` filter (only a `hasTmdbId`
  boolean). This is why stock Jellyfin never shows collection membership on an
  item page.
- The display side is already well supported: the detail page has
  `renderSimilarItems` / `renderMoreFromSeason` patterns and `cardBuilder` to
  mirror.

## Prerequisite (server / settings, not code)

This feature reads BoxSets, so they must exist server-side. The TMDB Box Sets
plugin should continue creating BoxSets, and the Collections library should be
hidden from the home screen / sidebar via user display settings rather than
deleted. If no BoxSets exist, the row hides silently with no errors.

## Architecture

Two new units plus markup/wiring in the existing detail controller.

### 1. Collection index (`src/utils/collectionIndex.ts`)

Builds and caches a reverse map from movie id to its BoxSet, working around the
missing reverse-lookup API.

- Build steps:
  1. `GET /Items?IncludeItemTypes=BoxSet&Recursive=true` -> list of BoxSets
     (1 request).
  2. For each BoxSet: `GET /Items?ParentId=<id>&IncludeItemTypes=Movie` ->
     child movie ids (N requests).
  3. Construct `Map<movieId, { boxSetId, boxSetName }>`.
- Caching: reuse `readRowCache` / `writeRowCache` from
  `components/homesections/sections/customRowsUtils.ts`. Key:
  `collectionIndex:<serverId>:<userId>`. TTL ~24h (franchise membership rarely
  changes). The build is asynchronous, backgrounded, and de-duplicated
  in-flight (mirror `dedupeInflight`).
- Public API:
  - `getCollectionForMovie(apiClient, userId, movieId): Promise<{ boxSetId: string; boxSetName: string } | null>`
    - Returns the cached entry, building the index first on a cache miss.
    - Returns `null` if the movie is in no BoxSet.

Tradeoff: the build is N+1 where N is the number of collections. It runs once
per TTL in the background, so steady-state per-page cost is a single request.
The first build is chatty for very large collection counts; the long TTL keeps
that infrequent.

### 2. Detail-page render (`renderCollectionMovies` in `src/controllers/itemDetails/index.js`)

Mirrors `renderSimilarItems`:

- Guard: only `item.Type === 'Movie'`; otherwise add `hide` and return.
- Resolve the BoxSet via `getCollectionForMovie`. If `null`, hide.
- Fetch siblings:
  `GET /Items?ParentId=<boxSetId>&IncludeItemTypes=Movie&ExcludeItemIds=<item.Id>&Fields=PrimaryImageAspectRatio,CanDelete`.
- If fewer than 1 sibling, hide.
- Otherwise render with `cardBuilder.getCardsHtml` (`shape: 'autooverflow'`,
  `showYear: true`, `overlayPlayButton: true`, `centerText: true`). Section
  title uses the existing `MoreFromValue` translation -> "More from
  [Collection Name]".

### 3. Markup and wiring

- New `#collectionMoviesCollapsible` vertical section in
  `src/controllers/itemDetails/index.html`, placed **after the Cast & Crew /
  Guest Cast block and before "More Like This" (`#similarCollapsible`)** —
  franchise is more relevant than generic similar items.
- Call `renderCollectionMovies(page, item, context)` alongside the existing
  `renderSimilarItems(page, item, context)` invocation.

## Data flow

1. User opens a movie detail page.
2. `renderCollectionMovies` calls `getCollectionForMovie`.
3. On cache hit, the BoxSet id/name returns immediately; on miss, the index
   builds in the background and resolves when ready.
4. The row fetches the BoxSet's other movies and renders cards, or hides if
   there is no collection or no local siblings.

## Error handling

Every network call is wrapped so failures hide the section and log via
`console.error`, never breaking the rest of the detail page. This matches the
existing detail-page and plugin-section behavior.

## Testing

- Vitest unit tests for `collectionIndex`:
  - Index build constructs the correct `movieId -> boxSet` map from mocked
    BoxSet list + children responses.
  - `getCollectionForMovie` returns the entry for a member movie and `null`
    for a non-member.
  - Cache hit avoids rebuilding.
- Style follows `customRowsUtils.test.ts`.
- Caveat: vitest cannot currently run in this checkout due to a pre-existing
  top-level `vite` module-resolution issue (the stashed lockfile work). Tests
  will be written but cannot be executed until that is resolved. Lint (eslint)
  will be used to validate in the meantime.

## Out of scope

- Server-side changes (no proxy endpoint; this is Approach A, web-client only).
- Showing franchise siblings for non-Movie types.
- Any change to how BoxSets are created or to the Collections library
  visibility (handled by server/settings as a prerequisite).
