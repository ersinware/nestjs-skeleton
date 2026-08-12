/**
 * @file user.controller.ts
 * @description HTTP endpoints of the user bounded context: public registration, self-service profile management, and admin lookup and ban/unban.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline, QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultDependencyUnavailableResponse,
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
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { CurrentAccessTokenPayload, Public, Roles } from 'src/core/security/auth';
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
import { ADMIN_ROLES } from 'src/shared/domain/auth-role';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * User endpoints: public registration, self-scoped profile routes (`me`), and admin-only lookup and
 * ban/unban. Responses are serialized through the whitelist DTOs so internal fields never leak.
 */
@Controller({
    path: 'user',
    version: VERSION_1,
})
@ApiTags('user')
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class UserController {
    /**
     * Initializes the controller with the command and query pipelines.
     *
     * @param commandPipeline The CQRS command pipeline (invalidation behavior applies)
     * @param queryPipeline The CQRS query pipeline (caching behavior applies)
     */
    constructor(
        private readonly commandPipeline: CommandPipeline,
        private readonly queryPipeline: QueryPipeline,
    ) {}

    /**
     * Soft-deletes the currently authenticated user's account.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     */
    @Delete('me')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete current user account',
        description: 'Soft deletes the currently authenticated user account and revokes all active sessions.',
    })
    @ApiNoContentResponse({ description: 'User account successfully deleted.' })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async deleteMe(@CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload) {
        await this.commandPipeline.execute(new DeleteUserCommand(accessTokenPayload.sub));
    }

    /**
     * Lists user accounts with pagination and optional search. Admin-only.
     *
     * @param query The pagination and search query parameters
     * @returns The paginated list of user profiles
     */
    @Get()
    @Roles(...ADMIN_ROLES)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List all users',
        description:
            'Retrieves user accounts with pagination and optional search. Requires administrator authorization.',
    })
    @ApiDefaultOkResponsePaginated({ message: 'Users successfully retrieved.', model: ResponseUserDto })
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
     * Retrieves the currently authenticated user's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
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
    async findMe(@CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload): Promise<ResponseUserDto> {
        return plainToInstance(
            ResponseUserDto,
            await this.queryPipeline.execute(new GetUserByIdQuery(accessTokenPayload.sub)),
        );
    }

    /**
     * Retrieves a specific user's profile by unique identifier. Admin-only.
     *
     * @param params The path parameters carrying the target user ID
     * @returns The serialized profile of the requested user
     */
    @Get(ROUTE_PARAM_ID)
    @Roles(...ADMIN_ROLES)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get user by ID',
        description: 'Retrieves a specific user account. Requires administrator authorization.',
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
     * Updates the currently authenticated user's profile.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     * @param patchUserDto The sparse payload carrying the fields to update
     * @returns The updated, serialized profile of the current user
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
        @CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserDto: PatchUserDto,
    ): Promise<ResponseUserDto> {
        await this.commandPipeline.execute(
            new UpdateUserCommand(accessTokenPayload.sub, patchUserDto.email, patchUserDto.name),
        );

        return plainToInstance(
            ResponseUserDto,
            await this.queryPipeline.execute(new GetUserByIdQuery(accessTokenPayload.sub)),
        );
    }

    /**
     * Changes the currently authenticated user's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     * @param patchUserPasswordDto The payload carrying the current and new passwords
     */
    @Patch('me/password')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Change current user password',
        description: "Updates the currently authenticated user's password and revokes all active sessions.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    // Generic 400 on purpose: payload validation, a wrong current password, and password reuse all
    // share the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async changePasswordMe(
        @CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserPasswordDto: PatchUserPasswordDto,
    ) {
        await this.commandPipeline.execute(
            new ChangeUserPasswordCommand(
                accessTokenPayload.sub,
                patchUserPasswordDto.currentPassword,
                patchUserPasswordDto.newPassword,
            ),
        );
    }

    /**
     * Registers a new user account. Public: this is the sign-up route. Returns no body — the client
     * signs in with the submitted credentials and reads the profile from `me`.
     *
     * @param postUserDto The registration payload
     */
    @Public()
    @Post()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Register user',
        description: 'Creates a new user account. Public sign-up route.',
    })
    @ApiNoContentResponse({ description: 'User account successfully created.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async create(@Body(NotEmptyBodyPipe) postUserDto: PostUserDto) {
        await this.commandPipeline.execute(
            new CreateUserCommand(postUserDto.email, postUserDto.name, postUserDto.password),
        );
    }

    /**
     * Bans a user account and revokes all of its active sessions. Admin-only.
     *
     * @param params The path parameters carrying the target user ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @Roles(...ADMIN_ROLES)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Ban user',
        description: 'Bans the account and revokes all active sessions. Requires administrator authorization.',
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
     * Lifts the ban on a user account. Admin-only.
     *
     * @param params The path parameters carrying the target user ID
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
    @Roles(...ADMIN_ROLES)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Unban user',
        description: 'Lifts the ban on the account. Requires administrator authorization.',
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
