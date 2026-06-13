import { describe, expect, it } from 'vitest';

import {
    getBackdropFillSize,
    getSlideBackdropBlurhash,
    getSlideLabel,
    isFreshCriticRating,
    isNearActiveSlide,
    mergeCarouselItems
} from './carouselUtils';

describe('mergeCarouselItems', () => {
    it('puts playlist items first and fills with the rest', () => {
        const playlist = [{ Id: 'p1' }, { Id: 'p2' }];
        const fill = [{ Id: 'f1' }, { Id: 'f2' }];
        expect(mergeCarouselItems(playlist, fill, 10).map((i) => i.Id))
            .toEqual(['p1', 'p2', 'f1', 'f2']);
    });

    it('dedupes fill items already in the playlist', () => {
        const playlist = [{ Id: 'a' }];
        const fill = [{ Id: 'a' }, { Id: 'b' }];
        expect(mergeCarouselItems(playlist, fill, 10).map((i) => i.Id))
            .toEqual(['a', 'b']);
    });

    it('caps the result and drops items without ids', () => {
        const playlist = [{ Id: 'a' }, {}, { Id: 'b' }];
        const fill = [{ Id: 'c' }, { Id: 'd' }];
        expect(mergeCarouselItems(playlist, fill, 3).map((i) => i.Id))
            .toEqual(['a', 'b', 'c']);
    });
});

describe('getSlideLabel', () => {
    it('prefers the carousel: tag label', () => {
        const item = { Tags: ['carousel: Editor Pick'] };
        expect(getSlideLabel(item, true, 'Featured', 'Suggestions')).toBe('Editor Pick');
    });

    it('labels playlist items as featured', () => {
        expect(getSlideLabel({ Tags: [] }, true, 'Featured', 'Suggestions')).toBe('Featured');
    });

    it('labels fill items as suggestions', () => {
        expect(getSlideLabel({}, false, 'Featured', 'Suggestions')).toBe('Suggestions');
    });
});

describe('isFreshCriticRating', () => {
    it('treats 60 and above as fresh', () => {
        expect(isFreshCriticRating(60)).toBe(true);
        expect(isFreshCriticRating(95)).toBe(true);
        expect(isFreshCriticRating(59)).toBe(false);
    });
});

describe('getSlideBackdropBlurhash', () => {
    it('uses the second own backdrop when multiple exist', () => {
        const item = {
            BackdropImageTags: ['t0', 't1'],
            ImageBlurHashes: { Backdrop: { t0: 'hash0', t1: 'hash1' } }
        };
        expect(getSlideBackdropBlurhash(item)).toBe('hash1');
    });

    it('uses the only own backdrop when one exists', () => {
        const item = {
            BackdropImageTags: ['t0'],
            ImageBlurHashes: { Backdrop: { t0: 'hash0' } }
        };
        expect(getSlideBackdropBlurhash(item)).toBe('hash0');
    });

    it('falls back to parent backdrops then primary', () => {
        const parentItem = {
            ParentBackdropImageTags: ['p0', 'p1'],
            ImageBlurHashes: { Backdrop: { p1: 'parentHash' } }
        };
        expect(getSlideBackdropBlurhash(parentItem)).toBe('parentHash');

        const primaryItem = {
            ImageTags: { Primary: 'prim' },
            ImageBlurHashes: { Primary: { prim: 'primaryHash' } }
        };
        expect(getSlideBackdropBlurhash(primaryItem)).toBe('primaryHash');
    });

    it('returns undefined without images', () => {
        expect(getSlideBackdropBlurhash({})).toBeUndefined();
    });
});

describe('isNearActiveSlide', () => {
    it('includes the active slide and direct neighbors', () => {
        expect(isNearActiveSlide(0, 0, 10)).toBe(true);
        expect(isNearActiveSlide(1, 0, 10)).toBe(true);
        expect(isNearActiveSlide(2, 0, 10)).toBe(false);
    });

    it('wraps around the deck', () => {
        expect(isNearActiveSlide(9, 0, 10)).toBe(true);
        expect(isNearActiveSlide(0, 9, 10)).toBe(true);
        expect(isNearActiveSlide(5, 0, 10)).toBe(false);
    });

    it('loads everything for small decks', () => {
        expect(isNearActiveSlide(2, 0, 3)).toBe(true);
    });
});

describe('getBackdropFillSize', () => {
    it('scales by capped device pixel ratio and keeps 16:9', () => {
        expect(getBackdropFillSize(800, 2)).toEqual({ fillWidth: 1600, fillHeight: 900 });
        expect(getBackdropFillSize(800, 3)).toEqual({ fillWidth: 1600, fillHeight: 900 });
    });

    it('clamps to the minimum and maximum widths', () => {
        expect(getBackdropFillSize(200, 1).fillWidth).toBe(640);
        expect(getBackdropFillSize(3000, 2).fillWidth).toBe(1920);
    });

    it('falls back to the maximum width when viewport is unknown', () => {
        expect(getBackdropFillSize(0, 1).fillWidth).toBe(1920);
    });
});
