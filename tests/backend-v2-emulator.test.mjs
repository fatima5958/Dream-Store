import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { createV2App } from '../server/v2/app.ts';
import { createFirebaseVerifier } from '../server/v2/modules/auth.ts';
import { createFirestoreProfileRepository } from '../server/v2/modules/users.ts';
import { createFirestoreStoreRepository } from '../server/v2/modules/stores.ts';
import { createCreatorCampaignRepository } from '../server/v2/modules/creators.ts';
import { createFirestoreProductRepository } from '../server/v2/modules/products.ts';
import { createFirebaseUploadRepository } from '../server/v2/modules/uploads.ts';
import { assertIsolatedV2Environment } from '../server/v2/config/staging.ts';

let app, db, auth, bucket, server, base, profiles, stores;
const tokens = {}, identities = {};
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const emulatorConfig = JSON.parse(readFileSync(new URL('../firebase.v2.emulator.json', import.meta.url), 'utf8'));
const projectId = process.env.DREAMSTORE_V2_PROJECT_ID;
async function request(path, caller, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(caller ? { Authorization: 'Bearer ' + tokens[caller] } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra,
  }, ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function start() {
  const deps = { auth: createFirebaseVerifier(auth), profiles, stores, creators: createCreatorCampaignRepository(db),
    products: createFirestoreProductRepository(db, bucket), uploads: createFirebaseUploadRepository(db, bucket),
    readiness: { check: async () => true }, adminUid: identities.admin.uid, allowWrites: true, allowUnsignedEmulatorTokens: true };
  const express = createV2App(deps);
  server = await new Promise(resolve => { const s = express.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
}
before(async () => {
  assertIsolatedV2Environment(process.env);
  process.env.STORAGE_EMULATOR_HOST = 'http://' + process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  app = initializeApp({ projectId }, 'v2-emulator-test');
  db = getFirestore(app, config.firestoreDatabaseId);
  auth = getAuth(app); bucket = getStorage(app).bucket(projectId + '.appspot.com');
  // Only the explicitly guarded demo project is reset. Never production data.
  const reset = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/${config.firestoreDatabaseId}/documents`, { method: 'DELETE' });
  assert.equal(reset.ok, true);
  for (const name of ['seller','other','buyer','admin','claim99','claim100','claim101']) {
    const uid = 'v2-' + name;
    await auth.deleteUser(uid).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
    identities[name] = await auth.createUser({ uid, email: name+'@example.test', emailVerified: true, password:'Emulator-only-123!' });
    if (name === 'admin') await auth.setCustomUserClaims(uid, { role: 'super_admin', superAdmin: true });
    const signedIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ email: name+'@example.test', password:'Emulator-only-123!', returnSecureToken:true }) });
    assert.equal(signedIn.ok,true);
    tokens[name] = (await signedIn.json()).idToken;
  }
  profiles = createFirestoreProfileRepository(db); stores = createFirestoreStoreRepository(db);
  await start();
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (app) await deleteApp(app); });

test('V2 emulator explicitly loads closed Firestore rules without unsupported multi-database config', () => {
  assert.equal(Array.isArray(emulatorConfig.firestore), false,
    'firebase-tools does not load Firestore rules from a multi-database config array');
  assert.equal(emulatorConfig.firestore?.rules, 'firestore.v2.rules');
});

test('real Auth/Firestore/Storage: Seller create→update→upload→publish→public view→restart; Buyer stays isolated', async () => {
  for (const name of ['seller','other','buyer']) {
    const result=await request('/api/users/profile',name,{role:name==='buyer'?'buyer':'seller',displayName:name});assert.equal(result.status,200);
  }
  const created=await request('/api/stores/create','seller',{storeName:'Seller Books',storeSlug:'seller-books'});
  assert.equal(created.status,201); const storeId=created.body.store.storeId;
  assert.equal((await request('/api/stores/update','other',{storeId,updates:{storeName:'Stolen'}})).status,403);
  assert.equal((await request('/api/stores/update','buyer',{storeId,updates:{storeName:'Stolen'}})).status,403);
  assert.equal((await request('/api/stores/update','seller',{storeId,updates:{storeName:'Updated Books'}})).status,200);
  const retry=await request('/api/stores/create','seller',{storeId,storeName:'Stale',storeSlug:'seller-books'});assert.equal(retry.status,200);
  const product={id:'v2-book',storeId,title:'Actual Book',category:'Ebooks',isFree:true,published:false,priceUsd:0,pricePkr:0};
  assert.equal((await request('/api/products/upsert','seller',product)).status,200);
  assert.equal((await request('/api/products?storeId='+storeId)).body.products.length,0);
  const uploaded=await request('/api/uploads/product','seller',Buffer.from('%PDF-1.7\nHello\n%%EOF'),'POST',{'Content-Type':'application/octet-stream','X-Product-ID':product.id,'X-Store-ID':storeId,'X-File-Name':'book.pdf','X-File-Type':'application/pdf'});
  assert.equal(uploaded.status,200);
  assert.equal((await request('/api/products/upsert','seller',{...product,published:true,fileName:'book.pdf',fileDataUrl:uploaded.body.fileReference})).status,200);
  const page=await request('/api/stores/by-slug/seller-books');assert.equal(page.status,200);
  assert.equal(page.body.store.storeName,'Updated Books');assert.equal(page.body.products.length,1);assert.equal(page.body.products[0].fileDataUrl,undefined);
  await new Promise(resolve=>server.close(resolve));await start();
  assert.equal((await request('/api/users/profile','seller')).body.profile.storeId,storeId);
  assert.equal((await request('/api/stores/seller-books')).body.products.length,1);
  const filename=uploaded.body.fileReference.slice('storage://'.length);
  const privateRead=await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media`);
  assert.equal(privateRead.status,403);
  // Rules must reject client-side writes even with a legitimate Seller token.
  const forged=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/${config.firestoreDatabaseId}/documents/products/forged`,{method:'PATCH',headers:{Authorization:'Bearer '+tokens.seller,'Content-Type':'application/json'},body:JSON.stringify({fields:{ownerId:{stringValue:identities.seller.uid},published:{booleanValue:true}}})});
  assert.equal(forged.status,403);
  await db.collection('stores').doc(storeId).update({status:'Suspended'});
  assert.equal((await request('/api/products/delete','seller',{productId:product.id})).status,403);
  assert.equal((await request('/api/stores/seller-books')).status,404);
  await db.collection('stores').doc(storeId).update({status:'Active'});
  assert.equal((await request('/api/products/delete','seller',{productId:product.id})).status,200);
});
test('real Firestore competing founder claims stop exactly at 100', async () => {
  await db.collection('creator_launch_campaigns').doc('first-100-creators').set({claimedCount:98,limit:100});
  for(const name of ['claim99','claim100','claim101']) assert.equal((await request('/api/users/profile',name,{role:'seller',displayName:name})).status,200);
  const attempts=await Promise.all(['claim99','claim100','claim101'].map(name=>request('/api/stores/create',name,{storeName:name,storeSlug:name})));
  assert.equal(attempts.filter(result=>result.status===201).length,2);
  assert.equal(attempts.filter(result=>result.body.code==='creator-spots-full').length,1);
  assert.equal((await db.collection('creator_launch_campaigns').doc('first-100-creators').get()).get('claimedCount'),100);
});
test('real emulator Admin claims and invalid tokens remain server-authorized', async () => {
  assert.equal((await request('/api/admin/verify-session','admin')).status,200);
  assert.equal((await request('/api/admin/verify-session','seller')).status,403);
  const invalid=await fetch(base+'/api/users/profile',{headers:{Authorization:'Bearer invalid.token.signature'}});
  assert.equal(invalid.status,401);
  const identity=await auth.getUser(identities.other.uid);
  const issuedAt=JSON.parse(Buffer.from(tokens.other.split('.')[1],'base64url').toString()).iat;
  await new Promise(resolve=>setTimeout(resolve,1100));
  await auth.revokeRefreshTokens(identity.uid);
  assert.equal((await request('/api/users/profile','other')).status,401);
});
