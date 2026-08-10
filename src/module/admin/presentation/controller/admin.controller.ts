/**
 * @file admin.controller.ts
 * @description HTTP endpoints for managing admin accounts, restricted to super-admins.
 */

import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline, QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultDependencyUnavailableResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultOkResponsePaginated,
    ApiDefaultResourceNotFoundResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import {
    ParamIdDto,
    QueryPaginationDto,
    RequestValidationMessage,
    ResponsePaginationDto,
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { Roles } from 'src/core/security/auth';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { ListAdminsQuery } from 'src/module/admin/application/query/list-admins/query';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Admin management endpoints: listing, soft-deleting, banning, and unbanning admin accounts.
 * Every route requires the super-admin role.
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
     * Lists admin accounts with pagination.
     *
     * @param query The pagination query parameters
     * @returns The paginated list of admin profiles
     */
    @Get()
    @ApiOperation({
        summary: 'List all admins',
        description: 'Retrieves administrator accounts with pagination. Requires super-administrator authorization.',
    })
    @ApiDefaultOkResponsePaginated({ message: 'Admins successfully retrieved.', model: ResponseAdminDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    async findAll(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<ResponseAdminDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListAdminsQuery(query));

        return new ResponsePaginationDto<ResponseAdminDto>(
            plainToInstance(ResponseAdminDto, data),
            total,
            query.page,
            query.limit,
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
