import { ApiError } from '../errors.ts';

// Only the object operations used by V2. Firebase Bucket satisfies this interface;
// provider credentials and public/signed URL creation are deliberately absent.
export interface ObjectMetadata {
  size?: number | string;
  contentType?: string;
  generation?: number | string;
  metadata?: Record<string, unknown>;
}
export interface ObjectSaveOptions {
  resumable?: boolean;
  validation?: 'crc32c';
  preconditionOpts: { ifGenerationMatch: number };
  metadata: { contentType: string; cacheControl?: string };
}
export interface StorageObject {
  save(data: Buffer, options: ObjectSaveOptions): Promise<unknown>;
  getMetadata(): Promise<[ObjectMetadata, ...unknown[]]>;
  download(options?: { validation?: 'crc32c' }): Promise<[Buffer, ...unknown[]]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
}
export interface StorageBucket {
  file(path: string): StorageObject;
  binding?: { provider: 'supabase'; bucket: string };
}

export function storageBinding(bucket: StorageBucket) {
  return bucket.binding ? { storageProvider: bucket.binding.provider, storageBucket: bucket.binding.bucket } : {};
}

export function assertStorageBinding(record: Record<string, any>, bucket: StorageBucket) {
  // Untagged legacy records always mean Firebase. A provider switch must never
  // reinterpret an existing reference or delete an object in the wrong bucket.
  if ((record.storageProvider || 'firebase') !== (bucket.binding?.provider || 'firebase') ||
      bucket.binding && record.storageBucket !== bucket.binding.bucket) {
    throw new ApiError(409, 'storage/provider-mismatch', 'Stored file belongs to another storage configuration.');
  }
}
