import { StorageClient } from '@supabase/storage-js';
import type { SupabaseStagingConfiguration } from '../config/storage.ts';
import { validateSupabaseSecret } from '../config/storage.ts';
import { ApiError } from '../errors.ts';
import { MAX_UPLOAD_BYTES, SUPPORTED_UPLOAD_MIME_TYPES, validateFileBytes } from '../modules/uploads.ts';
import type { ObjectMetadata, StorageBucket } from './contracts.ts';

function validatePath(path: string) {
  if (typeof path !== 'string' || path.length > 500 ||
      !/^(deliverables\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}|stores\/[A-Za-z0-9_-]{1,128}\/public)\/[A-Za-z0-9._-]{1,180}$/.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')) {
    throw new ApiError(422, 'storage/invalid-path', 'Invalid owner-scoped object path.');
  }
}

// All upstream errors are replaced at this boundary. Neither SDK errors nor
// credential-bearing request objects may escape to logs, JSON or Firestore.
const unavailable = () => new ApiError(503, 'storage/unavailable', 'Private staging storage is temporarily unavailable.');

export function createSupabaseStorageBucket(
  config: SupabaseStagingConfiguration,
  secretKey: string,
  fetcher: typeof fetch = fetch,
): StorageBucket & { checkReady(): Promise<void> } {
  validateSupabaseSecret(secretKey, config.projectRef);
  const safeFetch: typeof fetch = (input, init) => {
    if (new URL(String(input)).origin !== config.url) throw unavailable();
    return fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
  };
  const storage = new StorageClient(`${config.url}/storage/v1`, {
    apikey: secretKey, Authorization: `Bearer ${secretKey}`,
  }, safeFetch);
  const objects = storage.from(config.bucket);
  async function checkReady() {
    try {
      const { data, error } = await storage.getBucket(config.bucket);
      if (error || !data || data.id !== config.bucket || data.public !== false ||
          data.file_size_limit != null && (!Number.isSafeInteger(Number(data.file_size_limit)) || Number(data.file_size_limit) < MAX_UPLOAD_BYTES) ||
          data.allowed_mime_types != null && SUPPORTED_UPLOAD_MIME_TYPES.some(mime =>
            !data.allowed_mime_types!.some(allowed => allowed === '*/*' || allowed === mime || allowed === mime.split('/')[0] + '/*'))) throw unavailable();
    } catch { throw unavailable(); }
  }
  async function metadata(path: string): Promise<ObjectMetadata> {
    const { data, error } = await objects.info(path);
    if (error || !data || !Number.isSafeInteger(Number(data.size)) || Number(data.size) < 1 ||
        Number(data.size) > MAX_UPLOAD_BYTES || !data.contentType || !data.version) throw unavailable();
    return { size: data.size, contentType: data.contentType, generation: data.version };
  }
  return {
    binding: { provider: 'supabase', bucket: config.bucket },
    checkReady,
    file(path) {
      validatePath(path);
      return {
        async save(data, options) {
          validateFileBytes(path.split('/').at(-1)!, options.metadata.contentType, data,
            path.startsWith('deliverables/') ? 'product' : 'cover');
          if (options.preconditionOpts?.ifGenerationMatch !== 0) throw new ApiError(422, 'storage/overwrite-refused', 'Object overwrites are disabled.');
          await checkReady();
          try {
            const { data: saved, error } = await objects.upload(path, data, {
              contentType: options.metadata.contentType, cacheControl: '0', upsert: false,
            });
            if (error && ['409', '400'].includes(String((error as { statusCode?: string }).statusCode)) &&
                /duplicate|already.?exists/i.test(error.message)) {
              throw new ApiError(409, 'storage/object-exists', 'Object already exists; no replacement was made.');
            }
            if (error || !saved || saved.path !== path) throw unavailable();
            // Await a separate durable object-info read before publishing any reference.
            const info = await metadata(path);
            if (Number(info.size) !== data.length || info.contentType !== options.metadata.contentType) throw unavailable();
          } catch (error) {
            if (error instanceof ApiError && error.code === 'storage/object-exists') throw error;
            throw unavailable();
          }
        },
        async getMetadata() {
          await checkReady();
          try { return [await metadata(path)]; } catch { throw unavailable(); }
        },
        async download() {
          await checkReady();
          try {
            const before = await metadata(path);
            const { data, error } = await objects.download(path).asStream();
            if (error || !data) throw unavailable();
            const reader = data.getReader();
            const chunks: Buffer[] = [];
            let length = 0;
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                length += part.value.length;
                if (length > MAX_UPLOAD_BYTES || length > Number(before.size)) {
                  await reader.cancel(); throw unavailable();
                }
                chunks.push(Buffer.from(part.value));
              }
            } finally { reader.releaseLock(); }
            if (length !== Number(before.size)) throw unavailable();
            const bytes = Buffer.concat(chunks, length);
            const after = await metadata(path);
            if (after.generation !== before.generation || after.size !== before.size) throw unavailable();
            validateFileBytes(path.split('/').at(-1)!, String(before.contentType), bytes,
              path.startsWith('deliverables/') ? 'product' : 'cover');
            return [bytes];
          } catch { throw unavailable(); }
        },
        async delete() {
          await checkReady();
          try {
            const { error } = await objects.remove([path]);
            if (error) throw unavailable();
          } catch { throw unavailable(); }
        },
      };
    },
  };
}
