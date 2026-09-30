import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../../config/config';

export abstract class StorageProvider {
  abstract put(prefix: string, data: Buffer, contentType: string): Promise<string>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const ALLOWED_UPLOAD_TYPES = Object.keys(EXT);

/** Magic-number sniffing so a renamed executable cannot pass as an image. */
export function sniffContentType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

/** Local-disk storage for development. Keys are random, never derived from user input. */
@Injectable()
export class LocalDiskStorage extends StorageProvider {
  private readonly root = path.resolve(config().STORAGE_DIR);

  async put(prefix: string, data: Buffer, contentType: string): Promise<string> {
    const safePrefix = prefix.replace(/[^a-z0-9/_-]/gi, '');
    const key = `${safePrefix}/${randomUUID()}.${EXT[contentType] ?? 'bin'}`;
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, { mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return file;
  }
}
