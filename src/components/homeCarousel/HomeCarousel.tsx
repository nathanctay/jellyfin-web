import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line import/no-unresolved
import { Swiper, SwiperSlide } from 'swiper/react';
// eslint-disable-next-line import/no-unresolved
import { Autoplay, EffectFade } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';

import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import { BlurhashCanvas } from 'react-blurhash';

import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { getItemBackdropImageUrl } from 'utils/jellyfin-apiclient/backdropImage';
import datetime from 'scripts/datetime';
import { getCarouselPlaylist } from 'scripts/settings/webSettings';
import * as userSettings from 'scripts/settings/userSettings';

import { readRowCache, writeRowCache } from '../homesections/sections/customRowsUtils';
import {
    getBackdropFillSize,
    getSlideBackdropBlurhash,
    getSlideLabel,
    isFreshCriticRating,
    isNearActiveSlide,
    mergeCarouselItems
} from './carouselUtils';
import CarouselProgressBar from './CarouselProgressBar';

// eslint-disable-next-line import/no-unresolved
import 'swiper/css';
// eslint-disable-next-line import/no-unresolved
import 'swiper/css/effect-fade';
import 'components/mediainfo/mediainfo.scss';
import './homeCarousel.scss';

const CAROUSEL_DURATION_MS = 7000;
const MAX_SLIDES = 10;
const ITEM_FIELDS = 'PrimaryImageAspectRatio,Path,Tags,Overview,Genres,ChildCount,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ImageTags';

// Stale-while-revalidate window: anything cached within a day renders immediately
// while a fresh fetch updates the cache for the next visit.
const CAROUSEL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CarouselCacheEntry {
    items: BaseItemDto[];
    playlistIds: string[];
}

async function fetchPlaylistItems(apiClient: ApiClient, userId: string): Promise<BaseItemDto[]> {
    const playlistName: string = await getCarouselPlaylist();
    if (!playlistName) return [];

    const playlists = await apiClient.getItems(userId, {
        IncludeItemTypes: 'Playlist',
        Recursive: true,
        Limit: 100
    });
    const playlist = (playlists.Items ?? []).find(
        (p) => (p.Name || '').toLowerCase() === playlistName.toLowerCase()
    );
    if (!playlist?.Id) return [];

    const children = await apiClient.getItems(userId, {
        ParentId: playlist.Id,
        Limit: MAX_SLIDES,
        Fields: ITEM_FIELDS
    });
    return children.Items ?? [];
}

async function fetchFillItems(apiClient: ApiClient, userId: string): Promise<BaseItemDto[]> {
    const result = await apiClient.getItems(userId, {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        SortBy: 'Random',
        Filters: 'IsUnplayed',
        HasOverview: true,
        ImageTypes: 'Logo,Backdrop',
        Limit: MAX_SLIDES,
        Fields: ITEM_FIELDS
    });
    return (result.Items ?? []).filter((item) => item.ImageTags?.Logo);
}

function useCarouselItems() {
    const [items, setItems] = useState<BaseItemDto[]>([]);
    const [playlistIds, setPlaylistIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient) return;

        const userId = apiClient.getCurrentUserId();

        // Serve the last result immediately so the first slide (and its already
        // browser-cached backdrop) paints without waiting on the API; the fresh
        // fetch below updates the cache for the next visit, keeping fills rotating.
        const cacheKey = `carousel:${apiClient.serverId()}:${userId}`;
        const cached = readRowCache<CarouselCacheEntry>(cacheKey, CAROUSEL_CACHE_MAX_AGE_MS);
        const hasCached = !!cached?.items?.length;
        if (hasCached) {
            setPlaylistIds(new Set(cached.playlistIds));
            setItems(cached.items);
        }

        const playlistPromise = fetchPlaylistItems(apiClient, userId).catch((err: unknown) => {
            console.error('[HomeCarousel] playlist items failed', err);
            return [] as BaseItemDto[];
        });
        const fillPromise = fetchFillItems(apiClient, userId).catch((err: unknown) => {
            console.error('[HomeCarousel] suggestion items failed', err);
            return [] as BaseItemDto[];
        });

        Promise.all([playlistPromise, fillPromise]).then(([playlistItems, fillItems]) => {
            const ids = new Set<string>();
            playlistItems.forEach((item) => {
                if (item.Id) ids.add(item.Id);
            });
            const merged = mergeCarouselItems(playlistItems, fillItems, MAX_SLIDES);
            if (merged.length) {
                writeRowCache(cacheKey, {
                    items: merged,
                    playlistIds: Array.from(ids)
                } satisfies CarouselCacheEntry);
            }
            if (!hasCached) {
                setPlaylistIds(ids);
                setItems(merged);
            }
        }).catch((err: unknown) => {
            console.error('[HomeCarousel] failed to load items', err);
        });
    }, []);

    return { items, playlistIds };
}

function getSlideYear(item: BaseItemDto): number | undefined {
    if (item.PremiereDate) {
        const year = new Date(item.PremiereDate).getFullYear();
        if (!Number.isNaN(year)) return year;
    }
    return item.ProductionYear ?? undefined;
}

function getSlideDurationText(item: BaseItemDto): string | null {
    if (item.Type === 'Series') {
        if (!item.ChildCount) return null;
        const seasonsLabel = globalize.translate(item.ChildCount === 1 ? 'Season' : 'TypeOptionPluralSeason');
        return `${item.ChildCount} ${seasonsLabel}`;
    }
    if (item.RunTimeTicks) {
        const endDate = new Date(Date.now() + (item.RunTimeTicks / 10000));
        return globalize.translate('EndsAtValue', datetime.getDisplayTime(endDate));
    }
    return null;
}

function SlideMetaRow({ item }: Readonly<{ item: BaseItemDto }>) {
    const year = getSlideYear(item);
    const durationText = getSlideDurationText(item);
    const genres = (item.Genres ?? []).slice(0, 3);

    return (
        <>
            <div className='homeCarouselMetaRow'>
                {typeof item.CommunityRating === 'number' && (
                    <span className='homeCarouselMetaItem'>
                        <span className='material-icons starIcon' aria-hidden>star</span>
                        {item.CommunityRating.toFixed(1)}
                    </span>
                )}
                {typeof item.CriticRating === 'number' && (
                    <span
                        className={
                            'homeCarouselMetaItem mediaInfoCriticRating '
                            + (isFreshCriticRating(item.CriticRating) ? 'mediaInfoCriticRatingFresh' : 'mediaInfoCriticRatingRotten')
                        }
                    >
                        {Math.round(item.CriticRating)}%
                    </span>
                )}
                {year && <span className='homeCarouselMetaItem'>{year}</span>}
                {item.OfficialRating && (
                    <span className='homeCarouselMetaItem mediaInfoOfficialRating'>{item.OfficialRating}</span>
                )}
                {durationText && <span className='homeCarouselMetaItem'>{durationText}</span>}
            </div>
            {genres.length > 0 && (
                <div className='homeCarouselGenres'>{genres.join(' · ')}</div>
            )}
        </>
    );
}

type CarouselSlideProps = {
    item: BaseItemDto
    apiClient: ApiClient
    isPlaylistItem: boolean
    isFavorite: boolean
    shouldLoadImage: boolean
    onPlay: (item: BaseItemDto) => void
    onMore: (item: BaseItemDto) => void
    onToggleFavorite: (item: BaseItemDto, current: boolean) => void
};

function CarouselSlideContent({
    item,
    apiClient,
    isPlaylistItem,
    isFavorite,
    shouldLoadImage,
    onPlay,
    onMore,
    onToggleFavorite
}: Readonly<CarouselSlideProps>) {
    const handlePlay = useCallback(() => onPlay(item), [onPlay, item]);
    const handleMore = useCallback(() => onMore(item), [onMore, item]);
    const handleFavorite = useCallback(
        () => onToggleFavorite(item, isFavorite),
        [onToggleFavorite, item, isFavorite]
    );

    // Once told to load, stay loaded; slides never download their backdrop twice.
    const [loadStarted, setLoadStarted] = useState(shouldLoadImage);
    const [backdropLoaded, setBackdropLoaded] = useState(false);
    useEffect(() => {
        if (shouldLoadImage) setLoadStarted(true);
    }, [shouldLoadImage]);

    const fillSize = getBackdropFillSize(window.innerWidth, window.devicePixelRatio);
    const backdropUrl = getItemBackdropImageUrl(
        apiClient,
        item,
        { ...fillSize, quality: 80 },
        1
    );

    useEffect(() => {
        if (!loadStarted || !backdropUrl) return;

        const img = new Image();
        img.src = backdropUrl;
        if (img.complete) {
            setBackdropLoaded(true);
            return;
        }
        img.onload = () => setBackdropLoaded(true);
        img.onerror = () => setBackdropLoaded(true);
        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [loadStarted, backdropUrl]);

    const blurhash = getSlideBackdropBlurhash(item);
    // Fill items carry no label (the old "Suggestions" tag); playlist items keep
    // their custom "carousel:" tag or the default "Featured" badge.
    const label = getSlideLabel(item, isPlaylistItem, 'Featured', '');
    const logoTag = item.ImageTags?.Logo;
    const logoUrl = logoTag && item.Id ?
        apiClient.getScaledImageUrl(item.Id, { type: 'Logo', tag: logoTag, maxHeight: 280 }) :
        null;
    const favoriteLabel = globalize.translate(isFavorite ? 'Favorite' : 'AddToFavorites');
    const moreLabel = globalize.translate('More');

    return (
        <div className='homeCarouselContainer'>
            {!backdropLoaded && blurhash && userSettings.enableBlurhash() && (
                <BlurhashCanvas
                    hash={blurhash}
                    width={20}
                    height={20}
                    punch={1}
                    className='homeCarouselBlurhash'
                />
            )}
            <div
                className='homeCarouselBackdrop'
                style={loadStarted && backdropUrl ?
                    { backgroundImage: `url(${backdropUrl})`, opacity: backdropLoaded ? 1 : 0 } :
                    { opacity: 0 }}
            />
            <div className='homeCarouselContent'>
                {label && <div className='homeCarouselLabel'>{label}</div>}
                {logoUrl ? (
                    <img className='homeCarouselLogo' src={logoUrl} alt={item.Name ?? ''} />
                ) : (
                    <h2 className='homeCarouselTitle'>{item.Name}</h2>
                )}
                <SlideMetaRow item={item} />
                {item.Overview && (
                    <p className='homeCarouselOverview'>{item.Overview}</p>
                )}
                <div className='homeCarouselActions'>
                    <button
                        type='button'
                        className='btnMore'
                        onClick={handleMore}
                        aria-label={moreLabel}
                        title={moreLabel}
                    >
                        <span className='material-icons' aria-hidden>info_outline</span>
                    </button>
                    {playbackManager.canPlay(item) && (
                        <button
                            type='button'
                            className='btnPlay'
                            onClick={handlePlay}
                        >
                            <span className='material-icons' aria-hidden>play_arrow</span>
                            {globalize.translate('Play')}
                        </button>
                    )}
                    <button
                        type='button'
                        className={'btnFavorite' + (isFavorite ? ' btnFavorite-active' : '')}
                        onClick={handleFavorite}
                        aria-label={favoriteLabel}
                        title={favoriteLabel}
                    >
                        <span className='material-icons' aria-hidden>
                            {isFavorite ? 'favorite' : 'favorite_border'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function HomeCarousel() {
    const { items, playlistIds } = useCarouselItems();
    const [activeIndex, setActiveIndex] = useState(0);
    const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
    const swiperRef = useRef<SwiperType | null>(null);

    const onSwiper = useCallback((swiper: SwiperType) => {
        swiperRef.current = swiper;
    }, []);

    const onSlideChange = useCallback((swiper: SwiperType) => {
        setActiveIndex(swiper.realIndex);
    }, []);

    const onProgressClick = useCallback((index: number) => {
        swiperRef.current?.slideTo(index);
    }, []);

    const onPrev = useCallback(() => {
        swiperRef.current?.slidePrev();
    }, []);

    const onNext = useCallback(() => {
        swiperRef.current?.slideNext();
    }, []);

    const onPlay = useCallback((item: BaseItemDto) => {
        playbackManager.play({ items: [item] }).catch((err) => {
            console.error('[HomeCarousel] play failed', err);
        });
    }, []);

    const onMore = useCallback((item: BaseItemDto) => {
        appRouter.showItem(item);
    }, []);

    const onToggleFavorite = useCallback((item: BaseItemDto, current: boolean) => {
        const client = ServerConnections.currentApiClient();
        if (!client || !item.Id) return;

        const itemId = item.Id;
        const next = !current;
        setFavoriteOverrides((prev) => ({ ...prev, [itemId]: next }));
        client.updateFavoriteStatus(client.getCurrentUserId(), itemId, next).catch((err: unknown) => {
            console.error('[HomeCarousel] favorite toggle failed', err);
            setFavoriteOverrides((prev) => ({ ...prev, [itemId]: current }));
        });
    }, []);

    const apiClient = useMemo(() => ServerConnections.currentApiClient(), []);

    if (!items.length || !apiClient) {
        return null;
    }

    return (
        <div className='homeCarouselWrapper'>
            <Swiper
                modules={[EffectFade, Autoplay]}
                effect='fade'
                fadeEffect={{ crossFade: true }}
                autoplay={{ delay: CAROUSEL_DURATION_MS, disableOnInteraction: false }}
                onSwiper={onSwiper}
                onSlideChange={onSlideChange}
                className='homeCarouselSwiper'
                allowTouchMove={true}
                loop={items.length > 1}
            >
                {items.map((item, index) => (
                    <SwiperSlide key={item.Id}>
                        <CarouselSlideContent
                            item={item}
                            apiClient={apiClient}
                            isPlaylistItem={item.Id ? playlistIds.has(item.Id) : false}
                            isFavorite={item.Id ? (favoriteOverrides[item.Id] ?? item.UserData?.IsFavorite ?? false) : false}
                            shouldLoadImage={isNearActiveSlide(index, activeIndex, items.length)}
                            onPlay={onPlay}
                            onMore={onMore}
                            onToggleFavorite={onToggleFavorite}
                        />
                    </SwiperSlide>
                ))}
            </Swiper>
            {items.length > 1 && (
                <>
                    <button
                        type='button'
                        className='homeCarouselNav homeCarouselNav--prev'
                        onClick={onPrev}
                        aria-label={globalize.translate('Previous')}
                        title={globalize.translate('Previous')}
                    >
                        <span className='material-icons' aria-hidden>chevron_left</span>
                    </button>
                    <button
                        type='button'
                        className='homeCarouselNav homeCarouselNav--next'
                        onClick={onNext}
                        aria-label={globalize.translate('Next')}
                        title={globalize.translate('Next')}
                    >
                        <span className='material-icons' aria-hidden>chevron_right</span>
                    </button>
                </>
            )}
            <CarouselProgressBar
                count={items.length}
                activeIndex={activeIndex}
                durationMs={CAROUSEL_DURATION_MS}
                onSelect={onProgressClick}
            />
        </div>
    );
}
