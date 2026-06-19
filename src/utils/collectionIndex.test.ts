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
