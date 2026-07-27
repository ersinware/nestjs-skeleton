/**
 * @file user.controller.ts
 * @description Exposes HTTP endpoints for user profile management. Enforces role-based access control (RBAC) to ensure standard users can only modify themselves while administrators can manage all users.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline, QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultOkResponsePaginated,
    ApiDefaultResourceConflictResponse,
    ApiDefaultResourceNotFoundResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import {
    NotEmptyBodyPipe,
    ParamIdDto,
    QuerySearchDto,
    RequestValidationMessage,
    ResponsePaginationDto,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { AccessTokenPayloadDecorator, Public, Roles } from 'src/core/security/auth';
import type { AccessTokenPayload } from 'src/core/security/token';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import { ChangeUserPasswordCommand } from 'src/module/user/application/command/change-user-password/command';
import { CreateUserCommand } from 'src/module/user/application/command/create-user/command';
import { DeleteUserCommand } from 'src/module/user/application/command/delete-user/command';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { GetUserByIdQuery } from 'src/module/user/application/query/get-user-by-id/query';
import { ListUsersQuery } from 'src/module/user/application/query/list-users/query';
import { PatchUserPasswordDto } from 'src/module/user/presentation/dto/patch-user-password.dto';
import { PatchUserDto } from 'src/module/user/presentation/dto/patch-user.dto';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';
import { ResponseUserDto } from 'src/module/user/presentation/dto/response-user.dto';
import { AdminRole } from 'src/shared/domain/admin';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * The controller providing routing and handling for user domain API requests.
 * Maps incoming HTTP payloads to business logic operations and serializes the responses to prevent data leaks.
 */
@Controller({
    path: 'user',
    version: VERSION_1,
})
@ApiTags('user')
@ApiDefaultInternalServerErrorResponse()
export class UserController {
    constructor(
        private readonly commandPipeline: CommandPipeline,
        private readonly queryPipeline: QueryPipeline,
    ) {}

    /**
     * Registers a new user account.
     * Typically public, allowing unauthenticated guests to sign up.
     *
     * @param postUserDto The payload containing registration details
     * @returns The newly created and serialized user profile
     */
    @Public()
    @Post()
    @ApiOperation({
        summary: 'Register user',
        description: 'Creates a new user profile.',
    })
    @ApiCreatedResponse({ description: 'User account successfully created.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async create(@Body(NotEmptyBodyPipe) postUserDto: PostUserDto): Promise<ResponseUserDto> {
        const id: string = await this.commandPipeline.execute(
            new CreateUserCommand(postUserDto.email, postUserDto.name, postUserDto.password),
        );

        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(id)));
    }

    /**
     * Retrieves all registered users in a paginated format.
     * Exclusively available to administrators for back-office management.
     *
     * @param query The pagination limits and optional search parameters
     * @returns A paginated response containing a list of serialized user profiles
     */
    @Get()
    @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get all users',
        description:
            'Retrieves registered users with pagination and optional search query. Requires administrator-level authorization.',
    })
    @ApiDefaultOkResponsePaginated({ description: 'Users successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async findAll(@Query() query: QuerySearchDto): Promise<ResponsePaginationDto<ResponseUserDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListUsersQuery(query));

        return new ResponsePaginationDto<ResponseUserDto>(
            plainToInstance(ResponseUserDto, data),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Retrieves the profile details of the currently authenticated user.
     * Relies on the decoded JWT payload to infer the target user ID safely.
     *
     * @param payload The decoded access token payload of the requester
     * @returns The serialized profile of the current user
     */
    @Get('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current user profile',
        description: 'Retrieves profile details of the currently authenticated user.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async findMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(payload.sub)));
    }

    /**
     * Retrieves the profile details of a specific user by their unique identifier.
     * Exclusively available to administrators for support and auditing purposes.
     *
     * @param params The path parameters containing the target user ID
     * @returns The serialized profile of the requested user
     */
    @Get(':id')
    @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
    @Audited(AuditAction.PERSONAL_DATA_EXPORTED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get user by ID',
        description: 'Retrieves details of a specific user. Requires administrator-level authorization.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async findById(@Param() params: ParamIdDto): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(params.id)));
    }

    /**
     * Updates the profile details of the currently authenticated user.
     * Allows users to modify their own non-sensitive information like names.
     *
     * @param payload The decoded access token payload of the requester
     * @param patchUserDto The sparse payload containing the fields to update
     * @returns The updated and serialized profile of the current user
     */
    @Patch('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current user profile',
        description: "Updates details of the currently authenticated user's profile.",
    })
    @ApiOkResponse({ description: 'User successfully updated.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async updateMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserDto: PatchUserDto,
    ): Promise<ResponseUserDto> {
        await this.commandPipeline.execute(new UpdateUserCommand(payload.sub, patchUserDto.email, patchUserDto.name));

        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(payload.sub)));
    }

    /**
     * Changes the password of the currently authenticated user.
     * Requires the current password to be verified to prevent unauthorized account takeovers.
     *
     * @param payload The decoded access token payload of the requester
     * @param patchUserPasswordDto The payload containing the current and new passwords
     */
    @Patch('me/password')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Change current user password',
        description:
            "Updates the currently authenticated user's password. Doing so will immediately revoke all active sessions.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async changePasswordMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserPasswordDto: PatchUserPasswordDto,
    ) {
        await this.commandPipeline.execute(
            new ChangeUserPasswordCommand(
                payload.sub,
                patchUserPasswordDto.currentPassword,
                patchUserPasswordDto.newPassword,
            ),
        );
    }

    /**
     * Permanently deletes or deactivates the currently authenticated user's account.
     * A destructive action initiated by the user to leave the platform.
     *
     * @param payload The decoded access token payload of the requester
     */
    @Delete('me')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete current user account',
        description: 'Soft deletes the currently authenticated user account.',
    })
    @ApiNoContentResponse({ description: 'User account successfully deleted.' })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async deleteMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload) {
        await this.commandPipeline.execute(new DeleteUserCommand(payload.sub));
    }

    /**
     * Bans a user, allowing administrators to suspend accounts.
     * Banning a user immediately revokes all their active sessions.
     *
     * @param params The path parameters containing the target user ID
     */
    @Post(':id/ban')
    @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Ban user',
        description: 'Bans the account and revokes all active sessions. Requires administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'User successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async ban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanUserCommand(params.id));
    }

    /**
     * Unbans a user, allowing administrators to reinstate suspended accounts.
     *
     * @param params The path parameters containing the target user ID
     */
    @Post(':id/unban')
    @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Unban user',
        description: 'Lifts the ban on the account. Requires administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'User successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async unban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanUserCommand(params.id));
    }
}
