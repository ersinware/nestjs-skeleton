/**
 * @file check-admin-is-active.handler.ts
 * @description Handles CheckAdminIsActiveQuery by fetching only the isActive field required
 * for authentication checks.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { ICheckAdminIsActivePort } from 'src/module/admin/application/query/check-admin-is-active/port';
import { TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT } from 'src/module/admin/application/query/check-admin-is-active/port';
import {
    CheckAdminIsActiveQuery,
    CheckAdminIsActiveResult,
} from 'src/module/admin/application/query/check-admin-is-active/query';

/**
 * Returns only the boolean active status for an admin by ID.
 */
@QueryHandler(CheckAdminIsActiveQuery)
export class CheckAdminIsActiveQueryHandler implements IQueryHandler<CheckAdminIsActiveQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT) private readonly port: ICheckAdminIsActivePort) {}

    /**
     * Executes the check admin is active query.
     *
     * @param query The query parameters
     * @returns True if the admin is active, false otherwise
     * @throws {ResourceNotFoundException} When no admin exists with the given ID.
     */
    async execute(query: CheckAdminIsActiveQuery): Promise<CheckAdminIsActiveResult> {
        const isActive = await this.port.checkIsActive(query.id);

        if (isActive === null) {
            throw new ResourceNotFoundException();
        }

        return isActive;
    }
}
