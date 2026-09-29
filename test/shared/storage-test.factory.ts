/**
 * @file storage-test.factory.ts
 * @description Storage-only integration test module factory.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { EnvironmentVariables } from 'src/core/config';
import { StorageModule } from 'src/core/storage';

/**
 * Storage configuration required by integration tests.
 */
export type StorageTestConfig = Pick<
    EnvironmentVariables,
    'STORAGE_BUCKET' | 'STORAGE_REGION' | 'STORAGE_ENDPOINT' | 'STORAGE_CONNECT_TIMEOUT' | 'STORAGE_REQUEST_TIMEOUT'
>;

/**
 * Compiles the storage module without application dependencies.
 *
 * @param config Settings for the isolated test bucket.
 * @returns An isolated testing module that the caller must close.
 */
export async function createStorageTestModule(config: StorageTestConfig): Promise<TestingModule> {
    return Test.createTestingModule({
        imports: [
            ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => config] }),
            StorageModule,
        ],
    }).compile();
}
