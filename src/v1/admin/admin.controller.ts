/**
 * @file admin.controller.ts
 * @description Controller handling administrative user actions and account creation.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ApiDefaultBadRequestResponse } from 'src/common/decorator/doc/api-default-bad-request-response.decorator';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ApiDefaultConflictResponse } from 'src/common/decorator/doc/api-default-conflict-response.decorator';
import { ApiDefaultForbiddenResponse } from 'src/common/decorator/doc/api-default-forbidden-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/decorator/doc/api-default-internal-server-error-response.decorator';
import { ApiDefaultNotFoundResponse } from 'src/common/decorator/doc/api-default-not-found-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/decorator/doc/api-default-unauthorized-response.decorator';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { Roles } from 'src/common/decorator/auth/roles.decorator';
import { ParamIdDto } from 'src/common/dto/param-id.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { NotEmptyBodyPipe } from 'src/common/pipe/not-empty-body.pipe';
import { AdminService } from './admin.service';
import { GetCreatedAdminDto } from './dto/get-created-admin.dto';
import { PatchAdminStatusDto } from './dto/patch-admin-status.dto';
import { PostAdminDto } from './dto/post-admin.dto';
import { GetAdminDto } from './dto/get-admin.dto';

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
     * Get all admins. Requires super administrator-level authorization.
     *
     * @returns A promise resolving to an array of admin profiles.
     */
    @Get()
    @ApiOperation({
        summary: 'Get all admins',
        description:
            'Retrieves all registered administrative accounts. Requires super administrator-level authorization.',
    })
    @ApiOkResponse({ description: 'Admins successfully retrieved.', type: GetAdminDto, isArray: true })
    async findAll(): Promise<GetAdminDto[]> {
        return plainToInstance(GetAdminDto, await this.adminService.findAll());
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
