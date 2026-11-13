/**
 * @file module.ts
 * @description Configures the S3 client and storage port.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ENV } from 'src/core/config';
import { JwtTokenAdapter, TokenModule, type ITokenPort } from 'src/core/security/token';
import { S3StorageAdapter } from 'src/core/storage/adapter/s3-storage.adapter';
import { TOKEN_STORAGE_PORT } from 'src/core/storage/port/storage.port';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import { TOKEN_UPLOAD_TOKEN_PORT } from 'src/core/storage/upload-token';

/**
 * Binds the storage port, upload token port, and owns its S3 client.
 */
@Module({
    imports: [TokenModule],
    providers: [
        {
            provide: TOKEN_S3_CLIENT,
            inject: [ConfigService],
            useFactory: (configService: ConfigService): S3Client => {
                const endpoint = configService.get<string>(ENV.STORAGE_ENDPOINT);

                return new S3Client({
                    region: configService.getOrThrow<string>(ENV.STORAGE_REGION),
                    forcePathStyle: Boolean(endpoint),
                    // The browser owns PUT bytes; the server cannot precompute their checksum while presigning.
                    requestChecksumCalculation: 'WHEN_REQUIRED',
                    requestHandler: new NodeHttpHandler({
                        connectionTimeout: configService.getOrThrow<number>(ENV.STORAGE_CONNECT_TIMEOUT) * 1000,
                        requestTimeout: configService.getOrThrow<number>(ENV.STORAGE_REQUEST_TIMEOUT) * 1000,
                        throwOnRequestTimeout: true,
                    }),
                    ...(endpoint && { endpoint }),
                });
            },
        },
        { provide: TOKEN_STORAGE_PORT, useClass: S3StorageAdapter },
        {
            provide: TOKEN_UPLOAD_TOKEN_PORT,
            inject: [JwtService, ConfigService],
            useFactory: (jwtService: JwtService, configService: ConfigService): ITokenPort =>
                new JwtTokenAdapter(jwtService, configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET)),
        },
    ],
    exports: [TOKEN_STORAGE_PORT, TOKEN_UPLOAD_TOKEN_PORT],
})
export class StorageModule implements OnApplicationShutdown {
    /**
     * Retains the client for shutdown.
     *
     * @param client S3 operations and signing client.
     */
    constructor(@Inject(TOKEN_S3_CLIENT) private readonly client: S3Client) {}

    /**
     * Releases the S3 client.
     */
    onApplicationShutdown() {
        this.client.destroy();
    }
}
