import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { Principal, UploadRepository } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { assertOwnedActive, requireId } from './policy.ts';

// Matches the current V1, browser and Storage-rules limit: 5 MiB, not 450 KB.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const digital = new Map([
  ['pdf', 'application/pdf'], ['epub', 'application/epub+zip'], ['zip', 'application/zip'], ['txt', 'text/plain'],
  ['doc', 'application/msword'], ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);
const images = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif']]);
export function validateFileMetadata(name: string, mime: string, bytes: number, kind: 'product' | 'cover') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (!name || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name) ||
      !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_UPLOAD_BYTES ||
      (kind === 'product' ? digital : images).get(ext) !== mime) throw new ApiError(422, 'upload/invalid-file', 'File name, type or size is invalid (maximum 5 MiB).');
}
export function validateFileBytes(name: string, mime: string, data: Buffer, kind: 'product' | 'cover') {
  if (!Buffer.isBuffer(data)) throw new ApiError(422, 'upload/invalid-file', 'Upload original binary file bytes.');
  validateFileMetadata(name, mime, data.length, kind);
  const starts = (hex: string) => data.subarray(0, hex.length / 2).toString('hex') === hex;
  let valid = false;
  if (mime === 'application/pdf') valid = data.subarray(0, 5).toString() === '%PDF-';
  if (['application/zip', 'application/epub+zip', digital.get('docx')].includes(mime)) valid = starts('504b0304');
  if (mime === 'application/msword') valid = starts('d0cf11e0a1b11ae1');
  if (mime === 'text/plain') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(data); valid = !data.includes(0); } catch { valid = false; }
  }
  if (mime === 'image/png') valid = starts('89504e470d0a1a0a');
  if (mime === 'image/jpeg') valid = starts('ffd8ff');
  if (mime === 'image/gif') valid = ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString());
  if (mime === 'image/webp') valid = data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new ApiError(422, 'upload/content-mismatch', 'File content does not match its declared type.');
}
export function privateObjectPath(reference: string, uid: string, productId: string) {
  const prefix = `storage://deliverables/${uid}/${productId}/`;
  if (!reference.startsWith(prefix) || !/^[A-Za-z0-9._-]{1,180}$/.test(reference.slice(prefix.length))) throw new ApiError(422, 'upload/invalid-reference', 'Original file is outside the seller/product namespace.');
  return reference.slice('storage://'.length);
}
export function createFirebaseUploadRepository(db: Firestore, bucket: Pick<Bucket, 'file'>): UploadRepository {
  return {
    async save(principal, input) {
      const { productId, storeId, fileName, contentType, data, kind } = input;
      requireId(productId, 'product ID'); requireId(storeId, 'store ID');
      validateFileBytes(fileName, contentType, data, kind);
      const id = randomUUID();
      const basename = id + '-' + fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      const objectPath = kind === 'product' ? `deliverables/${principal.uid}/${productId}/${basename}` : `stores/${principal.uid}/public/${basename}`;
      const ref = db.collection('products').doc(productId);
      const jobRef = db.collection('v2_upload_jobs').doc(id);
      // Reserve the product ID before bytes are uploaded, preventing cross-owner races.
      // A durable job always names the object so crash cleanup can find it.
      await db.runTransaction(async tx => {
        const store = await tx.get(db.collection('stores').doc(storeId));
        const existing = await tx.get(ref);
        assertOwnedActive(store.exists ? store.data() : undefined, principal);
        if (existing.exists && (existing.get('ownerId') !== principal.uid || existing.get('storeId') !== storeId)) throw new ApiError(403, 'product/owner-forbidden', 'Product belongs to another seller.');
        if (existing.get('deleted') === true) throw new ApiError(410, 'product/deleted', 'Product was deleted.');
        if (existing.get('pendingUpload')) throw new ApiError(409, 'upload/in-progress', 'Another upload is pending. Retry after cleanup if it was interrupted.');
        tx.set(ref, { ownerId: principal.uid, storeId, pendingUpload: id,
          ...(!existing.exists ? { published: false, status: 'Draft', createdAt: new Date() } : {}), updatedAt: new Date() }, { merge: true });
        tx.create(jobRef, { ownerId: principal.uid, storeId, productId, kind, objectPath, state: 'pending', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) });
      });
      const object = bucket.file(objectPath);
      try {
        await object.save(data, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType, cacheControl: kind === 'product' ? 'private, no-store' : 'public, max-age=3600' } });
        const [metadata] = await object.getMetadata();
        if (Number(metadata.size) !== data.length || metadata.contentType !== contentType || !metadata.generation || metadata.metadata?.firebaseStorageDownloadTokens) throw new ApiError(503, 'storage/verification-failed', 'Stored file could not be verified.');
        await db.runTransaction(async tx => {
          const store = await tx.get(db.collection('stores').doc(storeId));
          const product = await tx.get(ref);
          const deliverableRef = ref.collection('deliverables').doc('main');
          const previous = kind === 'product' ? await tx.get(deliverableRef) : null;
          assertOwnedActive(store.exists ? store.data() : undefined, principal);
          if (product.get('ownerId') !== principal.uid || product.get('pendingUpload') !== id || product.get('deleted') === true) throw new ApiError(409, 'upload/reservation-lost', 'Upload reservation changed.');
          if (kind === 'product') tx.set(deliverableRef, {
            ownerId: principal.uid, productId, fileName, fileMimeType: contentType,
            fileDataUrl: `storage://${objectPath}`, storageGeneration: String(metadata.generation),
            fileSizeBytes: data.length, updatedAt: new Date(),
          });
          const oldReference = String(previous?.get('fileDataUrl') || '');
          if (kind === 'product' && oldReference && oldReference !== `storage://${objectPath}`) {
            const oldPath = privateObjectPath(oldReference, principal.uid, productId);
            const orphanId = 'orphan-' + randomUUID();
            tx.create(db.collection('v2_upload_jobs').doc(orphanId), {
              ownerId: principal.uid, storeId, productId, kind: 'orphan', objectPath: oldPath,
              state: 'orphan', createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
            });
          }
          tx.update(ref, { pendingUpload: null, updatedAt: new Date() });
          tx.update(jobRef, { state: 'completed', storageGeneration: String(metadata.generation), completedAt: new Date() });
        });
        return { ok: true, fileName, fileMimeType: contentType, fileSizeBytes: data.length,
          fileReference: `storage://${objectPath}`,
          ...(kind === 'cover' ? { coverUrl: `/api/assets/covers/${principal.uid}/${basename}` } : {}) };
      } catch {
        // Failed cleanup leaves a durable pending job; never claim success or
        // swallow the object identity. The explicit staging cleanup handles crashes.
        try {
          await object.delete({ ignoreNotFound: true });
          await db.runTransaction(async tx => {
            const product = await tx.get(ref);
            if (product.get('pendingUpload') === id) tx.update(ref, { pendingUpload: null });
            tx.update(jobRef, { state: 'failed', completedAt: new Date() });
          });
        } catch { /* job remains pending and locked for reconciliation */ }
        throw new ApiError(503, 'storage/upload-failed', 'Secure upload could not finish. Retry; interrupted uploads require staging cleanup.');
      }
    },
  };
}

// Operator-only maintenance, never mounted as a public API. Caller must enforce
// the same demo-project/emulator staging guard as the V2 entrypoint.
export async function cleanupExpiredUploads(db: Firestore, bucket: Pick<Bucket, 'file'>, now = new Date()) {
  const [pending, cleaning, orphaned] = await Promise.all(['pending', 'cleaning', 'orphan'].map(state => db.collection('v2_upload_jobs').where('state', '==', state).where('expiresAt', '<=', now).limit(100).get()));
  for (const job of [...pending.docs, ...cleaning.docs, ...orphaned.docs]) {
    const data = job.data();
    if (!['product', 'cover', 'orphan'].includes(data.kind)) throw new ApiError(503, 'upload/invalid-job', 'Upload cleanup requires review.');
    const path = String(data.objectPath || '');
    requireId(data.ownerId, 'owner ID'); requireId(data.productId, 'product ID');
    const prefix = data.kind === 'product' || data.kind === 'orphan' ? `deliverables/${data.ownerId}/${data.productId}/` : `stores/${data.ownerId}/public/`;
    if (!path.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(path.slice(prefix.length))) throw new ApiError(503, 'upload/invalid-job', 'Upload cleanup requires review.');
    // Claim cleanup before deleting: an uploader completing after expiry must
    // fail its pendingUpload check and cannot publish an object being removed.
    const ref = db.collection('products').doc(data.productId);
    const claimed = await db.runTransaction(async tx => {
      const fresh = await tx.get(job.ref);
      const product = await tx.get(ref);
      if (!['pending', 'cleaning', 'orphan'].includes(fresh.get('state'))) return false;
      tx.update(job.ref, { state: 'cleaning' });
      if (data.kind !== 'orphan' && product.get('pendingUpload') === job.id) tx.update(ref, { pendingUpload: 'cleanup-' + job.id });
      return true;
    });
    if (!claimed) continue;
    await bucket.file(path).delete({ ignoreNotFound: true });
    await db.runTransaction(async tx => {
      const product = await tx.get(ref);
      if (data.kind !== 'orphan' && product.get('pendingUpload') === 'cleanup-' + job.id) tx.update(ref, { pendingUpload: null });
      tx.update(job.ref, { state: 'failed', completedAt: now });
    });
  }
}
