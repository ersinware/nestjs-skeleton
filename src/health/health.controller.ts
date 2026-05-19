import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthyDto } from './dto/healthy.dto';
import { UnhealthyDto } from './dto/unhealthy.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller({
    path: 'health',
    version: VERSION_NEUTRAL,
})
export class HealthController {
    constructor(private readonly healthService: HealthService) {}

    @Get()
    @ApiOperation({
        summary: 'Health check endpoint.',
        description: 'Returns the health status of the API service.',
    })
    @ApiOkResponse({
        description: 'The service is fully healthy.',
        type: HealthyDto,
    })
    @ApiServiceUnavailableResponse({
        description: 'The service or one of its dependencies is unhealthy.',
        type: UnhealthyDto,
    })
    check() {
        return this.healthService.check();
    }
}
