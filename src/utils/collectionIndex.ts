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
