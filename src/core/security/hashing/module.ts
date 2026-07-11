/**
 * @file hashing.module.ts
 * @description Module providing password hashing and verification utilities.
 */

import { Module } from '@nestjs/common';
import { HashingPort } from 'src/core/security/hashing/adapter';
import { TOKEN_HASHING_PORT } from 'src/core/security/hashing/port';

/**
 * Module responsible for configuring and exposing hashing utilities.
 */
@Module({
    providers: [
        {
            provide: TOKEN_HASHING_PORT,
            useClass: HashingPort,
        },
    ],
    exports: [TOKEN_HASHING_PORT],
})
export class HashingModule {}
