import type { Firestore } from 'firebase-admin/firestore';
import { ApiError } from '../errors.ts';
import type { CreatorCampaignRepository } from '../contracts.ts';

export const FIRST_CREATORS_LIMIT = 100;
export const FIRST_CREATORS_ID = 'first-100-creators';

export function createCreatorCampaignRepository(db: Firestore): CreatorCampaignRepository {
  return {
    async read() {
      const snap = await db.collection('creator_launch_campaigns').doc(FIRST_CREATORS_ID).get();
      const claimed = snap.exists ? Number(snap.get('claimedCount')) : 0;
      if (!Number.isSafeInteger(claimed) || claimed < 0 || claimed > FIRST_CREATORS_LIMIT) {
        throw new ApiError(503, 'campaign/counter-invalid', 'Creator availability cannot be verified.');
      }
      return {
        limit: 100, claimed, remaining: 100 - claimed,
        soldOut: claimed >= 100, offer: 'free_storefront_setup',
      };
    },
  };
}
