import { Module } from '@nestjs/common';
import { USERS_REPOSITORY_TOKEN } from './constant/user.constant';
import { UsersRepository } from './repository/users.repository';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
    controllers: [UserController],
    providers: [
        UserService,
        {
            provide: USERS_REPOSITORY_TOKEN,
            useClass: UsersRepository,
        },
    ],
})
export class UserModule {}
