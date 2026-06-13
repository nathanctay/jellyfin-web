import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

const LABEL_TAG_PREFIX = 'carousel:';

export function mergeCarouselItems(
    playlistItems: BaseItemDto[],
    fillItems: BaseItemDto[],
    max: number
): BaseItemDto[] {
    const seen = new Set<string>();
    const merged: BaseItemDto[] = [];

    [...playlistItems, ...fillItems].forEach((item) => {
        if (item.Id && !seen.has(item.Id) && merged.length < max) {
            seen.add(item.Id);
            merged.push(item);
        }
    });

    return merged;
}

export function getSlideLabel(
    item: BaseItemDto,
    isPlaylistItem: boolean,
    featuredLabel: string,
    suggestionsLabel: string
): string {
    const labelTag = (item.Tags || []).find((tag) => tag.startsWith(LABEL_TAG_PREFIX));
    if (labelTag) {
        return labelTag.slice(LABEL_TAG_PREFIX.length).trim();
    }
    return isPlaylistItem ? featuredLabel : suggestionsLabel;
}

export function isFreshCriticRating(rating: number): boolean {
    return rating >= 60;
}

// Mirrors getItemBackdropImageUrl with a preferred index of 1: own backdrops first,
// then parent backdrops (second image preferred when present), then the primary image.
export function getSlideBackdropBlurhash(item: BaseItemDto): string | undefined {
    const ownTags = item.BackdropImageTags ?? [];
    const parentTags = item.ParentBackdropImageTags ?? [];
    const tags = ownTags.length ? ownTags : parentTags;

    if (tags.length) {
        const index = Math.min(1, tags.length - 1);
        return item.ImageBlurHashes?.Backdrop?.[tags[index]] ?? undefined;
    }

    const primaryTag = item.ImageTags?.Primary;
    return (primaryTag && item.ImageBlurHashes?.Primary?.[primaryTag]) ?? undefined;
}

// Whether a slide is the active one or an immediate (wrap-around) neighbor;
// only those slides download their backdrop, so the visible image never
// competes with the rest of the deck for bandwidth.
export function isNearActiveSlide(index: number, activeIndex: number, count: number): boolean {
    if (count <= 3) return true;
    const forward = (index - activeIndex + count) % count;
    const backward = (activeIndex - index + count) % count;
    return Math.min(forward, backward) <= 1;
}

const BACKDROP_MAX_WIDTH = 1920;
const BACKDROP_MIN_WIDTH = 640;

export function getBackdropFillSize(
    viewportWidth: number,
    devicePixelRatio: number
): { fillWidth: number; fillHeight: number } {
    const cappedDpr = Math.min(devicePixelRatio || 1, 2);
    const targetWidth = Math.round((viewportWidth || BACKDROP_MAX_WIDTH) * cappedDpr);
    const fillWidth = Math.min(BACKDROP_MAX_WIDTH, Math.max(BACKDROP_MIN_WIDTH, targetWidth));
    // Request the source 16:9 aspect so the server does not center-crop; the CSS
    // cover + background-position handles the crop with focal control instead.
    const fillHeight = Math.round(fillWidth * 9 / 16);
    return { fillWidth, fillHeight };
}
