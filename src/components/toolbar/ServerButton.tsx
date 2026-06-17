import logo from 'assets/img/logo.png';
import Button from '@mui/material/Button/Button';
import React, { FC } from 'react';
import { Link } from 'react-router-dom';

import { useSystemInfo } from 'hooks/useSystemInfo';

const ServerButton: FC = () => {
    const {
        data: systemInfo,
        isPending
    } = useSystemInfo();

    return (
        <Button
            variant='text'
            size='large'
            color='inherit'
            component={Link}
            to='/'
            aria-label={isPending ? '' : (systemInfo?.ServerName || 'Jellyfin')}
        >
            <img
                src={logo}
                alt={isPending ? '' : (systemInfo?.ServerName || 'Jellyfin')}
                style={{
                    height: '1.5em',
                    maxWidth: '11em'
                }}
            />
        </Button>
    );
};

export default ServerButton;
