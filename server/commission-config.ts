import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ApiError } from './v2/errors.ts';

export const validCommissionRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 5000;

export function commissionRateFromSnapshot(snapshot: { exists: boolean; get(key: string): unknown }): number {
  if (!snapshot.exists) return 500;
  const rate = snapshot.get('platformCommissionBps');
  if (!validCommissionRate(rate)) throw new ApiError(503, 'commission/configuration-invalid', 'Commission configuration could not be verified.');
  return rate;
}

export async function readCommissionRate(db: Firestore | null): Promise<number> {
  if (!db) throw new ApiError(503, 'commission/database-unavailable', 'Commission database is unavailable.');
  return commissionRateFromSnapshot(await db.collection('platform_settings').doc('commission').get());
}

export async function saveCommissionRate(db: Firestore | null, rate: number, actorUid: string): Promise<number> {
  if (!db) throw new ApiError(503, 'commission/database-unavailable', 'Commission settings were not saved.');
  if (!validCommissionRate(rate)) throw new ApiError(400, 'commission/rate-invalid', 'Invalid commission rate.');
  const ref = db.collection('platform_settings').doc('commission');
  const auditRef = ref.collection('audit').doc(randomUUID());
  await db.runTransaction(async tx => {
    const prior = await tx.get(ref);
    const previous = prior.exists ? prior.get('platformCommissionBps') : 500;
    const updatedAt = new Date();
    tx.set(ref, { platformCommissionBps: rate, updatedByUid: actorUid, updatedAt });
    tx.create(auditRef, { previousCommissionBps: validCommissionRate(previous) ? previous : null,
      platformCommissionBps: rate, actorUid, createdAt: updatedAt });
  });
  return rate;
}
