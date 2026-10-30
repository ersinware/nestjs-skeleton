/**
 * @file start-contract-app.ts
 * @description Starts the compiled application for Schemathesis with rate-limit counter admission bypassed.
 */

// Preserve production instrumentation order before loading application dependencies.
import 'reflect-metadata';
import 'src/instrument';
import 'src/tracing';

import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { configureApplication } from 'src/core/bootstrap';
import { ENV, resolveTrustProxy } from 'src/core/config';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';

/**
 * Keeps fuzz requests reaching application logic while preserving production guards and readiness.
 * Application imports resolve to dist through the contract-start command's TS_NODE_BASEURL.
 */
async function bootstrap() {
    const app = (
        await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(TOKEN_RATE_LIMIT_COUNTER_PORT)
            .useValue({
                consume: () => Promise.resolve({ allowed: true }),
            } satisfies IRateLimitCounterPort)
            .compile()
    ).createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: resolveTrustProxy() }), {
        bufferLogs: true,
    });

    configureApplication(app);

    await app.listen(app.get(ConfigService).getOrThrow<number>(ENV.PORT), '0.0.0.0');
}

void bootstrap();
