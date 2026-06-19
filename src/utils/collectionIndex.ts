import type { ApiClient } from 'jellyfin-apiclient';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

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

function isTmdbBoxSet(boxSet: BaseItemDto): boolean {
    const providerIds = boxSet.ProviderIds || {};
    return Object.keys(providerIds).some(
        (key) => key.toLowerCase().includes('tmdb') && !!providerIds[key]
    );
}

type BoxSetGroup = { boxSetId: string; boxSetName: string; isTmdb: boolean; movieIds: string[] };

async function buildIndex(apiClient: ApiClient, userId: string): Promise<CollectionIndex> {
    const boxSetsResult = await apiClient.getItems(userId, {
        IncludeItemTypes: 'BoxSet',
        Recursive: true,
        Fields: 'ProviderIds'
    });
    const boxSets = boxSetsResult?.Items || [];

    // A movie can belong to more than one box set (e.g. a manual collection on
    // top of the TMDb one). Fetch every box set's movies, then assign each movie
    // to a single collection deterministically: prefer the TMDb-created box set,
    // then fall back to a stable name/id order. First writer wins after the sort,
    // so the result does not depend on which fetch resolves first.
    const settled = await Promise.allSettled(boxSets.map(async (boxSet): Promise<BoxSetGroup | null> => {
        const boxSetId = boxSet.Id;
        if (!boxSetId) return null;
        const childrenResult = await apiClient.getItems(userId, {
            ParentId: boxSetId,
            IncludeItemTypes: 'Movie'
        });
        const movieIds = (childrenResult?.Items || [])
            .map((movie) => movie.Id)
            .filter((id): id is string => !!id);
        return { boxSetId, boxSetName: boxSet.Name || '', isTmdb: isTmdbBoxSet(boxSet), movieIds };
    }));

    // One box set's children failing must not discard the entire index; log and
    // drop only the failed groups, then build from the rest.
    settled.forEach((result) => {
        if (result.status === 'rejected') {
            console.error('[collectionIndex] failed to load box set children', result.reason);
        }
    });

    const sorted = settled
        .filter((result): result is PromiseFulfilledResult<BoxSetGroup | null> => result.status === 'fulfilled')
        .map((result) => result.value)
        .filter((group): group is BoxSetGroup => group !== null)
        .sort((a, b) => {
            if (a.isTmdb !== b.isTmdb) return a.isTmdb ? -1 : 1;
            return a.boxSetName.localeCompare(b.boxSetName) || a.boxSetId.localeCompare(b.boxSetId);
        });

    const index: CollectionIndex = {};
    for (const group of sorted) {
        for (const movieId of group.movieIds) {
            if (!(movieId in index)) {
                index[movieId] = { boxSetId: group.boxSetId, boxSetName: group.boxSetName };
            }
        }
    }

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
