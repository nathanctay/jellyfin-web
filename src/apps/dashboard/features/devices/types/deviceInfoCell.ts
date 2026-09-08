import type { DeviceInfoDto } from '@jellyfin/sdk/lib/generated-client';
import type { MRT_Row } from 'material-react-table';

export interface DeviceInfoCell {
    renderedCellValue: React.ReactNode
    row: MRT_Row<DeviceInfoDto>
}
