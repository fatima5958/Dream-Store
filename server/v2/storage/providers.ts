import type { CloudStagingConfiguration } from '../config/cloud-staging.ts';
import { createSupabaseStorageBucket } from './supabase.ts';
import type { StorageBucket } from './contracts.ts';

export function selectCloudStagingStorage(
  config: CloudStagingConfiguration,
  runtime: { projectNumber: string; supabaseSecretKey?: string },
  firebaseBucket: () => StorageBucket & { getMetadata(): Promise<unknown[]> },
  fetcher: typeof fetch = fetch,
): { bucket: StorageBucket; checkReady(): Promise<void> } {
  if (config.storageProvider === 'supabase') {
    if (!config.supabase || !runtime.supabaseSecretKey) throw new Error('Staging Supabase credentials are missing.');
    const bucket = createSupabaseStorageBucket(config.supabase, runtime.supabaseSecretKey, fetcher);
    return { bucket, checkReady: () => bucket.checkReady() };
  }
  const bucket = firebaseBucket();
  return { bucket, async checkReady() {
    const [metadata] = await bucket.getMetadata();
    if (String((metadata as { projectNumber?: string | number })?.projectNumber || '') !== runtime.projectNumber) {
      throw new Error('Staging Storage bucket belongs to another project.');
    }
  } };
}
