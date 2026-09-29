/**
 * @file module.ts
 * @description Configures the S3 client and storage port.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ENV } from 'src/core/config';
import { S3StorageAdapter } from 'src/core/storage/adapter/s3-storage.adapter';
import { TOKEN_STORAGE_PORT } from 'src/core/storage/port/storage.port';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';

/**
 * Binds the storage port and owns its S3 client.
 */
@Module({
    providers: [
        {
            provide: TOKEN_S3_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService): S3Client => {
                const endpoint = config.get<string>(ENV.STORAGE_ENDPOINT);

                return new S3Client({
                    region: config.getOrThrow<string>(ENV.STORAGE_REGION),
                    forcePathStyle: Boolean(endpoint),
                    // The browser owns PUT bytes; the server cannot precompute their checksum while presigning.
                    requestChecksumCalculation: 'WHEN_REQUIRED',
                    requestHandler: new NodeHttpHandler({
                        connectionTimeout: config.getOrThrow<number>(ENV.STORAGE_CONNECT_TIMEOUT) * 1000,
                        requestTimeout: config.getOrThrow<number>(ENV.STORAGE_REQUEST_TIMEOUT) * 1000,
                        throwOnRequestTimeout: true,
                    }),
                    ...(endpoint && { endpoint }),
                });
            },
        },
        { provide: TOKEN_STORAGE_PORT, useClass: S3StorageAdapter },
    ],
    exports: [TOKEN_STORAGE_PORT],
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
