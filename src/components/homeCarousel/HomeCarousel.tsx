import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import type SwiperType from 'swiper';
// eslint-disable-next-line import/no-unresolved
import { Swiper, SwiperSlide } from 'swiper/react';
// eslint-disable-next-line import/no-unresolved
import { EffectFade, A11y, Keyboard } from 'swiper/modules';

// eslint-disable-next-line import/no-unresolved
import 'swiper/css';
// eslint-disable-next-line import/no-unresolved
import 'swiper/css/effect-fade';

import { useApi } from 'hooks/useApi';
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { getItemBackdropImageUrl } from 'utils/jellyfin-apiclient/backdropImage';
import globalize from 'lib/globalize';
import type { ApiClient } from 'jellyfin-apiclient';
import CarouselProgressBar from './CarouselProgressBar';

import './homeCarousel.scss';

const SLIDE_DURATION = 7000;
const FEATURED_TAG = 'Featured';
const MAX_ITEMS = 10;

interface CarouselItem {
    item: BaseItemDto;
    isFeatured: boolean;
}

function getTitle(item: BaseItemDto): string {
    if (item.Type === BaseItemKind.Episode && item.SeriesName) {
        return item.SeriesName;
    }
    if (item.Type === BaseItemKind.MusicAlbum && item.AlbumArtist) {
        return item.AlbumArtist;
    }
    return item.Name ?? '';
}

function getSubtitle(item: BaseItemDto): string | undefined {
    if (item.Type === BaseItemKind.Episode || item.Type === BaseItemKind.MusicAlbum) {
        return item.Name ?? undefined;
    }
    return undefined;
}

function formatRuntime(ticks: number): string {
    const totalMinutes = Math.round(ticks / 600000000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getBackdropUrl(apiClient: ApiClient, item: BaseItemDto): string | undefined {
    return getItemBackdropImageUrl(apiClient, item, { maxWidth: 1920 });
}

interface CarouselSlideContentProps {
    item: BaseItemDto;
    apiClient: ApiClient;
    isFeatured: boolean;
}

const CarouselSlideContent: FC<CarouselSlideContentProps> = ({ item, apiClient, isFeatured }) => {
    const backdropUrl = useMemo(
        () => getBackdropUrl(apiClient, item),
        [apiClient, item]
    );

    const subtitle = useMemo(() => getSubtitle(item), [item]);
    const title = useMemo(() => getTitle(item), [item]);
    const itemUrl = useMemo(() => appRouter.getRouteUrl(item), [item]);

    const handlePlayClick = useCallback(() => {
        playbackManager.play({
            items: [item]
        }).catch((err: unknown) => {
            console.error('[HomeCarousel] Failed to play item', err);
        });
    }, [item]);

    return (
        <div className='homeCarousel-slide'>
            <div
                className='homeCarousel-backdrop'
                style={{
                    backgroundImage: `url(${backdropUrl})`
                }}
            />
            <div className='homeCarousel-content'>
                <span className={`homeCarousel-label${isFeatured ? ' homeCarousel-label--featured' : ''}`}>
                    {isFeatured ? globalize.translate('Featured') || 'Featured' : globalize.translate('HeaderLatestMedia')}
                </span>
                <h2 className='homeCarousel-title'>
                    {title}
                </h2>
                {subtitle && (
                    <h3 className='homeCarousel-subtitle'>
                        {subtitle}
                    </h3>
                )}
                {item.Taglines?.[0] && (
                    <p className='homeCarousel-tagline'>
                        {item.Taglines[0]}
                    </p>
                )}
                <div className='homeCarousel-mediaInfo'>
                    {item.ProductionYear && (
                        <span>{item.ProductionYear}</span>
                    )}
                    {item.RunTimeTicks && (
                        <span>{formatRuntime(item.RunTimeTicks)}</span>
                    )}
                    {item.CommunityRating && (
                        <span className='homeCarousel-rating'>
                            <span className='material-icons homeCarousel-ratingIcon'>
                                star
                            </span>
                            {item.CommunityRating.toFixed(1)}
                        </span>
                    )}
                </div>
                {item.Overview && (
                    <p className='homeCarousel-overview'>
                        {item.Overview}
                    </p>
                )}
                <div className='homeCarousel-buttons'>
                    <button
                        type='button'
                        className='homeCarousel-playBtn'
                        onClick={handlePlayClick}
                    >
                        <span className='material-icons'>
                            play_arrow
                        </span>
                        {globalize.translate('Play')}
                    </button>
                    <a
                        className='homeCarousel-detailsBtn'
                        href={itemUrl}
                    >
                        {globalize.translate('ButtonMore')}
                    </a>
                </div>
            </div>
        </div>
    );
};

const HomeCarousel: FC = () => {
    const { api, user, __legacyApiClient__: apiClient } = useApi();
    const [carouselItems, setCarouselItems] = useState<CarouselItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const swiperRef = useRef<SwiperType | null>(null);

    useEffect(() => {
        if (!api || !user?.Id) return;

        const imageFields = [
            ItemFields.PrimaryImageAspectRatio,
            ItemFields.Overview
        ];
        const imageTypes = [
            ImageType.Primary,
            ImageType.Backdrop,
            ImageType.Thumb
        ];

        const hasBackdrop = (item: BaseItemDto) =>
            item.BackdropImageTags?.length
            || item.ParentBackdropImageTags?.length;

        // Fetch featured items (tagged "Featured") and latest media in parallel
        const featuredPromise = getItemsApi(api).getItems({
            userId: user.Id,
            tags: [FEATURED_TAG],
            fields: imageFields,
            imageTypeLimit: 1,
            enableImageTypes: imageTypes,
            sortBy: [ItemSortBy.Random],
            sortOrder: [SortOrder.Descending],
            recursive: true,
            limit: MAX_ITEMS
        }).then(({ data }) =>
            (data.Items ?? []).filter(hasBackdrop)
        ).catch(err => {
            console.error('[HomeCarousel] Failed to fetch featured items', err);
            return [] as BaseItemDto[];
        });

        const latestPromise = getUserLibraryApi(api).getLatestMedia({
            userId: user.Id,
            fields: imageFields,
            imageTypeLimit: 1,
            enableImageTypes: imageTypes,
            limit: 12
        }).then(({ data }) =>
            (data ?? []).filter(hasBackdrop)
        ).catch(err => {
            console.error('[HomeCarousel] Failed to fetch latest media', err);
            return [] as BaseItemDto[];
        });

        void Promise.all([featuredPromise, latestPromise]).then(([featured, latest]) => {
            const merged: CarouselItem[] = [];
            const usedIds = new Set<string>();

            // Featured items go first
            for (const item of featured) {
                if (item.Id && !usedIds.has(item.Id) && merged.length < MAX_ITEMS) {
                    usedIds.add(item.Id);
                    merged.push({ item, isFeatured: true });
                }
            }

            // Fill remaining slots with latest media (skip duplicates)
            for (const item of latest) {
                if (item.Id && !usedIds.has(item.Id) && merged.length < MAX_ITEMS) {
                    usedIds.add(item.Id);
                    merged.push({ item, isFeatured: false });
                }
            }

            setCarouselItems(merged);
        });
    }, [api, user?.Id]);

    const handleSlideChange = useCallback((swiper: SwiperType) => {
        setCurrentIndex(swiper.realIndex);
    }, []);

    const handleAnimationEnd = useCallback(() => {
        if (swiperRef.current) {
            swiperRef.current.allowSlideNext = true;
            swiperRef.current.slideNext();
        }
    }, []);

    const handleProgressClicked = useCallback((index: number) => {
        swiperRef.current?.slideToLoop(index);
    }, []);

    const handleMouseEnter = useCallback(() => {
        setIsPaused(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsPaused(false);
    }, []);

    const handleSwiper = useCallback((swiper: SwiperType) => {
        swiperRef.current = swiper;
    }, []);

    const handleTouchStart = useCallback(() => {
        setIsPaused(true);
    }, []);

    const handleTouchEnd = useCallback(() => {
        setIsPaused(false);
    }, []);

    const swiperModules = useMemo(() => [EffectFade, A11y, Keyboard], []);

    if (!carouselItems.length || !apiClient) return null;

    return (
        <div
            className='homeCarousel'
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <Swiper
                modules={swiperModules}
                effect='fade'
                fadeEffect={{ crossFade: true }}
                loop={carouselItems.length > 1}
                keyboard={{ enabled: true }}
                allowTouchMove
                onSwiper={handleSwiper}
                onRealIndexChange={handleSlideChange}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className='homeCarousel-swiper'
            >
                {carouselItems.map(({ item, isFeatured }) => (
                    <SwiperSlide key={item.Id}>
                        <CarouselSlideContent
                            item={item}
                            apiClient={apiClient}
                            isFeatured={isFeatured}
                        />
                    </SwiperSlide>
                ))}
            </Swiper>
            {carouselItems.length > 1 && (
                <CarouselProgressBar
                    pages={carouselItems.length}
                    currentIndex={currentIndex}
                    duration={SLIDE_DURATION}
                    paused={isPaused}
                    onAnimationEnd={handleAnimationEnd}
                    onProgressClicked={handleProgressClicked}
                />
            )}
        </div>
    );
};

export default HomeCarousel;
