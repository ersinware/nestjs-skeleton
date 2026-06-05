/**
 * @file admin.module.ts
 * @description NestJS module configuring the controllers and repository layer for the admin domain.
 */

import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import { AdminsRepository } from './repository/admins.repository';

/**
 * Module responsible for orchestrating admin-related database operations and registering dependencies.
 */
@Module({
    imports: [forwardRef(() => AuthModule)],
    controllers: [AdminController],
    providers: [
        AdminService,
        {
            provide: TOKEN_ADMINS_REPOSITORY,
            useClass: AdminsRepository,
        },
    ],
    exports: [AdminService, TOKEN_ADMINS_REPOSITORY],
})
export class AdminModule {}
