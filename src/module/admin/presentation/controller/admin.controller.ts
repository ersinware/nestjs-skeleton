/**
 * @file admin.controller.ts
 * @description Exposes HTTP endpoints for managing administrative accounts. This controller is strictly protected and only accessible to super admins, ensuring that critical operations like creating or deactivating administrators remain secure.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultResourceNotFoundResponse,
    ApiDefaultTooManyRequestsResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import { InvalidRequestType } from 'src/core/exception';
import { NotEmptyBodyPipe, ParamIdDto, QueryPaginationDto, ResponsePaginationDto } from 'src/core/http';
import { Roles } from 'src/core/security';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin';
import { UpdateAdminStatusCommand } from 'src/module/admin/application/command/update-admin-status';
import { ListAdminsQuery, type ListAdminsResult } from 'src/module/admin/application/query/list-admins';
import { PatchAdminStatusDto } from 'src/module/admin/presentation/dto/patch-admin-status.dto';
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
@ApiDefaultTooManyRequestsResponse()
export class AdminController {
    /**
     * Initializes the controller with the command and query buses.
     *
     * @param commandBus The CQRS command bus
     * @param queryBus The CQRS query bus
     */
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus,
    ) {}

    /**
     * Retrieves all admins with pagination capabilities.
     * Useful for displaying a list of administrative users in a back-office dashboard. Requires super administrator-level authorization.
     *
     * @param query The query string parameters used for pagination
     * @returns A paginated response containing a list of administrator profiles
     */
    @Get()
    @ApiOperation({ summary: 'List all admins' })
    @ApiResponse({ status: HttpStatus.OK, description: 'List of admins retrieved successfully' })
    @ApiDefaultInvalidRequestResponse(InvalidRequestType.PARAM)
    async findAll(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<ResponseAdminDto>> {
        const { data, total } = await this.queryBus.execute<ListAdminsQuery, ListAdminsResult>(
            new ListAdminsQuery(query),
        );

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
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete admin',
        description: 'Soft deletes an admin account. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin account successfully deleted.' })
    @ApiDefaultInvalidRequestResponse(InvalidRequestType.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async deleteAdmin(@Param() params: ParamIdDto) {
        await this.commandBus.execute<DeleteAdminCommand, void>(new DeleteAdminCommand(params.id));
    }

    /**
     * Updates the active status of an admin account (e.g., active or inactive).
     * If deactivated, all current sessions belonging to the admin are immediately revoked. Super admins cannot be deactivated. Requires super administrator-level authorization.
     *
     * @param params The URL path parameters containing the target admin ID
     * @param dto The payload specifying the new active state
     */
    @Patch(':id/status')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Update admin status',
        description:
            'Updates active status and revokes sessions if deactivated. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin status successfully updated.' })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultResourceNotFoundResponse()
    async updateStatus(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) dto: PatchAdminStatusDto) {
        await this.commandBus.execute<UpdateAdminStatusCommand, void>(
            new UpdateAdminStatusCommand(params.id, dto.active),
        );
    }
}
