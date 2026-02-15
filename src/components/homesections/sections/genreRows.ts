import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getPortraitShape } from 'utils/card';

import type { SectionContainerElement, SectionOptions } from './section';

const MAX_FEATURED_ROWS = 6;
const MAX_FEATURED_ITEMS_PER_ROW = 16;
const MAX_GENRE_ROWS = 4;
const GENRE_ITEMS_PER_ROW = 16;
const ROW_LABEL_PREFIX = 'row:';

function getFeaturedRowLabel(tags: string[] | null | undefined): string {
    if (!tags || !tags.length) return 'Featured';
    const rowTag = tags.find((t) => t.startsWith(ROW_LABEL_PREFIX));
    if (rowTag) return rowTag.slice(ROW_LABEL_PREFIX.length).trim();
    return 'Featured';
}

function pickSlidingWindow<T>(arr: T[], count: number): T[] {
    if (arr.length <= count) return arr;
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const start = day % (arr.length - count + 1);
    return arr.slice(start, start + count);
}

function renderRowSection(
    elem: HTMLElement,
    title: string,
    fetchData: () => Promise<BaseItemDto[] | { Items?: BaseItemDto[] }>,
    getItemsHtml: (items: BaseItemDto[]) => string,
    options: SectionOptions
) {
    let html = '';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(title) + '</h2>';
    html += '</div>';
    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">';
    }
    if (options.enableOverflow) {
        html += '</div></div>';
    }
    html += '</div>';
    elem.innerHTML = html;

    const itemsContainer: SectionContainerElement | null = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;
    itemsContainer.fetchData = () => {
        return fetchData().then((result) => (Array.isArray(result) ? result : (result.Items ?? [])));
    };
    itemsContainer.getItemsHtml = getItemsHtml;
    itemsContainer.parentContainer = elem;
}

function getGenreItemsHtmlFn(options: SectionOptions) {
    return function (items: BaseItemDto[]) {
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
}

export function loadGenreRows(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    _userViews: BaseItemDto[],
    options: SectionOptions
): Promise<void> {
    const userId = user.Id || apiClient.getCurrentUserId();
    const serverId = apiClient.serverId();
    const imageFields = 'PrimaryImageAspectRatio,Path';
    const imageFieldsWithTags = imageFields + ',Tags';
    const promises: Promise<void>[] = [];

    // Featured item rows (tag: FeaturedRow, optional row:Label)
    const featuredPromise = apiClient
        .getItems(userId, {
            Tags: 'FeaturedRow',
            IncludeItemTypes: 'Movie,Series',
            Limit: 80,
            Fields: imageFieldsWithTags,
            Recursive: true
        })
        .then((result) => {
            const items = result.Items || [];
            if (items.length === 0) return;

            const byLabel = new Map<string, BaseItemDto[]>();
            items.forEach((item) => {
                const label = getFeaturedRowLabel(item.Tags);
                let list = byLabel.get(label);
                if (!list) {
                    list = [];
                    byLabel.set(label, list);
                }
                list.push(item);
            });

            const labels = pickSlidingWindow(Array.from(byLabel.keys()), MAX_FEATURED_ROWS);
            labels.forEach((label) => {
                const rowItems = (byLabel.get(label) || []).slice(0, MAX_FEATURED_ITEMS_PER_ROW);
                if (rowItems.length === 0) return;

                const frag = document.createElement('div');
                frag.classList.add('verticalSection', 'hide');
                elem.appendChild(frag);

                const fetchData = () => {
                    return Promise.resolve(rowItems);
                };
                renderRowSection(frag, label, fetchData, getGenreItemsHtmlFn(options), options);
            });
        })
        .catch((err) => {
            console.error('[genreRows] featured rows failed', err);
        });

    promises.push(featuredPromise);

    // Genre-based rows
    const genrePromise = apiClient
        .getGenres(userId, {
            IncludeItemTypes: 'Movie,Series'
        })
        .then((genresResult) => {
            const genres = genresResult.Items || [];
            if (genres.length === 0) return;

            const selected = pickSlidingWindow(genres, MAX_GENRE_ROWS);
            selected.forEach((genre) => {
                if (!genre.Id || !genre.Name) return;

                const frag = document.createElement('div');
                frag.classList.add('verticalSection', 'hide');
                elem.appendChild(frag);

                const fetchData = () => {
                    const client = ServerConnections.getApiClient(serverId);
                    return client.getItems(userId, {
                        GenreIds: genre.Id,
                        IncludeItemTypes: 'Movie,Series',
                        Limit: GENRE_ITEMS_PER_ROW,
                        SortBy: 'Random',
                        Fields: imageFields,
                        ImageTypeLimit: 1,
                        EnableImageTypes: 'Primary,Backdrop,Thumb',
                        Recursive: true
                    });
                };
                renderRowSection(
                    frag,
                    genre.Name,
                    fetchData,
                    getGenreItemsHtmlFn(options),
                    options
                );
            });
        })
        .catch((err) => {
            console.error('[genreRows] genre rows failed', err);
        });

    promises.push(genrePromise);

    return Promise.all(promises).then(() => {});
}
