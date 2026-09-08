/**
 * @file user.controller.ts
 * @description HTTP endpoints of the user bounded context: public registration, self-service profile management, and the permission-gated admin operations (lookup, ban/unban, permissions).
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
    HttpCache,
    HttpCachePolicy,
    ParamIdDto,
    QuerySearchDto,
    RequestValidationMessage,
    ResponsePaginationDto,
    ResponsePermissionCatalogDto,
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { CurrentPrincipal, Permissions, PrincipalOnly, Public } from 'src/core/security/auth';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import { ChangeUserPasswordCommand } from 'src/module/user/application/command/change-user-password/command';
import { ChangeUserPermissionsCommand } from 'src/module/user/application/command/change-user-permissions/command';
import { DeleteUserCommand } from 'src/module/user/application/command/delete-user/command';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { GetUserByIdQuery } from 'src/module/user/application/query/get-user-by-id/query';
import { ListUserPermissionCatalogQuery } from 'src/module/user/application/query/list-user-permission-catalog/query';
import { ListUsersQuery } from 'src/module/user/application/query/list-users/query';
import { PatchUserPasswordDto } from 'src/module/user/presentation/dto/patch-user-password.dto';
import { PatchUserDto } from 'src/module/user/presentation/dto/patch-user.dto';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';
import { PutUserPermissionsDto } from 'src/module/user/presentation/dto/put-user-permissions.dto';
import { ResponseUserDto } from 'src/module/user/presentation/dto/response-user.dto';
import { Permission, PrincipalType, type Principal } from 'src/shared/domain/principal';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * User endpoints: public registration, self-scoped profile routes (`me`) pinned to user principals,
 * and the permission-gated operations an administrator performs on users. Responses are serialized
 * through the whitelist DTOs so internal fields never leak.
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
     * @param principal The verified principal of the current request
     */
    @Delete('me')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Delete current user account',
        description: 'Soft deletes the currently authenticated user account and revokes all active sessions.',
    })
    @ApiNoContentResponse({ description: 'User account successfully deleted.' })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async deleteMe(@CurrentPrincipal() principal: Principal) {
        await this.commandPipeline.execute(new DeleteUserCommand(principal.id));
    }

    /**
     * Retrieves the currently authenticated user's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param principal The verified principal of the current request
     * @returns The serialized profile of the current user
     */
    @Get('me')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current user profile',
        description: 'Retrieves profile details of the currently authenticated user.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async getMe(@CurrentPrincipal() principal: Principal): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(principal.id)));
    }

    /**
     * Retrieves a specific user's profile by unique identifier.
     *
     * @param params The path parameters carrying the target user ID
     * @returns The serialized profile of the requested user
     */
    @Get(ROUTE_PARAM_ID)
    @Permissions(Permission.USER_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get user by ID',
        description: `Retrieves a specific user account. Requires the '${Permission.USER_ACCOUNT_READ}' permission.`,
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async getById(@Param() params: ParamIdDto): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(params.id)));
    }

    /**
     * Lists user accounts with pagination and optional search.
     *
     * @param query The pagination and search query parameters
     * @returns The paginated list of user profiles
     */
    @Get()
    @Permissions(Permission.USER_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List all users',
        description: `Retrieves user accounts with pagination and optional search. Requires the '${Permission.USER_ACCOUNT_READ}' permission.`,
    })
    @ApiDefaultOkResponsePaginated({ message: 'Users successfully retrieved.', model: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async list(@Query() query: QuerySearchDto): Promise<ResponsePaginationDto<ResponseUserDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListUsersQuery(query));

        return new ResponsePaginationDto<ResponseUserDto>(
            // Copied because plainToInstance maps arrays only through its mutable-array overload.
            plainToInstance(ResponseUserDto, [...data]),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Lists the permissions a user may be granted, for the permission-management screen.
     * Declared ahead of the `:id` route so the static segment is matched first.
     *
     * @returns The grantable user catalog
     */
    @Get('permission')
    @Permissions(Permission.USER_PERMISSION_MANAGE)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List grantable user permissions',
        description: `Lists every permission a user may be granted. Requires the '${Permission.USER_PERMISSION_MANAGE}' permission.`,
    })
    @ApiOkResponse({ description: 'Catalog successfully retrieved.', type: ResponsePermissionCatalogDto })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async listPermissionCatalog(): Promise<ResponsePermissionCatalogDto> {
        return plainToInstance(
            ResponsePermissionCatalogDto,
            await this.queryPipeline.execute(new ListUserPermissionCatalogQuery()),
        );
    }

    /**
     * Updates the currently authenticated user's profile.
     *
     * @param principal The verified principal of the current request
     * @param patchUserDto The sparse payload carrying the fields to update
     * @returns The updated, serialized profile of the current user
     */
    @Patch('me')
    @PrincipalOnly(PrincipalType.USER)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current user profile',
        description: "Updates details of the currently authenticated user's profile.",
    })
    @ApiOkResponse({ description: 'User successfully updated.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async updateMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchUserDto: PatchUserDto,
    ): Promise<ResponseUserDto> {
        await this.commandPipeline.execute(new UpdateUserCommand(principal.id, patchUserDto.email, patchUserDto.name));

        return plainToInstance(ResponseUserDto, await this.queryPipeline.execute(new GetUserByIdQuery(principal.id)));
    }

    /**
     * Changes the currently authenticated user's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param principal The verified principal of the current request
     * @param patchUserPasswordDto The payload carrying the current and new passwords
     */
    @Patch('me/password')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Change current user password',
        description: "Updates the currently authenticated user's password and revokes all active sessions.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    // Generic 400 on purpose: payload validation, a wrong current password, and password reuse all
    // share the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async changePasswordMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchUserPasswordDto: PatchUserPasswordDto,
    ) {
        await this.commandPipeline.execute(
            new ChangeUserPasswordCommand(
                principal.id,
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
        description: 'Registers a new user account. Public sign-up route.',
    })
    @ApiNoContentResponse({ description: 'User account successfully created.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async register(@Body() postUserDto: PostUserDto) {
        await this.commandPipeline.execute(
            new RegisterUserCommand(postUserDto.email, postUserDto.name, postUserDto.password),
        );
    }

    /**
     * Bans a user account and revokes all of its active sessions.
     *
     * @param principal The verified principal imposing the ban
     * @param params The path parameters carrying the target user ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @Permissions(Permission.USER_ACCOUNT_BAN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Ban user',
        description: `Bans the account and revokes all active sessions. Requires the '${Permission.USER_ACCOUNT_BAN}' permission.`,
    })
    @ApiNoContentResponse({ description: 'User successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async ban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanUserCommand(params.id, principal));
    }

    /**
     * Lifts the ban on a user account.
     *
     * @param principal The verified principal lifting the ban
     * @param params The path parameters carrying the target user ID
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
    @Permissions(Permission.USER_ACCOUNT_BAN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Unban user',
        description: `Lifts the ban on the account. Requires the '${Permission.USER_ACCOUNT_BAN}' permission.`,
    })
    @ApiNoContentResponse({ description: 'User successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async unban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanUserCommand(params.id, principal));
    }

    /**
     * Replaces a user's permission set.
     *
     * @param principal The verified principal making the change
     * @param params The path parameters carrying the target user ID
     * @param putUserPermissionsDto The complete permission set the user should hold afterwards
     */
    @Put(`${ROUTE_PARAM_ID}/permission`)
    @Permissions(Permission.USER_PERMISSION_MANAGE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Replace user permissions',
        description: `Replaces the user's permission set with the given one and retires its access tokens, so the next refresh carries the new set. Requires the '${Permission.USER_PERMISSION_MANAGE}' permission.`,
    })
    @ApiNoContentResponse({ description: 'Permissions successfully replaced.' })
    // Generic 400 on purpose: payload validation and a permission a user may not hold share the
    // status, so naming one cause would document the endpoint as if the other did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async replacePermissions(
        @CurrentPrincipal() principal: Principal,
        @Param() params: ParamIdDto,
        @Body() putUserPermissionsDto: PutUserPermissionsDto,
    ) {
        await this.commandPipeline.execute(
            new ChangeUserPermissionsCommand(params.id, putUserPermissionsDto.permissions, principal),
        );
    }
}
