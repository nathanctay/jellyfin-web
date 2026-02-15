import { LegacyRoute } from '../../../../components/router/LegacyRoute';

export const LEGACY_PUBLIC_ROUTES: LegacyRoute[] = [
    {
        path: 'login',
        pageProps: {
            controller: 'session/login/index',
            view: 'session/login/index.html'
        }
    },
    {
        path: 'forgotpassword',
        pageProps: {
            controller: 'session/forgotPassword/index',
            view: 'session/forgotPassword/index.html'
        }
    },
    {
        path: 'forgotpasswordpin',
        pageProps: {
            controller: 'session/resetPassword/index',
            view: 'session/resetPassword/index.html'
        }
    }
];
