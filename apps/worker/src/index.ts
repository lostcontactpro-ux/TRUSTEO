import { Worker } from 'bullmq';
import { ProviderError } from '@trusteo/core/providers/index';
import { db, deliveryQueue, notificationQueue, redis, syncQueue } from './runtime';
import { deliverRecipient, dispatch, notifyReview, syncConnection } from './jobs';

// Fail before accepting jobs when migrations or connectivity are missing.
await db.providerConnection.findFirst({ select: { id: true } });
await redis.ping();

const workers = [
  new Worker('trusteo-sync', async job => {
    if (job.name === 'dispatch') return dispatch();
    if (job.name === 'sync-connection' && typeof job.data.connectionId === 'string') return syncConnection(job.data.connectionId);
    throw new Error('unknown_sync_job');
  }, { connection: redis, concurrency: 3, limiter: { max: 10, duration: 1000 }, settings: { backoffStrategy: (attemptsMade, _type, error) => {
    const quotaDelay = error instanceof ProviderError ? (error.retryAfterSeconds ?? 0) * 1000 : 0;
    return Math.max(10000 * 2 ** Math.max(0, attemptsMade - 1), quotaDelay);
  } } }),
  new Worker('trusteo-notifications', async job => {
    if (job.name !== 'new-review' || typeof job.data.reviewId !== 'string') throw new Error('unknown_notification_job');
    return notifyReview(job.data.reviewId);
  }, { connection: redis, concurrency: 3, limiter: { max: 2, duration: 1000 } }),
  new Worker('trusteo-delivery', async job => {
    if (job.name !== 'campaign-recipient' || typeof job.data.recipientId !== 'string') throw new Error('unknown_delivery_job');
    return deliverRecipient(job.data.recipientId);
  }, { connection: redis, concurrency: 2, limiter: { max: 2, duration: 1000 } }),
];
for (const worker of workers) {
  worker.on('failed', job => console.error('Job failed', worker.name, job?.id));
  worker.on('error', () => console.error('Worker connection error', worker.name));
}
await syncQueue.upsertJobScheduler('poll-every-10-minutes', { every: 600_000 }, { name: 'dispatch', data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 10000 } } });
await dispatch();
await Promise.all(workers.map(worker => worker.waitUntilReady()));
console.log('Trusteo worker ready: reviews, notifications, campaigns.');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await Promise.all(workers.map(worker => worker.close()));
  await Promise.all([syncQueue.close(), notificationQueue.close(), deliveryQueue.close()]);
  await redis.quit(); await db.$disconnect();
}
process.on('SIGTERM', () => { void stop().catch(() => process.exitCode = 1); });
process.on('SIGINT', () => { void stop().catch(() => process.exitCode = 1); });
