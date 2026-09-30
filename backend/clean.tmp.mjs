import { Queue } from 'bullmq';
import IORedis from 'ioredis';
const c = new IORedis('redis://localhost:6379/0', { maxRetriesPerRequest: null });
const q = new Queue('scheduler', { connection: c });
await q.clean(0, 10000, 'failed');
console.log('failed after clean', await q.getFailedCount());
process.exit(0);
