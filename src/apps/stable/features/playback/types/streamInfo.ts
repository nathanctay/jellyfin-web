import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client';
import type { MediaType } from '@jellyfin/sdk/lib/generated-client';
import type { PlayMethod } from '@jellyfin/sdk/lib/generated-client';

export interface StreamInfo {
    ended?: boolean
    fullscreen?: boolean
    item?: BaseItemDto
    lastMediaInfoQuery?: number
    liveStreamId?: string
    mediaSource?: MediaSourceInfo
    mediaType?: MediaType
    mimeType?: string
    playMethod?: PlayMethod
    playSessionId?: string
    playbackStartTimeTicks?: number
    playerStartPositionTicks?: number
    resetSubtitleOffset?: boolean
    started?: boolean
    textTracks?: TrackInfo[]
    title?: string
    tracks?: TrackInfo[]
    transcodingOffsetTicks?: number
    url?: string
}

interface TrackInfo {
    url: string
    language: string
    isDefault: boolean
    index: number
    format: string
}
