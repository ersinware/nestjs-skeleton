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
    NotEmptyBodyPipe,
    ParamIdDto,
    QuerySearchDto,
    RequestValidationMessage,
    ResponsePaginationDto,
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { CurrentAccessTokenPayload, Roles } from 'src/core/security/auth';
import type { AccessTokenPayload } from 'src/core/security/token';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import { ChangeAdminPasswordCommand } from 'src/module/admin/application/command/change-admin-password/command';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { GetAdminByIdQuery } from 'src/module/admin/application/query/get-admin-by-id/query';
import { ListAdminsQuery } from 'src/module/admin/application/query/list-admins/query';
import { PatchAdminPasswordDto } from 'src/module/admin/presentation/dto/patch-admin-password.dto';
import { PatchAdminDto } from 'src/module/admin/presentation/dto/patch-admin.dto';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { AdminRole } from 'src/shared/domain/admin';
import { ADMIN_ROLES } from 'src/shared/domain/auth-role';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * Admin management endpoints: listing, soft-deleting, banning, and unbanning admin accounts, plus
 * self-scoped profile routes (`me`). Every route requires the super-admin role, except the `me`
 * routes, which any administrator may call on their own account.
 */
@Controller({
    path: 'admin',
    version: VERSION_1,
})
@Roles(AdminRole.SUPER_ADMIN)
@ApiTags('admin')
@ApiBearerAuth()
@ApiDefaultUnauthenticatedResponse()
@ApiDefaultAccessDeniedResponse()
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
     * Lists admin accounts with pagination and optional search.
     *
     * @param query The pagination and search query parameters
     * @returns The paginated list of admin profiles
     */
    @Get()
    @Audited(AuditAction.PERSONAL_DATA_ACCESSED)
    @ApiOperation({
        summary: 'List all admins',
        description:
            'Retrieves administrator accounts with pagination and optional search. Requires super-administrator authorization.',
    })
    @ApiDefaultOkResponsePaginated({ message: 'Admins successfully retrieved.', model: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
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
    @ApiOperation({
        summary: 'Get current admin profile',
        description: 'Retrieves profile details of the currently authenticated admin.',
    })
    @ApiOkResponse({ description: 'Admin details successfully retrieved.', type: ResponseAdminDto })
    @ApiDefaultResourceNotFoundResponse()
    async findMe(@CurrentAccessTokenPayload() accessTokenPayload: AccessTokenPayload): Promise<ResponseAdminDto> {
        return plainToInstance(
            ResponseAdminDto,
            await this.queryPipeline.execute(new GetAdminByIdQuery(accessTokenPayload.sub)),
        );
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
    @ApiOperation({
        summary: 'Update current admin profile',
        description: "Updates details of the currently authenticated admin's profile.",
    })
    @ApiOkResponse({ description: 'Admin successfully updated.', type: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
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
    @ApiOperation({
        summary: 'Change current admin password',
        description: "Updates the currently authenticated admin's password and revokes all active sessions.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    // Generic 400 on purpose: payload validation, a wrong current password, and password reuse all
    // share the status, so naming one cause would document the endpoint as if the others did not exist.
    @ApiDefaultInvalidRequestResponse()
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
     * Soft-deletes an admin account. Super-admins cannot be deleted, so the system can never lock
     * itself out.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Delete(ROUTE_PARAM_ID)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete admin',
        description: 'Soft deletes an admin account. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin account successfully deleted.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async deleteAdmin(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new DeleteAdminCommand(params.id));
    }

    /**
     * Bans an admin account and revokes all of its active sessions. Super-admins cannot be banned.
     *
     * @param params The path parameters carrying the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Ban admin',
        description:
            'Bans the account and revokes all active sessions. Super admins cannot be banned. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
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
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Unban admin',
        description: 'Lifts the ban on the account. Requires super-administrator authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async unban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanAdminCommand(params.id));
    }
}
