# Carousel Media-Bar Upgrade

Date: 2026-06-12
Status: Approved

## Problem

The home carousel (`src/components/homeCarousel/`) predates the discovery of
[jellyfin-plugin-media-bar](https://github.com/IAmParadox27/jellyfin-plugin-media-bar)
(IAmParadox27's wrapper around MakD's Media Bar). That UI is visually richer and its
item-selection model is better. The plugin itself injects JS into the server-served web
client, which is irrelevant to this Cloudflare-hosted fork - we adopt its ideas natively.

## Decisions (from review with Nathan)

Adopt: logo titles, metadata + genres row, favorite button, playlist-led curation with
random-unplayed fill. Skip: trailers (YouTube/SponsorBlock dependency), progressive
image loading, hover-pause/keyboard polish.

## Item selection

Replaces the `Featured` tag + latest-media model in `useCarouselItems`:

1. Read playlist name from `config.json` key `carouselPlaylist` (missing key defaults to
   `"Carousel"`; explicit empty string disables the playlist source). Find the playlist
   case-insensitively (`IncludeItemTypes: 'Playlist'`), fetch its children with
   `ParentId` and no sort - playlist order is slide order, giving drag-to-reorder
   curation control.
2. Fill remaining slots up to 10 with the media bar's selection: random unplayed
   movies/series that have an overview, logo, and backdrop
   (`SortBy: 'Random'`, `Filters: 'IsUnplayed'`, `HasOverview: true`,
   `ImageTypes: 'Logo,Backdrop'`), plus a client-side `ImageTags.Logo` check,
   deduped against playlist items.
3. Labels: `carousel:` tag override still wins; otherwise playlist items get
   "Featured", random fills get the `Suggestions` translation.
4. The `Featured` tag no longer drives carousel membership. Random fills change every
   load by design; the playlist is the pinning mechanism.

## Slide UI

- **Logo title**: `ImageTags.Logo` rendered via `apiClient.getScaledImageUrl` instead of
  the text title; text `<h2>` fallback when no logo (possible for playlist items only).
- **Metadata row** (each part rendered only when data exists):
  star icon + `CommunityRating.toFixed(1)`; critic score with the built-in
  `mediaInfoCriticRating` + `Fresh`/`Rotten` classes (>= 60 is fresh); premiere year;
  `OfficialRating` in the built-in `mediaInfoOfficialRating` badge class;
  series: `ChildCount` + `Season`/`TypeOptionPluralSeason` translations,
  movies: `EndsAtValue` translation with `getDisplayTime(now + RunTimeTicks / 10000 ms)`.
  `components/mediainfo/mediainfo.scss` is imported for the reused classes.
- **Genres line**: first three genres joined with a separator dot.
- **Favorite button**: heart icon button beside Play/More; optimistic toggle through
  `apiClient.updateFavoriteStatus(userId, itemId, isFavorite)`, reverting on error.
  Initial state from `item.UserData.IsFavorite`.

Unchanged: Swiper fade/autoplay/loop, 7s progress bar with clickable dots, Play/More
buttons, backdrop selection (second backdrop preferred), aspect-ratio layout.

## Components

- `src/components/homeCarousel/carouselUtils.ts` (new): pure helpers with vitest
  coverage, npm-only imports - `mergeCarouselItems` (dedupe by Id, playlist first, cap),
  `getSlideLabel` (tag override > playlist label > suggestions label),
  `isFreshCriticRating`.
- `src/components/homeCarousel/HomeCarousel.tsx`: selection rewrite + slide UI additions.
- `src/components/homeCarousel/homeCarousel.scss`: logo, meta row, genres, favorite
  button styles.
- `src/types/webConfig.ts`, `src/scripts/settings/webSettings.js`, `src/config.json`:
  `carouselPlaylist` plumbing following the `featuredCollections` pattern.

## Performance (added after initial implementation)

- **Stale-while-revalidate item cache**: the merged item list (and playlist id set) is
  cached in localStorage (`customRows:carousel:*`, 24h bound, reusing the homesections
  cache helpers). A cached list renders immediately - the first slide's backdrop URL is
  stable, so the browser's HTTP cache serves it instantly on repeat visits - while a
  fresh fetch updates the cache in the background for the next visit, keeping the random
  fills rotating per load without ever swapping slides mid-view.
- **Viewport-sized backdrops**: `getBackdropFillSize` requests
  min(1920, viewport x DPR capped at 2) wide images at quality 80 instead of a fixed
  1920px.
- **Blurhash + fade-in**: each slide shows its backdrop's blurhash (matching the
  second-backdrop preference) until the real image finishes loading, then fades it in.
  Respects the user's blurhash display setting.
- **Neighbor-only image loading**: only the active slide and its wrap-around neighbors
  download backdrops (`isNearActiveSlide`), sticky once started, so the first paint is
  never queued behind the other slides' images.

## Error handling

Playlist missing or empty: random fill takes all slots. All fetch failures log to
console and fall back to whatever items resolved; an empty result renders no carousel
(current behavior). Favorite toggle failure reverts the heart and logs.

## Out of scope

Trailers, SponsorBlock, YouTube embeds, progressive image loading, hover/keyboard
polish, any caching changes (carousel already loads independently of the rows).
