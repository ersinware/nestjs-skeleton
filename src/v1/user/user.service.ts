import {
    BadRequestException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { USERS_REPOSITORY_TOKEN } from './constant/user.constant';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import type { IUsersRepository } from './interface/users.repository.interface';

@Injectable()
export class UserService {
    constructor(@Inject(USERS_REPOSITORY_TOKEN) private readonly usersRepository: IUsersRepository) {}

    async create(postUserDto: PostUserDto) {
        const newUser = await this.usersRepository.create({
            ...postUserDto,
            password: await argon2.hash(postUserDto.password),
        });

        if (!newUser) {
            throw new InternalServerErrorException('Failed to create user record.');
        }

        return newUser;
    }

    async findAll() {
        return this.usersRepository.findAll();
    }

    async findById(id: number) {
        const user = await this.usersRepository.findById(id);

        if (!user) {
            throw new NotFoundException(`User with ID ${id} not found.`);
        }

        return user;
    }

    async update(id: number, patchUserDto: PatchUserDto) {
        const updatedUser = await this.usersRepository.update(id, patchUserDto);

        if (!updatedUser) {
            throw new NotFoundException(`User with ID ${id} not found.`);
        }

        return updatedUser;
    }

    async changePassword(id: number, patchUserPasswordDto: PatchUserPasswordDto) {
        const hashedPassword = await this.usersRepository.findPasswordById(id);

        if (!hashedPassword) {
            throw new NotFoundException(`User with ID ${id} not found.`);
        }

        if (!(await argon2.verify(hashedPassword, patchUserPasswordDto.currentPassword))) {
            throw new BadRequestException('Invalid current password.');
        }

        if (await argon2.verify(hashedPassword, patchUserPasswordDto.newPassword)) {
            throw new BadRequestException('New password cannot be the same as the current password.');
        }

        if (
            !(await this.usersRepository.update(id, {
                password: await argon2.hash(patchUserPasswordDto.newPassword),
            }))
        ) {
            throw new NotFoundException(`User with ID ${id} not found.`);
        }
    }

    async delete(id: number) {
        if (!(await this.usersRepository.delete(id))) {
            throw new NotFoundException(`User with ID ${id} not found.`);
        }
    }
}
