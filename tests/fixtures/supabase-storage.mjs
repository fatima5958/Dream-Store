import assert from 'node:assert/strict';

export const projectRef = 'abcdefghijklmnopqrst';
export const supabaseConfig = { url: `https://${projectRef}.supabase.co`, projectRef,
  bucket: 'dreamstore-v2-staging-files', secretName: 'v2-staging-supabase-secret' };
export const syntheticSecret = 'sb_secret_' + 'synthetic-server-key-01234567890123456789';
export function cloudSupabaseEnv() {
  return {
    DREAMSTORE_V2_STAGING: '1', DREAMSTORE_V2_MODE: 'cloud-staging', DREAMSTORE_V2_STORAGE_PROVIDER: 'supabase',
    DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID: 'dreamstore-stage-23',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS: 'dreamstore-stage-23',
    DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER: '123456789',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_NUMBERS: '123456789',
    DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID: 'dreamstore-stage-data',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_DATABASE_IDS: 'dreamstore-stage-data',
    K_SERVICE: 'v2-stage', K_REVISION: 'v2-stage-00001', K_CONFIGURATION: 'v2-stage',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICES: 'v2-stage',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS: 'runtime@dreamstore-stage-23.iam.gserviceaccount.com',
    DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME: 'v2-staging-signing',
    DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SIGNING_SECRET_NAMES: 'v2-staging-signing',
    SUPER_ADMIN_UID: 'synthetic-admin',
    DREAMSTORE_V2_SUPABASE_URL: supabaseConfig.url,
    DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS: projectRef,
    DREAMSTORE_V2_SUPABASE_BUCKET: supabaseConfig.bucket,
    DREAMSTORE_V2_SUPABASE_ALLOWED_BUCKETS: supabaseConfig.bucket,
    DREAMSTORE_V2_SUPABASE_SECRET_NAME: supabaseConfig.secretName,
    DREAMSTORE_V2_SUPABASE_ALLOWED_SECRET_NAMES: supabaseConfig.secretName,
  };
}

// The official SDK runs against this deterministic HTTP double. It is not real
// Supabase cloud evidence and never makes external requests.
export function syntheticSupabase() {
  const f = { objects: new Map(), calls: [], public: false, fail: false, failUpload: false,
    failDelete: false, failInfo: false, limit: 50 * 1024 * 1024, mimeTypes: null, version: 0 };
  f.fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, supabaseConfig.url);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), syntheticSecret);
    assert.equal(headers.get('authorization'), 'Bearer ' + syntheticSecret);
    assert.equal(init.redirect, 'error');
    f.calls.push({ path: url.pathname, method: init.method || 'GET', headers });
    if (f.fail) throw new Error('private upstream detail ' + syntheticSecret);
    const error = (status, message) => Response.json({ statusCode: String(status), error: message, message }, { status });
    if (url.pathname === '/storage/v1/bucket/' + supabaseConfig.bucket) return Response.json({
      id: supabaseConfig.bucket, name: supabaseConfig.bucket, public: f.public,
      file_size_limit: f.limit, allowed_mime_types: f.mimeTypes,
    });
    const infoPrefix = '/storage/v1/object/info/' + supabaseConfig.bucket + '/';
    const objectPrefix = '/storage/v1/object/' + supabaseConfig.bucket;
    if (url.pathname.startsWith(infoPrefix)) {
      const path = url.pathname.slice(infoPrefix.length), object = f.objects.get(path);
      if (f.failInfo || !object) return error(404, 'not found');
      return Response.json({ id: object.version, version: object.version, name: path, bucket_id: supabaseConfig.bucket,
        content_type: object.mime, size: object.reportedSize ?? object.bytes.length, etag: object.version });
    }
    if (url.pathname === objectPrefix && init.method === 'DELETE') {
      if (f.failDelete) return error(503, 'private delete error ' + syntheticSecret);
      for (const path of JSON.parse(init.body).prefixes) f.objects.delete(path);
      return Response.json([]);
    }
    assert.ok(url.pathname.startsWith(objectPrefix + '/'), 'Unexpected Storage API endpoint');
    const path = url.pathname.slice(objectPrefix.length + 1);
    if (init.method === 'POST') {
      assert.equal(headers.get('x-upsert'), 'false');
      assert.equal(headers.get('cache-control'), 'max-age=0');
      if (f.failUpload) return error(503, 'private write error ' + syntheticSecret);
      if (f.objects.has(path)) return error(409, 'Duplicate');
      f.objects.set(path, { bytes: Buffer.from(init.body), mime: headers.get('content-type'), version: 'version-' + (++f.version) });
      return Response.json({ Id: String(f.version), Key: supabaseConfig.bucket + '/' + path });
    }
    const object = f.objects.get(path);
    if (!object) return error(404, 'not found');
    return new Response(object.bytes, { headers: { 'Content-Type': object.mime } });
  };
  return f;
}
