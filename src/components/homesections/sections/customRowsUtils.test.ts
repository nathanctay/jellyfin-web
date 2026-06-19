import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cachedFetch,
    dedupeInflight,
    filterSupportedSections,
    getUpcomingCardHtml,
    isPortraitViewMode,
    matchCollectionsByName,
    readRowCache,
    writeRowCache
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

    it('collapses duplicate genre rows with the same title', () => {
        const sections = [
            { Section: 'Genre', DisplayText: 'Thriller movies' },
            { Section: 'Genre', DisplayText: 'Thriller movies' },
            { Section: 'Genre', DisplayText: 'Action movies' }
        ];
        expect(filterSupportedSections(sections).map((s) => s.DisplayText))
            .toEqual(['Thriller movies', 'Action movies']);
    });

    it('keeps same-type rows that differ in title or data', () => {
        const sections = [
            { Section: 'BecauseYouWatched', DisplayText: 'Because you watched A', AdditionalData: 'a' },
            { Section: 'BecauseYouWatched', DisplayText: 'Because you watched B', AdditionalData: 'b' }
        ];
        expect(filterSupportedSections(sections)).toHaveLength(2);
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

describe('row cache', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('round-trips data within the ttl', () => {
        writeRowCache('k1', [{ Id: 'a' }]);
        expect(readRowCache('k1', 60000)).toEqual([{ Id: 'a' }]);
    });

    it('expires data past the ttl', () => {
        vi.useFakeTimers();
        try {
            writeRowCache('k1', [{ Id: 'a' }]);
            vi.advanceTimersByTime(61000);
            expect(readRowCache('k1', 60000)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns null for missing or corrupt entries', () => {
        expect(readRowCache('missing', 60000)).toBeNull();
        window.localStorage.setItem('customRows:bad', 'not json');
        expect(readRowCache('bad', 60000)).toBeNull();
    });

    it('cachedFetch serves from cache without calling the fetcher', async () => {
        const fetcher = vi.fn().mockResolvedValue(['fresh']);
        writeRowCache('k2', ['cached']);
        await expect(cachedFetch('k2', 60000, fetcher)).resolves.toEqual(['cached']);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('cachedFetch fetches and stores on a cache miss', async () => {
        const fetcher = vi.fn().mockResolvedValue(['fresh']);
        await expect(cachedFetch('k3', 60000, fetcher)).resolves.toEqual(['fresh']);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(readRowCache('k3', 60000)).toEqual(['fresh']);
    });
});

describe('dedupeInflight', () => {
    it('shares one in-flight promise across concurrent calls', async () => {
        const deferred: { resolve?: (v: string[]) => void } = {};
        const fetcher = vi.fn(() => new Promise<string[]>((resolve) => {
            deferred.resolve = resolve;
        }));
        const deduped = dedupeInflight(fetcher);

        const first = deduped();
        const second = deduped();
        expect(fetcher).toHaveBeenCalledTimes(1);

        deferred.resolve?.(['items']);
        await expect(first).resolves.toEqual(['items']);
        await expect(second).resolves.toEqual(['items']);
    });

    it('fetches again after the previous call settles', async () => {
        const fetcher = vi.fn().mockResolvedValue(['items']);
        const deduped = dedupeInflight(fetcher);

        await deduped();
        await deduped();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
