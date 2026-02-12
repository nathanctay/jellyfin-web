import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
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
}

const CarouselSlideContent: FC<CarouselSlideContentProps> = ({ item, apiClient }) => {
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
                <span className='homeCarousel-label'>
                    {globalize.translate('HeaderLatestMedia')}
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
    const [items, setItems] = useState<BaseItemDto[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const swiperRef = useRef<SwiperType | null>(null);

    useEffect(() => {
        if (!api || !user?.Id) return;

        getUserLibraryApi(api).getLatestMedia({
            userId: user.Id,
            fields: [
                ItemFields.PrimaryImageAspectRatio,
                ItemFields.Overview
            ],
            imageTypeLimit: 1,
            enableImageTypes: [
                ImageType.Primary,
                ImageType.Backdrop,
                ImageType.Thumb
            ],
            limit: 12
        }).then(({ data }) => {
            const itemsWithBackdrops = (data ?? []).filter(item =>
                item.BackdropImageTags?.length
                || item.ParentBackdropImageTags?.length
            );
            setItems(itemsWithBackdrops.slice(0, 10));
        }).catch(err => {
            console.error('[HomeCarousel] Failed to fetch latest media', err);
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

    if (!items.length || !apiClient) return null;

    return (
        <div
            className='homeCarousel'
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {items.length > 1 && (
                <CarouselProgressBar
                    pages={items.length}
                    currentIndex={currentIndex}
                    duration={SLIDE_DURATION}
                    paused={isPaused}
                    onAnimationEnd={handleAnimationEnd}
                    onProgressClicked={handleProgressClicked}
                />
            )}
            <Swiper
                modules={swiperModules}
                effect='fade'
                fadeEffect={{ crossFade: true }}
                loop={items.length > 1}
                keyboard={{ enabled: true }}
                allowTouchMove
                onSwiper={handleSwiper}
                onRealIndexChange={handleSlideChange}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className='homeCarousel-swiper'
            >
                {items.map(item => (
                    <SwiperSlide key={item.Id}>
                        <CarouselSlideContent
                            item={item}
                            apiClient={apiClient}
                        />
                    </SwiperSlide>
                ))}
            </Swiper>
        </div>
    );
};

export default HomeCarousel;
