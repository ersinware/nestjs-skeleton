/**
 * @file admins.repository.interface.ts
 * @description Repository interface defining contract for Admin entity database persistence operations.
 */

import type { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import type { Admin, NewAdmin } from '../type/admin.type';

export interface IAdminsRepository {
    /**
     * Inserts a new admin record into the database.
     *
     * @param data Admin creation fields.
     * @returns A promise resolving to the created admin, or null if insert failed.
     */
    create(data: NewAdmin): Promise<Admin | null>;

    /**
     * Retrieves all non-deleted admin records from the database with pagination.
     *
     * @param query The query pagination parameters.
     * @returns A promise resolving to an object containing active admins array and total count.
     */
    findAll(query: QueryPaginationDto): Promise<{ data: Admin[]; total: number }>;

    /**
     * Finds a single admin record by their ID where they are not deleted.
     *
     * @param id The admin ID.
     * @returns A promise resolving to the admin or null if not found.
     */
    findById(id: string): Promise<Admin | null>;

    /**
     * Finds a single admin record by their email address where they are not deleted.
     *
     * @param email The admin email address.
     * @returns A promise resolving to the admin or null if not found.
     */
    findByEmail(email: string): Promise<Admin | null>;

    /**
     * Updates an existing admin record with partial data where they are not deleted.
     *
     * @param id The admin ID.
     * @param data Partial fields to update.
     * @returns A promise resolving to the updated admin, or null if update failed.
     */
    update(id: string, data: Partial<NewAdmin>): Promise<Admin | null>;

    /**
     * Deletes an admin record by their ID (soft delete).
     *
     * @param id The admin ID.
     * @returns A promise resolving to true if the record was soft-deleted, false otherwise.
     */
    delete(id: string): Promise<boolean>;
}
