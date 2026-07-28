/**
 * @file e2e-spec.interface.ts
 * @description Type definitions for E2E application factory configurations.
 */

import { Type } from '@nestjs/common';

/**
 * Options for configuring the mock Fastify test application.
 */
export type OptionsTestApp = {
    /**
     * Additional controllers to mount directly onto the root module.
     * Useful for isolated testing of global guards, filters, or interceptors.
     */
    extraControllers?: Type<unknown>[];

    /**
     * Providers to override with mock implementations (e.g., database repositories, third-party clients).
     */
    overrides?: {
        /**
         * The injection token of the provider to override.
         */
        provide: unknown;

        /**
         * The mock implementation or value to use instead of the actual provider.
         */
        useValue: unknown;
    }[];
};
