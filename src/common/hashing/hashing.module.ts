/**
 * @file hashing.module.ts
 * @description Global module providing password hashing and verification utilities across the application.
 */

import { Global, Module } from '@nestjs/common';
import { HashingService } from './service/hashing.service';

@Global()
@Module({
    providers: [HashingService],
    exports: [HashingService],
})
export class HashingModule {}
