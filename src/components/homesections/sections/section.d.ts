import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { BaseItemDtoQueryResult } from '@jellyfin/sdk/lib/generated-client';

export interface SectionOptions {
    enableOverflow: boolean
}

export type SectionContainerElement = {
    fetchData: () => Promise<BaseItemDtoQueryResult | BaseItemDto[]>
    getItemsHtml: (items: BaseItemDto[]) => void
    parentContainer: HTMLElement
} & Element;
