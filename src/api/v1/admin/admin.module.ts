/**
 * @file admin.module.ts
 * @description Configures the administrative domain of the application. It bundles the controllers, services, and repositories required for managing admin accounts and provides these capabilities to the rest of the application context.
 */

import { Module } from '@nestjs/common';
import { TOKEN_ADMIN_IDENTITY_PROVIDER } from '../auth/constant/auth.constant';
import { SessionModule } from 'src/infrastructure/security/session/session.module';
import { EmailModule } from 'src/infrastructure/email/email.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import { AdminEmailListener } from './listener/admin-email.listener';
import { AdminsRepository } from './repository/admins.repository';

import { HashingModule } from 'src/infrastructure/security/hashing/hashing.module';

/**
 * The module responsible for orchestrating admin-related database operations and registering dependencies.
 * It encapsulates the business logic for super admin operations and exposes the `AdminService` for internal usage.
 */
@Module({
    imports: [HashingModule, SessionModule, EmailModule],
    controllers: [AdminController],
    providers: [
        AdminService,
        AdminEmailListener,
        {
            provide: TOKEN_ADMINS_REPOSITORY,
            useClass: AdminsRepository,
        },
        {
            provide: TOKEN_ADMIN_IDENTITY_PROVIDER,
            useExisting: AdminService,
        },
    ],
    exports: [AdminService, TOKEN_ADMIN_IDENTITY_PROVIDER],
})
export class AdminModule {}
