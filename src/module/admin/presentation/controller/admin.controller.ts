/**
 * @file admin.controller.ts
 * @description HTTP endpoints for managing admin accounts, restricted to super-admins.
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
    HttpCache,
    HttpCachePolicy,
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
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import { ChangeAdminPasswordCommand } from 'src/module/admin/application/command/change-admin-password/command';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { GetAdminByIdQuery } from 'src/module/admin/application/query/get-admin-by-id/query';
import { ListAdminsQuery } from 'src/module/admin/application/query/list-admins/query';
import { PatchAdminPasswordDto } from 'src/module/admin/presentation/dto/patch-admin-password.dto';
import { PatchAdminDto } from 'src/module/admin/presentation/dto/patch-admin.dto';
import { PostAdminActivateDto } from 'src/module/admin/presentation/dto/post-admin-activate.dto';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { AdminRole } from 'src/shared/domain/admin';
import { ADMIN_ROLES } from 'src/shared/domain/auth-role';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * Admin management endpoints, plus self-scoped profile routes (`me`) open to any administrator and
 * the public activation route the invitation email lands on. Auth requirements are declared per
 * endpoint — the activation route is public, so no class-level lock applies.
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
     * Soft-deletes an admin account. Super-admins cannot be deleted, so the system can never lock
     * itself out.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Delete(ROUTE_PARAM_ID)
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Delete admin',
        description: 'Soft deletes an admin account. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin account successfully deleted.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async deleteAdmin(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new DeleteAdminCommand(params.id));
    }

    /**
     * Lists admin accounts with pagination and optional search.
     *
     * @param query The pagination and search query parameters
     * @returns The paginated list of admin profiles
     */
    @Get()
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List all admins',
        description:
            'Retrieves administrator accounts with pagination and optional search. Requires super-administrator authorization.',
    })
    @ApiDefaultOkResponsePaginated({ message: 'Admins successfully retrieved.', model: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async findAll(@Query() query: QuerySearchDto): Promise<ResponsePaginationDto<ResponseAdminDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListAdminsQuery(query));

        return new ResponsePaginationDto<ResponseAdminDto>(
            plainToInstance(ResponseAdminDto, data),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Retrieves the currently authenticated admin's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     * @returns The serialized profile of the current admin
     */
    @Get('me')
    @Roles(...ADMIN_ROLES)
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
    async findMe(@CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload): Promise<ResponseAdminDto> {
        return plainToInstance(
            ResponseAdminDto,
            await this.queryPipeline.execute(new GetAdminByIdQuery(accessTokenPayload.sub)),
        );
    }

    /**
     * Retrieves an admin's profile by id. Super-admin only.
     *
     * @param params The path parameters carrying the target admin id
     * @returns The serialized profile of the requested admin
     */
    @Get(ROUTE_PARAM_ID)
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get admin by ID',
        description: 'Retrieves a specific admin account. Requires super administrator authorization.',
    })
    @ApiOkResponse({ description: 'Admin details successfully retrieved.', type: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async findById(@Param() params: ParamIdDto): Promise<ResponseAdminDto> {
        return plainToInstance(ResponseAdminDto, await this.queryPipeline.execute(new GetAdminByIdQuery(params.id)));
    }

    /**
     * Updates the currently authenticated admin's profile; the target id comes from the verified
     * token, never from the client.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     * @param patchAdminDto The sparse payload carrying the fields to update
     * @returns The updated, serialized profile of the current admin
     */
    @Patch('me')
    @Roles(...ADMIN_ROLES)
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
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async updateMe(
        @CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchAdminDto: PatchAdminDto,
    ): Promise<ResponseAdminDto> {
        await this.commandPipeline.execute(
            new UpdateAdminCommand(accessTokenPayload.sub, patchAdminDto.email, patchAdminDto.name),
        );

        return plainToInstance(
            ResponseAdminDto,
            await this.queryPipeline.execute(new GetAdminByIdQuery(accessTokenPayload.sub)),
        );
    }

    /**
     * Changes the currently authenticated admin's password; the current password must be verified so
     * a hijacked session cannot take the account over.
     *
     * @param accessTokenPayload The decoded access token payload of the requester
     * @param patchAdminPasswordDto The payload carrying the current and new passwords
     */
    @Patch('me/password')
    @Roles(...ADMIN_ROLES)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Change current admin password',
        description: "Updates the currently authenticated admin's password and revokes all active sessions.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    // Generic 400 on purpose: payload validation, a wrong current password, and password reuse all
    // share the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async changePasswordMe(
        @CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchAdminPasswordDto: PatchAdminPasswordDto,
    ) {
        await this.commandPipeline.execute(
            new ChangeAdminPasswordCommand(
                accessTokenPayload.sub,
                patchAdminPasswordDto.currentPassword,
                patchAdminPasswordDto.newPassword,
            ),
        );
    }

    /**
     * Creates a new admin account pending activation and emails the invitation to its owner. Only
     * the ADMIN role can be created over the API — super-admins are minted by the seed script alone.
     *
     * @param postAdminDto The creation payload carrying the email and name
     */
    @Post()
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Create admin',
        description:
            'Creates an admin account pending activation and emails an invitation to its owner. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin account successfully created; the invitation email is on its way.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)
    async create(@Body(NotEmptyBodyPipe) postAdminDto: PostAdminDto) {
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
    async activate(@Body(NotEmptyBodyPipe) postAdminActivateDto: PostAdminActivateDto) {
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
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Re-invite admin',
        description:
            'Emails a fresh activation invitation for a pending admin account. Requires super-administrator authorization.',
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
     * Bans an admin account and revokes all of its active sessions. Super-admins cannot be banned.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Ban admin',
        description:
            'Bans the account and revokes all active sessions. Super admins cannot be banned. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async ban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanAdminCommand(params.id));
    }

    /**
     * Lifts the ban on an admin account. Super-admins cannot be modified.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
    @Roles(AdminRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Unban admin',
        description: 'Lifts the ban on the account. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    @ApiDefaultResourceNotFoundResponse()
    async unban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanAdminCommand(params.id));
    }
}
