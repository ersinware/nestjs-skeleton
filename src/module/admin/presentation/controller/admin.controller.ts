/**
 * @file admin.controller.ts
 * @description HTTP endpoints for managing admin accounts, each gated by the permission it exercises.
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
    ApiDefaultRateLimitedResponse,
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
    ResponseSingleUploadInitiateDto,
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { Audited } from 'src/core/observability/audit';
import { CurrentPrincipal, Permissions, PrincipalOnly, Public } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';
import { SessionOutcome } from 'src/core/security/session';
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import { ChangeAdminPasswordCommand } from 'src/module/admin/application/command/change-admin-password/command';
import { ConfirmAdminEmailChangeCommand } from 'src/module/admin/application/command/confirm-admin-email-change/command';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { InitiateAdminActivationCommand } from 'src/module/admin/application/command/initiate-admin-activation/command';
import { InitiateAdminAvatarChangeCommand } from 'src/module/admin/application/command/initiate-admin-avatar-change/command';
import { InitiateAdminEmailChangeCommand } from 'src/module/admin/application/command/initiate-admin-email-change/command';
import { InviteAdminCommand } from 'src/module/admin/application/command/invite-admin/command';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { ReplaceAdminPermissionsCommand } from 'src/module/admin/application/command/replace-admin-permissions/command';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { GetAdminByIdQuery } from 'src/module/admin/application/query/get-admin-by-id/query';
import { GetFreshAdminByIdQuery } from 'src/module/admin/application/query/get-fresh-admin-by-id/query';
import { ListAdminPermissionCatalogQuery } from 'src/module/admin/application/query/list-admin-permission-catalog/query';
import { ListAdminsQuery } from 'src/module/admin/application/query/list-admins/query';
import { PatchAdminPasswordDto } from 'src/module/admin/presentation/dto/patch-admin-password.dto';
import { PatchAdminDto } from 'src/module/admin/presentation/dto/patch-admin.dto';
import { PostAdminActivationInitiateDto } from 'src/module/admin/presentation/dto/post-admin-activation-initiate.dto';
import { PostAdminActivationDto } from 'src/module/admin/presentation/dto/post-admin-activation.dto';
import { PostAdminAvatarChangeInitiateDto } from 'src/module/admin/presentation/dto/post-admin-avatar-change-initiate.dto';
import { PostAdminEmailChangeConfirmDto } from 'src/module/admin/presentation/dto/post-admin-email-change-confirm.dto';
import { PostAdminEmailChangeInitiateDto } from 'src/module/admin/presentation/dto/post-admin-email-change-initiate.dto';
import { PostAdminInviteDto } from 'src/module/admin/presentation/dto/post-admin-invite.dto';
import { PutAdminPermissionsDto } from 'src/module/admin/presentation/dto/put-admin-permissions.dto';
import {
    ResponseAdminEmailChangeLoginRequiredDto,
    ResponseAdminEmailChangeSessionDto,
} from 'src/module/admin/presentation/dto/response-admin-email-change.dto';
import {
    ResponseAdminPasswordLoginRequiredDto,
    ResponseAdminPasswordSessionDto,
} from 'src/module/admin/presentation/dto/response-admin-password.dto';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { Permission, PrincipalAuditAction, PrincipalType, type Principal } from 'src/shared/domain/principal';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * Admin management endpoints, each gated by the permission it exercises, plus self-scoped profile
 * routes (`me`) open to any administrator and the public activation route the invitation email
 * lands on. Auth requirements are declared per endpoint — the activation route is public, so no
 * class-level lock applies.
 */
@Controller({
    path: 'admin',
    version: VERSION_1,
})
@ApiTags('admin')
@ApiDefaultRateLimitedResponse()
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class AdminController {
    /**
     * Injects the pipelines the controller dispatches through.
     *
     * @param commandPipeline The CQRS command pipeline
     * @param queryPipeline The CQRS query pipeline
     */
    constructor(
        private readonly commandPipeline: CommandPipeline,
        private readonly queryPipeline: QueryPipeline,
    ) {}

    /**
     * Soft-deletes an admin account. Nobody deletes themselves or root; only root deletes a manager.
     *
     * @param principal The verified principal performing the deletion
     * @param params The path parameters carrying the target admin ID
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    @Delete(ROUTE_PARAM_ID)
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_ACCOUNT_DELETE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Delete admin',
        description: `Soft deletes an admin account. Requires the '${Permission.ADMIN_ACCOUNT_DELETE}' permission; the target may be neither the caller nor root, and a manager only when the caller is root.`,
    })
    @ApiNoContentResponse({ description: 'Admin account successfully deleted.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    // Generic 403 on purpose: a missing permission, self-deletion, root and a manager target all share
    // the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async delete(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new DeleteAdminCommand(params.id, principal));
    }

    /**
     * Retrieves an admin's profile by id.
     *
     * @param params The path parameters carrying the target admin id
     * @returns The serialized profile of the requested admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    @Get(ROUTE_PARAM_ID)
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(PrincipalAuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get admin by ID',
        description: `Retrieves a specific admin account. Requires the '${Permission.ADMIN_ACCOUNT_READ}' permission.`,
    })
    @ApiOkResponse({ description: 'Admin details successfully retrieved.', type: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async getById(@Param() params: ParamIdDto): Promise<ResponseAdminDto> {
        return plainToInstance(ResponseAdminDto, await this.queryPipeline.execute(new GetAdminByIdQuery(params.id)));
    }

    /**
     * Lists admin accounts with pagination and optional search.
     *
     * @param query The pagination and search query parameters
     * @returns The paginated list of admin profiles
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    @Get()
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(PrincipalAuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List all admins',
        description: `Retrieves administrator accounts with pagination and optional search. Requires the '${Permission.ADMIN_ACCOUNT_READ}' permission.`,
    })
    @ApiDefaultOkResponsePaginated({ message: 'Admins successfully retrieved.', model: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async list(@Query() query: QuerySearchDto): Promise<ResponsePaginationDto<ResponseAdminDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListAdminsQuery(query));

        return new ResponsePaginationDto<ResponseAdminDto>(
            // Copied because plainToInstance maps arrays only through its mutable-array overload.
            plainToInstance(ResponseAdminDto, [...data]),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Retrieves the currently authenticated admin's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param principal The verified principal of the current request
     * @returns The serialized profile of the current admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    @Get('me')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @PrincipalOnly(PrincipalType.ADMIN)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current admin profile',
        description: 'Retrieves profile details of the currently authenticated admin.',
    })
    @ApiOkResponse({ description: 'Admin details successfully retrieved.', type: ResponseAdminDto })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async getMe(@CurrentPrincipal() principal: Principal): Promise<ResponseAdminDto> {
        return plainToInstance(ResponseAdminDto, await this.queryPipeline.execute(new GetAdminByIdQuery(principal.id)));
    }

    /**
     * Lists the permissions an admin may be granted, for the permission-management screen.
     * Declared ahead of the `:id` route so the static segment is matched first.
     *
     * @returns The grantable admin catalog
     */
    @Get('permissions')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_PERMISSION_MANAGE)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List grantable admin permissions',
        description: `Lists every permission an admin may be granted. Requires the '${Permission.ADMIN_PERMISSION_MANAGE}' permission.`,
    })
    @ApiOkResponse({ description: 'Catalog successfully retrieved.', type: ResponsePermissionCatalogDto })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async listPermissionCatalog(): Promise<ResponsePermissionCatalogDto> {
        return plainToInstance(
            ResponsePermissionCatalogDto,
            await this.queryPipeline.execute(new ListAdminPermissionCatalogQuery()),
        );
    }

    /**
     * Updates the currently authenticated admin's name and/or avatar; the target id comes from the verified
     * token, never from the client.
     *
     * @param principal The verified principal of the current request
     * @param patchAdminDto Optional display name and/or uploaded avatar with its proof
     * @returns The updated, serialized profile of the current admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When the upload proof is replayed or persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account is deleted or inactive, or verified upload keys violate invariants
     * @throws {AccessDeniedException} When the upload proof belongs to another account or the account is banned
     * @throws {InvalidInputException} When the upload proof is invalid or expired, or the profile binding or uploaded metadata does not match
     */
    @Patch('me')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @PrincipalOnly(PrincipalType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current admin profile',
        description:
            'Updates the current admin name, avatar, or both. Avatar acceptance requires the same optional name and descriptor supplied at initiation. The response includes the selected pending key while its permanent copy is queued. Empty bodies are rejected.',
    })
    @ApiOkResponse({ description: 'Admin successfully updated.', type: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async updateMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchAdminDto: PatchAdminDto,
    ): Promise<ResponseAdminDto> {
        await this.commandPipeline.execute(
            new UpdateAdminCommand(principal.id, patchAdminDto.name, patchAdminDto.avatar, patchAdminDto.uploadToken),
        );

        return plainToInstance(
            ResponseAdminDto,
            await this.queryPipeline.execute(new GetFreshAdminByIdQuery(principal.id)),
        );
    }

    /**
     * Prepares a profile avatar upload without changing the authenticated account.
     *
     * @param principal Verified admin selecting their own avatar
     * @param body Avatar descriptor and optional normalized name bound to the final PATCH
     * @returns Signed PUT and profile upload proof
     * @throws {ResourceNotFoundException} When the account is missing or deleted
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When database or storage is unavailable
     * @throws {SystemException} When the account is inactive or the storage plan violates the contract
     */
    @Post('me/avatar/initiate')
    @RateLimit(RateLimitPolicy.AVATAR_UPLOAD_INITIATE)
    @PrincipalOnly(PrincipalType.ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Prepare current admin avatar change',
        description:
            'Prepares a conditional avatar PUT valid for up to five minutes and a profile proof valid for ten minutes. PATCH requires the same avatar descriptor and optional name. Initiation does not change the profile.',
    })
    @ApiOkResponse({ type: ResponseSingleUploadInitiateDto, description: 'Avatar upload request and profile proof.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async initiateAvatarChange(
        @CurrentPrincipal() principal: Principal,
        @Body() body: PostAdminAvatarChangeInitiateDto,
    ): Promise<ResponseSingleUploadInitiateDto> {
        return plainToInstance(
            ResponseSingleUploadInitiateDto,
            await this.commandPipeline.execute(
                new InitiateAdminAvatarChangeCommand(principal.id, body.avatar, body.name),
            ),
        );
    }

    /**
     * Initiates email verification without changing the current address or sessions.
     *
     * @param principal The verified principal requesting the change
     * @param postAdminEmailChangeInitiateDto The new address and current password proof
     * @throws {ResourceNotFoundException} When the account no longer exists
     * @throws {SystemException} When a deleted or inactive account reaches this authenticated flow, or the queue does not accept every required job
     * @throws {InvalidInputException} When the password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the address is in use or the loaded account changed
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    @Post('me/email/initiate')
    @RateLimit(RateLimitPolicy.PASSWORD_CHANGE_EMAIL_CHANGE_INITIATE)
    @PrincipalOnly(PrincipalType.ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Initiate current admin email change',
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
    async initiateEmailChangeMe(
        @CurrentPrincipal() principal: Principal,
        @Body() postAdminEmailChangeInitiateDto: PostAdminEmailChangeInitiateDto,
    ) {
        await this.commandPipeline.execute(
            new InitiateAdminEmailChangeCommand(
                principal.id,
                postAdminEmailChangeInitiateDto.newEmail,
                postAdminEmailChangeInitiateDto.currentPassword,
            ),
        );
    }

    /**
     * Consumes emailed proof for the authenticated account and replaces its sessions.
     *
     * @param principal The verified principal confirming the change
     * @param postAdminEmailChangeConfirmDto The token delivered to the pending address
     * @returns The committed email change with replacement tokens or a sign-in requirement
     * @throws {InvalidInputException} When the proof is invalid or its pending request is revoked, mismatched, consumed, or expired
     * @throws {AccessDeniedException} When the token belongs to another principal or the account is banned
     * @throws {ResourceNotFoundException} When the authenticated account no longer exists
     * @throws {ResourceConflictException} When the email is taken or the account changed concurrently
     * @throws {SystemException} When the loaded account violates the confirmation contract, or the queue does not accept every required job
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    @Post('me/email/confirm')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @PrincipalOnly(PrincipalType.ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Confirm current admin email change',
        description:
            'Requires a valid session for the account named by the emailed token. Confirms the new address, consumes the request, revokes existing sessions, queues an old-address notice, and attempts to open a replacement session.',
    })
    @ApiExtraModels(ResponseAdminEmailChangeSessionDto, ResponseAdminEmailChangeLoginRequiredDto)
    @ApiOkResponse({
        description:
            'Email changed. Discard old tokens; use the replacement pair or sign in with the new address and unchanged password. Session unavailability does not undo the email change.',
        schema: {
            type: 'object',
            oneOf: [
                { $ref: getSchemaPath(ResponseAdminEmailChangeSessionDto) },
                { $ref: getSchemaPath(ResponseAdminEmailChangeLoginRequiredDto) },
            ],
            discriminator: {
                propertyName: 'session',
                mapping: {
                    [SessionOutcome.CREATED]: getSchemaPath(ResponseAdminEmailChangeSessionDto),
                    [SessionOutcome.LOGIN_REQUIRED]: getSchemaPath(ResponseAdminEmailChangeLoginRequiredDto),
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
        @Body() postAdminEmailChangeConfirmDto: PostAdminEmailChangeConfirmDto,
    ): Promise<ResponseAdminEmailChangeSessionDto | ResponseAdminEmailChangeLoginRequiredDto> {
        const result = await this.commandPipeline.execute(
            new ConfirmAdminEmailChangeCommand(principal.id, postAdminEmailChangeConfirmDto.token),
        );

        return result.session === SessionOutcome.CREATED
            ? plainToInstance(ResponseAdminEmailChangeSessionDto, result)
            : plainToInstance(ResponseAdminEmailChangeLoginRequiredDto, result);
    }

    /**
     * Changes the currently authenticated admin's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param principal The verified principal of the current request
     * @param patchAdminPasswordDto The payload carrying the current and new passwords
     * @returns The password change result with tokens or a sign-in requirement
     * @throws {ResourceNotFoundException} When the admin does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account violates the mutation contract or required jobs are not accepted
     */
    @Patch('me/password')
    @RateLimit(RateLimitPolicy.PASSWORD_CHANGE_EMAIL_CHANGE_INITIATE)
    @PrincipalOnly(PrincipalType.ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Change current admin password',
        description:
            "Updates the currently authenticated admin's password, revokes existing sessions, and attempts to open a replacement session for this client.",
    })
    @ApiExtraModels(ResponseAdminPasswordSessionDto, ResponseAdminPasswordLoginRequiredDto)
    @ApiOkResponse({
        description:
            'Password changed. The session result contains new tokens or requires sign-in with the new password; session unavailability does not undo the password change.',
        schema: {
            type: 'object',
            oneOf: [
                { $ref: getSchemaPath(ResponseAdminPasswordSessionDto) },
                { $ref: getSchemaPath(ResponseAdminPasswordLoginRequiredDto) },
            ],
            discriminator: {
                propertyName: 'session',
                mapping: {
                    [SessionOutcome.CREATED]: getSchemaPath(ResponseAdminPasswordSessionDto),
                    [SessionOutcome.LOGIN_REQUIRED]: getSchemaPath(ResponseAdminPasswordLoginRequiredDto),
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
        @Body() patchAdminPasswordDto: PatchAdminPasswordDto,
    ): Promise<ResponseAdminPasswordSessionDto | ResponseAdminPasswordLoginRequiredDto> {
        const result = await this.commandPipeline.execute(
            new ChangeAdminPasswordCommand(
                principal.id,
                patchAdminPasswordDto.currentPassword,
                patchAdminPasswordDto.newPassword,
            ),
        );

        return result.session === SessionOutcome.CREATED
            ? plainToInstance(ResponseAdminPasswordSessionDto, result)
            : plainToInstance(ResponseAdminPasswordLoginRequiredDto, result);
    }

    /**
     * Invites a new admin by creating an account pending activation and emailing its owner. The
     * account starts with no permissions; they are granted separately once it exists.
     *
     * @param postAdminInviteDto The invitation payload carrying the email and name
     * @throws {ResourceConflictException} When the email address is already in use
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the delivery queue does not accept every required job
     */
    @Post('invite')
    @RateLimit(RateLimitPolicy.ADMIN_INVITATION)
    @Permissions(Permission.ADMIN_ACCOUNT_INVITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Invite admin',
        description: `Invites a new admin by creating an account pending activation, with no permissions, and emailing its owner. Requires the '${Permission.ADMIN_ACCOUNT_INVITE}' permission.`,
    })
    @ApiNoContentResponse({ description: 'Admin invitation queued; the account is pending activation.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async invite(@Body() postAdminInviteDto: PostAdminInviteDto) {
        await this.commandPipeline.execute(new InviteAdminCommand(postAdminInviteDto.email, postAdminInviteDto.name));
    }

    /**
     * Prepares the invited admin's required avatar without consuming the invitation.
     *
     * @param body Validated invitation, initial password, and avatar descriptor
     * @returns One signed PUT and a form-bound activation proof
     * @throws {InvalidInputException} When the invitation is invalid, expired, or revoked
     * @throws {ResourceNotFoundException} When the account is missing or deleted
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active
     * @throws {DependencyUnavailableException} When database or storage is unavailable
     * @throws {SystemException} When invitation identity or the storage plan violates the contract
     */
    @Public()
    @Post('activation/initiate')
    @RateLimit(RateLimitPolicy.USER_REGISTRATION_ADMIN_USER_ACTIVATION)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Prepare admin activation',
        description:
            'Prepares one conditional avatar PUT valid for up to five minutes and a form-bound activation proof valid for up to ten minutes. Both expire no later than the invitation. Activation requires the same password and avatar descriptor.',
    })
    @ApiOkResponse({
        type: ResponseSingleUploadInitiateDto,
        description: 'Avatar upload request and activation proof.',
    })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceConflictResponse()
    async initiateActivation(@Body() body: PostAdminActivationInitiateDto): Promise<ResponseSingleUploadInitiateDto> {
        return plainToInstance(
            ResponseSingleUploadInitiateDto,
            await this.commandPipeline.execute(
                new InitiateAdminActivationCommand(body.token, body.password, body.avatar),
            ),
        );
    }

    /**
     * Activates a pending admin account with the invite token from the invitation email. Public: the
     * new admin has no credentials yet, the token is what proves the invitation.
     *
     * @param postAdminActivationDto Invitation and upload proofs with the bound password and avatar descriptor
     * @throws {InvalidInputException} When the invitation or upload proof is invalid or expired, or the form binding or uploaded metadata does not match
     * @throws {ResourceNotFoundException} When the verified invitation refers to a missing account
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active or changed concurrently
     * @throws {SystemException} When the loaded account is deleted or differs from the verified subject
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    @Public()
    @Post('activation/complete')
    @RateLimit(RateLimitPolicy.USER_REGISTRATION_ADMIN_USER_ACTIVATION)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Activate admin account',
        description:
            'Activates the invited account with its first password and verified uploaded avatar. Commits the pending key and avatar move job without opening a session.',
    })
    @ApiNoContentResponse({ description: 'Account successfully activated; avatar finalization is queued.' })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async activate(@Body() postAdminActivationDto: PostAdminActivationDto) {
        await this.commandPipeline.execute(
            new ActivateAdminCommand(
                postAdminActivationDto.token,
                postAdminActivationDto.password,
                postAdminActivationDto.avatar,
                postAdminActivationDto.uploadToken,
            ),
        );
    }

    /**
     * Re-issues a pending admin's invitation, invalidating earlier links.
     *
     * @param principal The verified principal requesting the invitation
     * @param params The path parameters carrying the target admin ID
     * @throws {ResourceNotFoundException} When no non-deleted admin exists with the given ID
     * @throws {ResourceConflictException} When the account is active, banned, or concurrently modified
     * @throws {AccessDeniedException} When the actor cannot administer the target
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    @Post(`${ROUTE_PARAM_ID}/re-invite`)
    @RateLimit(RateLimitPolicy.ADMIN_INVITATION)
    @Permissions(Permission.ADMIN_ACCOUNT_INVITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Re-invite admin',
        description: `Invalidates earlier invitations and emails a replacement for a pending admin account. Requires the '${Permission.ADMIN_ACCOUNT_INVITE}' permission and authority to administer the target.`,
    })
    @ApiNoContentResponse({ description: 'Invitation successfully re-issued.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    // Active/banned accounts and concurrent writes all return 409.
    @ApiDefaultResourceConflictResponse()
    async reInvite(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new ReInviteAdminCommand(params.id, principal));
    }

    /**
     * Bans an admin account and revokes all of its active sessions. Nobody bans themselves or root;
     * only root bans a manager.
     *
     * @param principal The verified principal imposing the ban
     * @param params The path parameters carrying the target admin ID
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_ACCOUNT_BAN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Ban admin',
        description: `Bans the account and revokes all active sessions. Requires the '${Permission.ADMIN_ACCOUNT_BAN}' permission; the target may be neither the caller nor root, and a manager only when the caller is root.`,
    })
    @ApiNoContentResponse({ description: 'Admin successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    // Generic 403 on purpose: a missing permission, self-targeting, root and a manager target all share
    // the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async ban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanAdminCommand(params.id, principal));
    }

    /**
     * Lifts the ban on an admin account. Nobody unbans themselves or root; only root unbans a manager.
     *
     * @param principal The verified principal lifting the ban
     * @param params The path parameters carrying the target admin ID
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account or actor violates the mutation contract
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_ACCOUNT_BAN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Unban admin',
        description: `Lifts the ban on the account. Requires the '${Permission.ADMIN_ACCOUNT_BAN}' permission; the target may be neither the caller nor root, and a manager only when the caller is root.`,
    })
    @ApiNoContentResponse({ description: 'Admin successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    // Generic 403 on purpose: a missing permission, self-targeting, root and a manager target all share
    // the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async unban(@CurrentPrincipal() principal: Principal, @Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanAdminCommand(params.id, principal));
    }

    /**
     * Replaces an admin's permission set. A manager gives and takes every ordinary permission; the
     * manager marker moves only by root's hand, root's own marker never; nobody targets themselves
     * or root, and only root revokes from a manager.
     *
     * @param principal The verified principal making the change
     * @param params The path parameters carrying the target admin ID
     * @param putAdminPermissionsDto The complete permission set the admin should hold afterwards
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, moves a tier marker without being root, or revokes from a manager without being root.
     * @throws {InvalidInputException} When the set holds a permission an admin may not hold.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    @Put(`${ROUTE_PARAM_ID}/permissions`)
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.ADMIN_PERMISSION_MANAGE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Replace admin permissions',
        description: `Replaces the admin's permission set with the given one and retires its access tokens, so the next refresh carries the new set. Requires the '${Permission.ADMIN_PERMISSION_MANAGE}' permission. Only root may grant or revoke '${Permission.ADMIN_PERMISSION_MANAGE}' or revoke from a manager; '${Permission.ADMIN_ROOT}' is never granted; the target may be neither the caller nor root.`,
    })
    @ApiNoContentResponse({ description: 'Permissions successfully replaced.' })
    // Generic 400 on purpose: payload validation and a permission an admin may not hold share the
    // status, so naming one cause would document the endpoint as if the other did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    // Generic 403 on purpose: a missing permission, self-targeting, root, a tier marker and a manager
    // target all share the status.
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async replacePermissions(
        @CurrentPrincipal() principal: Principal,
        @Param() params: ParamIdDto,
        @Body() putAdminPermissionsDto: PutAdminPermissionsDto,
    ) {
        await this.commandPipeline.execute(
            new ReplaceAdminPermissionsCommand(params.id, putAdminPermissionsDto.permissions, principal),
        );
    }
}
