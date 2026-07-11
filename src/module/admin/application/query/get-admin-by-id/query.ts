/**
 * @file get-admin-by-id.query.ts
 * @description Query that resolves the public read-model for an admin by their unique identifier.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Fetches the public admin projection by unique identifier.
 */
export class GetAdminByIdQuery extends Query<GetAdminByIdResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The expected result of the GetAdminByIdQuery, returning the read model.
 */
export type GetAdminByIdResult = {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};
