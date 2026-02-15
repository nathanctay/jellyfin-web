import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, EffectFade } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'

import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'

import globalize from 'lib/globalize'
import { ServerConnections } from 'lib/jellyfin-apiclient'
import { appRouter } from 'components/router/appRouter'
import { playbackManager } from 'components/playback/playbackmanager'
import { getItemBackdropImageUrl } from 'utils/jellyfin-apiclient/backdropImage'

import CarouselProgressBar from './CarouselProgressBar'

import 'swiper/css'
import 'swiper/css/effect-fade'
import './homeCarousel.scss'

const CAROUSEL_DURATION_MS = 7000
const MAX_SLIDES = 10

function getCarouselLabel(item: BaseItemDto, isFeatured: boolean): string {
    const tags = item.Tags ?? []
    const carouselTag = tags.find((t: string) => t.startsWith('carousel:'))
    if (carouselTag) {
        return carouselTag.slice('carousel:'.length).trim()
    }
    return isFeatured ? 'Featured' : globalize.translate('HeaderLatestMedia')
}

function useCarouselItems() {
    const [items, setItems] = useState<BaseItemDto[]>([])
    const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        const apiClient = ServerConnections.currentApiClient()
        if (!apiClient) return

        const userId = apiClient.getCurrentUserId()
        const imageFields = 'PrimaryImageAspectRatio,Path,Tags,Overview,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ImageTags'

        const featuredPromise = apiClient.getItems(userId, {
            Tags: 'Featured',
            IncludeItemTypes: 'Movie,Series',
            Limit: MAX_SLIDES,
            Fields: imageFields,
            Recursive: true
        }).then((result) => ({ items: result.Items ?? [], featured: true }))

        const latestPromise = apiClient.getLatestItems({
            UserId: userId,
            IncludeItemTypes: 'Movie,Series',
            Limit: MAX_SLIDES,
            Fields: imageFields
        }).then((items) => ({ items: Array.isArray(items) ? items : [], featured: false }))

        Promise.all([featuredPromise, latestPromise]).then(([featuredResult, latestResult]) => {
            const featured = featuredResult.items
            const latest = latestResult.items
            const seen = new Set<string>()
            const merged: BaseItemDto[] = []
            const ids = new Set<string>()

            featured.forEach((item) => {
                if (item.Id && !seen.has(item.Id)) {
                    seen.add(item.Id)
                    merged.push(item)
                    ids.add(item.Id)
                }
            })
            latest.forEach((item) => {
                if (item.Id && !seen.has(item.Id) && merged.length < MAX_SLIDES) {
                    seen.add(item.Id)
                    merged.push(item)
                }
            })

            setItems(merged)
            setFeaturedIds(ids)
        }).catch((err) => {
            console.error('[HomeCarousel] failed to load items', err)
        })
    }, [])

    return { items, featuredIds }
}

export default function HomeCarousel() {
    const { items, featuredIds } = useCarouselItems()
    const [activeIndex, setActiveIndex] = useState(0)
    const swiperRef = useRef<SwiperType | null>(null)

    const onSwiper = useCallback((swiper: SwiperType) => {
        swiperRef.current = swiper
    }, [])

    const onSlideChange = useCallback((swiper: SwiperType) => {
        setActiveIndex(swiper.realIndex)
    }, [])

    const onProgressClick = useCallback((index: number) => {
        swiperRef.current?.slideTo(index)
    }, [])

    const onPlay = useCallback((item: BaseItemDto) => {
        playbackManager.play({ items: [item] }).catch((err) => {
            console.error('[HomeCarousel] play failed', err)
        })
    }, [])

    const onMore = useCallback((item: BaseItemDto) => {
        appRouter.showItem(item)
    }, [])

    const apiClient = useMemo(() => ServerConnections.currentApiClient(), [])

    if (!items.length || !apiClient) {
        return null
    }

    return (
        <div className="homeCarouselWrapper">
            <Swiper
                modules={[EffectFade, Autoplay]}
                effect="fade"
                fadeEffect={{ crossFade: true }}
                autoplay={{ delay: CAROUSEL_DURATION_MS, disableOnInteraction: false }}
                onSwiper={onSwiper}
                onSlideChange={onSlideChange}
                className="homeCarouselSwiper"
                allowTouchMove={true}
                loop={items.length > 1}
            >
                {items.map((item) => {
                    const backdropUrl = getItemBackdropImageUrl(apiClient, item, { maxWidth: 1920 })
                    const isFeatured = item.Id ? featuredIds.has(item.Id) : false
                    const label = getCarouselLabel(item, isFeatured)

                    return (
                        <SwiperSlide key={item.Id}>
                            <div className="homeCarouselContainer">
                                <div
                                    className="homeCarouselBackdrop"
                                    style={backdropUrl ? { backgroundImage: `url(${backdropUrl})` } : undefined}
                                />
                                <div className="homeCarouselContent">
                                    <div className="homeCarouselLabel">{label}</div>
                                    <h2 className="homeCarouselTitle">{item.Name}</h2>
                                    {item.Overview && (
                                        <p className="homeCarouselOverview">{item.Overview}</p>
                                    )}
                                    <div className="homeCarouselActions">
                                        {playbackManager.canPlay(item) && (
                                            <button
                                                type="button"
                                                className="btnPlay"
                                                onClick={() => onPlay(item)}
                                            >
                                                <span className="material-icons" aria-hidden>play_arrow</span>
                                                {globalize.translate('Play')}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btnMore"
                                            onClick={() => onMore(item)}
                                        >
                                            <span className="material-icons" aria-hidden>info</span>
                                            {globalize.translate('More')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </SwiperSlide>
                    )
                })}
            </Swiper>
            <CarouselProgressBar
                count={items.length}
                activeIndex={activeIndex}
                durationMs={CAROUSEL_DURATION_MS}
                onSelect={onProgressClick}
            />
        </div>
    )
}
