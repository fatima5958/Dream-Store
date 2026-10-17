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
import { createFirestoreFinancialRepository } from '../server/v2/modules/finance-repository.ts';
import { createFirestoreAdminManagementRepository } from '../server/v2/modules/admin-management.ts';
import { assertIsolatedV2Environment } from '../server/v2/config/staging.ts';
import { createSupabaseStorageBucket } from '../server/v2/storage/supabase.ts';
import { createCoverReader } from '../server/v2/storage/covers.ts';
import { supabaseConfig, syntheticSecret, syntheticSupabase } from './fixtures/supabase-storage.mjs';

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
  const management = createFirestoreAdminManagementRepository(db);
  const deps = { auth: createFirebaseVerifier(auth), profiles, stores, creators: createCreatorCampaignRepository(db),
    products: createFirestoreProductRepository(db, bucket), uploads: createFirebaseUploadRepository(db, bucket),
    finance: createFirestoreFinancialRepository(db, bucket, 'emulator-only-invoice-signing-secret-0123456789abcdef'),
    management, subscriptions: management,
    readiness: { check: async () => true }, adminUid: identities.admin.uid, allowWrites: true, allowUnsignedEmulatorTokens: true,
    paidCheckoutEnabled: true, downloadTokenSecret: 'emulator-only-signing-secret-0123456789abcdef' };
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
  for (const name of ['seller','other','buyer','buyer2','legacyBuyer','admin','claim99','claim100','claim101','supaseller','supabuyer','supaother']) {
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
  for (const name of ['seller','other','buyer','buyer2']) {
    const result=await request('/api/users/profile',name,{role:name==='buyer'?'buyer':'seller',displayName:name});assert.equal(result.status,200);
  }
  const created=await request('/api/stores/create','seller',{storeName:'Seller Books',storeSlug:'seller-books'});
  assert.equal(created.status,201); const storeId=created.body.store.storeId;
  assert.equal((await request('/api/subscriptions','seller',{status:'Waitlist'})).status,200);
  assert.equal((await request('/api/subscriptions?storeId='+storeId,'other')).status,403);
  assert.equal((await request('/api/admin/subscriptions/grant-pro','seller',{storeId,grantPro:true})).status,403);
  const proGrant=await request('/api/admin/subscriptions/grant-pro','admin',{storeId,grantPro:true});
  assert.equal(proGrant.status,200);assert.equal((await db.collection('stores').doc(storeId).get()).get('plan'),'Pro');
  assert.equal((await db.collection('subscriptions').doc('sub-'+storeId).get()).get('plan'),'Pro');
  assert.equal((await request('/api/commission/admin/grant-pro','admin',{storeId,grantPro:false})).status,200);
  assert.equal((await db.collection('stores').doc(storeId).get()).get('plan'),'Free');
  assert.equal((await request('/api/entitlements/'+identities.seller.uid,'seller')).body.hasProEntitlement,false);
  assert.equal((await request('/api/stores/update','other',{storeId,updates:{storeName:'Stolen'}})).status,403);
  assert.equal((await request('/api/stores/update','buyer',{storeId,updates:{storeName:'Stolen'}})).status,403);
  assert.equal((await request('/api/stores/update','seller',{storeId,updates:{storeName:'Updated Books'}})).status,200);
  const retry=await request('/api/stores/create','seller',{storeId,storeName:'Stale',storeSlug:'seller-books'});assert.equal(retry.status,200);
  const product={id:'v2-book',storeId,title:'Actual Book',category:'Ebooks',isFree:false,published:false,priceUsd:10,pricePkr:2780};
  assert.equal((await request('/api/products/upsert','seller',product)).status,200);
  assert.equal((await request('/api/products?storeId='+storeId)).body.products.length,0);
  const uploaded=await request('/api/uploads/product','seller',Buffer.from('%PDF-1.7\nHello\n%%EOF'),'POST',{'Content-Type':'application/octet-stream','X-Product-ID':product.id,'X-Store-ID':storeId,'X-File-Name':'book.pdf','X-File-Type':'application/pdf'});
  assert.equal(uploaded.status,200);
  assert.equal((await request('/api/products/upsert','seller',{...product,published:true,fileName:'book.pdf',fileDataUrl:uploaded.body.fileReference})).status,200);
  assert.equal((await request('/api/payment-settings/save','seller',{storeId,jazzCashMerchantId:'merchant-123',jazzCashEnabled:true})).status,200);
  const checkoutBody={idempotencyKey:'idem-v2-paid-order-0001',storeId,buyerId:identities.buyer.uid,customerEmail:'buyer@example.test',currency:'PKR',paymentMethod:'jazzcash',paymentReference:'TXN-12345',items:[{id:product.id,quantity:1}]};
  const parallel=await Promise.all([request('/api/checkout/validate-and-prepare','buyer',checkoutBody),request('/api/checkout/validate-and-prepare','buyer',checkoutBody)]);
  assert.ok(parallel.every(result=>result.status===200||result.status===201));
  assert.equal(parallel.filter(result=>result.body.duplicate===true).length,1);
  assert.equal((await request('/api/checkout/validate-and-prepare','buyer',{...checkoutBody,paymentReference:'TXN-CHANGED-REFERENCE'})).status,409,
    'An idempotency key cannot be replayed with changed purchase details');
  const orderNumber=parallel.find(result=>result.body.orderNumber)?.body.orderNumber;
  const gatewayStatus=await request('/api/payments/gateway-status');
  assert.equal(gatewayStatus.status,200);assert.equal(gatewayStatus.body.jazzcashConfigured,false);
  assert.equal(gatewayStatus.body.stripeConfigured,false);assert.equal(gatewayStatus.body.paidCheckoutEnabled,true,
    'Explicit paid-checkout opt-in is permitted only in this isolated emulator test');
  assert.equal((await request('/api/webhooks/test-provider','buyer',{})).status,503);
  assert.equal((await request('/api/orders/list','buyer')).body.orders.length,1);
  assert.equal((await request('/api/delivery/verify-download','buyer',{orderNumber,productId:product.id,buyerId:identities.buyer.uid,downloadToken:'LOCKED-PENDING-VERIFICATION'})).status,403);
  assert.equal((await request('/api/orders/list','buyer2')).body.orders.length,0);
  assert.equal((await request('/api/checkout/validate-and-prepare','buyer2',{...checkoutBody,buyerId:identities.buyer2.uid,customerEmail:'buyer2@example.test',idempotencyKey:'idem-v2-dupe-reference-01'})).status,409);
  const secondOrder=await request('/api/checkout/validate-and-prepare','buyer2',{...checkoutBody,buyerId:identities.buyer2.uid,customerEmail:'buyer2@example.test',idempotencyKey:'idem-v2-second-buyer-0001',paymentReference:'TXN-98765'});
  assert.equal(secondOrder.status,201);
  assert.equal((await request('/api/orders/list','buyer')).body.orders.length,1);
  assert.equal((await request('/api/orders/list','buyer2')).body.orders.length,1);
  assert.equal((await request('/api/orders/verify-payment','other',{orderNumber,newStatus:'Paid',statementConfirmed:true})).status,403);
  assert.equal((await request('/api/orders/verify-payment','buyer',{orderNumber,newStatus:'Paid',statementConfirmed:true})).status,403);
  assert.equal((await request('/api/orders/verify-payment',null,{orderNumber,newStatus:'Paid',statementConfirmed:true})).status,401);
  assert.equal((await request('/api/orders/verify-payment','seller',{orderNumber,newStatus:'Paid',statementConfirmed:false})).status,422);
  const verified=await request('/api/orders/verify-payment','seller',{orderNumber,newStatus:'Paid',statementConfirmed:true});
  assert.equal(verified.status,200);assert.equal(verified.body.commissionStatus,'outstanding');
  assert.equal(verified.body.paymentEvidence.externalProviderVerified,false,
    'Seller attestation must never be represented as gateway/bank verification');
  assert.equal((await db.collection('commission_entries').doc(orderNumber).get()).get('platformCommissionMinor'),13900);
  const auditedOrders=await request('/api/orders/list','buyer');
  assert.equal(auditedOrders.body.orders.find(order=>order.orderNumber===orderNumber).paymentEvidence.attestedByUid,identities.seller.uid);
  assert.equal(auditedOrders.body.audits.some(audit=>audit.action==='MANUAL_PAYMENT_VERIFIED'&&audit.actorUid===identities.seller.uid),true);
  const downloadBody={orderNumber,productId:product.id,buyerId:identities.buyer.uid,downloadToken:verified.body.downloadToken};
  const downloaded=await request('/api/delivery/verify-download','buyer',downloadBody);
  assert.equal(downloaded.status,200);assert.equal(downloaded.body.allowed,true);assert.match(downloaded.body.fileDataUrl,/^data:application\/pdf;base64,/);
  assert.equal((await request('/api/delivery/verify-download','buyer',downloadBody)).status,403);
  assert.equal((await request('/api/orders/refund','seller',{orderNumber,refundConfirmed:true,refundReference:'RF-12345'})).status,200);
  assert.equal((await request('/api/downloads/token','buyer',{orderNumber})).status,403);
  assert.equal((await db.collection('commission_adjustments').doc(orderNumber+':refund').get()).get('reason'),'order_refunded');

  // The first paid sale was refunded, so five fresh verified sales are needed
  // before the V1-compatible commission threshold produces an invoice.
  const additional=[];
  for(let i=0;i<4;i++){
    const buyer=i%2===0?'buyer':'buyer2';
    const checkout=await request('/api/checkout/validate-and-prepare',buyer,{...checkoutBody,
      buyerId:identities[buyer].uid,customerEmail:buyer+'@example.test',idempotencyKey:`idem-v2-invoice-${i}-0001`,
      paymentReference:`TXN-INVOICE-${i}-10001`});
    assert.equal(checkout.status,201);
    additional.push(checkout.body.orderNumber);
  }
  const eligibleOrders=[secondOrder.body.orderNumber,...additional];
  for(const number of eligibleOrders){
    const pendingOrder=await db.collection('ledger').doc(number).get();
    const sellerResult=await request('/api/orders/verify-payment','seller',{orderNumber:number,newStatus:'Paid',
      declaredPaymentMethod:pendingOrder.get('paymentMethod'),statementConfirmed:true});
    assert.equal(sellerResult.status,200);
  }
  const summary=await request('/api/commission/status?sellerId='+encodeURIComponent(identities.seller.uid),'seller');
  assert.equal(summary.status,200);assert.equal(summary.body.invoices.length,1);
  const invoice=summary.body.invoices[0];
  assert.equal(invoice.verifiedSalesCount,5);assert.equal(invoice.commissionAmountMinor,69500);
  assert.equal((await request('/api/commission/status?sellerId='+encodeURIComponent(identities.seller.uid),'buyer')).status,403);
  assert.equal((await request('/api/commission/submit-payment','other',{invoiceId:invoice.invoiceId,amountMinor:invoice.remainingBalanceMinor,
    paymentMethod:'manual_bank',paymentReference:'CPAY-FOREIGN-001'})).status,403);
  const proof=await request('/api/commission/submit-payment','seller',{invoiceId:invoice.invoiceId,
    amountMinor:invoice.remainingBalanceMinor,paymentMethod:'manual_bank',paymentReference:'CPAY-TEST-0001',
    proofNote:'Synthetic staging-only transfer reference'});
  assert.equal(proof.status,200);assert.equal(proof.body.payment.status,'submitted');
  assert.equal((await request('/api/commission/submit-payment','buyer',{invoiceId:invoice.invoiceId,
    amountMinor:invoice.remainingBalanceMinor,paymentMethod:'manual_bank',paymentReference:'CPAY-BUYER-001'})).status,403);
  assert.equal((await request('/api/commission/submit-payment','seller',{invoiceId:invoice.invoiceId,
    amountMinor:invoice.remainingBalanceMinor,paymentMethod:'manual_bank',paymentReference:'CPAY-TEST-0001'})).status,409);
  assert.equal((await request('/api/admin/commission/verify-payment','seller',{invoiceId:invoice.invoiceId,
    paymentId:proof.body.payment.paymentId,decision:'approve',fundsConfirmed:true})).status,403);
  assert.equal((await request('/api/admin/commission-config','seller',{newCommissionBps:500})).status,403);
  assert.equal((await request('/api/admin/commission-config','admin',{newCommissionBps:250})).status,409);
  assert.equal((await request('/api/admin/commission-config','admin',{newCommissionBps:500})).body.platformCommissionBps,500);
  assert.equal((await request('/api/admin/commission/verify-payment','admin',{invoiceId:invoice.invoiceId,
    paymentId:proof.body.payment.paymentId,decision:'approve',fundsConfirmed:false})).status,422);
  const settlement=await request('/api/admin/commission/verify-payment','admin',{invoiceId:invoice.invoiceId,
    paymentId:proof.body.payment.paymentId,decision:'approve',fundsConfirmed:true});
  assert.equal(settlement.status,200);assert.equal(settlement.body.invoice.status,'paid');
  assert.equal(settlement.body.payment.reviewMode,'Super Admin Attested Cleared Funds');
  assert.equal((await request('/api/admin/commission/verify-payment','admin',{invoiceId:invoice.invoiceId,
    paymentId:proof.body.payment.paymentId,decision:'approve',fundsConfirmed:true})).status,409);
  const page=await request('/api/stores/by-slug/seller-books');assert.equal(page.status,200);
  assert.equal(page.body.store.storeName,'Updated Books');assert.equal(page.body.products.length,1);assert.equal(page.body.products[0].fileDataUrl,undefined);
  await new Promise(resolve=>server.close(resolve));await start();
  assert.equal((await request('/api/users/profile','seller')).body.profile.storeId,storeId);
  assert.equal((await request('/api/stores/seller-books')).body.products.length,1);
  assert.equal((await request('/api/orders/list','buyer')).body.orders.find(order=>order.orderNumber===orderNumber).paymentStatus,'Refunded');
  const filename=uploaded.body.fileReference.slice('storage://'.length);
  const privateRead=await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media`);
  assert.equal(privateRead.status,403);
  // Rules must reject client-side writes even with a legitimate Seller token.
  const forged=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/${config.firestoreDatabaseId}/documents/products/forged`,{method:'PATCH',headers:{Authorization:'Bearer '+tokens.seller,'Content-Type':'application/json'},body:JSON.stringify({fields:{ownerId:{stringValue:identities.seller.uid},published:{booleanValue:true}}})});
  assert.equal(forged.status,403);
  const suspended=await request('/api/admin/stores/status','admin',{storeId,status:'suspended'});
  assert.equal(suspended.status,200);assert.equal(suspended.body.status,'Pending');
  assert.equal((await request('/api/products/delete','seller',{productId:product.id})).status,403);
  assert.equal((await request('/api/stores/seller-books')).status,404);
  const storeAudit=await db.collection('admin_audit').where('targetId','==',storeId).get();
  assert.ok(storeAudit.size>=1);
  assert.equal((await request('/api/admin/stores/status','admin',{storeId,status:'active'})).status,200);
  assert.equal((await request('/api/products/delete','seller',{productId:product.id})).status,200);
});

test('real named Firestore dispute lifecycle is isolated, audited and serialized against invoice settlement', async () => {
  const prefix='EMU-PHASE6-DISPUTE';
  for(let i=1;i<=5;i++) {
    const row={orderNumber:`${prefix}-${i}`,orderId:`${prefix}-order-${i}`,sellerId:identities.seller.uid,
    storeId:'store-'+identities.seller.uid.slice(0,20),buyerId:identities.buyer.uid,currency:'PKR',
    grossAmountMinor:10000,platformCommissionMinor:500,commissionRateBps:500,paymentMethod:'jazzcash',
    paymentStatus:'Paid',verificationMode:'Manually Verified by Seller',commissionStatus:'outstanding',
    createdAtIso:`2026-03-0${i}T00:00:00.000Z`};
    await db.collection('ledger').doc(`${prefix}-${i}`).set(row);
    await db.collection('commission_entries').doc(`${prefix}-${i}`).set({...row,entryId:row.orderNumber,status:'outstanding'});
  }
  const finance=createFirestoreFinancialRepository(db,bucket,'emulator-only-invoice-signing-secret-0123456789abcdef');
  const [invoice]=await finance.issueCommissionInvoices(identities.seller.uid);
  assert.equal(invoice.verifiedSalesCount,5);assert.equal(invoice.commissionAmountMinor,2500);
  assert.equal((await request('/api/ledger/commission-status','buyer',{orderNumber:`${prefix}-1`,newCommissionStatus:'disputed',note:'Buyer is not permitted to file Seller commission disputes.'})).status,403);
  assert.equal((await request('/api/ledger/commission-status','other',{orderNumber:`${prefix}-1`,newCommissionStatus:'disputed',note:'Unrelated Seller cannot dispute another Seller commission.'})).status,403);
  const submitted=await request('/api/ledger/commission-status','seller',{orderNumber:`${prefix}-1`,newCommissionStatus:'disputed',note:'Source evidence shows the commission amount needs review.'});
  assert.equal(submitted.status,200);assert.equal(submitted.body.commissionStatus,'disputed');
  await new Promise(resolve=>server.close(resolve));await start();
  assert.equal((await db.collection('commission_disputes').doc(submitted.body.disputeId).get()).get('status'),'pending');
  assert.equal((await request('/api/commission/admin/disputes','seller')).status,403);
  const listed=await request('/api/commission/admin/disputes?limit=10','admin');
  assert.equal(listed.status,200);assert.ok(listed.body.disputes.some(item=>item.disputeId===submitted.body.disputeId));
  assert.equal((await request('/api/commission/submit-payment','seller',{invoiceId:invoice.invoiceId,amountMinor:2500,
    paymentMethod:'manual_bank',paymentReference:'DISPUTE-EMU-PAYMENT'})).status,409);
  const decision={disputeId:submitted.body.disputeId,decision:'approve',explanation:'Evidence confirms the order was not eligible for this invoice.'};
  const decisions=await Promise.all([request('/api/commission/admin/disputes/resolve','admin',decision),
    request('/api/commission/admin/disputes/resolve','admin',decision)]);
  assert.equal(decisions.filter(item=>item.status===200).length,1);
  assert.equal(decisions.filter(item=>item.status===409).length,1);
  const savedInvoice=await db.collection('commission_invoices').doc(invoice.invoiceId).get();
  assert.equal(savedInvoice.get('remainingBalanceMinor'),2000);assert.equal(savedInvoice.get('adjustedAmountMinor'),500);
  const order=await db.collection('ledger').doc(`${prefix}-1`).get();assert.equal(order.get('commissionStatus'),'reversed');
  const audit=await db.collection('ledger_audit').where('disputeId','==',submitted.body.disputeId).get();assert.equal(audit.size,2);
});

test('real Firestore competing founder claims stop exactly at 100', async () => {
  await db.collection('creator_launch_campaigns').doc('first-100-creators').set({claimedCount:98,limit:100});
  for(const name of ['claim99','claim100','claim101']) assert.equal((await request('/api/users/profile',name,{role:'seller',displayName:name})).status,200);
  const attempts=await Promise.all(['claim99','claim100','claim101'].map(name=>request('/api/stores/create',name,{storeName:name,storeSlug:name})));
  assert.equal(attempts.filter(result=>result.status===201).length,2);
  assert.equal(attempts.filter(result=>result.body.code==='creator-spots-full').length,1);
  assert.equal((await db.collection('creator_launch_campaigns').doc('first-100-creators').get()).get('claimedCount'),100);
});

test('Firebase Auth emulator signup stays unverified until Admin verification; only verified Seller store creation claims a spot', async () => {
  async function signup(name) {
    const email = `${name}@example.test`, password = 'Emulator-only-123!';
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    identities[name] = { uid: data.localId };
    tokens[name] = data.idToken;
    assert.equal((await auth.getUser(data.localId)).emailVerified, false);
    return { email, password, uid: data.localId };
  }
  async function refreshSignIn(name, email, password) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(await response.text());
    tokens[name] = (await response.json()).idToken;
  }
  const counterRef = db.collection('creator_launch_campaigns').doc('first-100-creators');
  await counterRef.set({ claimedCount: 17, limit: 100 });
  const initial = await counterRef.get();
  const initialCount = initial.exists ? Number(initial.get('claimedCount') || 0) : 0;

  const buyer = await signup('signup-buyer');
  assert.equal((await request('/api/users/profile', 'signup-buyer', { role: 'buyer', displayName: 'Signup Buyer' })).status, 403,
    'Unverified email cannot complete role onboarding');
  await auth.updateUser(buyer.uid, { emailVerified: true });
  await refreshSignIn('signup-buyer', buyer.email, buyer.password);
  assert.equal((await request('/api/users/profile', 'signup-buyer', { role: 'buyer', displayName: 'Signup Buyer' })).status, 200);
  assert.equal((await counterRef.get()).get('claimedCount') || 0, initialCount,
    'Buyer signup and role onboarding never consume a Creator claim');

  const seller = await signup('signup-seller');
  assert.equal((await request('/api/users/profile', 'signup-seller', { role: 'seller', displayName: 'Signup Seller' })).status, 403);
  await auth.updateUser(seller.uid, { emailVerified: true });
  await refreshSignIn('signup-seller', seller.email, seller.password);
  assert.equal((await request('/api/users/profile', 'signup-seller', { role: 'seller', displayName: 'Signup Seller' })).status, 200);
  assert.equal((await request('/api/stores/create', 'signup-seller', { storeName: 'Verified Signup', storeSlug: 'signup-verified' })).status, 201);
  assert.equal((await counterRef.get()).get('claimedCount'), initialCount + 1,
    'The claim increments only after verified Seller store creation succeeds');
  assert.equal((await db.collection('creator_launch_claims').doc(seller.uid).get()).exists, true);
  assert.equal((await db.collection('creator_launch_claims').doc(buyer.uid).get()).exists, false);
});

test('returning Buyer with exact historical UID order restores Buyer access without profile mutation', async () => {
  const uid = identities.legacyBuyer.uid;
  await db.collection('ledger').doc('DS-historic-buyer').set({ orderNumber:'DS-historic-buyer', buyerId:uid,
    customerName:'Legacy Buyer', customerEmail:'legacy@example.test', sellerId:'historic-seller', paymentStatus:'Paid' });
  const restored = await request('/api/users/profile','legacyBuyer');
  assert.equal(restored.status,200);
  assert.equal(restored.body.profile.role,'buyer');
  assert.equal(restored.body.profile.onboardingCompleted,true);
  assert.equal(restored.body.profile.email,'legacybuyer@example.test');
  assert.equal((await db.collection('users').doc(uid).get()).exists,false,'restoration is a read-only compatibility projection');
  assert.equal((await request('/api/orders/list','legacyBuyer')).body.orders.length,1);
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

test('real Auth/named Firestore + official Supabase SDK HTTP double: ownership, free delivery and restart persistence', async () => {
  // Firebase services here are actual local emulators. Only Supabase HTTP is a
  // controlled double; this does not claim live Supabase or cloud IAM validation.
  const http = syntheticSupabase();
  const signingSecret = 'phase11-emulator-signing-secret-0123456789';
  const privateBucket = createSupabaseStorageBucket(supabaseConfig, syntheticSecret, http.fetcher);
  const storeId = 'phase11-supabase-store', productId = 'phase11-supabase-book';
  await db.collection('stores').doc(storeId).set({ ownerId: identities.supaseller.uid,
    storeSlug: 'phase11-supabase-store', storeName: 'Synthetic Stage', status: 'Active', plan: 'Free' });
  const campaignRef = db.collection('creator_launch_campaigns').doc('first-100-creators');
  const initialCount = (await campaignRef.get()).get('claimedCount');
  let instance;
  async function restart() {
    if (instance) await new Promise(resolve => instance.close(resolve));
    const deps = { auth: createFirebaseVerifier(auth), profiles: createFirestoreProfileRepository(db),
      creators: createCreatorCampaignRepository(db), products: createFirestoreProductRepository(db, privateBucket),
      uploads: createFirebaseUploadRepository(db, privateBucket), covers: createCoverReader(privateBucket),
      finance: createFirestoreFinancialRepository(db, privateBucket, signingSecret),
      readiness: { async check() { await privateBucket.checkReady(); return true; } },
      allowWrites: true, allowUnsignedEmulatorTokens: true, paidCheckoutEnabled: false,
      adminUid: identities.admin.uid, downloadTokenSecret: signingSecret };
    instance = await new Promise(resolve => { const s = createV2App(deps).listen(0, '127.0.0.1', () => resolve(s)); });
  }
  async function call(path, name, body, binary = false, headers = {}) {
    const response = await fetch('http://127.0.0.1:' + instance.address().port + path, {
      method: body === undefined ? 'GET' : 'POST', headers: {
        ...(name ? { Authorization: 'Bearer ' + tokens[name] } : {}),
        ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }), ...headers,
      }, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  await restart();
  try {
    for (const [name, role] of [['supaseller','seller'],['supabuyer','buyer'],['supaother','seller']]) {
      assert.equal((await call('/api/users/profile', name, { role, displayName: 'Synthetic ' + name })).status, 200);
    }
    const draft = { id: productId, storeId, title: 'Synthetic Original', category: 'Ebooks', isFree: true,
      published: false, priceUsd: 0, pricePkr: 0, image: '' };
    assert.equal((await call('/api/products', 'supaseller', draft)).status, 200);
    const binary = Buffer.from('%PDF-1.7\nPrivate synthetic file\n%%EOF');
    const headers = { 'X-Product-ID': productId, 'X-Store-ID': storeId, 'X-File-Name': 'book.pdf', 'X-File-Type': 'application/pdf' };
    for (const [name, status] of [[null,401],['supabuyer',403],['supaother',403]]) {
      assert.equal((await call('/api/uploads/product', name, binary, true, headers)).status,status);
    }
    assert.equal(http.objects.size,0);
    assert.equal((await call('/api/uploads/product','supaseller',binary,true,headers)).status,200);
    const saved = await db.collection('products').doc(productId).collection('deliverables').doc('main').get();
    assert.equal(saved.get('storageProvider'),'supabase'); assert.equal(saved.get('storageBucket'),supabaseConfig.bucket);
    assert.equal((await call('/api/products','supaseller',{...draft,published:true,fileName:'book.pdf'})).status,200);
    const publicProducts=await call('/api/products?storeId='+storeId);
    assert.equal(publicProducts.status,200);assert.doesNotMatch(JSON.stringify(publicProducts.body),/storageBucket|storageProvider|storage:\/\//);
    const free=await call('/api/checkout/validate-and-prepare','supabuyer',{storeId,currency:'PKR',paymentMethod:'free_instant',items:[{id:productId,quantity:1}],idempotencyKey:'phase11-emulator-free-idem'});
    assert.equal(free.status,201);
    const download={orderNumber:free.body.orderNumber,productId,downloadToken:free.body.downloadToken};
    assert.equal((await call('/api/delivery/verify-download','supaother',download)).status,403);
    await restart();
    const restored=await call('/api/users/profile','supaseller');assert.equal(restored.body.profile.storeId,storeId);
    const delivered=await call('/api/delivery/verify-download','supabuyer',download);
    assert.equal(delivered.status,200);assert.equal(delivered.body.fileDataUrl,'data:application/pdf;base64,'+binary.toString('base64'));
    assert.equal((await db.collection('ledger').doc(free.body.orderNumber).get()).get('downloadCount'),1);
    assert.equal((await call('/api/delivery/verify-download','supabuyer',download)).status,403);
    assert.equal((await campaignRef.get()).get('claimedCount'),initialCount,'storage/provider operations never consume creator spots');
  } finally { if(instance) await new Promise(resolve=>instance.close(resolve)); }
});
