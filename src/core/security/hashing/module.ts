/**
 * @file module.ts
 * @description Wiring of the hashing concern.
 */

import { Module } from '@nestjs/common';
import { HashingAdapter } from 'src/core/security/hashing/adapter/hashing.adapter';
import { TOKEN_HASHING_PORT } from 'src/core/security/hashing/port/hashing.port';

/**
 * Binds the hashing port to its Argon2 adapter and exports the token.
 */
@Module({
    providers: [
        {
            provide: TOKEN_HASHING_PORT,
            useClass: HashingAdapter,
        },
    ],
    exports: [TOKEN_HASHING_PORT],
})
export class HashingModule {}
