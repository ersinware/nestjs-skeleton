/**
 * @file refresh-state.e2e-spec.ts
 * @description Verifies refresh eligibility and current claims against PostgreSQL for both account owners.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import { DatabaseModule, TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { UserReaderAdapter } from 'src/module/user/infrastructure/adapter/user-reader.adapter';
import { user } from 'src/module/user/infrastructure/user.schema';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Refresh eligibility reads', () => {
    let module: TestingModule;
    let database: NodePgDatabase;

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: resolveEnvFilePath(),
                    validate: validateConfig,
                }),
                DatabaseModule,
            ],
        }).compile();
        database = module.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT);
        await module.init();
    });

    afterAll(async () => {
        await module?.close();
    });

    describe.each(['admin', 'user'] as const)('%s', (kind) => {
        it('returns null for a missing account', async () => {
            const reader = kind === 'admin' ? new AdminReaderAdapter(database) : new UserReaderAdapter(database);
            expect(await reader.getRefreshState(uuidv7(), 1)).toBeNull();
        });

        it.each([
            { scenario: 'banned account', isBanned: true, deletedAt: null, tokenVersion: 1, eligible: false },
            { scenario: 'deleted account', isBanned: false, deletedAt: new Date(), tokenVersion: 1, eligible: false },
            { scenario: 'revoked token', isBanned: false, deletedAt: null, tokenVersion: 0, eligible: false },
            {
                scenario: 'token at the revocation floor',
                isBanned: false,
                deletedAt: null,
                tokenVersion: 1,
                eligible: true,
            },
            {
                scenario: 'token above the revocation floor',
                isBanned: false,
                deletedAt: null,
                tokenVersion: 2,
                eligible: true,
            },
        ])('$scenario', async ({ isBanned, deletedAt, tokenVersion, eligible }) => {
            const id = uuidv7(),
                values = {
                    id,
                    email: `${id}@example.com`,
                    name: 'Refresh eligibility fixture',
                    password: 'unused-password-hash',
                    isBanned,
                    deletedAt,
                    sessionVersion: 3,
                    revocationVersion: 1,
                },
                reader = kind === 'admin' ? new AdminReaderAdapter(database) : new UserReaderAdapter(database);

            if (kind === 'admin') {
                await database.insert(admin).values(values);
            } else {
                await database.insert(user).values(values);
            }

            try {
                expect(await reader.getRefreshState(id, tokenVersion)).toEqual(
                    eligible ? { sessionVersion: 3, permissions: [] } : null,
                );
            } finally {
                if (kind === 'admin') {
                    await database.delete(admin).where(eq(admin.id, id));
                } else {
                    await database.delete(user).where(eq(user.id, id));
                }
            }
        });
    });
});
