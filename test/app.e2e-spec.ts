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

    it('/api/health (GET)', () => {
        return request(app.getHttpServer()).get('/api/health').expect(200);
    });

    it('/api/v1/user (GET)', async () => {
        const response = await request(app.getHttpServer()).get('/api/v1/user').expect(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    afterEach(async () => {
        await app.close();
    });
});
