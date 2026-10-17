import type { StorageBucket } from './contracts.ts';
import { ApiError } from '../errors.ts';
import { requireId } from '../modules/policy.ts';
import { validateFileBytes, MAX_UPLOAD_BYTES } from '../modules/uploads.ts';

export function createCoverReader(bucket: StorageBucket) {
  return { async read(ownerId: string, fileName: string) {
    requireId(ownerId, 'owner ID');
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(fileName) || fileName === '.' || fileName === '..') throw new ApiError(422, 'upload/invalid-name', 'Invalid cover name.');
    try {
      const file = bucket.file(`stores/${ownerId}/public/${fileName}`);
      const [meta] = await file.getMetadata();
      if (Number(meta.size) < 1 || Number(meta.size) > MAX_UPLOAD_BYTES) throw new Error();
      const [data] = await file.download({ validation: 'crc32c' });
      const contentType = String(meta.contentType || '');
      validateFileBytes(fileName, contentType, data, 'cover');
      return { data, contentType };
    } catch { throw new ApiError(404, 'cover/not-found', 'Cover not found.'); }
  } };
}
