/**
 * @file admin.controller.ts
 * @description Exposes HTTP endpoints for managing administrative accounts. This controller is strictly protected and only accessible to super admins, ensuring that critical operations like creating or deactivating administrators remain secure.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/common/routing/constant/version.constant';
import { ApiDefaultBadRequestResponse } from 'src/common/doc/decorator/api-default-bad-request-response.decorator';
import { ApiDefaultConflictResponse } from 'src/common/doc/decorator/api-default-conflict-response.decorator';
import { ApiDefaultForbiddenResponse } from 'src/common/doc/decorator/api-default-forbidden-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/doc/decorator/api-default-internal-server-error-response.decorator';
import { ApiDefaultNotFoundResponse } from 'src/common/doc/decorator/api-default-not-found-response.decorator';
import { ApiDefaultOkResponsePaginated } from 'src/common/doc/decorator/api-default-ok-response-paginated.decorator';
import { ApiDefaultTooManyRequestsResponse } from 'src/common/doc/decorator/api-default-too-many-requests-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/doc/decorator/api-default-unauthorized-response.decorator';
import { ParamIdDto } from 'src/common/validation/dto/param-id.dto';
import { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';
import { ResponsePaginationDto } from 'src/common/pagination/dto/response-pagination.dto';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { BadRequestType } from 'src/common/exception/enum/bad-request-type.enum';
import { ConflictType } from 'src/common/exception/enum/conflict-type.enum';
import { NotEmptyBodyPipe } from 'src/common/validation/pipe/not-empty-body.pipe';
import { Roles } from 'src/common/auth/decorator/roles.decorator';
import { AdminService } from './admin.service';
import { PatchAdminStatusDto } from './dto/patch-admin-status.dto';
import { PostAdminDto } from './dto/post-admin.dto';
import { ResponseAdminDto } from './dto/response-admin.dto';
import { ResponseCreatedAdminDto } from './dto/response-created-admin.dto';

/**
 * The controller handling admin management endpoints.
 * Provides routes for creating, deleting, listing, and updating the status of administrative users.
 */
@Controller({
    path: 'admin',
    version: VERSION_1,
})
@Roles(AuthUserRole.SUPER_ADMIN)
@ApiTags('admin')
@ApiBearerAuth()
@ApiDefaultUnauthorizedResponse()
@ApiDefaultForbiddenResponse()
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultTooManyRequestsResponse()
export class AdminController {
    /**
     * Injects the admin service to execute administrative business logic.
     *
     * @param adminService The service handling admin operations such as creation and deletion
     */
    constructor(private readonly adminService: AdminService) {}

    /**
     * Creates a new admin account.
     * Automatically generates a temporary secure password and sends it to the newly created administrator via email. This endpoint is strictly restricted to super administrator-level authorization.
     *
     * @param dto The payload containing new admin account details
     * @returns The created admin profile details
     */
    @Post()
    @ApiOperation({
        summary: 'Register admin',
        description:
            "Creates a new admin account. A temporary secure password is automatically generated and sent to the registered admin's email address. Requires super administrator-level authorization.",
    })
    @ApiCreatedResponse({
        description: 'Admin account successfully created. Welcome email with generated credentials has been sent.',
        type: ResponseCreatedAdminDto,
    })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultConflictResponse(ConflictType.EMAIL_IN_USE)
    async createAdmin(@Body(NotEmptyBodyPipe) dto: PostAdminDto): Promise<ResponseCreatedAdminDto> {
        return plainToInstance(ResponseCreatedAdminDto, await this.adminService.create(dto));
    }

    /**
     * Retrieves all admins with pagination capabilities.
     * Useful for displaying a list of administrative users in a back-office dashboard. Requires super administrator-level authorization.
     *
     * @param query The query string parameters used for pagination
     * @returns A paginated response containing a list of administrator profiles
     */
    @Get()
    @ApiOperation({
        summary: 'Get all admins',
        description:
            'Retrieves registered administrative accounts with pagination. Requires super administrator-level authorization.',
    })
    @ApiDefaultOkResponsePaginated({ description: 'Admins successfully retrieved.', type: ResponseAdminDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    async findAll(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<ResponseAdminDto>> {
        const { data, total } = await this.adminService.findAll(query);

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
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    @ApiDefaultNotFoundResponse()
    async deleteAdmin(@Param() params: ParamIdDto) {
        await this.adminService.delete(params.id);
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
    @ApiDefaultBadRequestResponse()
    @ApiDefaultNotFoundResponse()
    async updateStatus(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) dto: PatchAdminStatusDto) {
        await this.adminService.updateStatus(params.id, dto.active);
    }
}
