/**
 * @file job-queue-migration.ts
 * @description Deployment composition root selecting the producers whose queues are provisioned.
 */

import { createDeliveryTopology } from 'src/core/event-bus';
import { migrateJobQueues } from 'src/core/job-queue';
import { ADMIN_DELIVERY_ROUTES } from 'src/module/admin/infrastructure/admin-delivery.constant';
import { AUTH_DELIVERY_ROUTES } from 'src/module/auth/infrastructure/auth-delivery.constant';
import { USER_DELIVERY_ROUTES } from 'src/module/user/infrastructure/user-delivery.constant';

void migrateJobQueues([USER_DELIVERY_ROUTES, ADMIN_DELIVERY_ROUTES, AUTH_DELIVERY_ROUTES].map(createDeliveryTopology));
