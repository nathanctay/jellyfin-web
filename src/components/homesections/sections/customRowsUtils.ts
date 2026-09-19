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

export const ROW_CACHE_TTL_MS = 10 * 60 * 1000;

const CACHE_PREFIX = 'customRows:';

interface RowCacheEntry {
    time: number;
    data: unknown;
}

export function readRowCache<T>(key: string, ttlMs: number): T | null {
    try {
        const raw = window.localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const entry = JSON.parse(raw) as RowCacheEntry;
        if (typeof entry?.time !== 'number' || Date.now() - entry.time > ttlMs) {
            return null;
        }
        return (entry.data as T) ?? null;
    } catch {
        return null;
    }
}

export function writeRowCache(key: string, data: unknown): void {
    try {
        window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ time: Date.now(), data }));
    } catch {
        // Caching is best-effort; quota or unavailable storage must never break rows.
    }
}

export function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = readRowCache<T>(key, ttlMs);
    if (cached !== null) {
        return Promise.resolve(cached);
    }
    return fetcher().then((data) => {
        writeRowCache(key, data);
        return data;
    });
}

// The shared resume sweep in homesections.js and a row's own self-resume can both
// trigger fetchData; sharing the in-flight promise keeps that to one network call.
export function dedupeInflight<T>(fetcher: () => Promise<T>): () => Promise<T> {
    let inflight: Promise<T> | null = null;
    return () => {
        if (!inflight) {
            inflight = fetcher().finally(() => {
                inflight = null;
            });
        }
        return inflight;
    };
}

// The plugin serializes SectionViewMode as a string by default, but a numeric
// enum value survives if the server JSON options ever change.
export function isPortraitViewMode(viewMode: string | number | null | undefined): boolean {
    return viewMode === 'Portrait' || viewMode === 0;
}

export function filterSupportedSections(sections: PluginSectionInfo[]): PluginSectionInfo[] {
    // The Home Screen Sections plugin picks genres randomly and can emit the same
    // one more than once (e.g. two "Thriller movies" rows). Collapse descriptors
    // that are identical in type, title and data so each row appears once. This
    // only drops true duplicates; distinct rows like "Because you watched A" vs
    // "...B" differ in DisplayText and are kept.
    const seen = new Set<string>();
    return sections.filter((section) => {
        if (!section.Section || !SUPPORTED_PLUGIN_SECTIONS.includes(section.Section)) {
            return false;
        }
        const key = `${section.Section}|${section.DisplayText || ''}|${section.AdditionalData || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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

export const FEATURED_ROW_TAG = 'FeaturedRow';
export const FEATURED_ROW_LABEL_PREFIX = 'row:';
export const DEFAULT_FEATURED_ROW_LABEL = 'Featured';

export function getFeaturedRowLabel(tags: string[] | null | undefined): string {
    if (!tags || !tags.length) return DEFAULT_FEATURED_ROW_LABEL;
    const rowTag = tags.find((t) => t.startsWith(FEATURED_ROW_LABEL_PREFIX));
    if (rowTag) {
        const label = rowTag.slice(FEATURED_ROW_LABEL_PREFIX.length).trim();
        if (label) return label;
    }
    return DEFAULT_FEATURED_ROW_LABEL;
}

export function groupFeaturedItemsByLabel<T extends { Tags?: string[] | null }>(
    items: T[]
): Map<string, T[]> {
    const byLabel = new Map<string, T[]>();
    items.forEach((item) => {
        const label = getFeaturedRowLabel(item.Tags);
        let list = byLabel.get(label);
        if (!list) {
            list = [];
            byLabel.set(label, list);
        }
        list.push(item);
    });
    return byLabel;
}

// Rotates which subset of rows is shown day-by-day when there are more labels
// than MAX_FEATURED_ROWS, so the home screen stays fresh without admin churn.
export function pickSlidingWindow<T>(arr: T[], count: number): T[] {
    if (arr.length <= count) return arr;
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const start = day % (arr.length - count + 1);
    return arr.slice(start, start + count);
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

    const imageStyle = posterUrl ?
        ` style="background-image:url('${encodeURI(posterUrl)}')"` :
        '';
    const imageClass = posterUrl ?
        'cardImageContainer coveredImage cardContent' :
        'cardImageContainer coveredImage cardContent defaultCardBackground defaultCardBackground1';

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
