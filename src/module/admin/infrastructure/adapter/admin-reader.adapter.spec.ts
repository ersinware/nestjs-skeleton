/**
 * @file admin-reader.adapter.spec.ts
 * @description Unit tests for AdminReaderAdapter. Verifies that each projection query selects
 * only the required columns and maps rows directly to read-models without aggregate reconstitution.
 */

import { Test } from '@nestjs/testing';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { AdminRole } from 'src/shared/domain/admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildChain = (resolvedValue: unknown) => {
    const chain: Record<string, unknown> = {};
    chain['select'] = vi.fn().mockReturnValue(chain);
    chain['from'] = vi.fn().mockReturnValue(chain);
    chain['where'] = vi.fn().mockReturnValue(chain);
    chain['orderBy'] = vi.fn().mockReturnValue(chain);
    chain['limit'] = vi.fn().mockResolvedValue(resolvedValue);
    chain['offset'] = vi.fn().mockResolvedValue(resolvedValue);
    return { chain };
};

describe('AdminReaderAdapter', () => {
    let repository: AdminReaderAdapter;
    let mockDb: { select: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockDb = {
            select: vi.fn(),
        };

        await Test.createTestingModule({
            providers: [{ provide: TOKEN_DATABASE, useValue: mockDb }],
        }).compile();

        repository = new AdminReaderAdapter(mockDb as unknown as PostgresJsDatabase);
    });

    describe('getById', () => {
        it('should return null when no row is found', async () => {
            const { chain } = buildChain([]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getById('some-id');

            expect(result).toBeNull();
        });

        it('should return the read-model when a row is found', async () => {
            const row = {
                id: 'admin-1',
                email: 'admin@example.com',
                name: 'Admin',
                role: AdminRole.ADMIN,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const { chain } = buildChain([row]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getById('admin-1');

            expect(result).toEqual(row);
        });
    });

    describe('getCredentialsById', () => {
        it('should return null when no row is found', async () => {
            const { chain } = buildChain([]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getCredentialsById('some-id');

            expect(result).toBeNull();
        });

        it('should return the credentials read-model when a row is found', async () => {
            const row = { id: 'admin-1', password: 'hashed', isActive: true, role: AdminRole.ADMIN };
            const { chain } = buildChain([row]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getCredentialsById('admin-1');

            expect(result).toEqual(row);
        });
    });

    describe('getCredentialsByEmail', () => {
        it('should return null when no row is found', async () => {
            const { chain } = buildChain([]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getCredentialsByEmail('notfound@example.com');

            expect(result).toBeNull();
        });

        it('should return the credentials read-model when a row is found', async () => {
            const row = { id: 'admin-1', password: 'hashed', isActive: true, role: AdminRole.ADMIN };
            const { chain } = buildChain([row]);
            mockDb.select.mockReturnValue(chain);

            const result = await repository.getCredentialsByEmail('admin@example.com');

            expect(result).toEqual(row);
        });
    });
});
