import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { CardOptions } from 'types/cardOptions';

export interface Section {
    title: string
    items: BaseItemDto[];
    cardOptions?: CardOptions;
};
