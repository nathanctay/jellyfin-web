import { describe, expect, it } from 'vitest';

import { getSubtitleTrackLabel } from './subtitleTrack';

describe('getSubtitleTrackLabel', () => {
    it('uses the localized language without format or external suffixes', () => {
        expect(getSubtitleTrackLabel({
            LocalizedLanguage: 'English',
            DisplayTitle: 'English - SUBRIP - EXTERNAL'
        })).toBe('English');
    });

    it('uses the track title when no localized language is available', () => {
        expect(getSubtitleTrackLabel({
            Title: 'English',
            DisplayTitle: 'English - SUBRIP'
        })).toBe('English');
    });

    it('removes display-title suffixes when it is the only label available', () => {
        expect(getSubtitleTrackLabel({
            DisplayTitle: 'English - SUBRIP - EXTERNAL'
        })).toBe('English');
    });

    it('falls back to the stream language', () => {
        expect(getSubtitleTrackLabel({ Language: 'eng' })).toBe('eng');
    });
});
