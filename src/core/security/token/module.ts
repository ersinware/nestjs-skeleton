/**
 * @file module.ts
 * @description NestJS infrastructure module exposing generic JWT signing and verification support.
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * Provides configured JWT infrastructure for concern-specific token port factories.
 */
@Module({
    imports: [JwtModule.register({})],
    exports: [JwtModule],
})
export class TokenModule {}
