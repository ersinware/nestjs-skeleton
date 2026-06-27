/**
 * @file hashing.module.ts
 * @description Module providing password hashing and verification utilities.
 */

import { Module } from '@nestjs/common';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { HashingService } from './hashing.service';

/**
 * Module responsible for configuring and exposing hashing utilities.
 */
@Module({
    providers: [
        {
            provide: TOKEN_HASHING_SERVICE,
            useClass: HashingService,
        },
    ],
    exports: [TOKEN_HASHING_SERVICE],
})
export class HashingModule {}
