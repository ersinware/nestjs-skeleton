/**
 * @file user-writer.adapter.ts
 * @description The Drizzle ORM implementation of the user writer port. Handles mapping between domain aggregates and database models for write operations.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import type { IUserWriterPort } from 'src/module/user/application/command/port';
import { User } from 'src/module/user/domain/aggregate';
import { user as userSchema } from 'src/module/user/infrastructure/database/schema';

@Injectable()
export class UserWriterAdapter implements IUserWriterPort {
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Maps a database row to the User aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof userSchema>): User {
        return User.reconstitute(row.id, {
            email: row.email,
            name: row.name,
            password: row.password,
            isActive: row.isActive,
            deletedAt: row.deletedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

    async load(id: string): Promise<User | null> {
        const row = (
            await this.db
                .select()
                .from(userSchema)
                .where(and(eq(userSchema.id, id), isNull(userSchema.deletedAt)))
                .limit(1)
        )[0];

        return row ? this.mapToDomain(row) : null;
    }

    async save(user: User) {
        const payload = user.toSnapshot();

        await this.db
            .insert(userSchema)
            .values(payload)
            .onConflictDoUpdate({
                target: userSchema.id,
                set: {
                    ...payload,
                    id: undefined,
                    createdAt: undefined,
                },
            });
    }
}
