import { APIVersionDetail } from '../interface/documentation.interface';
import { APITag, APITagDetail, APIVersion } from '../type/documentation.type';

export * from '../interface/documentation.interface';
export * from '../type/documentation.type';

export const ACTIVE_VERSIONS: APIVersion[] = ['1'];

export const TAG_DESCRIPTIONS: Record<APITag, APITagDetail> = {
    health: {
        '1': 'System health monitoring.',
    },
    user: {
        '1': 'User management and profile operations.',
    },
};

export const VERSION_CONFIG: Record<APIVersion, APIVersionDetail> = {
    '1': {
        title: 'Skeleton API V1',
        description: 'Core API features.',
        tags: {
            health: TAG_DESCRIPTIONS['health']['1'],
            user: TAG_DESCRIPTIONS['user']['1'],
        },
    },
};
