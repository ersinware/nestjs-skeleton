import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { TOKEN_ADMINS_REPOSITORY } from 'src/api/v1/admin/constant/admin.constant';
import type { IAdminsRepository } from 'src/api/v1/admin/interface/admins.repository.interface';
import type { IHashingService } from 'src/common/port/security/hashing.service.interface';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

async function seed() {
    console.log('Bootstrapping application context...');
    const app = await NestFactory.createApplicationContext(AppModule);

    const adminsRepo = app.get<IAdminsRepository>(TOKEN_ADMINS_REPOSITORY);
    const hashingService = app.get<IHashingService>(TOKEN_HASHING_SERVICE);

    const email = 'ersin@ersinware.com';
    const password = 'SuperAdminPassword123!';

    console.log('Hashing password...');
    const hashedPassword = await hashingService.hash(password);

    console.log(`Checking if admin ${email} exists...`);
    const existing = await adminsRepo.findByEmail(email);
    if (existing) {
        console.log('Admin already exists!');
    } else {
        console.log('Inserting admin into database...');
        await adminsRepo.create({
            email,
            name: 'Ersinware Admin',
            password: hashedPassword,
            role: AuthUserRole.SUPER_ADMIN,
        });
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
