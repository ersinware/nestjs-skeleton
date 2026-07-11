/**
 * @file get-admin-email-and-name.query.ts
 * @description Query to retrieve only the email and name of an admin.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches the email and name of an admin by their unique identifier.
 */
export class GetAdminEmailAndNameQuery extends Query<GetAdminEmailAndNameResult> {
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
 * The expected result of the GetAdminEmailAndNameQuery.
 */
export type GetAdminEmailAndNameResult = {
    email: string;
    name: string;
};
