import type { MediaStream } from '@jellyfin/sdk/lib/generated-client';

type SubtitleTrack = Pick<MediaStream, 'LocalizedLanguage' | 'Title' | 'DisplayTitle' | 'Language'>;

/**
 * Gets the concise label used to identify a subtitle track in selectors.
 */
export function getSubtitleTrackLabel(track: SubtitleTrack) {
    return track.Title
        || track.LocalizedLanguage
        || track.DisplayTitle?.split(' - ')[0]
        || track.Language
        || '';
}
