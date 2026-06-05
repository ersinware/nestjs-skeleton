/**
 * @file auth.module.ts
 * @description NestJS module configuring the controller and service providers for the authentication domain.
 */

import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminModule } from '../admin/admin.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Module responsible for configuring authentication services, controller routing, and dependencies.
 */
@Module({
    imports: [JwtModule.register({}), forwardRef(() => UserModule), forwardRef(() => AdminModule)],
    controllers: [AuthController],
    providers: [AuthService, SessionService, TokenService],
    exports: [AuthService, SessionService, TokenService, JwtModule],
})
export class AuthModule {}
