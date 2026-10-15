import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { Principal, ProductRepository } from '../contracts.ts';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.ts';
import { assertOwnedActive, requireId, safeImage } from './policy.ts';
import { validateFileMetadata, privateObjectPath } from './uploads.ts';

const fields = ['storeId', 'ownerId', 'title', 'category', 'subtitle', 'description', 'priceUsd', 'pricePkr',
  'isFree', 'published', 'status', 'image', 'fileName', 'fileType', 'fileSizeLabel', 'salesCount', 'downloadCount'];
export function productProjection(id: string, data: Record<string, any>) {
  const result: Record<string, unknown> = { id };
  for (const key of fields) {
    const val = data[key];
    if (typeof val === 'string' || typeof val === 'boolean' || typeof val === 'number' && Number.isFinite(val)) result[key] = val;
  }
  return result;
}
export function createFirestoreProductRepository(db: Firestore, bucket: Pick<Bucket, 'file'>): ProductRepository {
  const products = db.collection('products');
  return {
    async list(storeId, viewer) {
      requireId(storeId, 'store ID');
      const store = await db.collection('stores').doc(storeId).get();
      if (!store.exists) throw new ApiError(404, 'store/not-found', 'Store not found.');
      const owner = viewer?.emailVerified && store.get('ownerId') === viewer.uid;
      if (!owner && store.get('status') !== 'Active') throw new ApiError(404, 'store/not-found', 'Public store not found.');
      // Bounded query; owners see drafts, guests only verified published listings.
      let query = products.where('storeId', '==', storeId);
      if (!owner) query = query.where('published', '==', true).where('status', '==', 'Available');
      const result = await query.limit(200).get();
      return result.docs.filter(d => d.get('ownerId') === store.get('ownerId') && d.get('deleted') !== true &&
        (owner || d.get('published') === true && d.get('status') === 'Available'))
        .map(d => productProjection(d.id, d.data()));
    },
    async save(principal, raw) {
      const input = raw.product || raw;
      if (typeof input.published !== 'boolean') throw new ApiError(422, 'product/publish-required', 'Explicit publish state is required.');
      const id = requireId(input.id, 'product ID');
      const storeId = requireId(input.storeId, 'store ID');
      if (input.ownerId != null && input.ownerId !== principal.uid) throw new ApiError(403, 'product/owner-forbidden', 'Cannot change another seller product.');
      const ref = products.doc(id);
      const deliverableRef = ref.collection('deliverables').doc('main');
      // Verify actual stored object; never turn client-supplied storage paths into an entitlement.
      const savedFile = await deliverableRef.get();
      const reference = String(input.fileDataUrl || savedFile.get('fileDataUrl') || '');
      let verifiedGeneration = '';
      if (input.published === true) {
        if (!savedFile.exists || reference !== savedFile.get('fileDataUrl') || savedFile.get('ownerId') !== principal.uid || savedFile.get('productId') !== id) throw new ApiError(422, 'product/file-required', 'Upload your original file before publishing.');
        const path = privateObjectPath(reference, principal.uid, id);
        try {
          const [metadata] = await bucket.file(path).getMetadata();
          validateFileMetadata(String(savedFile.get('fileName') || ''), String(metadata.contentType || ''), Number(metadata.size), 'product');
          if (metadata.metadata?.firebaseStorageDownloadTokens) throw new ApiError(422, 'product/public-file', 'Original file has a public download token. Re-upload securely.');
          verifiedGeneration = String(metadata.generation || '');
          if (!verifiedGeneration) throw new ApiError(503, 'storage/metadata-invalid', 'File version could not be verified.');
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(503, 'storage/unavailable', 'Original file cannot be verified. Try again.');
        }
      }
      return db.runTransaction(async tx => {
        const store = await tx.get(db.collection('stores').doc(storeId));
        const old = await tx.get(ref);
        const file = await tx.get(deliverableRef);
        assertOwnedActive(store.exists ? store.data() : undefined, principal);
        if (old.exists && (old.get('ownerId') !== principal.uid || old.get('storeId') !== storeId)) throw new ApiError(403, 'product/owner-forbidden', 'Product belongs to another seller or store.');
        if (old.get('deleted') === true) throw new ApiError(410, 'product/deleted', 'This listing was deleted. Create a new product.');
        if (old.get('pendingUpload')) throw new ApiError(409, 'upload/in-progress', 'Wait for the original file upload to complete.');
        if (input.published === true && (file.get('fileDataUrl') !== reference || file.get('ownerId') !== principal.uid || file.get('productId') !== id)) throw new ApiError(409, 'product/file-changed', 'File changed. Retry publishing.');
        const merged = { ...(old.data() || {}), ...input };
        if (typeof merged.title !== 'string' || merged.title.trim().length < 2 || merged.title.length > 160 ||
            !['Ebooks', 'Workbooks', 'Planners', 'Templates', 'Bundles'].includes(merged.category) ||
            typeof merged.published !== 'boolean' || typeof merged.isFree !== 'boolean') throw new ApiError(422, 'product/invalid-fields', 'A title, category, price and publish state are required.');
        const priceUsd = merged.isFree ? 0 : merged.priceUsd;
        const pricePkr = merged.isFree ? 0 : merged.pricePkr;
        if (![priceUsd, pricePkr].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000000) || !merged.isFree && (priceUsd < 1 || pricePkr < 100)) throw new ApiError(422, 'product/invalid-price', 'Set valid USD and PKR prices or mark Free.');
        const status = input.status || (merged.published ? 'Available' : 'Draft');
        if (!['Available', 'Coming Soon', 'Draft'].includes(status) || merged.published && status !== 'Available') throw new ApiError(422, 'product/invalid-status', 'Only available products may be published.');
        const record: Record<string, any> = { ownerId: principal.uid, storeId, title: merged.title.trim(), category: merged.category,
          isFree: merged.isFree, priceUsd, pricePkr, published: merged.published, status, image: safeImage(merged.image || ''),
          createdAt: old.get('createdAt') || new Date(), updatedAt: new Date(), deleted: false };
        for (const [key, limit] of Object.entries({ subtitle: 300, description: 3000, fileName: 255, fileType: 100, fileSizeLabel: 60 })) {
          const value = merged[key] || '';
          if (typeof value !== 'string' || value.length > limit) throw new ApiError(422, 'product/invalid-field', `Invalid ${key}.`);
          record[key] = value;
        }
        // Merge only allowlisted listing fields. Sales/download metrics and pending
        // uploads never come from the client, and survive catalog changes.
        tx.set(ref, record, { merge: true });
        if (merged.published && verifiedGeneration) tx.update(deliverableRef, { storageGeneration: verifiedGeneration, fileSizeBytes: Number(savedFile.get('fileSizeBytes') || 0) });
        return productProjection(id, { ...old.data(), ...record });
      });
    },
    async remove(principal, id) {
      requireId(id, 'product ID');
      await db.runTransaction(async tx => {
        const ref = products.doc(id);
        const product = await tx.get(ref);
        if (!product.exists) throw new ApiError(404, 'product/not-found', 'Product not found.');
        if (product.get('ownerId') !== principal.uid) throw new ApiError(403, 'product/owner-forbidden', 'Product belongs to another seller.');
        const store = await tx.get(db.collection('stores').doc(requireId(product.get('storeId'), 'store ID')));
        assertOwnedActive(store.exists ? store.data() : undefined, principal);
        if (product.get('pendingUpload')) throw new ApiError(409, 'upload/in-progress', 'Wait for the file upload before deleting.');
        // Preserve paid buyers' original file/history for the next fulfillment phase.
        tx.update(ref, { deleted: true, published: false, status: 'Draft', updatedAt: new Date() });
      });
    },
  };
}
