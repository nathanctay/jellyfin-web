import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape } from 'components/cardbuilder/utils/shape';
import { getFeaturedCollections } from 'scripts/settings/webSettings';

import {
    cachedFetch,
    dedupeInflight,
    matchCollectionsByName,
    ROW_CACHE_TTL_MS
} from './customRowsUtils';
import type { SectionContainerElement, SectionOptions } from './section';

const MAX_ITEMS_PER_ROW = 16;

type ResumableSectionContainer = SectionContainerElement & {
    resume?: (options?: { refresh?: boolean }) => void;
};

function renderCollectionRow(
    elem: HTMLElement,
    apiClient: ApiClient,
    userId: string,
    collection: BaseItemDto,
    options: SectionOptions
) {
    const frag = document.createElement('div');
    frag.classList.add('verticalSection', 'hide');
    elem.appendChild(frag);

    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(collection.Name || '') + '</h2>';
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

    const cacheKey = `collection:${apiClient.serverId()}:${userId}:${collection.Id}`;

    itemsContainer.fetchData = dedupeInflight(() => {
        return cachedFetch(cacheKey, ROW_CACHE_TTL_MS, () => {
            return apiClient
                .getItems(userId, {
                    ParentId: collection.Id,
                    Limit: MAX_ITEMS_PER_ROW,
                    Fields: 'PrimaryImageAspectRatio,Path',
                    ImageTypeLimit: 1,
                    EnableImageTypes: 'Primary,Backdrop,Thumb'
                })
                .then((result) => result.Items || []);
        }).catch((err: unknown) => {
            console.error('[collectionRows] failed to load collection ' + collection.Name, err);
            return [];
        });
    });
    itemsContainer.getItemsHtml = (items: BaseItemDto[]) => {
        return cardBuilder.getCardsHtml({
            items: items,
            shape: getBackdropShape(options.enableOverflow),
            preferThumb: true,
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
    itemsContainer.parentContainer = frag;

    // This row is created after the shared resume sweep in loadSections has already
    // run, so it triggers its own data load. The timeout mirrors the polyfilled
    // CustomElements workaround in loadSections (webOS 1.2).
    window.setTimeout(() => itemsContainer.resume?.({ refresh: true }), 0);
}

export function loadCollectionRows(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();

    return getFeaturedCollections()
        .then((names: string[]) => {
            if (!names.length) return;

            const cacheKey = `collections:${apiClient.serverId()}:${userId}:${names.join('|')}`;

            return cachedFetch(cacheKey, ROW_CACHE_TTL_MS, () => {
                return apiClient
                    .getItems(userId, {
                        IncludeItemTypes: 'BoxSet',
                        Recursive: true,
                        Limit: 200,
                        Fields: 'PrimaryImageAspectRatio'
                    })
                    .then((result) => matchCollectionsByName(result.Items || [], names));
            }).then((collections) => {
                // The user may have navigated away while the collection list loaded.
                if (!elem.isConnected) return;

                collections.forEach((collection) => {
                    renderCollectionRow(elem, apiClient, userId, collection, options);
                });
            });
        })
        .catch((err: unknown) => {
            console.error('[collectionRows] failed to load collection rows', err);
        });
}
