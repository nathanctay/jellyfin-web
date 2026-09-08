import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';

/**
 * Views in the web app that we treat as UserViews.
 */
export const MetaView: Record<string, BaseItemDto> = {
    Favorites: {
        Id: 'favorites',
        Name: 'Favorites'
    }
};
