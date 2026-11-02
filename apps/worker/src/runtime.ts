import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

export const db = new PrismaClient({ adapter: new PrismaPg({connectionString:process.env.DATABASE_URL}), log: ['error'] });
if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for the worker.');
export const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
export const jobOptions = { attempts: 5, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: { age: 604800 }, removeOnFail: { age: 604800 } };
export const syncQueue = new Queue('trusteo-sync', { connection: redis });
export const notificationQueue = new Queue('trusteo-notifications', { connection: redis });
export const deliveryQueue = new Queue('trusteo-delivery', { connection: redis });
