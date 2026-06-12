import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape, getPortraitShape } from 'components/cardbuilder/utils/shape';

import {
    cachedFetch,
    dedupeInflight,
    filterSupportedSections,
    getUpcomingCardHtml,
    isPortraitViewMode,
    ROW_CACHE_TTL_MS,
    type PluginSectionInfo
} from './customRowsUtils';
import type { SectionContainerElement, SectionOptions } from './section';

interface PluginSectionsResult {
    Items?: PluginSectionInfo[];
}

interface SectionItemsResult {
    Items?: BaseItemDto[];
}

type ResumableSectionContainer = SectionContainerElement & {
    resume?: (options?: { refresh?: boolean }) => void;
};

function getSectionItemsHtmlFn(
    info: PluginSectionInfo,
    serverAddress: string,
    options: SectionOptions
) {
    return function (items: BaseItemDto[]) {
        const portrait = isPortraitViewMode(info.ViewMode);
        const shape = portrait ?
            getPortraitShape(options.enableOverflow) :
            getBackdropShape(options.enableOverflow);

        if (info.Section === 'UpcomingShows') {
            return items.map((item) => getUpcomingCardHtml(item, serverAddress, shape)).join('');
        }

        return cardBuilder.getCardsHtml({
            items: items,
            shape: shape,
            preferThumb: !portrait,
            showUnplayedIndicator: false,
            showChildCountIndicator: true,
            context: 'home',
            overlayText: false,
            centerText: true,
            overlayPlayButton: true,
            allowBottomPadding: !options.enableOverflow,
            cardLayout: false,
            showTitle: true,
            showYear: true,
            lines: 2
        });
    };
}

function renderPluginSection(
    elem: HTMLElement,
    apiClient: ApiClient,
    userId: string,
    info: PluginSectionInfo,
    options: SectionOptions
) {
    const frag = document.createElement('div');
    frag.classList.add('verticalSection', 'hide');
    if (info.ContainerClass) frag.classList.add(info.ContainerClass);
    elem.appendChild(frag);

    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(info.DisplayText || '') + '</h2>';
    html += '</div>';
    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
        html += '</div></div>';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap"></div>';
    }
    frag.innerHTML = html;

    const itemsContainer: ResumableSectionContainer | null = frag.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    const params: Record<string, string> = { userId };
    if (info.AdditionalData) params.additionalData = info.AdditionalData;
    const sectionUrl = apiClient.getUrl('HomeScreen/Section/' + info.Section, params);
    const cacheKey = `section:${apiClient.serverId()}:${userId}:${info.Section}:${info.AdditionalData || ''}`;

    itemsContainer.fetchData = dedupeInflight(() => {
        return cachedFetch(cacheKey, ROW_CACHE_TTL_MS, () => {
            return apiClient
                .getJSON(sectionUrl)
                .then((result: SectionItemsResult) => result?.Items || []);
        }).catch((err: unknown) => {
            console.error('[pluginSections] failed to load section ' + info.Section, err);
            return [];
        });
    });
    itemsContainer.getItemsHtml = getSectionItemsHtmlFn(info, apiClient.serverAddress(), options);
    itemsContainer.parentContainer = frag;

    // This row is created after the shared resume sweep in loadSections has already
    // run, so it triggers its own data load. The timeout mirrors the polyfilled
    // CustomElements workaround in loadSections (webOS 1.2).
    window.setTimeout(() => itemsContainer.resume?.({ refresh: true }), 0);
}

export function loadPluginSections(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();
    const url = apiClient.getUrl('HomeScreen/Sections', { userId });
    const cacheKey = `sections:${apiClient.serverId()}:${userId}`;

    return cachedFetch(cacheKey, ROW_CACHE_TTL_MS, () => {
        return apiClient
            .getJSON(url)
            .then((result: PluginSectionsResult) => filterSupportedSections(result?.Items || []));
    })
        .then((sections) => {
            // The user may have navigated away while the section list loaded.
            if (!elem.isConnected) return;

            sections.forEach((info) => {
                renderPluginSection(elem, apiClient, userId, info, options);
            });
        })
        .catch((err: unknown) => {
            console.error('[pluginSections] failed to load section list (is the Home Screen Sections plugin installed?)', err);
        });
}
