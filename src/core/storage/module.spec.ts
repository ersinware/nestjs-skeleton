/**
 * @file module.spec.ts
 * @description Verifies storage DI binding and SDK client ownership without network requests.
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { StorageModule } from 'src/core/storage/module';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage/port/storage.port';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import { describe, expect, it, vi } from 'vitest';

describe('StorageModule', () => {
    it('exposes one storage port and closes its client on shutdown', async () => {
        const destroy = vi.fn();
        const client = { destroy };
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), StorageModule],
        })
            .overrideProvider(ConfigService)
            .useValue({
                getOrThrow: (key: string) => ({ STORAGE_BUCKET: 'storage-test' })[key],
            })
            .overrideProvider(TOKEN_S3_CLIENT)
            .useValue(client)
            .compile();

        const port = module.get<IStoragePort>(TOKEN_STORAGE_PORT);
        expect(port).toBeDefined();
        expect(typeof port.headObject).toBe('function');
        await module.close();
        expect(destroy).toHaveBeenCalledOnce();
    });
});
