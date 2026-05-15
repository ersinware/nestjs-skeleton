import { APIVersionDetail } from '../interface/documentation.interface';
import { APITag, APITagDetail, APIVersion } from '../type/documentation.type';

export * from '../interface/documentation.interface';
export * from '../type/documentation.type';

export const ACTIVE_VERSIONS: APIVersion[] = ['1'];

export const TAG_DESCRIPTIONS: Record<APITag, APITagDetail> = {
    health: {
        '1': 'System health monitoring.',
    },
    users: {
        '1': 'User management and profile operations.',
    },
};

export const VERSION_CONFIG: Record<APIVersion, APIVersionDetail> = {
    '1': {
        title: 'Skeleton API V1',
        description: 'Core API features.',
        tags: {
            health: TAG_DESCRIPTIONS['health']['1'],
            users: TAG_DESCRIPTIONS['users']['1'],
        },
    },
};
