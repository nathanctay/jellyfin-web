# Plugin-Backed Featured Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken tag-based featured rows with rows rendered from the jellyfin-plugin-home-sections server API, plus config-driven collection rows.

**Architecture:** Two new section loaders follow the existing `homesections/sections/*` pattern (verticalSection + emby-scroller + emby-itemscontainer with `fetchData`/`getItemsHtml` hooks). `pluginSections.ts` renders sections listed by `GET /HomeScreen/Sections`; `collectionRows.ts` renders Jellyfin collections named in `config.json`. Pure logic lives in `customRowsUtils.ts` with vitest coverage. Spec: `docs/superpowers/specs/2026-06-12-plugin-backed-featured-rows-design.md`.

**Tech Stack:** TypeScript, jellyfin-apiclient, existing cardBuilder, vitest.

**IMPORTANT — Git:** Nathan controls git. Do NOT commit or push. Each task ends at a verification step; Nathan reviews and commits himself.

---

### Task 1: Pure helpers module with tests

**Files:**
- Create: `src/components/homesections/sections/customRowsUtils.ts`
- Create: `src/components/homesections/sections/customRowsUtils.test.ts`

Note: this module must only import from npm packages (`escape-html`, `@jellyfin/sdk` types), never from aliased app paths, so vitest can load it without the webpack alias setup.

- [x] **Step 1: Write the failing tests**

```ts
// src/components/homesections/sections/customRowsUtils.test.ts
import { describe, expect, it } from 'vitest';

import {
    filterSupportedSections,
    getUpcomingCardHtml,
    isPortraitViewMode,
    matchCollectionsByName
} from './customRowsUtils';

describe('isPortraitViewMode', () => {
    it('matches the string enum value', () => {
        expect(isPortraitViewMode('Portrait')).toBe(true);
        expect(isPortraitViewMode('Landscape')).toBe(false);
    });

    it('matches the numeric enum value', () => {
        expect(isPortraitViewMode(0)).toBe(true);
        expect(isPortraitViewMode(1)).toBe(false);
    });

    it('defaults to landscape when missing', () => {
        expect(isPortraitViewMode(undefined)).toBe(false);
        expect(isPortraitViewMode(null)).toBe(false);
    });
});

describe('filterSupportedSections', () => {
    it('keeps only whitelisted section types and drops entries without a type', () => {
        const sections = [
            { Section: 'LatestMovies' },
            { Section: 'Discover' },
            { Section: 'UpcomingShows' },
            { Section: null },
            {}
        ];
        expect(filterSupportedSections(sections).map((s) => s.Section))
            .toEqual(['LatestMovies', 'UpcomingShows']);
    });
});

describe('matchCollectionsByName', () => {
    const collections = [
        { Id: '1', Name: 'Halloween' },
        { Id: '2', Name: 'Staff Picks' },
        { Id: '3', Name: 'Top Ten' }
    ];

    it('matches case-insensitively and preserves configured order', () => {
        const matched = matchCollectionsByName(collections, ['top ten', 'HALLOWEEN']);
        expect(matched.map((c) => c.Id)).toEqual(['3', '1']);
    });

    it('skips names with no matching collection', () => {
        const matched = matchCollectionsByName(collections, ['Nope', 'Staff Picks']);
        expect(matched.map((c) => c.Id)).toEqual(['2']);
    });

    it('returns empty for empty config', () => {
        expect(matchCollectionsByName(collections, [])).toEqual([]);
    });
});

describe('getUpcomingCardHtml', () => {
    const item = {
        Name: 'Severance',
        ProviderIds: {
            SonarrPoster: '/HomeScreen/CachedImage/abc123',
            EpisodeInfo: 'S03E01 - The <Return>',
            FormattedDate: 'In 3 days'
        }
    };

    it('absolutizes relative poster urls against the server address', () => {
        const html = getUpcomingCardHtml(item, 'https://server.example:8096', 'overflowPortrait');
        expect(html).toContain('https://server.example:8096/HomeScreen/CachedImage/abc123');
    });

    it('keeps absolute poster urls untouched', () => {
        const absolute = {
            ...item,
            ProviderIds: { ...item.ProviderIds, SonarrPoster: 'https://cdn.example/p.jpg' }
        };
        const html = getUpcomingCardHtml(absolute, 'https://server.example:8096', 'overflowPortrait');
        expect(html).toContain('https://cdn.example/p.jpg');
    });

    it('escapes text content', () => {
        const html = getUpcomingCardHtml(item, 'https://server.example:8096', 'overflowPortrait');
        expect(html).toContain('S03E01 - The &lt;Return&gt;');
        expect(html).not.toContain('The <Return>');
    });

    it('renders title, episode info and date lines', () => {
        const html = getUpcomingCardHtml(item, 'https://server.example:8096', 'overflowPortrait');
        expect(html).toContain('Severance');
        expect(html).toContain('In 3 days');
        expect(html).toContain('overflowPortraitCard');
        expect(html).toContain('cardPadder-overflowPortrait');
    });

    it('renders without a poster', () => {
        const noPoster = { Name: 'X', ProviderIds: {} };
        const html = getUpcomingCardHtml(noPoster, 'https://server.example:8096', 'overflowPortrait');
        expect(html).toContain('defaultCardBackground');
        expect(html).not.toContain('background-image');
    });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vite.config.ts src/components/homesections/sections/customRowsUtils.test.ts`
Expected: FAIL — cannot resolve `./customRowsUtils`.

- [x] **Step 3: Write the implementation**

```ts
// src/components/homesections/sections/customRowsUtils.ts
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';

export interface PluginSectionInfo {
    Section?: string | null;
    DisplayText?: string | null;
    AdditionalData?: string | null;
    ViewMode?: string | number | null;
    ContainerClass?: string | null;
}

export const SUPPORTED_PLUGIN_SECTIONS = [
    'LatestMovies',
    'LatestShows',
    'BecauseYouWatched',
    'WatchAgain',
    'Genre',
    'MyJellyseerrRequests',
    'UpcomingShows'
];

// The plugin serializes SectionViewMode as a string by default, but a numeric
// enum value survives if the server JSON options ever change.
export function isPortraitViewMode(viewMode: string | number | null | undefined): boolean {
    return viewMode === 'Portrait' || viewMode === 0;
}

export function filterSupportedSections(sections: PluginSectionInfo[]): PluginSectionInfo[] {
    return sections.filter(
        (section) => !!section.Section && SUPPORTED_PLUGIN_SECTIONS.includes(section.Section)
    );
}

export function matchCollectionsByName<T extends { Name?: string | null }>(
    collections: T[],
    configuredNames: string[]
): T[] {
    const matched: T[] = [];
    configuredNames.forEach((name) => {
        const collection = collections.find(
            (c) => (c.Name || '').toLowerCase() === name.toLowerCase()
        );
        if (collection) matched.push(collection);
    });
    return matched;
}

export function getUpcomingCardHtml(
    item: BaseItemDto,
    serverAddress: string,
    shape: string
): string {
    const providerIds = item.ProviderIds || {};
    let posterUrl = providerIds.SonarrPoster || '';
    if (posterUrl && !posterUrl.startsWith('http')) {
        posterUrl = serverAddress + posterUrl;
    }

    const imageStyle = posterUrl
        ? ` style="background-image:url('${encodeURI(posterUrl)}')"`
        : '';
    const imageClass = posterUrl
        ? 'cardImageContainer coveredImage cardContent'
        : 'cardImageContainer coveredImage cardContent defaultCardBackground defaultCardBackground1';

    let html = `<div class="card ${shape}Card card-hoverable card-withuserdata">`;
    html += '<div class="cardBox cardBox-bottompadded">';
    html += '<div class="cardScalable">';
    html += `<div class="cardPadder cardPadder-${shape}"></div>`;
    html += `<div class="${imageClass}"${imageStyle}></div>`;
    html += '</div>';
    html += `<div class="cardText cardTextCentered">${escapeHtml(item.Name || '')}</div>`;
    if (providerIds.EpisodeInfo) {
        html += `<div class="cardText cardText-secondary cardTextCentered">${escapeHtml(providerIds.EpisodeInfo)}</div>`;
    }
    if (providerIds.FormattedDate) {
        html += `<div class="cardText cardText-secondary cardTextCentered">${escapeHtml(providerIds.FormattedDate)}</div>`;
    }
    html += '</div></div>';
    return html;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vite.config.ts src/components/homesections/sections/customRowsUtils.test.ts`
Expected: PASS (all tests).

- [x] **Step 5: Checkpoint** — leave changes uncommitted for Nathan's review.

---

### Task 2: Plugin sections loader

**Files:**
- Create: `src/components/homesections/sections/pluginSections.ts`

No unit test (DOM/API glue, untested across all existing loaders); verified by typecheck, lint, and manual run in Task 5.

- [x] **Step 1: Write the loader**

```ts
// src/components/homesections/sections/pluginSections.ts
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape, getPortraitShape } from 'components/cardbuilder/utils/shape';

import {
    filterSupportedSections,
    getUpcomingCardHtml,
    isPortraitViewMode,
    type PluginSectionInfo
} from './customRowsUtils';
import type { SectionContainerElement, SectionOptions } from './section';

interface PluginSectionsResult {
    Items?: PluginSectionInfo[];
}

interface SectionItemsResult {
    Items?: BaseItemDto[];
}

function getSectionItemsHtmlFn(
    info: PluginSectionInfo,
    serverAddress: string,
    options: SectionOptions
) {
    return function (items: BaseItemDto[]) {
        const portrait = isPortraitViewMode(info.ViewMode);
        const shape = portrait
            ? getPortraitShape(options.enableOverflow)
            : getBackdropShape(options.enableOverflow);

        if (info.Section === 'UpcomingShows') {
            return items.map((item) => getUpcomingCardHtml(item, serverAddress, shape)).join('');
        }

        return cardBuilder.getCardsHtml({
            items: items,
            shape: shape,
            preferThumb: !portrait,
            showUnplayedIndicator: false,
            showChildCountIndicator: true,
            context: 'home',
            overlayText: false,
            centerText: true,
            overlayPlayButton: true,
            allowBottomPadding: !options.enableOverflow,
            cardLayout: false,
            showTitle: true,
            showYear: true,
            lines: 2
        });
    };
}

function renderPluginSection(
    elem: HTMLElement,
    apiClient: ApiClient,
    userId: string,
    info: PluginSectionInfo,
    options: SectionOptions
) {
    const frag = document.createElement('div');
    frag.classList.add('verticalSection', 'hide');
    if (info.ContainerClass) frag.classList.add(info.ContainerClass);
    elem.appendChild(frag);

    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(info.DisplayText || '') + '</h2>';
    html += '</div>';
    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
        html += '</div></div>';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap"></div>';
    }
    frag.innerHTML = html;

    const itemsContainer: SectionContainerElement | null = frag.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    const params: Record<string, string> = { userId };
    if (info.AdditionalData) params.additionalData = info.AdditionalData;
    const sectionUrl = apiClient.getUrl('HomeScreen/Section/' + info.Section, params);

    itemsContainer.fetchData = () => {
        return apiClient
            .getJSON(sectionUrl)
            .then((result: SectionItemsResult) => result?.Items || [])
            .catch((err: unknown) => {
                console.error('[pluginSections] failed to load section ' + info.Section, err);
                return [];
            });
    };
    itemsContainer.getItemsHtml = getSectionItemsHtmlFn(info, apiClient.serverAddress(), options);
    itemsContainer.parentContainer = frag;
}

export function loadPluginSections(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();
    const url = apiClient.getUrl('HomeScreen/Sections', { userId });

    return apiClient
        .getJSON(url)
        .then((result: PluginSectionsResult) => {
            filterSupportedSections(result?.Items || []).forEach((info) => {
                renderPluginSection(elem, apiClient, userId, info, options);
            });
        })
        .catch((err: unknown) => {
            console.error('[pluginSections] failed to load section list (is the Home Screen Sections plugin installed?)', err);
        });
}
```

- [x] **Step 2: Typecheck**

Run: `npm run build:check`
Expected: PASS. If `SectionContainerElement.fetchData` or `getJSON` types complain, match the patterns used by `resume.ts`/`nextUp.ts` rather than adding casts blindly.

- [x] **Step 3: Checkpoint** — leave changes uncommitted.

---

### Task 3: Collection rows loader and config plumbing

**Files:**
- Create: `src/components/homesections/sections/collectionRows.ts`
- Modify: `src/scripts/settings/webSettings.js` (add getter next to `getMenuLinks`)
- Modify: `src/types/webConfig.ts` (add field)
- Modify: `src/config.json` (add empty `featuredCollections`)

- [x] **Step 1: Add the config field and getter**

In `src/types/webConfig.ts`, add to `WebConfig`:

```ts
    featuredCollections?: string[]
```

In `src/scripts/settings/webSettings.js`, after `getMenuLinks()`:

```js
export function getFeaturedCollections() {
    return getConfig().then(config => {
        if (!Array.isArray(config.featuredCollections)) {
            return [];
        }
        return config.featuredCollections.filter(name => typeof name === 'string' && name.trim());
    }).catch(error => {
        console.log('cannot get web config:', error);
        return [];
    });
}
```

In `src/config.json`, add a top-level key (alongside `menuLinks`):

```json
"featuredCollections": [],
```

- [x] **Step 2: Write the loader**

```ts
// src/components/homesections/sections/collectionRows.ts
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape } from 'components/cardbuilder/utils/shape';
import { getFeaturedCollections } from 'scripts/settings/webSettings';

import { matchCollectionsByName } from './customRowsUtils';
import type { SectionContainerElement, SectionOptions } from './section';

const MAX_ITEMS_PER_ROW = 16;

function renderCollectionRow(
    elem: HTMLElement,
    apiClient: ApiClient,
    userId: string,
    collection: BaseItemDto,
    options: SectionOptions
) {
    const frag = document.createElement('div');
    frag.classList.add('verticalSection', 'hide');
    elem.appendChild(frag);

    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(collection.Name || '') + '</h2>';
    html += '</div>';
    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
        html += '</div></div>';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap"></div>';
    }
    frag.innerHTML = html;

    const itemsContainer: SectionContainerElement | null = frag.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    itemsContainer.fetchData = () => {
        return apiClient
            .getItems(userId, {
                ParentId: collection.Id,
                Limit: MAX_ITEMS_PER_ROW,
                Fields: 'PrimaryImageAspectRatio,Path',
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb'
            })
            .then((result) => result.Items || [])
            .catch((err: unknown) => {
                console.error('[collectionRows] failed to load collection ' + collection.Name, err);
                return [];
            });
    };
    itemsContainer.getItemsHtml = (items: BaseItemDto[]) => {
        return cardBuilder.getCardsHtml({
            items: items,
            shape: getBackdropShape(options.enableOverflow),
            preferThumb: true,
            showUnplayedIndicator: false,
            showChildCountIndicator: true,
            context: 'home',
            overlayText: false,
            centerText: true,
            overlayPlayButton: true,
            allowBottomPadding: !options.enableOverflow,
            cardLayout: false,
            showTitle: true,
            showYear: true,
            lines: 2
        });
    };
    itemsContainer.parentContainer = frag;
}

export function loadCollectionRows(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();

    return getFeaturedCollections()
        .then((names: string[]) => {
            if (!names.length) return;

            return apiClient
                .getItems(userId, {
                    IncludeItemTypes: 'BoxSet',
                    Recursive: true,
                    Limit: 200,
                    Fields: 'PrimaryImageAspectRatio'
                })
                .then((result) => {
                    matchCollectionsByName(result.Items || [], names).forEach((collection) => {
                        renderCollectionRow(elem, apiClient, userId, collection, options);
                    });
                });
        })
        .catch((err: unknown) => {
            console.error('[collectionRows] failed to load collection rows', err);
        });
}
```

Note: `webSettings.js` is untyped JS; if `getFeaturedCollections` resolves as `any`, the explicit `names: string[]` annotation above keeps the module typed.

- [x] **Step 3: Typecheck**

Run: `npm run build:check`
Expected: PASS.

- [x] **Step 4: Checkpoint** — leave changes uncommitted.

---

### Task 4: Wire into homesections.js and delete genreRows

**Files:**
- Modify: `src/components/homesections/homesections.js`
- Delete: `src/components/homesections/sections/genreRows.ts`

- [x] **Step 1: Replace the import**

In `src/components/homesections/homesections.js`, replace:

```js
import { loadGenreRows } from './sections/genreRows';
```

with:

```js
import { loadCollectionRows } from './sections/collectionRows';
import { loadPluginSections } from './sections/pluginSections';
```

(Keep import order alphabetical within the block to satisfy lint: `activeRecordings`, `collectionRows`, `libraryButtons`, `libraryTiles`, `liveTv`, `nextUp`, `pluginSections`, `recentlyAdded`, `resume`.)

- [x] **Step 2: Restore the custom call site**

In `loadSections`, after the native promises are built:

```js
                const promises = getAllSectionsToShow(userSettings)
                    .map((section, index) => (
                        loadSection(elem, apiClient, user, userSettings, userViews, section, index)
                    ));

                const customRowOptions = { enableOverflow: enableScrollX() };
                promises.push(loadCollectionRows(elem, apiClient, user, customRowOptions));
                promises.push(loadPluginSections(elem, apiClient, user, customRowOptions));

                return Promise.all(promises)
```

The custom loaders only build DOM and attach `fetchData`; the shared `resume(elem, { refresh: true })` that follows triggers the actual data loads, same as native sections.

- [x] **Step 3: Delete the old implementation**

Run: `rm src/components/homesections/sections/genreRows.ts`
Then: `grep -rn "genreRows\|loadGenreRows\|FeaturedRow" src/` — expected: no matches (the carousel's `Featured`/`carousel:` tags are different strings and must remain).

- [x] **Step 4: Checkpoint** — leave changes uncommitted.

---

### Task 5: Full verification

- [x] **Step 1: Run all checks**

```bash
npm run build:check && npm run lint && npx vitest run --config vite.config.ts
```

Expected: all PASS. Fix any lint/type fallout before proceeding.

- [x] **Step 2: Production build**

Run: `npm run build:production`
Expected: build completes without errors.

- [ ] **Step 3: Manual verification (requires plugin installed on the server)**

Run `npm start`, open the dashboard home tab, and verify:
- Native sections + carousel render as before.
- With the plugin installed and sections enabled: one row per enabled plugin section, in admin-configured order, portrait cards for My Requests/Upcoming Shows, landscape for the rest; Upcoming Shows cards show poster, series title, episode line, and countdown.
- With `featuredCollections` populated in `config.json`: one landscape row per named collection.
- With the plugin uninstalled/disabled: console error logged, no broken rows, home screen otherwise normal.

- [ ] **Step 4: Server setup (Nathan, one-time)** — follow the "Server setup" section of the spec: install File Transformation, Plugin Pages, Home Screen Sections; configure Jellyseerr/Sonarr URLs + keys; enable the seven sections with view modes and user override disabled.
