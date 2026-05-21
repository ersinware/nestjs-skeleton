import { Test, TestingModule } from '@nestjs/testing';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from 'src/app.module';

describe('AppController (e2e)', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        app.setGlobalPrefix('api');
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.enableShutdownHooks();

        await app.init();
        await app.getHttpAdapter().getInstance().ready();
    });

    it('/api/health (GET)', async () => {
        const response = await request(app.getHttpServer()).get('/api/health').expect(200);
        const body = response.body as { data: { status: string } };
        expect(body).toHaveProperty('data');
        expect(body.data).toHaveProperty('status', 'ok');
    });

    it('/api/v1/user (GET)', async () => {
        const response = await request(app.getHttpServer()).get('/api/v1/user').expect(200);
        const body = response.body as { data: unknown[] };
        expect(body).toHaveProperty('data');
        expect(Array.isArray(body.data)).toBe(true);
    });

    it('/api/non-existent-route (GET) - error response wrapping', async () => {
        const response = await request(app.getHttpServer()).get('/api/non-existent-route').expect(404);
        const body = response.body as { error: { statusCode: number; statusText: string } };
        expect(body).toHaveProperty('error');
        expect(body.error).toHaveProperty('statusCode', 404);
        expect(body.error).toHaveProperty('statusText', 'Not Found');
    });

    afterEach(async () => {
        await app.close();
    });
});
