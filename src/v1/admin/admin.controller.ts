/**
 * @file admin.controller.ts
 * @description Controller handling administrative user actions and account creation.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { Roles } from 'src/common/decorator/auth/roles.decorator';
import { ApiDefaultBadRequestResponse } from 'src/common/decorator/doc/api-default-bad-request-response.decorator';
import { ApiDefaultConflictResponse } from 'src/common/decorator/doc/api-default-conflict-response.decorator';
import { ApiDefaultForbiddenResponse } from 'src/common/decorator/doc/api-default-forbidden-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/decorator/doc/api-default-internal-server-error-response.decorator';
import { ApiDefaultNotFoundResponse } from 'src/common/decorator/doc/api-default-not-found-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/decorator/doc/api-default-unauthorized-response.decorator';
import { ApiDefaultOkResponsePaginated } from 'src/common/decorator/doc/api-default-ok-response-paginated.decorator';
import { ParamIdDto } from 'src/common/dto/param-id.dto';
import { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import { ResponsePaginationDto } from 'src/common/dto/response-pagination.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { NotEmptyBodyPipe } from 'src/common/pipe/not-empty-body.pipe';
import { AdminService } from './admin.service';
import { GetAdminDto } from './dto/get-admin.dto';
import { GetCreatedAdminDto } from './dto/get-created-admin.dto';
import { PatchAdminStatusDto } from './dto/patch-admin-status.dto';
import { PostAdminDto } from './dto/post-admin.dto';

/**
 * Controller handling admin management endpoints.
 */
@Controller({
    path: 'admin',
    version: '1',
})
@Roles(AuthUserRole.SUPER_ADMIN)
@ApiTags('admin')
@ApiBearerAuth()
@ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
@ApiDefaultForbiddenResponse()
@ApiDefaultInternalServerErrorResponse()
export class AdminController {
    /**
     * Creates an instance of AdminController.
     *
     * @param adminService Administrative business logic service.
     */
    constructor(private readonly adminService: AdminService) {}

    /**
     * Create a new admin account. Requires super administrator-level authorization.
     *
     * @param dto New admin account details payload.
     * @returns The created admin profile details.
     */
    @Post()
    @ApiOperation({
        summary: 'Register admin',
        description: 'Creates a new admin account Requires super administrator-level authorization.',
    })
    @ApiCreatedResponse({ description: 'Admin account successfully created.', type: GetCreatedAdminDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultConflictResponse()
    async createAdmin(@Body(NotEmptyBodyPipe) dto: PostAdminDto): Promise<GetCreatedAdminDto> {
        return plainToInstance(GetCreatedAdminDto, await this.adminService.create(dto));
    }

    /**
     * Get all admins with pagination. Requires super administrator-level authorization.
     *
     * @param query The query pagination parameters.
     * @returns A promise resolving to a paginated response of GetAdminDto.
     */
    @Get()
    @ApiOperation({
        summary: 'Get all admins',
        description:
            'Retrieves registered administrative accounts with pagination. Requires super administrator-level authorization.',
    })
    @ApiDefaultOkResponsePaginated({ description: 'Admins successfully retrieved.', type: GetAdminDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    async findAll(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<GetAdminDto>> {
        const { data, total } = await this.adminService.findAll(query);

        return new ResponsePaginationDto<GetAdminDto>(
            plainToInstance(GetAdminDto, data),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Delete an admin account. Super admins cannot be deleted. Requires super administrator-level authorization.
     *
     * @param params URL path parameters containing the admin ID.
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
     * Update an admin account status (active/inactive). Super admins cannot be deactivated. Requires super administrator-level authorization.
     *
     * @param params URL path parameters containing the admin ID.
     * @param dto Admin status update payload.
     */
    @Patch(':id/status')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Update admin status',
        description:
            'Updates active status and revokes sessions if deactivated. Requires super administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'Admin status successfully updated.' })
    @ApiDefaultBadRequestResponse(BadRequestType.BOTH)
    @ApiDefaultNotFoundResponse()
    async updateStatus(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) dto: PatchAdminStatusDto) {
        await this.adminService.updateStatus(params.id, dto.active);
    }
}
