import './env';
import { execSync } from 'child_process';

export default async function globalSetup() {
  // make sure Redis db 15 starts clean for the whole e2e run
  execSync('redis-cli -n 15 flushdb', { stdio: 'ignore' });
}
