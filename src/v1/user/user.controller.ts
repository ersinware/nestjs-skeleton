import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiInternalServerErrorResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { ParamIdDto } from 'src/common/dto/param-id.dto';
import { NotEmptyBodyPipe } from 'src/common/pipe/not-empty-body.pipe';
import { GetUserDto } from './dto/get-user.dto';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { UserService } from './user.service';

@ApiTags('user')
@Controller({
    path: 'user',
    version: '1',
})
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post()
    @ApiOperation({ summary: 'Create a new user', description: 'Creates a new user and hashes their password.' })
    @ApiCreatedResponse({ description: 'The user has been successfully created.', type: GetUserDto })
    @ApiBadRequestResponse({ description: 'Invalid input data.', type: ErrorDefaultDto })
    @ApiConflictResponse({ description: 'The email address is already in use.', type: ErrorDefaultDto })
    @ApiInternalServerErrorResponse({ description: 'Failed to create user record.', type: ErrorDefaultDto })
    async create(@Body() postUserDto: PostUserDto): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.create(postUserDto));
    }

    @Get()
    @ApiOperation({ summary: 'Get all users', description: 'Retrieves a list of all registered users.' })
    @ApiOkResponse({ description: 'A list of users has been retrieved.', type: GetUserDto, isArray: true })
    async findAll(): Promise<GetUserDto[]> {
        return plainToInstance(GetUserDto, await this.userService.findAll());
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a user by ID', description: 'Retrieves details of a specific user.' })
    @ApiOkResponse({ description: 'The user details have been retrieved.', type: GetUserDto })
    @ApiBadRequestResponse({ description: 'Invalid user ID format.', type: ErrorDefaultDto })
    @ApiNotFoundResponse({ description: 'User not found.', type: ErrorDefaultDto })
    async findById(@Param() params: ParamIdDto): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.findById(params.id));
    }

    @Patch(':id')
    @ApiOperation({
        summary: 'Update a user',
        description: "Updates a user's details.",
    })
    @ApiOkResponse({ description: 'The user has been successfully updated.', type: GetUserDto })
    @ApiBadRequestResponse({ description: 'Invalid input data.', type: ErrorDefaultDto })
    @ApiNotFoundResponse({ description: 'User not found.', type: ErrorDefaultDto })
    @ApiConflictResponse({ description: 'The email address is already in use.', type: ErrorDefaultDto })
    async update(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) patchUserDto: PatchUserDto): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.update(params.id, patchUserDto));
    }

    @Patch(':id/password')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Change user password',
        description: "Updates a user's password after verifying the old one.",
    })
    @ApiNoContentResponse({ description: 'The password has been successfully changed.' })
    @ApiBadRequestResponse({ description: 'Invalid current password or input data.', type: ErrorDefaultDto })
    @ApiNotFoundResponse({ description: 'User not found.', type: ErrorDefaultDto })
    async changePassword(
        @Param() params: ParamIdDto,
        @Body() patchUserPasswordDto: PatchUserPasswordDto,
    ): Promise<void> {
        await this.userService.changePassword(params.id, patchUserPasswordDto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a user', description: 'Removes a user from the system permanently.' })
    @ApiNoContentResponse({ description: 'The user has been successfully deleted.' })
    @ApiBadRequestResponse({ description: 'Invalid user ID format.', type: ErrorDefaultDto })
    @ApiNotFoundResponse({ description: 'User not found.', type: ErrorDefaultDto })
    @ApiConflictResponse({
        description: 'Foreign key constraint violation. The user is still referenced in other records.',
        type: ErrorDefaultDto,
    })
    async delete(@Param() params: ParamIdDto): Promise<void> {
        await this.userService.delete(params.id);
    }
}
