/**
 * @file admins.repository.interface.ts
 * @description Defines the persistence contract for the Admin entity. By abstracting database operations into an interface, the business logic remains decoupled from the specific ORM or database technology used.
 */

import type { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';
import type { Admin, NewAdmin } from '../type/admin.type';

/**
 * Interface for the AdminsRepository.
 * Defines the database interactions for the admin domain.
 */
export interface IAdminsRepository {
    /**
     * Inserts a new admin record into the database.
     *
     * @param data The admin creation payload
     * @returns The created admin entity, or null if the insertion failed
     */
    create(data: NewAdmin): Promise<Admin | null>;

    /**
     * Retrieves all non-deleted admin records from the database using pagination.
     *
     * @param query The pagination configuration parameters
     * @returns An object containing the array of active admins and their total count
     */
    findAll(query: QueryPaginationDto): Promise<{ data: Admin[]; total: number }>;

    /**
     * Finds a single admin record by their unique ID, excluding deleted records.
     *
     * @param id The unique identifier of the admin
     * @returns The matched admin entity, or null if not found
     */
    findById(id: string): Promise<Admin | null>;

    /**
     * Finds a single admin record by their email address, excluding deleted records.
     *
     * @param email The exact email address to search for
     * @returns The matched admin entity, or null if not found
     */
    findByEmail(email: string): Promise<Admin | null>;

    /**
     * Updates an existing admin record with partial data, excluding deleted records.
     *
     * @param id The unique identifier of the admin
     * @param data The partial fields to apply to the record
     * @returns The updated admin entity, or null if the update failed
     */
    update(id: string, data: Partial<NewAdmin>): Promise<Admin | null>;

    /**
     * Soft deletes an admin record by their ID, marking it as deleted without removing it from the database.
     *
     * @param id The unique identifier of the admin
     * @returns True if the record was successfully soft-deleted, false otherwise
     */
    delete(id: string): Promise<boolean>;

    /**
     * Permanently removes an admin record from the database.
     *
     * @param id The unique identifier of the admin
     * @returns True if the record was successfully hard-deleted, false otherwise
     */
    hardDelete(id: string): Promise<boolean>;
}
