/**
 * @file admin-reader.adapter.ts
 * @description Read-only Drizzle ORM implementation of specific query ports. Selects only the columns
 * required by each read-model, avoiding full aggregate reconstitution on the read path.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import { type ICheckAdminIsActivePort } from 'src/module/admin/application/query/check-admin-is-active';
import { type IGetAdminByIdPort, GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id';
import {
    type GetAdminCredentialsByEmailResult,
    type IGetAdminCredentialsByEmailPort,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';
import {
    type GetAdminCredentialsByIdResult,
    type IGetAdminCredentialsByIdPort,
} from 'src/module/admin/application/query/get-admin-credentials-by-id';
import {
    type GetAdminEmailAndNameResult,
    type IGetAdminEmailAndNamePort,
} from 'src/module/admin/application/query/get-admin-email-and-name';
import { type GetAdminRoleResult, type IGetAdminRolePort } from 'src/module/admin/application/query/get-admin-role';
import {
    type GetDeletedAdminRoleResult,
    type IGetDeletedAdminRolePort,
} from 'src/module/admin/application/query/get-deleted-admin-role';
import { type IListAdminsPort, type ListAdminsResult } from 'src/module/admin/application/query/list-admins';
import { admin } from 'src/module/admin/infrastructure/database/schema';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Implements query-specific reader ports with direct SQL projection queries.
 * Never instantiates aggregate roots — maps rows straight to flat read-models.
 */
@Injectable()
export class AdminReaderAdapter
    implements
        ICheckAdminIsActivePort,
        IGetAdminByIdPort,
        IGetAdminCredentialsByEmailPort,
        IGetAdminCredentialsByIdPort,
        IGetAdminEmailAndNamePort,
        IGetAdminRolePort,
        IListAdminsPort,
        IGetDeletedAdminRolePort
{
    /**
     * Initializes the admin query repository with the database connection.
     *
     * @param db The PostgresJs database instance
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Checks if an admin is active by ID.
     *
     * @param id The unique identifier
     * @returns True if active, false if inactive, or null if not found
     */
    async checkIsActive(id: string): Promise<boolean | null> {
        return (
            (
                await this.db
                    .select({ isActive: admin.isActive })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0]?.isActive ?? null
        );
    }

    /**
     * Retrieves the public read-model of a non-deleted admin by ID.
     *
     * @param id The unique identifier
     * @returns The public admin read-model or null
     */
    async getById(id: string): Promise<GetAdminByIdResult | null> {
        return (
            (
                await this.db
                    .select({
                        id: admin.id,
                        email: admin.email,
                        name: admin.name,
                        role: admin.role,
                        isActive: admin.isActive,
                        createdAt: admin.createdAt,
                        updatedAt: admin.updatedAt,
                    })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves credential fields for a non-deleted admin by email.
     *
     * @param email The exact email address
     * @returns The minimal credential projection or null if not found
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null> {
        return (
            (
                await this.db
                    .select({
                        id: admin.id,
                        password: admin.password,
                        role: admin.role,
                        isActive: admin.isActive,
                    })
                    .from(admin)
                    .where(and(eq(admin.email, email), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves credential fields for a non-deleted admin by ID.
     *
     * @param id The unique identifier
     * @returns The minimal credential projection or null if not found
     */
    async getCredentialsById(id: string): Promise<GetAdminCredentialsByIdResult | null> {
        return (
            (
                await this.db
                    .select({
                        id: admin.id,
                        password: admin.password,
                        role: admin.role,
                        isActive: admin.isActive,
                    })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves only the email and name of a non-deleted admin by ID.
     *
     * @param id The unique identifier
     * @returns An object containing email and name, or null if not found
     */
    async getAdminEmailAndName(id: string): Promise<GetAdminEmailAndNameResult | null> {
        return (
            (
                await this.db
                    .select({ email: admin.email, name: admin.name })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Checks the role of an admin by ID.
     *
     * @param id The unique identifier
     * @returns An object containing the role, or null if not found
     */
    async getRole(id: string): Promise<GetAdminRoleResult | null> {
        return (
            (
                await this.db
                    .select({ role: admin.role })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0]?.role ?? null
        );
    }

    /**
     * Gets the role of a deleted admin by ID.
     * Crucially, this explicitly filters for deleted records.
     *
     * @param id The admin ID.
     * @returns The admin role result or null if not found.
     */
    async getDeletedAdminRole(id: string): Promise<GetDeletedAdminRoleResult | null> {
        return (
            (await this.db.select({ role: admin.role }).from(admin).where(eq(admin.id, id)).limit(1))[0]?.role ?? null
        );
    }

    /**
     * Retrieves a paginated list of non-deleted admin read-models.
     *
     * @param params The pagination limits
     * @returns Paginated list of admins
     */
    async listAdmins(params: PaginationParams): Promise<ListAdminsResult> {
        const conditions = isNull(admin.deletedAt),
            [rows, countResult] = await Promise.all([
                this.db
                    .select({
                        id: admin.id,
                        email: admin.email,
                        name: admin.name,
                        role: admin.role,
                        isActive: admin.isActive,
                        createdAt: admin.createdAt,
                        updatedAt: admin.updatedAt,
                    })
                    .from(admin)
                    .where(conditions)
                    .orderBy(desc(admin.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.db.select({ total: count() }).from(admin).where(conditions),
            ]);

        return { data: rows, total: countResult[0]?.total ?? 0 };
    }
}
