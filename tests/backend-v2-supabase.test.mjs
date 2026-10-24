import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStorageBucket } from '../server/v2/storage/supabase.ts';
import { selectCloudStagingStorage } from '../server/v2/storage/providers.ts';
import { createCoverReader } from '../server/v2/storage/covers.ts';
import { parseCloudStagingConfiguration, verifyCloudStagingRuntime } from '../server/v2/config/cloud-staging.ts';
import { validateSupabaseSecret } from '../server/v2/config/storage.ts';
import { assertIsolatedV2Environment } from '../server/v2/config/staging.ts';
import { createFirebaseUploadRepository, cleanupExpiredUploads, MAX_UPLOAD_BYTES } from '../server/v2/modules/uploads.ts';
import { createFirestoreProductRepository } from '../server/v2/modules/products.ts';
import { createFirestoreProfileRepository } from '../server/v2/modules/users.ts';
import { createFirestoreFinancialRepository } from '../server/v2/modules/finance-repository.ts';
import { createFirebaseVerifier } from '../server/v2/modules/auth.ts';
import { createDownloadToken } from '../server/v2/modules/checkout.ts';
import { createV2App } from '../server/v2/app.ts';
import { checkoutAttempt, applyDownloadReceipt } from '../src/lib/checkout.ts';
import { MemoryFirestore } from './fixtures/v2-repositories.mjs';
import { cloudSupabaseEnv, supabaseConfig, syntheticSecret, syntheticSupabase } from './fixtures/supabase-storage.mjs';

const principal = uid => ({ uid, email: uid + '@example.test', emailVerified: true, displayName: uid });
const seller = principal('seller');
const pdf = Buffer.from('%PDF-1.7\nSynthetic original\n%%EOF');
const png = Buffer.from('89504e470d0a1a0a010203', 'hex');
const product = { id: 'book', storeId: 'store-seller', title: 'Synthetic Book', category: 'Ebooks',
  isFree: false, published: false, priceUsd: 10, pricePkr: 1000, image: '' };
const signingSecret = 'synthetic-staging-signing-secret-0123456789';
const hasCode = expected => error => error.code === expected;
const saveOptions = mime => ({ preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: mime } });
function fixture() {
  const http = syntheticSupabase(), db = new MemoryFirestore();
  const bucket = createSupabaseStorageBucket(supabaseConfig, syntheticSecret, http.fetcher);
  db.seed('stores/store-seller', { ownerId: 'seller', status: 'Active', plan: 'Free', storeSlug: 'synthetic-books' });
  for (const uid of ['seller', 'other', 'buyer', 'buyer2']) db.seed('users/' + uid, {
    uid, role: uid.startsWith('buyer') ? 'buyer' : 'seller', onboardingCompleted: true,
  });
  const uploads = createFirebaseUploadRepository(db, bucket), products = createFirestoreProductRepository(db, bucket);
  const finance = createFirestoreFinancialRepository(db, bucket, signingSecret);
  const auth = createFirebaseVerifier({ async verifyIdToken(token, revoked) {
    assert.equal(revoked, true);
    const uid = token.split('.')[1];
    if (uid === 'revoked') throw Object.assign(new Error(), { code: 'auth/id-token-revoked' });
    if (uid === 'outage') throw new Error('Private provider error');
    if (!['seller','other','buyer','buyer2','unverified'].includes(uid)) throw Object.assign(new Error(), { code: 'auth/invalid-id-token' });
    return { uid, email: uid + '@example.test', email_verified: uid !== 'unverified' };
  } });
  const deps = { auth, profiles: createFirestoreProfileRepository(db), creators: { async read() { return { claimed: 0 }; } },
    products, uploads, finance, covers: createCoverReader(bucket), readiness: { async check() {
      try { await bucket.checkReady(); return true; } catch { return false; }
    } }, adminUid: 'synthetic-admin', allowWrites: true, allowUnsignedEmulatorTokens: false,
    paidCheckoutEnabled: false, downloadTokenSecret: signingSecret };
  return { http, db, bucket, products, uploads, finance, deps,
    upload: () => uploads.save(seller, { productId: 'book', storeId: 'store-seller', fileName: 'book.pdf',
      contentType: 'application/pdf', data: pdf, kind: 'product' }) };
}
async function withApi(f, run) {
  const server = await new Promise(resolve => { const s = createV2App(f.deps).listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try { await run(async (path, uid, body, binary = false, headers = {}) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(uid ? { Authorization: 'Bearer synthetic.' + uid + '.signature' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text,
      text, headers: response.headers };
  }); } finally { await new Promise(resolve => server.close(resolve)); }
}
const uploadHeaders = { 'X-Product-ID': 'book', 'X-Store-ID': 'store-seller', 'X-File-Name': 'book.pdf', 'X-File-Type': 'application/pdf' };

test('Supabase selection needs no Firebase bucket and preserves all Cloud Run identity/production guards', () => {
  const config = parseCloudStagingConfiguration(cloudSupabaseEnv());
  assert.equal(config.storageBucket, undefined); assert.equal(config.storageProvider, 'supabase');
  assert.equal(config.supabase.bucket, supabaseConfig.bucket);
  for (const patch of [
    { DREAMSTORE_V2_STAGING: '0' }, { DREAMSTORE_V2_MODE: 'production' },
    { DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID: 'dulcet-trees-qk6n5', DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS: 'dulcet-trees-qk6n5' },
    { DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER: '582009353900', DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_NUMBERS: '582009353900' },
    { K_SERVICE: 'unexpected' }, { K_REVISION: '' }, { DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS: 'runtime@other-project.iam.gserviceaccount.com' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, { DREAMSTORE_PAID_CHECKOUT_ENABLED: 'true' },
    { DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID: '(default)' }, { DREAMSTORE_V2_STORAGE_PROVIDER: 'unknown' },
    { DREAMSTORE_V2_SUPABASE_URL: 'https://evil.example.test' }, { DREAMSTORE_V2_SUPABASE_URL: supabaseConfig.url + '/redirect' },
    { DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS: 'anotherprojectrefxxxx' },
    { DREAMSTORE_V2_SUPABASE_BUCKET: 'production-files' }, { DREAMSTORE_V2_SUPABASE_SECRET_NAME: '' },
    { DREAMSTORE_V2_SUPABASE_SECRET_KEY: syntheticSecret }, { SUPABASE_SERVICE_ROLE_KEY: syntheticSecret },
    { DREAMSTORE_V2_SUPABASE_SECRET_NAME: 'v2-staging-signing', DREAMSTORE_V2_SUPABASE_ALLOWED_SECRET_NAMES: 'v2-staging-signing' },
    { DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET: 'dulcet-trees-qk6n5.firebasestorage.app' },
  ]) assert.throws(() => parseCloudStagingConfiguration({ ...cloudSupabaseEnv(), ...patch }), JSON.stringify(Object.keys(patch)));
  assert.throws(() => assertIsolatedV2Environment({ DREAMSTORE_V2_STORAGE_PROVIDER: 'supabase' }), /emulator/i);
  assert.throws(() => validateSupabaseSecret('', supabaseConfig.projectRef));
  assert.throws(() => validateSupabaseSecret('sb_publishable_' + 'a'.repeat(40), supabaseConfig.projectRef));
});

test('Supabase credentials load only after runtime identity checks, from a separate staging secret', async () => {
  const config = parseCloudStagingConfiguration(cloudSupabaseEnv());
  const calls = [];
  const fetcher = async url => {
    const path = String(url); calls.push(path);
    if (path.endsWith('/project/project-id')) return new Response(config.projectId);
    if (path.endsWith('/project/numeric-project-id')) return new Response(config.projectNumber);
    if (path.endsWith('/instance/service-accounts/default/email')) return new Response(config.allowedServiceAccounts[0]);
    if (path.endsWith('/default/token')) return Response.json({ access_token: 'synthetic-runtime-access' });
    const secret = path.includes('/' + supabaseConfig.secretName + '/') ? syntheticSecret : signingSecret;
    return Response.json({ payload: { data: Buffer.from(secret).toString('base64') } });
  };
  const runtime = await verifyCloudStagingRuntime(config, fetcher);
  assert.equal(runtime.supabaseSecretKey, syntheticSecret);
  assert.equal(calls.filter(url => url.includes('secretmanager.googleapis.com')).length, 2);
  let reads = 0;
  await assert.rejects(verifyCloudStagingRuntime(config, async url => {
    reads++; if (String(url).includes('metadata.google.internal')) return new Response('wrong-project');
    throw new Error('Must not reach secrets');
  }));
  assert.equal(reads, 3);
  await assert.rejects(verifyCloudStagingRuntime(config, async url => String(url).includes('/' + supabaseConfig.secretName + '/')
    ? Response.json({ payload: { data: Buffer.from('sb_publishable_invalid').toString('base64') } }) : fetcher(url)));
});

test('selected-provider readiness never touches Firebase Storage and fails closed on public/small/restricted buckets', async () => {
  const http = syntheticSupabase();
  const selected = selectCloudStagingStorage(parseCloudStagingConfiguration(cloudSupabaseEnv()),
    { projectNumber: '123456789', supabaseSecretKey: syntheticSecret }, () => { throw new Error('Firebase Storage must not initialize'); }, http.fetcher);
  await selected.checkReady();
  for (const patch of [{ public: true }, { limit: 1024 }, { fail: true }, { mimeTypes: ['image/*'] }]) {
    Object.assign(http, { public: false, limit: 50 * 1024 * 1024, fail: false, mimeTypes: null }, patch);
    await assert.rejects(selected.checkReady(), error => error.status === 503 && !error.message.includes(syntheticSecret));
  }
  assert.throws(() => selectCloudStagingStorage(parseCloudStagingConfiguration(cloudSupabaseEnv()),
    { projectNumber: '123456789' }, () => {}), /missing/);
});

test('official SDK stores all supported digital and cover formats privately with create-only writes', async () => {
  const f = fixture();
  for (const [name, mime, data] of [
    ['a.pdf','application/pdf',pdf], ['a.epub','application/epub+zip',Buffer.from('504b03040102','hex')],
    ['a.zip','application/zip',Buffer.from('504b03040102','hex')], ['a.txt','text/plain',Buffer.from('Synthetic text')],
    ['a.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',Buffer.from('504b03040102','hex')],
    ['a.png','image/png',png], ['a.jpg','image/jpeg',Buffer.from('ffd8ff0011','hex')],
    ['a.gif','image/gif',Buffer.from('GIF89a1234')], ['a.webp','image/webp',Buffer.from('RIFF0000WEBP')],
  ]) {
    const path = (mime.startsWith('image/') ? 'stores/seller/public/' : 'deliverables/seller/book/') + name;
    const object = f.bucket.file(path); await object.save(data, saveOptions(mime));
    assert.deepEqual((await object.download())[0], data);
    assert.equal((await object.getMetadata())[0].generation.startsWith('version-'), true);
    await assert.rejects(object.save(data, saveOptions(mime)), hasCode('storage/object-exists'));
    assert.deepEqual(f.http.objects.get(path).bytes, data);
    await object.delete({ ignoreNotFound: true }); assert.equal(f.http.objects.has(path), false);
  }
  assert.ok(f.http.calls.every(c => !/\/storage\/v1\/object\/(public|sign)\//.test(c.path)));
});

test('object path traversal and unscoped paths reject before any SDK request', () => {
  const f = fixture();
  for (const path of ['../secret','deliverables/seller/other/../book.pdf','deliverables/seller/book/%2e%2e',
    'deliverables/seller/book/..','deliverables/seller/book/a\\b.pdf','stores/seller/private/file.pdf','https://evil.test/file']) {
    assert.throws(() => f.bucket.file(path), hasCode('storage/invalid-path'));
  }
  assert.equal(f.http.calls.length, 0);
});

test('seller upload persists provider/version privately; public listing and covers keep frontend JSON contracts', async () => {
  const f = fixture(); await f.products.save(seller, product);
  const uploaded = await f.upload();
  const file = f.db.data.get('products/book/deliverables/main');
  assert.equal(file.storageProvider, 'supabase'); assert.equal(file.storageBucket, supabaseConfig.bucket);
  assert.match(file.storageGeneration, /^version-/); assert.match(uploaded.fileReference, /^storage:\/\/deliverables\/seller\/book\//);
  assert.equal([...f.db.data.values()].some(v => JSON.stringify(v).includes(syntheticSecret)), false);
  await f.products.save(seller, { ...product, published: true, fileName: 'book.pdf' });
  assert.equal((await f.products.list('store-seller')).length, 1);
  const publicListing = JSON.stringify(await f.products.list('store-seller'));
  assert.doesNotMatch(publicListing, /storageProvider|storageBucket|storageGeneration|fileDataUrl|storage:\/\/|supabase/);
  const cover = await f.uploads.save(seller, { productId: 'book', storeId: 'store-seller', fileName: 'cover.png',
    contentType: 'image/png', data: png, kind: 'cover' });
  assert.match(cover.coverUrl, /^\/api\/assets\/covers\/seller\//);
  await withApi(f, async request => {
    const served = await request(cover.coverUrl);
    assert.equal(served.status, 200); assert.match(served.headers.get('content-type'), /image\/png/);
    assert.match(served.headers.get('content-security-policy'), /sandbox/);
    const stolen = await request(cover.coverUrl.replace('/seller/', '/other/')); assert.equal(stolen.status, 404);
    const notCover = await request('/api/assets/covers/seller/book.pdf'); assert.equal(notCover.status, 404);
  });
});

test('unauthenticated, Buyer, revoked and unverified uploads reject without storage side effects; roles restore', async () => {
  const f = fixture();
  await withApi(f, async request => {
    for (const [uid, expected] of [[null,401],['buyer',403],['other',403],['revoked',401],['unverified',403],['outage',503]]) {
      assert.equal((await request('/api/uploads/product',uid,pdf,true,uploadHeaders)).status, expected);
    }
    assert.equal((await request('/api/users/profile','buyer')).body.profile.role, 'buyer');
    const restored = await request('/api/users/profile','seller');
    assert.equal(restored.body.profile.role, 'seller'); assert.equal(restored.body.profile.storeId, 'store-seller');
  });
  assert.equal(f.http.calls.length, 0); assert.equal(f.http.objects.size, 0);
});

test('invalid MIME/signatures and oversized uploads fail without persisting reservations', async () => {
  const f = fixture();
  for (const bad of [
    { fileName: 'book.exe', contentType: 'application/octet-stream', data: pdf },
    { fileName: 'book.pdf', contentType: 'application/pdf', data: Buffer.from('not pdf') },
    { fileName: '../book.pdf', contentType: 'application/pdf', data: pdf },
    { fileName: 'book.pdf', contentType: 'application/pdf', data: Buffer.alloc(MAX_UPLOAD_BYTES + 1) },
  ]) await assert.rejects(f.uploads.save(seller,{ productId:'book',storeId:'store-seller',kind:'product', ...bad }), error => error.status === 422);
  await withApi(f, async request => assert.equal((await request('/api/uploads/product','seller',Buffer.alloc(MAX_UPLOAD_BYTES + 1),true,uploadHeaders)).status,413));
  assert.equal(f.http.calls.length, 0); assert.equal(f.db.data.has('products/book'), false);
});

test('cross-seller replacement/deletion and suspended mutations never reach storage', async () => {
  const f = fixture(); await f.products.save(seller, product); await f.upload();
  const before = f.http.calls.length;
  await assert.rejects(f.uploads.save(principal('other'), { productId:'book',storeId:'store-seller',fileName:'book.pdf',contentType:'application/pdf',data:pdf,kind:'product' }), error=>error.status===403);
  await assert.rejects(f.products.remove(principal('other'),'book'), error=>error.status===403);
  f.db.seed('stores/store-seller',{ ownerId:'seller',status:'Suspended' });
  await assert.rejects(f.upload(), error=>error.status===403);
  await assert.rejects(f.products.remove(seller,'book'), error=>error.status===403);
  assert.equal(f.http.calls.length, before);
});

test('Storage and Firestore failures never report success or leak details; durable cleanup restores reservations', async () => {
  const f = fixture(); f.http.failUpload = true;
  await assert.rejects(f.upload(), error => error.status===503 && !error.message.includes(syntheticSecret));
  assert.equal(f.db.data.get('products/book').pendingUpload,null);
  f.http.failUpload=false; f.db.failCommit=true;
  const writes=f.http.calls.length;
  await assert.rejects(f.upload()); assert.equal(f.http.calls.length,writes);
  f.db.failCommit=false;
  const original=f.bucket.file.bind(f.bucket);
  f.bucket.file=path=>{ const file=original(path); return { ...file, async save(...args) { await file.save(...args);f.db.failCommit=true; } }; };
  await assert.rejects(f.upload()); assert.equal(f.http.objects.size,0);
  assert.equal([...f.db.data.values()].some(j=>j.state==='pending'&&j.storageProvider==='supabase'),true);
  f.db.failCommit=false;
  await cleanupExpiredUploads(f.db,f.bucket,new Date(Date.now()+7200000));
  assert.equal(f.db.data.get('products/book').pendingUpload,null);
});

test('changing bucket/provider refuses legacy references and cleanup; replacement reconciles only its own namespace', async () => {
  const f=fixture(); await f.products.save(seller,product); await f.upload();
  const old=f.db.data.get('products/book/deliverables/main').fileDataUrl.slice('storage://'.length);
  await f.upload(); assert.equal(f.http.objects.size,2);
  await cleanupExpiredUploads(f.db,f.bucket,new Date(Date.now()+2*86400000));
  assert.equal(f.http.objects.has(old),false);assert.equal(f.http.objects.size,1);
  const wrong={ ...f.bucket,binding:{provider:'supabase',bucket:'other-staging-bucket'} };
  await assert.rejects(createFirestoreProductRepository(f.db,wrong).save(seller,{...product,published:true}),hasCode('storage/provider-mismatch'));
  const legacy=f.db.data.get('products/book/deliverables/main');delete legacy.storageProvider;delete legacy.storageBucket;
  f.db.seed('products/book/deliverables/main',legacy);
  await assert.rejects(f.products.save(seller,{...product,published:true}),hasCode('storage/provider-mismatch'));
  f.db.seed('v2_upload_jobs/legacy',{ownerId:'seller',productId:'book',kind:'orphan',state:'orphan',objectPath:old,expiresAt:new Date(0)});
  await assert.rejects(cleanupExpiredUploads(f.db,f.bucket),hasCode('storage/provider-mismatch'));
});

test('private Buyer delivery requires verified payment, scopes tokens, blocks refunds and preserves archived-purchase entitlements', async () => {
  const f=fixture();await f.products.save(seller,product);await f.upload();await f.products.save(seller,{...product,published:true,fileName:'book.pdf'});
  f.db.seed('sellerSettings/seller',{ownerId:'seller',jazzCashMerchantId:'synthetic-receiver',jazzCashEnabled:true});
  const pending={orderNumber:'DS-supabase-1',orderId:'order-supabase-1',buyerId:'buyer',sellerId:'seller',storeId:'store-seller',
    primaryProductId:'book',currency:'PKR',totalAmount:1000,grossAmountMinor:100000,commissionRateBps:500,platformCommissionMinor:5000,
    sellerShareBeforeFeesMinor:95000,gatewayFeeMinor:0,sellerNetEarningsMinor:95000,paymentMethod:'jazzcash',paymentReference:'SYNTHETIC-1',
    paymentStatus:'Pending',commissionStatus:'outstanding',downloadCount:0,maxDownloads:5,expiresAtMs:Date.now()+600000,downloadTokenId:'first',idempotencyKey:'supabase-order-idem'};
  await f.finance.createOrder(pending);
  await withApi(f,async request=>{
    assert.equal((await request('/api/downloads/token','buyer',{orderNumber:pending.orderNumber})).status,403);
    assert.equal((await request('/api/orders/verify-payment','other',{orderNumber:pending.orderNumber,newStatus:'Paid',statementConfirmed:true})).status,403);
    const verified=await request('/api/orders/verify-payment','seller',{orderNumber:pending.orderNumber,newStatus:'Paid',statementConfirmed:true});
    assert.equal(verified.status,200); assert.equal(f.db.data.get('commission_entries/'+pending.orderNumber).platformCommissionMinor,5000);
    const body={orderNumber:pending.orderNumber,productId:'book',downloadToken:verified.body.downloadToken};
    const before=f.http.calls.length;
    assert.equal((await request('/api/delivery/verify-download','buyer2',body)).status,403);
    assert.equal((await request('/api/delivery/verify-download','buyer',{...body,downloadToken:body.downloadToken+'forged'})).status,403);
    const current=await f.finance.order(pending.orderNumber);
    const expired=createDownloadToken({...current,expiresAtMs:Date.now()-1000},signingSecret);
    assert.equal((await request('/api/delivery/verify-download','buyer',{...body,downloadToken:expired})).status,403);
    assert.equal(f.http.calls.length,before);
    const first=await request('/api/delivery/verify-download','buyer',body);assert.equal(first.status,200);
    assert.equal(first.body.allowed,true);assert.equal(first.body.fileDataUrl,'data:application/pdf;base64,'+pdf.toString('base64'));
    assert.doesNotMatch(first.text,/supabase|storage:\/\/|storageBucket|sb_secret/);
    assert.equal((await request('/api/delivery/verify-download','buyer',body)).status,403);
    // Existing policy preserves fulfilled purchases after catalog archival;
    // archival blocks NEW checkout and public discovery, not historic ownership.
    await f.products.remove(seller,'book'); assert.equal((await f.products.list('store-seller')).length,0);
    assert.equal((await request('/api/checkout/validate-and-prepare','buyer',{storeId:'store-seller',currency:'PKR',paymentMethod:'jazzcash',items:[{id:'book'}],idempotencyKey:'new-checkout-key'})).status,404);
    const archived=await request('/api/delivery/verify-download','buyer',{...body,downloadToken:first.body.nextDownloadToken});assert.equal(archived.status,200);
    await f.finance.transitionOrder(pending.orderNumber,'Paid',{paymentStatus:'Refunded',refundReference:'SYNTHETIC-REFUND'},'seller');
    assert.equal((await request('/api/delivery/verify-download','buyer',{...body,downloadToken:archived.body.nextDownloadToken})).status,403);
  });
});

test('unpublished products block new checkout; free product follows existing authenticated free-download flow', async()=>{
  const f=fixture();await f.products.save(seller,product);await f.upload();
  await withApi(f,async request=>{
    const checkout={storeId:'store-seller',currency:'PKR',paymentMethod:'free_instant',items:[{id:'book',quantity:1}],idempotencyKey:'free-checkout-supabase-1'};
    assert.equal((await request('/api/checkout/validate-and-prepare','buyer',checkout)).status,404);
    await f.products.save(seller,{...product,published:true,isFree:true,fileName:'book.pdf'});
    const free=await request('/api/checkout/validate-and-prepare','buyer',checkout);assert.equal(free.status,201);assert.equal(free.body.initialPaymentStatus,'Paid');
    const duplicate=await request('/api/checkout/validate-and-prepare','buyer',checkout);
    assert.equal(duplicate.status,200);assert.equal(duplicate.body.orderNumber,free.body.orderNumber);
    assert.ok(duplicate.body.downloadToken===free.body.downloadToken,'idempotent free checkout must sign the persisted order and nonce');
    assert.equal(duplicate.body.expiresAtMs,free.body.expiresAtMs);
    const download=await request('/api/delivery/verify-download','buyer',{orderNumber:free.body.orderNumber,productId:'book',downloadToken:free.body.downloadToken});
    assert.equal(download.status,200); assert.equal(download.body.allowed,true);
  });
});

test('missing signing secret rejects checkout before any order is committed', async () => {
  const f = fixture();
  await f.products.save(seller, product); await f.upload();
  await f.products.save(seller, { ...product, published: true, isFree: true, fileName: 'book.pdf' });
  f.deps.downloadTokenSecret = '';
  await withApi(f, async request => {
    const result = await request('/api/checkout/validate-and-prepare', 'buyer', { storeId: 'store-seller',
      currency: 'USD', paymentMethod: 'free_instant', items: [{ id: 'book', quantity: 1 }], idempotencyKey: 'missing-signing-secret' });
    assert.equal(result.status, 503);
    assert.equal([...f.db.data.keys()].filter(key => /^(ledger|orders|checkout_idempotency)\//.test(key)).length, 0);
  });
});

test('the browser checkout/download protocol supports retries and multiple authorized downloads', async () => {
  const f = fixture(); await f.products.save(seller, product); await f.upload();
  await f.products.save(seller, { ...product, published: true, isFree: true, fileName: 'book.pdf' });
  const attempt = await checkoutAttempt({ buyerId: 'buyer', storeId: 'store-seller', productId: 'book', quantity: 1,
    currency: 'USD', paymentMethod: 'free_instant', paymentReference: '', customerName: 'Buyer', customerEmail: 'buyer@example.test' });
  await withApi(f, async request => {
    const checkout = { storeId: 'store-seller', currency: 'USD', paymentMethod: 'free_instant',
      items: [{ id: 'book', quantity: 1 }], idempotencyKey: attempt.key };
    const created = await request('/api/checkout/validate-and-prepare', 'buyer', checkout);
    assert.equal(created.status, 201, created.text);
    let order = { ...created.body, downloadCount: 0 };
    for (let count = 1; count <= 2; count++) {
      const downloaded = await request('/api/delivery/verify-download', 'buyer', { orderNumber: order.orderNumber,
        productId: 'book', downloadToken: order.downloadToken });
      assert.equal(downloaded.status, 200, downloaded.text);
      order = applyDownloadReceipt(order, downloaded.body);
      assert.equal(order.downloadCount, count);
      const retry = await request('/api/checkout/validate-and-prepare', 'buyer', checkout);
      assert.equal(retry.status, 200); assert.equal(retry.body.downloadToken, order.downloadToken);
      assert.equal(retry.body.downloadCount, count);
    }
  });
  attempt.complete();
});

test('storage failures, corrupt bytes and mismatched versions never consume Buyer download entitlement', async()=>{
  const f=fixture();await f.upload();
  const order={orderNumber:'DS-down-fail',orderId:'order-fail',buyerId:'buyer',sellerId:'seller',primaryProductId:'book',paymentStatus:'Paid',commissionStatus:'outstanding',downloadCount:0,maxDownloads:5,expiresAtMs:Date.now()+600000,downloadTokenId:'unused'};
  f.db.seed('ledger/'+order.orderNumber,order);
  const path=[...f.http.objects.keys()][0], object=f.http.objects.get(path);
  const original=Buffer.from(object.bytes);
  for(const mutate of [()=>{f.http.fail=true;},()=>{object.bytes=Buffer.alloc(pdf.length,65);},()=>{object.version='different-version';},()=>{object.bytes=Buffer.alloc(MAX_UPLOAD_BYTES+1);object.reportedSize=pdf.length;}]){
    f.http.fail=false;object.bytes=original;object.version='version-1';delete object.reportedSize;mutate();
    await assert.rejects(f.finance.consumeDownload(order.orderNumber,'buyer','book','unused'));
    assert.equal(f.db.data.get('ledger/'+order.orderNumber).downloadCount,0);
  }
});

test('repositories and selected provider restore durable files after backend recreation',async()=>{
  const f=fixture();await f.products.save(seller,product);await f.upload();await f.products.save(seller,{...product,published:true});
  const restarted=createSupabaseStorageBucket(supabaseConfig,syntheticSecret,f.http.fetcher);
  const products=createFirestoreProductRepository(f.db,restarted);
  assert.equal((await products.list('store-seller')).length,1);
  const order={orderNumber:'DS-restart',orderId:'order-restart',buyerId:'buyer',sellerId:'seller',primaryProductId:'book',paymentStatus:'Paid',commissionStatus:'outstanding',downloadCount:0,maxDownloads:5,expiresAtMs:Date.now()+600000,downloadTokenId:'restart'};
  f.db.seed('ledger/'+order.orderNumber,order);
  const delivered=await createFirestoreFinancialRepository(f.db,restarted,signingSecret).consumeDownload(order.orderNumber,'buyer','book','restart');
  assert.match(delivered.fileDataUrl,/^data:application\/pdf;base64,/);
  assert.equal(f.db.data.get('ledger/'+order.orderNumber).downloadCount,1);
});

test('create-conflict compensation never deletes an existing object',async()=>{
  const f=fixture(), original=f.bucket.file.bind(f.bucket);
  f.bucket.file=path=>{
    const object=original(path);
    return {...object,async save(...args){
      f.http.objects.set(path,{bytes:pdf,mime:'application/pdf',version:'pre-existing'});
      return object.save(...args);
    }};
  };
  await assert.rejects(f.upload(),hasCode('storage/upload-failed'));
  assert.equal(f.http.objects.size,1);
  assert.equal([...f.http.objects.values()][0].version,'pre-existing');
  assert.equal(f.http.calls.some(c=>c.method==='DELETE'),false);
  assert.equal(f.db.data.get('products/book').pendingUpload,null);
});
