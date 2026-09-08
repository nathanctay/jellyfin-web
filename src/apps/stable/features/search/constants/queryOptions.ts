import { ItemFields } from '@jellyfin/sdk/lib/generated-client';

export const QUERY_OPTIONS = {
    limit: 100,
    fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.CanDelete,
        ItemFields.MediaSourceCount
    ],
    enableTotalRecordCount: false,
    imageTypeLimit: 1
};
