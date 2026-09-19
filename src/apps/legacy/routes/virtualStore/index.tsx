/* global __MULTIPLAYER_SERVER__ */
import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../../hooks/useApi';
import { ServerConnections } from '../../../../lib/jellyfin-apiclient';

export default function VirtualStore() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { user } = useApi();
    const navigate = useNavigate();

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'EXIT') {
                if (window.history.length > 2) {
                    navigate(-1);
                } else {
                    navigate('/home');
                }
                return;
            }
            if (event.data && event.data.type === 'OPEN_DETAILS') {
                navigate(`/details?id=${event.data.payload.itemId}`);
                return;
            }
            // Wait for iframe to say READY
            // eslint-disable-next-line sonarjs/different-types-comparison -- MessageEventSource includes WindowProxy, so this comparison is valid
            if (event.data && event.data.type === 'READY' && event.source === iframeRef.current?.contentWindow) {
                const apiClient = ServerConnections.currentApiClient();
                if (!apiClient) return;

                const authPayload = {
                    token: apiClient.accessToken(),
                    serverUrl: apiClient.serverAddress(),
                    userId: apiClient.getCurrentUserId(),
                    username: user?.Name || 'Guest',
                    multiplayerServer: __MULTIPLAYER_SERVER__ || '',
                    locale: 'en-US',
                    theme: 'dark'
                };

                iframeRef.current?.contentWindow?.postMessage({
                    source: 'jellyfin',
                    version: 1,
                    type: 'AUTH',
                    payload: authPayload
                }, window.location.origin);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Resolving iframe src against the app base URL
    const iframeSrc = new URL('assets/3d-store/index.html', window.location.href).href;

    return (
        <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
            <iframe
                ref={iframeRef}
                src={iframeSrc}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title='Virtual 3D Store'
                allow='fullscreen'
            />
        </div>
    );
}
