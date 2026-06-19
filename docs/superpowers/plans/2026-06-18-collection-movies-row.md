# Collection Movies Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "More from [Collection]" row to movie detail pages that lists other movies from the same TMDB BoxSet present in the local library, placed below Cast & Crew.

**Architecture:** A new web-client-only module builds and caches a reverse `movieId -> { boxSetId, boxSetName }` index from existing Jellyfin BoxSets (working around the missing reverse-lookup API). The movie detail controller resolves the current movie's BoxSet from that index and renders its other movies using the existing `cardBuilder` pattern, mirroring `renderSimilarItems`.

**Tech Stack:** TypeScript, vanilla JS controller (`itemDetails`), `cardBuilder`, jellyfin-apiclient (`apiClient.getItems`), localStorage cache helpers from `customRowsUtils.ts`, vitest + jsdom for tests, eslint.

## Global Constraints

- Node >= 24.0.0, npm >= 11.0.0. Run all node tooling with this PATH prefix: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"`.
- **Git: the user controls all commits. Do NOT run `git commit`.** Where a step says "Stage", run only the `git add` shown and stop for the user to review/commit.
- **Known blocker:** `npx vitest` currently fails with `Cannot find module 'vite'` because of the intentionally stashed lockfile state. Do NOT modify `vite.config.ts` or run an install to fix it. Test-run steps below give the vitest command and expected result for when that is resolved; until then, `npx eslint` is the automated gate.
- No emojis anywhere (code, comments, commit messages).
- Follow existing detail-page patterns (`renderSimilarItems`, `renderMoreFromSeason`); reuse existing translation `MoreFromValue` ("More from {0}").
- Reuse `readRowCache` / `writeRowCache` from `components/homesections/sections/customRowsUtils.ts`; do not add a new cache layer.

---

## File Structure

- Create: `src/utils/collectionIndex.ts` — builds/caches the reverse index; exposes `getCollectionForMovie`.
- Create: `src/utils/collectionIndex.test.ts` — vitest unit tests for the module.
- Modify: `src/controllers/itemDetails/index.html` — new `#collectionMoviesCollapsible` markup block after Guest Cast, before the series/music sections and "More Like This".
- Modify: `src/controllers/itemDetails/index.js` — import `getCollectionForMovie`, add `renderCollectionMovies`, call it after `renderSimilarItems`.

---

## Task 1: Collection index module

**Files:**
- Create: `src/utils/collectionIndex.ts`
- Test: `src/utils/collectionIndex.test.ts`

**Interfaces:**
- Consumes: `readRowCache`, `writeRowCache` from `components/homesections/sections/customRowsUtils`.
- Produces:
  - `interface MovieCollection { boxSetId: string; boxSetName: string; }`
  - `getCollectionForMovie(apiClient: ApiClient, userId: string, movieId: string): Promise<MovieCollection | null>`

- [ ] **Step 1: Write the failing test**

Create `src/utils/collectionIndex.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCollectionForMovie } from './collectionIndex';

function makeApiClient() {
    const getItems = vi.fn(async (_userId: string, query: Record<string, unknown>) => {
        if (query.IncludeItemTypes === 'BoxSet') {
            return { Items: [{ Id: 'bs1', Name: 'John Wick Collection' }] };
        }
        if (query.ParentId === 'bs1') {
            return { Items: [{ Id: 'm1' }, { Id: 'm2' }] };
        }
        return { Items: [] };
    });
    return {
        serverId: () => 'srv',
        getItems
    };
}

describe('getCollectionForMovie', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('returns the box set for a movie that belongs to one', async () => {
        const apiClient = makeApiClient();
        const result = await getCollectionForMovie(apiClient as never, 'u1', 'm2');
        expect(result).toEqual({ boxSetId: 'bs1', boxSetName: 'John Wick Collection' });
    });

    it('returns null for a movie in no box set', async () => {
        const apiClient = makeApiClient();
        const result = await getCollectionForMovie(apiClient as never, 'u1', 'unknown');
        expect(result).toBeNull();
    });

    it('serves from cache without rebuilding on a second lookup', async () => {
        const apiClient = makeApiClient();
        await getCollectionForMovie(apiClient as never, 'u1', 'm1');
        const callsAfterBuild = apiClient.getItems.mock.calls.length;
        await getCollectionForMovie(apiClient as never, 'u1', 'm2');
        expect(apiClient.getItems.mock.calls.length).toBe(callsAfterBuild);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && npx vitest run src/utils/collectionIndex.test.ts`
Expected: FAIL — `getCollectionForMovie` is not exported / module not found.
If vitest is still blocked by the `vite` resolution issue, this command errors before running; proceed to implementation and rely on the eslint gate in Step 4.

- [ ] **Step 3: Write the implementation**

Create `src/utils/collectionIndex.ts`:

```ts
import type { ApiClient } from 'jellyfin-apiclient';

import { readRowCache, writeRowCache } from 'components/homesections/sections/customRowsUtils';

export interface MovieCollection {
    boxSetId: string;
    boxSetName: string;
}

type CollectionIndex = Record<string, MovieCollection>;

// Franchise membership changes rarely, so the reverse index is cached for a day.
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

// Shares one build across concurrent lookups so a page with several movies does
// not trigger the (N + 1) build more than once per cache key.
const inflight = new Map<string, Promise<CollectionIndex>>();

function indexCacheKey(apiClient: ApiClient, userId: string): string {
    return `collectionIndex:${apiClient.serverId()}:${userId}`;
}

async function buildIndex(apiClient: ApiClient, userId: string): Promise<CollectionIndex> {
    const boxSetsResult = await apiClient.getItems(userId, {
        IncludeItemTypes: 'BoxSet',
        Recursive: true
    });
    const boxSets = boxSetsResult?.Items || [];

    const index: CollectionIndex = {};
    await Promise.all(boxSets.map(async (boxSet) => {
        if (!boxSet.Id) return;
        const childrenResult = await apiClient.getItems(userId, {
            ParentId: boxSet.Id,
            IncludeItemTypes: 'Movie'
        });
        const children = childrenResult?.Items || [];
        children.forEach((movie) => {
            if (movie.Id) {
                index[movie.Id] = { boxSetId: boxSet.Id, boxSetName: boxSet.Name || '' };
            }
        });
    }));

    return index;
}

export function getCollectionForMovie(
    apiClient: ApiClient,
    userId: string,
    movieId: string
): Promise<MovieCollection | null> {
    const key = indexCacheKey(apiClient, userId);

    const cached = readRowCache<CollectionIndex>(key, INDEX_TTL_MS);
    if (cached) {
        return Promise.resolve(cached[movieId] ?? null);
    }

    let build = inflight.get(key);
    if (!build) {
        build = buildIndex(apiClient, userId)
            .then((index) => {
                writeRowCache(key, index);
                return index;
            })
            .finally(() => inflight.delete(key));
        inflight.set(key, build);
    }

    return build
        .then((index) => index[movieId] ?? null)
        .catch(() => null);
}
```

- [ ] **Step 4: Run the test (or eslint) to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && npx vitest run src/utils/collectionIndex.test.ts`
Expected: PASS (3 tests).
If vitest is blocked, run instead: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && npx eslint src/utils/collectionIndex.ts src/utils/collectionIndex.test.ts`
Expected: exit 0, no errors.

- [ ] **Step 5: Stage for the user to commit**

```bash
git add src/utils/collectionIndex.ts src/utils/collectionIndex.test.ts
```
Then stop and tell the user the files are staged for their review/commit (suggested message: `feat(itemDetails): add cached movie->boxset collection index`). Do not run `git commit`.

---

## Task 2: Detail-page row markup, render, and wiring

**Files:**
- Modify: `src/controllers/itemDetails/index.html` (insert after `#guestCastCollapsible`, currently ending at line 214)
- Modify: `src/controllers/itemDetails/index.js` (import near line 31; render function near the other `render*` helpers; call near line 1007)

**Interfaces:**
- Consumes: `getCollectionForMovie(apiClient, userId, movieId): Promise<MovieCollection | null>` from Task 1; `cardBuilder.getCardsHtml`, `imageLoader.lazyChildren`, `globalize.translate`, `ServerConnections` (all already imported in `index.js`).
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Add the markup block**

In `src/controllers/itemDetails/index.html`, insert this block immediately after the `#guestCastCollapsible` closing `</div>` (after line 214) and before `#seriesScheduleSection`:

```html
            <div id="collectionMoviesCollapsible" class="verticalSection detailVerticalSection hide">
                <h2 class="sectionTitle sectionTitle-cards padded-right"></h2>
                <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
                    <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer collectionMoviesContent"></div>
                </div>
            </div>
```

The `<h2>` is intentionally empty; `renderCollectionMovies` fills it with the collection name at runtime (same approach as `.moreFromSeasonSection`).

- [ ] **Step 2: Add the import**

In `src/controllers/itemDetails/index.js`, add this import alongside the other `utils/` imports (e.g. directly below line 34 `import dom from 'utils/dom';`):

```js
import { getCollectionForMovie } from 'utils/collectionIndex';
```

- [ ] **Step 3: Add the render function**

In `src/controllers/itemDetails/index.js`, add this function immediately after the `renderSimilarItems` function (after its closing brace at line 1211):

```js
function renderCollectionMovies(page, item, context) {
    const collapsible = page.querySelector('#collectionMoviesCollapsible');

    if (!collapsible) {
        return;
    }

    if (item.Type !== 'Movie') {
        collapsible.classList.add('hide');
        return;
    }

    const apiClient = ServerConnections.getApiClient(item.ServerId);
    const userId = apiClient.getCurrentUserId();

    getCollectionForMovie(apiClient, userId, item.Id).then(function (collection) {
        if (!collection) {
            collapsible.classList.add('hide');
            return;
        }

        return apiClient.getItems(userId, {
            ParentId: collection.boxSetId,
            IncludeItemTypes: 'Movie',
            ExcludeItemIds: item.Id,
            SortBy: 'PremiereDate,ProductionYear,SortName',
            Fields: 'PrimaryImageAspectRatio,CanDelete'
        }).then(function (result) {
            const items = result.Items || [];
            if (!items.length) {
                collapsible.classList.add('hide');
                return;
            }

            collapsible.classList.remove('hide');
            collapsible.querySelector('h2').innerText = globalize.translate('MoreFromValue', collection.boxSetName);

            const html = cardBuilder.getCardsHtml({
                items: items,
                shape: 'autooverflow',
                centerText: true,
                showTitle: true,
                showYear: true,
                context: context,
                lazy: true,
                overlayPlayButton: true,
                overlayText: false
            });
            const content = collapsible.querySelector('.collectionMoviesContent');
            content.innerHTML = html;
            imageLoader.lazyChildren(content);
        });
    }).catch(function (err) {
        console.error('[itemDetails] failed to render collection movies', err);
        collapsible.classList.add('hide');
    });
}
```

- [ ] **Step 4: Wire the call**

In `src/controllers/itemDetails/index.js`, add the call immediately after `renderSimilarItems(page, item, context);` (line 1007):

```js
    renderSimilarItems(page, item, context);
    renderCollectionMovies(page, item, context);
```

- [ ] **Step 5: Lint the changed files**

Run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && npx eslint src/controllers/itemDetails/index.js`
Expected: exit 0, no errors.

- [ ] **Step 6: Manual verification (browser)**

The detail controller has no unit-test harness, so verify in a running client:
1. Open a movie that belongs to a TMDB BoxSet with at least one other local movie -> a "More from [Collection]" row appears below Cast & Crew, excluding the current movie.
2. Open a movie in no BoxSet -> the row is absent (section stays hidden).
3. Open a non-movie (Series/Episode) -> the row is absent.
4. Confirm no console errors; the rest of the page renders normally even if the index build is slow (row appears when ready).

- [ ] **Step 7: Stage for the user to commit**

```bash
git add src/controllers/itemDetails/index.html src/controllers/itemDetails/index.js
```
Then stop and tell the user the files are staged for their review/commit (suggested message: `feat(itemDetails): show other movies from the same collection`). Do not run `git commit`.

---

## Self-Review

**Spec coverage:**
- Reverse-lookup index with 24h TTL, dedupe in-flight, reuse of cache helpers -> Task 1.
- `getCollectionForMovie` API -> Task 1 (returns entry or null).
- `renderCollectionMovies` mirroring `renderSimilarItems`, Movie-only guard, hide when no collection / no siblings, `MoreFromValue` title -> Task 2 Steps 3-4.
- Markup placed after Cast/Guest Cast, before More Like This -> Task 2 Step 1.
- Error handling hides section + logs, never breaks page -> Task 2 Step 3 (`.catch`).
- Tests in `customRowsUtils.test.ts` style -> Task 1 Step 1.
- Prerequisite (BoxSets exist, Collections library hidden) is server/settings, explicitly out of code scope -> noted in spec; no task needed.

**Placeholder scan:** No TBD/TODO; all steps contain real code and exact commands.

**Type consistency:** `MovieCollection { boxSetId, boxSetName }` and `getCollectionForMovie(apiClient, userId, movieId)` are used identically in Task 1 (definition) and Task 2 (consumption). The `.collectionMoviesContent` class and `#collectionMoviesCollapsible` id match between the markup (Step 1) and the render function (Step 3).
