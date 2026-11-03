import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export default defineConfig({
  schema:'prisma/schema.prisma',
  migrations:{path:'prisma/migrations'},
  experimental:{adapter:true},
  engine:'js',
  adapter:async()=>new PrismaPg({connectionString:process.env.DATABASE_URL}),
});
