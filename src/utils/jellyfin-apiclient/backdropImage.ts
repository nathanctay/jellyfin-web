import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { randomInt } from '../number';

export interface ScaleImageOptions {
    maxWidth?: number;
    width?: number;
    maxHeight?: number;
    height?: number;
    fillWidth?: number;
    fillHeight?: number;
    quality?: number;
}

/**
 * Picks a backdrop index when multiple are available.
 * @param count Number of backdrop images.
 * @param randomOrPreferred If true, random index; if a number, use that index (clamped); otherwise 0.
 */
function getBackdropIndex(count: number, randomOrPreferred: boolean | number): number {
    if (count <= 0) return 0;
    if (randomOrPreferred === true) return randomInt(0, count - 1);
    if (typeof randomOrPreferred === 'number') return Math.min(Math.max(0, randomOrPreferred), count - 1);
    return 0;
}

/**
 * Returns the url of the first or a random backdrop image of an item.
 * If the item has no backdrop image, the url of the first or a random backdrop image of the parent item is returned.
 * Falls back to the primary image (cover) of the item, if neither the item nor it's parent have at least one backdrop image.
 * Returns undefined if no usable image was found.
 * @param apiClient The ApiClient to generate the url.
 * @param item The item for which the backdrop image is requested.
 * @param options Optional; allows to scale the backdrop image.
 * @param randomOrPreferred If true, a random backdrop is used when multiple exist. If a number (e.g. 1), that index is preferred (clamped). Use 1 to prefer the second image when multiple backdrops exist (often the wider one).
 * @returns The url of the chosen backdrop image of the provided item.
 */
export const getItemBackdropImageUrl = (apiClient: ApiClient, item: BaseItemDto, options: ScaleImageOptions = {}, randomOrPreferred: boolean | number = false): string | undefined => {
    if (item.Id && item.BackdropImageTags?.length) {
        const backdropImgIndex = getBackdropIndex(item.BackdropImageTags.length, randomOrPreferred);
        return apiClient.getScaledImageUrl(item.Id, {
            type: ImageType.Backdrop,
            index: backdropImgIndex,
            tag: item.BackdropImageTags[backdropImgIndex],
            ...options
        });
    } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        const backdropImgIndex = getBackdropIndex(item.ParentBackdropImageTags.length, randomOrPreferred);
        return apiClient.getScaledImageUrl(item.ParentBackdropItemId, {
            type: ImageType.Backdrop,
            index: backdropImgIndex,
            tag: item.ParentBackdropImageTags[backdropImgIndex],
            ...options
        });
    } else if (item.Id && item.ImageTags?.Primary) {
        return apiClient.getScaledImageUrl(item.Id, {
            type: ImageType.Primary,
            tag: item.ImageTags.Primary,
            ...options
        });
    }
    return undefined;
};
