/**
 * @file get-admin-email-and-name.handler.ts
 * @description Handles GetAdminEmailAndNameQuery by fetching only the email and name from the reader port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetAdminEmailAndNamePort } from 'src/module/admin/application/query/get-admin-email-and-name/port';
import { TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT } from 'src/module/admin/application/query/get-admin-email-and-name/port';
import {
    GetAdminEmailAndNameQuery,
    type GetAdminEmailAndNameResult,
} from 'src/module/admin/application/query/get-admin-email-and-name/query';

/**
 * Returns the email and name projection for an admin by ID.
 */
@QueryHandler(GetAdminEmailAndNameQuery)
export class GetAdminEmailAndNameQueryHandler implements IQueryHandler<GetAdminEmailAndNameQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT) private readonly port: IGetAdminEmailAndNamePort) {}

    /**
     * Executes the get admin email and name query.
     *
     * @param query The query parameters
     * @returns The email and name read model
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async execute(query: GetAdminEmailAndNameQuery): Promise<GetAdminEmailAndNameResult> {
        const result = await this.port.getAdminEmailAndName(query.id);

        if (!result) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
