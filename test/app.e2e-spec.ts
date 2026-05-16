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
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
    });

    it('/api/health (GET)', () => {
        return request(app.getHttpServer()).get('/api/health').expect(200);
    });

    it('/api/v1/users (GET)', () => {
        return request(app.getHttpServer()).get('/api/v1/users').expect(200).expect({ message: 'Hello World!' });
    });

    afterEach(async () => {
        await app.close();
    });
});
