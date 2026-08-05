/**
 * @file admin.controller.ts
 * @description Exposes HTTP endpoints for managing administrative accounts. This controller is strictly protected and only accessible to super admins, ensuring that critical operations like creating or deactivating administrators remain secure.
 */

import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline, QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
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
 * The controller handling admin management endpoints.
 * Provides routes for creating, deleting, listing, and updating the status of administrative users.
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
export class AdminController {
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
     * Retrieves all admins with pagination capabilities.
     * Useful for displaying a list of administrative users in a back-office dashboard. Requires super administrator-level authorization.
     *
     * @param query The query string parameters used for pagination
     * @returns A paginated response containing a list of administrator profiles
     */
    @Get()
    @ApiOperation({
        summary: 'List all admins',
        description:
            'Retrieves administrator accounts with pagination. Requires super administrator-level authorization.',
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
     * Deletes an admin account from the system.
     * Hard deletion is not performed; instead, it soft deletes the record. Super admins cannot be deleted to prevent locking out the system. Requires super administrator-level authorization.
     *
     * @param params The URL path parameters containing the target admin ID
     */
    @Delete(ROUTE_PARAM_ID)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete admin',
        description: 'Soft deletes an admin account. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin account successfully deleted.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async deleteAdmin(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new DeleteAdminCommand(params.id));
    }

    /**
     * Bans an admin account.
     * All current sessions belonging to the admin are immediately revoked. Super admins cannot be banned. Requires super administrator-level authorization.
     *
     * @param params The URL path parameters containing the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/ban`)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Ban admin',
        description:
            'Bans the account and revokes all active sessions. Super admins cannot be banned. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully banned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async ban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new BanAdminCommand(params.id));
    }

    /**
     * Unbans an admin account.
     * Super admins cannot be modified. Requires super administrator-level authorization.
     *
     * @param params The URL path parameters containing the target admin ID
     */
    @Post(`${ROUTE_PARAM_ID}/unban`)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Unban admin',
        description: 'Lifts the ban on the account. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin successfully unbanned.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async unban(@Param() params: ParamIdDto) {
        await this.commandPipeline.execute(new UnbanAdminCommand(params.id));
    }
}
