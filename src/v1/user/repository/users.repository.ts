import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE_DB } from 'src/database/constant';
import * as schema from 'src/database/schema';
import type { IUsersRepository } from '../interface/users.repository.interface';
import type { NewUser, User } from '../type/user.type';

@Injectable()
export class UsersRepository implements IUsersRepository {
    constructor(@Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase<typeof schema>) {}

    async create(data: NewUser): Promise<User | null> {
        return (await this.db.insert(schema.users).values(data).returning())[0] ?? null;
    }

    async findAll(): Promise<User[]> {
        return this.db.query.users.findMany();
    }

    async findById(id: number): Promise<User | null> {
        return (
            (await this.db.query.users.findFirst({
                where: eq(schema.users.id, id),
            })) ?? null
        );
    }

    async findByEmail(email: string): Promise<User | null> {
        return (
            (await this.db.query.users.findFirst({
                where: eq(schema.users.email, email),
            })) ?? null
        );
    }

    async findPasswordById(id: number): Promise<string | null> {
        return (
            (
                await this.db
                    .select({ password: schema.users.password })
                    .from(schema.users)
                    .where(eq(schema.users.id, id))
                    .limit(1)
            )[0]?.password ?? null
        );
    }

    async update(id: number, data: Partial<NewUser>): Promise<User | null> {
        if (Object.keys(data).length === 0) {
            return this.findById(id);
        }

        return (await this.db.update(schema.users).set(data).where(eq(schema.users.id, id)).returning())[0] ?? null;
    }

    async delete(id: number): Promise<boolean> {
        return (
            (await this.db.delete(schema.users).where(eq(schema.users.id, id)).returning({ id: schema.users.id }))
                .length > 0
        );
    }
}
