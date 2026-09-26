/**
 * @file user.controller.ts
 * @description HTTP endpoints of the user bounded context: public registration, self-service profile management, and the permission-gated admin operations (lookup, ban/unban, permissions).
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiExtraModels,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    getSchemaPath,
} from '@nestjs/swagger';
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
import { SessionOutcome } from 'src/core/security/session';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import { ChangeUserPasswordCommand } from 'src/module/user/application/command/change-user-password/command';
import { ChangeUserPermissionsCommand } from 'src/module/user/application/command/change-user-permissions/command';
import { ConfirmUserEmailChangeCommand } from 'src/module/user/application/command/confirm-user-email-change/command';
import { DeleteUserCommand } from 'src/module/user/application/command/delete-user/command';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import { RequestUserEmailChangeCommand } from 'src/module/user/application/command/request-user-email-change/command';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { GetFreshUserByIdQuery } from 'src/module/user/application/query/get-fresh-user-by-id/query';
import { GetUserByIdQuery } from 'src/module/user/application/query/get-user-by-id/query';
import { ListUserPermissionCatalogQuery } from 'src/module/user/application/query/list-user-permission-catalog/query';
import { ListUsersQuery } from 'src/module/user/application/query/list-users/query';
import { PatchUserPasswordDto } from 'src/module/user/presentation/dto/patch-user-password.dto';
import { PatchUserDto } from 'src/module/user/presentation/dto/patch-user.dto';
import { PostUserEmailChangeDto } from 'src/module/user/presentation/dto/post-user-email-change.dto';
import { PostUserEmailConfirmDto } from 'src/module/user/presentation/dto/post-user-email-confirm.dto';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';
import { PutUserPermissionsDto } from 'src/module/user/presentation/dto/put-user-permissions.dto';
import {
    ResponseUserEmailChangeLoginRequiredDto,
    ResponseUserEmailChangeSessionDto,
} from 'src/module/user/presentation/dto/response-user-email-change.dto';
import {
    ResponseUserPasswordLoginRequiredDto,
    ResponseUserPasswordSessionDto,
} from 'src/module/user/presentation/dto/response-user-password.dto';
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
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When the delivery queue does not accept every required job
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
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async deleteMe(@CurrentPrincipal() principal: Principal) {
        await this.commandPipeline.execute(new DeleteUserCommand(principal.id));
    }

    /**
     * Retrieves the currently authenticated user's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param principal The verified principal of the current request
     * @returns The serialized profile of the current user
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
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
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
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
     * @throws {DependencyUnavailableException} When the account database is unavailable
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
     * Updates the currently authenticated user's display name.
     *
     * @param principal The verified principal of the current request
     * @param patchUserDto The required display name to update
     * @returns The updated, serialized profile of the current user
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account violates the mutation contract or required jobs are not accepted
     */
    @Patch('me')
    @PrincipalOnly(PrincipalType.USER)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current user profile',
        description: "Updates only the currently authenticated user's display name.",
    })
    @ApiOkResponse({ description: 'User successfully updated.', type: ResponseUserDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async updateMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchUserDto: PatchUserDto,
    ): Promise<ResponseUserDto> {
        await this.commandPipeline.execute(new UpdateUserCommand(principal.id, patchUserDto.name));

        return plainToInstance(
            ResponseUserDto,
            await this.queryPipeline.execute(new GetFreshUserByIdQuery(principal.id)),
        );
    }

    /**
     * Requests a confirmation link without changing the current address or sessions.
     *
     * @param principal The verified principal requesting the change
     * @param postUserEmailChangeDto The new address and current password proof
     * @throws {ResourceNotFoundException} When the account no longer exists
     * @throws {SystemException} When a deleted account reaches this authenticated flow, or the queue does not accept every required job
     * @throws {InvalidInputException} When the password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the address is in use or the loaded account changed
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    @Post('me/email')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Request current user email change',
        description:
            'Verifies the current password and queues a confirmation link to the new address. Each request replaces the previous link, even for the same address; the current email and sessions remain unchanged.',
    })
    @ApiNoContentResponse({
        description: 'Confirmation request and delivery job committed; email delivery is asynchronous.',
    })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async requestEmailChangeMe(
        @CurrentPrincipal() principal: Principal,
        @Body() postUserEmailChangeDto: PostUserEmailChangeDto,
    ) {
        await this.commandPipeline.execute(
            new RequestUserEmailChangeCommand(
                principal.id,
                postUserEmailChangeDto.newEmail,
                postUserEmailChangeDto.currentPassword,
            ),
        );
    }

    /**
     * Consumes emailed proof for the authenticated account and replaces its sessions.
     *
     * @param principal The verified principal confirming the change
     * @param postUserEmailConfirmDto The token delivered to the pending address
     * @returns The committed email change with replacement tokens or a sign-in requirement
     * @throws {InvalidInputException} When the proof is invalid or its pending request is revoked, mismatched, consumed, or expired
     * @throws {AccessDeniedException} When the token belongs to another principal or the account is banned
     * @throws {ResourceNotFoundException} When the authenticated account no longer exists
     * @throws {ResourceConflictException} When the email is taken or the account changed concurrently
     * @throws {SystemException} When the loaded account violates the confirmation contract, or the queue does not accept every required job
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    @Post('me/email/confirm')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Confirm current user email change',
        description:
            'Requires a valid session for the account named by the emailed token. Confirms the new address, consumes the request, revokes existing sessions, queues an old-address notice, and attempts to open a replacement session.',
    })
    @ApiExtraModels(ResponseUserEmailChangeSessionDto, ResponseUserEmailChangeLoginRequiredDto)
    @ApiOkResponse({
        description:
            'Email changed. Discard old tokens; use the replacement pair or sign in with the new address and unchanged password. Session unavailability does not undo the email change.',
        schema: {
            type: 'object',
            oneOf: [
                { $ref: getSchemaPath(ResponseUserEmailChangeSessionDto) },
                { $ref: getSchemaPath(ResponseUserEmailChangeLoginRequiredDto) },
            ],
            discriminator: {
                propertyName: 'session',
                mapping: {
                    [SessionOutcome.CREATED]: getSchemaPath(ResponseUserEmailChangeSessionDto),
                    [SessionOutcome.LOGIN_REQUIRED]: getSchemaPath(ResponseUserEmailChangeLoginRequiredDto),
                },
            },
        },
    })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async confirmEmailChangeMe(
        @CurrentPrincipal() principal: Principal,
        @Body() postUserEmailConfirmDto: PostUserEmailConfirmDto,
    ): Promise<ResponseUserEmailChangeSessionDto | ResponseUserEmailChangeLoginRequiredDto> {
        const result = await this.commandPipeline.execute(
            new ConfirmUserEmailChangeCommand(principal.id, postUserEmailConfirmDto.token),
        );

        return result.session === SessionOutcome.CREATED
            ? plainToInstance(ResponseUserEmailChangeSessionDto, result)
            : plainToInstance(ResponseUserEmailChangeLoginRequiredDto, result);
    }

    /**
     * Changes the currently authenticated user's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param principal The verified principal of the current request
     * @param patchUserPasswordDto The payload carrying the current and new passwords
     * @returns The password change result with tokens or a sign-in requirement
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account violates the mutation contract or required jobs are not accepted
     */
    @Patch('me/password')
    @PrincipalOnly(PrincipalType.USER)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Change current user password',
        description:
            "Updates the currently authenticated user's password, revokes existing sessions, and attempts to open a replacement session for this client.",
    })
    @ApiExtraModels(ResponseUserPasswordSessionDto, ResponseUserPasswordLoginRequiredDto)
    @ApiOkResponse({
        description:
            'Password changed. The session result contains new tokens or requires sign-in with the new password; session unavailability does not undo the password change.',
        schema: {
            type: 'object',
            oneOf: [
                { $ref: getSchemaPath(ResponseUserPasswordSessionDto) },
                { $ref: getSchemaPath(ResponseUserPasswordLoginRequiredDto) },
            ],
            discriminator: {
                propertyName: 'session',
                mapping: {
                    [SessionOutcome.CREATED]: getSchemaPath(ResponseUserPasswordSessionDto),
                    [SessionOutcome.LOGIN_REQUIRED]: getSchemaPath(ResponseUserPasswordLoginRequiredDto),
                },
            },
        },
    })
    // Generic 400 on purpose: payload validation, a wrong current password, and password reuse all
    // share the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async changePasswordMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchUserPasswordDto: PatchUserPasswordDto,
    ): Promise<ResponseUserPasswordSessionDto | ResponseUserPasswordLoginRequiredDto> {
        const result = await this.commandPipeline.execute(
            new ChangeUserPasswordCommand(
                principal.id,
                patchUserPasswordDto.currentPassword,
                patchUserPasswordDto.newPassword,
            ),
        );

        return result.session === SessionOutcome.CREATED
            ? plainToInstance(ResponseUserPasswordSessionDto, result)
            : plainToInstance(ResponseUserPasswordLoginRequiredDto, result);
    }

    /**
     * Registers a new user account. Public: this is the sign-up route. Returns no body — the client
     * signs in with the submitted credentials and reads the profile from `me`.
     *
     * @param postUserDto The registration payload
     * @throws {ResourceConflictException} When the email address is already in use
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
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
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
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
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async ban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanUserCommand(params.id, principal));
    }

    /**
     * Lifts the ban on a user account.
     *
     * @param principal The verified principal lifting the ban
     * @param params The path parameters carrying the target user ID
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
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
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async unban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanUserCommand(params.id, principal));
    }

    /**
     * Replaces a user's permission set.
     *
     * @param principal The verified principal making the change
     * @param params The path parameters carrying the target user ID
     * @param putUserPermissionsDto The complete permission set the user should hold afterwards
     * @throws {ResourceNotFoundException} When the target user does not exist.
     * @throws {InvalidInputException} When the set holds a permission a user may not hold.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
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
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
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
