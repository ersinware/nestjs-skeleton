/**
 * @file auth.module.ts
 * @description Configures the authentication domain of the application. It bundles the controllers, services, and security dependencies required for authenticating users and managing sessions.
 */

import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { HashingModule } from 'src/infrastructure/security/hashing/hashing.module';
import { TokenModule } from 'src/infrastructure/security/token/token.module';
import { SessionModule } from 'src/infrastructure/security/session/session.module';

/**
 * The module responsible for configuring authentication services, controller routing, and dependencies.
 * It encapsulates the business logic for login, token refresh, and session management, exposing the `AuthService` for internal cross-module usage.
 */
@Module({
    imports: [HashingModule, TokenModule, SessionModule, UserModule, AdminModule],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService],
})
export class AuthModule {}
