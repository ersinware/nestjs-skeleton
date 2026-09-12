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
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import { ChangeAdminPasswordCommand } from 'src/module/admin/application/command/change-admin-password/command';
import { ChangeAdminPermissionsCommand } from 'src/module/admin/application/command/change-admin-permissions/command';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { GetAdminByIdQuery } from 'src/module/admin/application/query/get-admin-by-id/query';
import { ListAdminPermissionCatalogQuery } from 'src/module/admin/application/query/list-admin-permission-catalog/query';
import { ListAdminsQuery } from 'src/module/admin/application/query/list-admins/query';
import { PatchAdminPasswordDto } from 'src/module/admin/presentation/dto/patch-admin-password.dto';
import { PatchAdminDto } from 'src/module/admin/presentation/dto/patch-admin.dto';
import { PostAdminActivateDto } from 'src/module/admin/presentation/dto/post-admin-activate.dto';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';
import { PutAdminPermissionsDto } from 'src/module/admin/presentation/dto/put-admin-permissions.dto';
import {
    ResponseAdminPasswordLoginRequiredDto,
    ResponseAdminPasswordSessionDto,
} from 'src/module/admin/presentation/dto/response-admin-password.dto';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { Permission, PrincipalType, type Principal } from 'src/shared/domain/principal';
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
     */
    @Delete(ROUTE_PARAM_ID)
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
     */
    @Get(ROUTE_PARAM_ID)
    @Permissions(Permission.ADMIN_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
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
     */
    @Get()
    @Permissions(Permission.ADMIN_ACCOUNT_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
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
     */
    @Get('me')
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
    @Get('permission')
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
     * Updates the currently authenticated admin's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param principal The verified principal of the current request
     * @param patchAdminDto The sparse payload carrying the fields to update
     * @returns The updated, serialized profile of the current admin
     */
    @Patch('me')
    @PrincipalOnly(PrincipalType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current admin profile',
        description: "Updates details of the currently authenticated admin's profile.",
    })
    @ApiOkResponse({ description: 'Admin successfully updated.', type: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    // Generic 409 on purpose: a taken email address and a concurrent modification share the status,
    // so naming one cause would document the endpoint as if the other did not exist.
    @ApiDefaultResourceConflictResponse()
    async updateMe(
        @CurrentPrincipal() principal: Principal,
        @Body() patchAdminDto: PatchAdminDto,
    ): Promise<ResponseAdminDto> {
        await this.commandPipeline.execute(
            new UpdateAdminCommand(principal.id, patchAdminDto.email, patchAdminDto.name),
        );

        return plainToInstance(ResponseAdminDto, await this.queryPipeline.execute(new GetAdminByIdQuery(principal.id)));
    }

    /**
     * Changes the currently authenticated admin's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param principal The verified principal of the current request
     * @param patchAdminPasswordDto The payload carrying the current and new passwords
     * @returns The password change result with tokens or a sign-in requirement
     */
    @Patch('me/password')
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
                    created: getSchemaPath(ResponseAdminPasswordSessionDto),
                    login_required: getSchemaPath(ResponseAdminPasswordLoginRequiredDto),
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

        return result.session === 'created'
            ? plainToInstance(ResponseAdminPasswordSessionDto, result)
            : plainToInstance(ResponseAdminPasswordLoginRequiredDto, result);
    }

    /**
     * Creates a new admin account pending activation and emails the invitation to its owner. The
     * account starts with no permissions; they are granted separately once it exists.
     *
     * @param postAdminDto The creation payload carrying the email and name
     */
    @Post()
    @Permissions(Permission.ADMIN_ACCOUNT_INVITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Create admin',
        description: `Creates an admin account pending activation, with no permissions, and emails an invitation to its owner. Requires the '${Permission.ADMIN_ACCOUNT_INVITE}' permission.`,
    })
    @ApiNoContentResponse({ description: 'Admin account successfully created; the invitation email is on its way.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async create(@Body() postAdminDto: PostAdminDto) {
        await this.commandPipeline.execute(new CreateAdminCommand(postAdminDto.email, postAdminDto.name));
    }

    /**
     * Activates a pending admin account with the invite token from the invitation email. Public: the
     * new admin has no credentials yet, the token is what proves the invitation.
     *
     * @param postAdminActivateDto The payload carrying the invite token and the chosen password
     */
    @Public()
    @Post('activate')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Activate admin account',
        description: 'Activates a pending admin account by setting its first password via the invite token.',
    })
    @ApiNoContentResponse({ description: 'Account successfully activated.' })
    // Generic 400 on purpose: payload validation and every invitation failure (bad signature,
    // expired, wrong account state) share the status, and the response must not disclose which.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.CONCURRENT_MODIFICATION)
    async activate(@Body() postAdminActivateDto: PostAdminActivateDto) {
        await this.commandPipeline.execute(
            new ActivateAdminCommand(postAdminActivateDto.token, postAdminActivateDto.password),
        );
    }

    /**
     * Re-issues the activation invitation for a pending admin whose link expired or never arrived.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/re-invite`)
    @Permissions(Permission.ADMIN_ACCOUNT_INVITE)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Re-invite admin',
        description: `Emails a fresh activation invitation for a pending admin account. Requires the '${Permission.ADMIN_ACCOUNT_INVITE}' permission.`,
    })
    @ApiNoContentResponse({ description: 'Invitation successfully re-issued.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    // Generic 409 on purpose: an already-activated and a banned account both refuse a re-invite, so
    // naming one cause would document the endpoint as if the other did not exist.
    @ApiDefaultResourceConflictResponse()
    async reInvite(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new ReInviteAdminCommand(params.id));
    }

    /**
     * Bans an admin account and revokes all of its active sessions. Nobody bans themselves or root;
     * only root bans a manager.
     *
     * @param principal The verified principal imposing the ban
     * @param params The path parameters carrying the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
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
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
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
     */
    @Put(`${ROUTE_PARAM_ID}/permission`)
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
            new ChangeAdminPermissionsCommand(params.id, putAdminPermissionsDto.permissions, principal),
        );
    }
}
