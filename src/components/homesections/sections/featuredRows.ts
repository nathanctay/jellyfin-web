import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getPortraitShape } from 'components/cardbuilder/utils/shape';

import {
    cachedFetch,
    FEATURED_ROW_TAG,
    groupFeaturedItemsByLabel,
    pickSlidingWindow,
    ROW_CACHE_TTL_MS
} from './customRowsUtils';
import type { SectionContainerElement, SectionOptions } from './section';

const MAX_FEATURED_ROWS = 6;
const MAX_FEATURED_ITEMS_PER_ROW = 16;

type ResumableSectionContainer = SectionContainerElement & {
    resume?: (options?: { refresh?: boolean }) => void;
};

function renderFeaturedRow(
    elem: HTMLElement,
    label: string,
    rowItems: BaseItemDto[],
    options: SectionOptions
) {
    const frag = document.createElement('div');
    frag.classList.add('verticalSection', 'hide');
    elem.appendChild(frag);

    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(label) + '</h2>';
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

    itemsContainer.fetchData = () => Promise.resolve(rowItems);
    itemsContainer.getItemsHtml = (items: BaseItemDto[]) => {
        return cardBuilder.getCardsHtml({
            items: items,
            shape: getPortraitShape(options.enableOverflow),
            preferThumb: 'auto',
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
            showParentTitle: true,
            lines: 2
        });
    };
    itemsContainer.parentContainer = frag;

    // This row is created after the shared resume sweep in loadSections has already
    // run, so it triggers its own data load. The timeout mirrors the polyfilled
    // CustomElements workaround in loadSections (webOS 1.2).
    window.setTimeout(() => itemsContainer.resume?.({ refresh: true }), 0);
}

export function loadFeaturedRows(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();
    const cacheKey = `featuredRows:${apiClient.serverId()}:${userId}`;

    return cachedFetch(cacheKey, ROW_CACHE_TTL_MS, () => {
        return apiClient
            .getItems(userId, {
                Tags: FEATURED_ROW_TAG,
                IncludeItemTypes: 'Movie,Series',
                Limit: 80,
                Fields: 'PrimaryImageAspectRatio,Path,Tags',
                Recursive: true
            })
            .then((result) => result.Items || []);
    })
        .then((items) => {
            // The user may have navigated away while the featured list loaded.
            if (!elem.isConnected || items.length === 0) return;

            const byLabel = groupFeaturedItemsByLabel(items);
            const labels = pickSlidingWindow(Array.from(byLabel.keys()), MAX_FEATURED_ROWS);

            labels.forEach((label) => {
                const rowItems = (byLabel.get(label) || []).slice(0, MAX_FEATURED_ITEMS_PER_ROW);
                if (rowItems.length === 0) return;
                renderFeaturedRow(elem, label, rowItems, options);
            });
        })
        .catch((err: unknown) => {
            console.error('[featuredRows] failed to load featured rows', err);
        });
}
