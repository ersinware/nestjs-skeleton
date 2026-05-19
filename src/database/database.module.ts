import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DRIZZLE_DB } from './constant';
import * as schema from './schema';

export const PG_CONNECTION = 'PG_CONNECTION';

@Global()
@Module({
    imports: [],
    providers: [
        {
            provide: PG_CONNECTION,
            useFactory: (configService: ConfigService) => {
                const databaseUrl = configService.getOrThrow<string>('DATABASE_URL'),
                    databasePoolSize = configService.getOrThrow<number>('DATABASE_POOL_SIZE');

                return postgres(databaseUrl, { max: databasePoolSize });
            },
            inject: [ConfigService],
        },
        {
            provide: DRIZZLE_DB,
            useFactory: (pgConnection: postgres.Sql) => {
                return drizzle(pgConnection, { schema });
            },
            inject: [PG_CONNECTION],
        },
    ],
    exports: [DRIZZLE_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
    constructor(@Inject(PG_CONNECTION) private readonly pg: postgres.Sql) {}

    async onApplicationShutdown() {
        await this.pg.end();
    }
}
