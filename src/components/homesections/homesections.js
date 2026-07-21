import layoutManager from 'components/layoutManager';
import { DEFAULT_SECTIONS, HomeSectionType } from 'constants/homeSectionType';
import { getUserViewsQuery } from 'hooks/api/useUserViews';
import globalize from 'lib/globalize';
import Dashboard from 'utils/dashboard';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { loadRecordings } from './sections/activeRecordings';
import { loadCollectionRows } from './sections/collectionRows';
import { loadFeaturedRows } from './sections/featuredRows';
import { loadLibraryButtons } from './sections/libraryButtons';
import { loadLibraryTiles } from './sections/libraryTiles';
import { loadLiveTV } from './sections/liveTv';
import { loadNextUp } from './sections/nextUp';
import { loadPluginSections } from './sections/pluginSections';
import { loadRecentlyAdded } from './sections/recentlyAdded';
import { loadResume } from './sections/resume';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import './homesections.scss';

const MAX_SECTIONS = 10;
const MAX_SECTIONS_TV = MAX_SECTIONS + 1; // TV layout can have an extra section to ensure a library section is always visible

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function getAllSectionsToShow(userSettings) {
    const sections = [];
    for (let i = 0, length = MAX_SECTIONS; i < length; i++) {
        let section = userSettings.get('homesection' + i) || getDefaultSection(i);
        if (section === 'folders') {
            section = getDefaultSection(0);
        }

        sections.push(section);
    }

    // Ensure libraries are visible in TV layout
    if (
        layoutManager.tv
            && !sections.includes(HomeSectionType.SmallLibraryTiles)
            && !sections.includes(HomeSectionType.LibraryButtons)
    ) {
        return [
            HomeSectionType.SmallLibraryTiles,
            ...sections
        ];
    }

    return sections;
}

export function loadSections(elem, apiClient, user, userSettings) {
    const userId = user.Id || apiClient.getCurrentUserId();
    return queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), { userId }))
        .then(result => result.Items || [])
        .then(function (userViews) {
            let html = '';

            if (userViews.length) {
                // TV layout can have an extra section to ensure libraries are visible
                const totalSectionCount = layoutManager.tv ? MAX_SECTIONS_TV : MAX_SECTIONS;
                for (let i = 0; i < totalSectionCount; i++) {
                    html += '<div class="verticalSection section' + i + '"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');

                const sectionsToShow = getAllSectionsToShow(userSettings);
                const promises = sectionsToShow
                    .map((section, index) => (
                        loadSection(elem, apiClient, user, userSettings, userViews, section, index)
                    ));

                // Custom rows are intentionally not awaited: the plugin's section list
                // and external integrations can be slow, and native sections must never
                // wait on them. Each custom row resumes itself once its DOM exists.
                // Pre-created mounts keep the group order stable (featured tag rows,
                // then collections, then plugin rows) no matter which response arrives first.
                const customRowOptions = { enableOverflow: enableScrollX() };
                const featuredRowsMount = document.createElement('div');
                const collectionRowsMount = document.createElement('div');
                const pluginSectionsMount = document.createElement('div');
                elem.appendChild(featuredRowsMount);
                elem.appendChild(collectionRowsMount);
                elem.appendChild(pluginSectionsMount);

                // The My Requests row is pulled out of the plugin group and mounted
                // directly after Continue Watching so it reads as the third row (hero
                // carousel, Continue Watching, then My Requests) rather than sitting
                // with the other plugin rows below the native sections.
                const myRequestsMount = document.createElement('div');
                const resumeIndex = sectionsToShow.indexOf(HomeSectionType.Resume);
                const resumeSection = resumeIndex >= 0 ? elem.querySelector('.section' + resumeIndex) : null;
                if (resumeSection) {
                    elem.insertBefore(myRequestsMount, resumeSection.nextSibling);
                } else {
                    elem.insertBefore(myRequestsMount, featuredRowsMount);
                }

                loadFeaturedRows(featuredRowsMount, apiClient, user, customRowOptions);
                loadCollectionRows(collectionRowsMount, apiClient, user, customRowOptions);
                loadPluginSections(pluginSectionsMount, apiClient, user, customRowOptions, (info) => (
                    info.Section === 'MyJellyseerrRequests' ? myRequestsMount : pluginSectionsMount
                ));

                return Promise.all(promises)
                    // Timeout for polyfilled CustomElements (webOS 1.2)
                    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
                    .then(() => resume(elem, { refresh: true }));
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        });
}

export function destroySections(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

export function resume(elem, options) {
    const elems = elem.querySelectorAll('.itemsContainer');
    const promises = [];

    Array.prototype.forEach.call(elems, section => {
        if (section.resume) {
            promises.push(section.resume(options));
        }
    });

    return Promise.all(promises);
}

function loadSection(page, apiClient, user, userSettings, userViews, section, index) {
    const elem = page.querySelector('.section' + index);
    const options = { enableOverflow: enableScrollX() };

    switch (section) {
        case HomeSectionType.ActiveRecordings:
            loadRecordings(elem, true, apiClient, options);
            break;
        case HomeSectionType.LatestMedia:
            loadRecentlyAdded(elem, apiClient, user, userViews, options);
            break;
        case HomeSectionType.LibraryButtons:
            loadLibraryButtons(elem, userViews);
            break;
        case HomeSectionType.LiveTv:
            return loadLiveTV(elem, apiClient, user, options);
        case HomeSectionType.NextUp:
            loadNextUp(elem, apiClient, userSettings, options);
            break;
        case HomeSectionType.Resume:
            loadResume(elem, apiClient, 'HeaderContinueWatching', 'Video', userSettings, options);
            break;
        case HomeSectionType.ResumeAudio:
            loadResume(elem, apiClient, 'HeaderContinueListening', 'Audio', userSettings, options);
            break;
        case HomeSectionType.ResumeBook:
            loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
            break;
        case HomeSectionType.SmallLibraryTiles:
            loadLibraryTiles(elem, userViews, options);
            break;
        default:
            elem.innerHTML = '';
    }

    return Promise.resolve();
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};

