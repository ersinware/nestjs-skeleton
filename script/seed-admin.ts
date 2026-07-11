/**
 * @file seed-admin.ts
 * @description Bootstrap script to create an initial super admin user in the database.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { type IHashingPort, TOKEN_HASHING_PORT } from 'src/core/security';
import { type IAdminWriterPort, TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port';
import {
    type IGetAdminCredentialsByEmailPort,
    TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';
import { Admin } from 'src/module/admin/domain/aggregate';
import { AdminRole } from 'src/shared/domain/admin';
import { uuidv7 } from 'uuidv7';

async function seed() {
    console.log('Bootstrapping application context...');
    const app = await NestFactory.createApplicationContext(AppModule);

    const adminsRepo = app.get<IAdminWriterPort>(TOKEN_ADMIN_WRITER_PORT);
    const adminsReader = app.get<IGetAdminCredentialsByEmailPort>(TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT);
    const hashingPort = app.get<IHashingPort>(TOKEN_HASHING_PORT);

    const email = 'ersin@ersinware.com';
    const password = 'SuperAdminPassword123!';

    console.log('Hashing password...');
    const hashedPassword = await hashingPort.hash(password);

    console.log(`Checking if admin ${email} exists...`);
    const existing = await adminsReader.getCredentialsByEmail(email);
    if (existing) {
        console.log('Admin already exists!');
    } else {
        console.log('Inserting admin into database...');
        const seedAdmin = Admin.create(uuidv7(), {
            email,
            name: 'Ersinware Admin',
            role: AdminRole.SUPER_ADMIN,
            password: hashedPassword,
        });
        await adminsRepo.save(seedAdmin);
        console.log('\n--- SUPER ADMIN CREDENTIALS ---');
        console.log(`Email:    ${email}`);
        console.log(`Password: ${password}`);
        console.log('-------------------------------\n');
    }

    await app.close();
    process.exit(0);
}

seed()
    .then(() => {
        console.log('Seed completed successfully!');
    })
    .catch((error) => {
        console.error('Seed failed:', error);
    });
