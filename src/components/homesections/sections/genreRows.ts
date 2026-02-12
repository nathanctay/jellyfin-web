import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getPortraitShape } from 'utils/card';

import type { SectionContainerElement, SectionOptions } from './section';

const FEATURED_ROW_TAG = 'FeaturedRow';
const GENRE_ROW_LABEL_PREFIX = 'row:';

function getGenreRowLabel(item: BaseItemDto): string | undefined {
    const raw = item.Tags?.find(t => t.startsWith(GENRE_ROW_LABEL_PREFIX));
    if (!raw) return undefined;
    const label = raw.slice(GENRE_ROW_LABEL_PREFIX.length).trim();
    return label || undefined;
}

function getGenreItemsHtmlFn({ enableOverflow }: SectionOptions) {
    return function (items: BaseItemDto[]) {
        return cardBuilder.getCardsHtml({
            items,
            shape: getPortraitShape(enableOverflow),
            showUnplayedIndicator: false,
            showChildCountIndicator: true,
            context: 'home',
            overlayText: false,
            centerText: false,
            overlayPlayButton: true,
            allowBottomPadding: !enableOverflow,
            cardLayout: false,
            showTitle: true,
            showYear: true,
            showParentTitle: true,
            lines: 2
        });
    };
}

function renderGenreSection(
    elem: HTMLElement,
    apiClient: ApiClient,
    label: string,
    options: SectionOptions,
    customLabel?: string
) {
    let html = '';

    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(customLabel || label) + '</h2>';
    html += '</div>';

    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">';
    }

    if (options.enableOverflow) {
        html += '</div>';
    }
    html += '</div>';

    elem.innerHTML = html;

    const itemsContainer: SectionContainerElement | null = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    // fetchData and getItemsHtml are assigned by the caller for each row
    itemsContainer.getItemsHtml = getGenreItemsHtmlFn(options);
    itemsContainer.parentContainer = elem;
}

export function loadGenreRows(
    elem: HTMLElement,
    apiClient: ApiClient,
    user: UserDto,
    _userViews: BaseItemDto[],
    options: SectionOptions
) {
    elem.classList.remove('verticalSection');

    const userId = user.Id || apiClient.getCurrentUserId();

    const itemsQuery = {
        SortBy: 'Random',
        SortOrder: 'Descending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        EnableTotalRecordCount: false,
        Fields: 'PrimaryImageAspectRatio,Path,Tags',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Limit: 80,
        Tags: FEATURED_ROW_TAG
    };

    const featuredRowsPromise = apiClient.getItems(userId, itemsQuery).then(result => {
        const items = result.Items || [];
        if (!items.length) {
            return;
        }

        const candidates = items.filter(i => i.Id);
        if (!candidates.length) {
            return;
        }

        const rows = new Map<string, BaseItemDto[]>();
        const fallbackLabel = 'Featured';

        for (const item of candidates) {
            const label = getGenreRowLabel(item) || fallbackLabel;
            if (!rows.has(label)) {
                rows.set(label, []);
            }
            rows.get(label)!.push(item);
        }

        const allRows = Array.from(rows.entries());
        if (!allRows.length) {
            return;
        }

        const maxRows = 6;
        const selectedRows: Array<[string, BaseItemDto[]]> = [];

        if (allRows.length <= maxRows) {
            selectedRows.push(...allRows);
        } else {
            const today = new Date();
            const seed = today.getFullYear() * 1000 + (today.getMonth() + 1) * 32 + today.getDate();
            const startIndex = seed % allRows.length;

            for (let i = 0; i < maxRows; i++) {
                const index = (startIndex + i) % allRows.length;
                selectedRows.push(allRows[index]);
            }
        }

        selectedRows.forEach(([label, rowItems]) => {
            const frag = document.createElement('div');
            frag.classList.add('verticalSection');
            frag.classList.add('hide');
            elem.appendChild(frag);

            renderGenreSection(frag, apiClient, label, options, label === fallbackLabel ? undefined : label);

            const itemsContainer: SectionContainerElement | null = frag.querySelector('.itemsContainer');
            if (!itemsContainer) {
                return;
            }

            const limitedItems = rowItems.slice(0, 16);
            itemsContainer.fetchData = () => Promise.resolve(limitedItems);
            itemsContainer.getItemsHtml = getGenreItemsHtmlFn(options);
            itemsContainer.parentContainer = frag;
        });
    });

    const genreQuery = {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        EnableTotalRecordCount: false
    };

    const genreRowsPromise = apiClient.getGenres(userId, genreQuery).then(result => {
        const genres = result.Items || [];
        if (!genres.length) {
            return;
        }

        const candidates = genres.filter(g => g.Id && g.Name);
        if (!candidates.length) {
            return;
        }

        const maxGenreRows = 4;
        const selectedGenres: BaseItemDto[] = [];

        if (candidates.length <= maxGenreRows) {
            selectedGenres.push(...candidates);
        } else {
            const today = new Date();
            const seed = today.getFullYear() * 1000 + (today.getMonth() + 1) * 32 + today.getDate() * 7;
            const startIndex = seed % candidates.length;

            for (let i = 0; i < maxGenreRows; i++) {
                const index = (startIndex + i) % candidates.length;
                selectedGenres.push(candidates[index]);
            }
        }

        selectedGenres.forEach(genre => {
            if (!genre.Id || !genre.Name) {
                return;
            }

            const frag = document.createElement('div');
            frag.classList.add('verticalSection');
            frag.classList.add('hide');
            elem.appendChild(frag);

            renderGenreSection(frag, apiClient, genre.Name, options);

            const itemsContainer: SectionContainerElement | null = frag.querySelector('.itemsContainer');
            if (!itemsContainer) {
                return;
            }

            const limit = options.enableOverflow ? 16 : 8;
            const genreItemsQuery = {
                SortBy: 'Random',
                SortOrder: 'Ascending',
                IncludeItemTypes: 'Movie,Series',
                Recursive: true,
                EnableTotalRecordCount: false,
                Fields: 'PrimaryImageAspectRatio,Path',
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb',
                Limit: limit,
                GenreIds: genre.Id
            };

            itemsContainer.fetchData = () => apiClient.getItems(userId, genreItemsQuery).then(r => r.Items || []);
            itemsContainer.getItemsHtml = getGenreItemsHtmlFn(options);
            itemsContainer.parentContainer = frag;
        });
    });

    return Promise.all([featuredRowsPromise, genreRowsPromise]).then(() => undefined);
}

