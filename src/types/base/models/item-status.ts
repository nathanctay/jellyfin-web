import { RecordingStatus } from '@jellyfin/sdk/lib/generated-client';
import { SeriesStatus } from '@jellyfin/sdk/lib/generated-client';

export const ItemStatus = {
    ...RecordingStatus,
    ...SeriesStatus
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type ItemStatus = typeof ItemStatus[keyof typeof ItemStatus] | null | undefined;
