import { APITag } from '../type/documentation.type';

export interface APIVersionDetail {
    title: string;
    description: string;
    tags: Record<APITag, string>;
}
