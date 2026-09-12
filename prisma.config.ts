import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({schema:'backend/prisma/schema.prisma',migrations:{path:'backend/prisma/migrations'},datasource:{url:process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || ''}});
