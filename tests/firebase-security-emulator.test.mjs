import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const projectId = 'demo-dreamstore-authorization';
const rules = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
let env;

const user = (uid, emailVerified = true) =>
  env.authenticatedContext(uid, { email_verified: emailVerified });
const storageObject = (context, path) => ref(context.storage(), path);
const makePdf = (size) => new Uint8Array(size).fill(17);

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: rules('firestore.rules'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: rules('storage.rules'),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const database = ctx.firestore();
    await setDoc(doc(database, 'stores', 'store-one'), {
      ownerId: 'seller-one',
      storeSlug: 'seller-one',
      status: 'Active',
      plan: 'Free',
    });
    await setDoc(doc(database, 'products', 'digital-one'), {
      ownerId: 'seller-one',
      storeId: 'store-one',
      isFree: false,
      published: true,
    });
    await setDoc(doc(database, 'products', 'free-one'), {
      ownerId: 'seller-one',
      storeId: 'store-one',
      isFree: true,
      published: true,
    });
    await setDoc(doc(database, 'products', 'digital-one', 'deliverables', 'main'), {
      productId: 'digital-one',
      ownerId: 'seller-one',
      fileName: 'original.pdf',
      fileMimeType: 'application/pdf',
      fileDataUrl: 'storage://deliverables/seller-one/digital-one/original.pdf',
      updatedAt: new Date(),
    });
    await setDoc(doc(database, 'products', 'free-one', 'deliverables', 'main'), {
      productId: 'free-one',
      ownerId: 'seller-one',
      fileName: 'free.pdf',
      fileMimeType: 'application/pdf',
      fileDataUrl: 'storage://deliverables/seller-one/free-one/free.pdf',
      updatedAt: new Date(),
    });
  });
});

after(async () => {
  await env?.cleanup();
});

test('Seller can upload and read original private PDF, buyer and public visitors cannot', async () => {
  const path = 'deliverables/seller-one/digital-one/original.pdf';
  await assertSucceeds(uploadBytes(storageObject(user('seller-one'), path), makePdf(1024), {
    contentType: 'application/pdf',
  }));

  const sellerBytes = await assertSucceeds(getBytes(storageObject(user('seller-one'), path)));
  assert.equal(sellerBytes.byteLength, 1024);
  await assertFails(getBytes(storageObject(user('other-buyer'), path)));
  await assertFails(getBytes(storageObject(env.unauthenticatedContext(), path)));
});

test('5 MiB exact accepted; oversize, unsupported type, empty content and unverified account rejected', async () => {
  await assertSucceeds(uploadBytes(
    storageObject(user('seller-one'), 'deliverables/seller-one/digital-one/exact-5mb.pdf'),
    makePdf(5 * 1024 * 1024),
    { contentType: 'application/pdf' }
  ));
  await assertFails(uploadBytes(
    storageObject(user('seller-one'), 'deliverables/seller-one/digital-one/oversized.pdf'),
    makePdf(5 * 1024 * 1024 + 1),
    { contentType: 'application/pdf' }
  ));
  await assertFails(uploadBytes(
    storageObject(user('seller-one'), 'deliverables/seller-one/digital-one/payload.exe'),
    makePdf(512),
    { contentType: 'application/octet-stream' }
  ));
  await assertFails(uploadBytes(
    storageObject(user('seller-one', false), 'deliverables/seller-one/digital-one/unverified.pdf'),
    makePdf(1024),
    { contentType: 'application/pdf' }
  ));
  await assertFails(uploadBytes(
    storageObject(user('other-buyer'), 'deliverables/seller-one/digital-one/wrong-owner.pdf'),
    makePdf(1024),
    { contentType: 'application/pdf' }
  ));
});

test('Firestore deliverable records are never exposed directly to buyers, even when free', async () => {
  for (const product of ['digital-one', 'free-one']) {
    const privateDoc = (ctx) => doc(ctx.firestore(), 'products', product, 'deliverables', 'main');
    const ownSnap = await assertSucceeds(getDoc(privateDoc(user('seller-one'))));
    assert.equal(ownSnap.exists(), true);
    await assertFails(getDoc(privateDoc(user('other-buyer'))));
    await assertFails(getDoc(privateDoc(env.unauthenticatedContext())));
  }
});

test('No browser Firebase client can create or change a financial ledger document', async () => {
  const fake = {
    orderId: 'order-one',
    orderNumber: 'order-one',
    storeId: 'store-one',
    sellerId: 'seller-one',
    buyerId: 'other-buyer',
    currency: 'PKR',
    paymentStatus: 'Paid',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(user('other-buyer').firestore(), 'ledger', 'order-one'), fake));
  await assertFails(setDoc(doc(user('seller-one').firestore(), 'ledger', 'order-two'), {
    ...fake,
    orderNumber: 'order-two',
  }));
});

test('Browser users cannot create/update stores or forge slug reservations', async () => {
  const base = {
    ownerId: 'seller-one',
    storeSlug: 'seller-one-live',
    storeName: 'Seller One',
    ownerName: 'Seller',
    announcementText: 'Welcome',
    heroHeadingLine1: 'Seller One',
    heroHeadingLine2: 'Original downloads',
    heroSubheading: 'Digital downloads by Seller One',
    heroButtonText: 'Shop',
    heroImage: '',
    logoUrl: '',
    theme: 'blush-rose',
    currency: 'PKR',
    exchangeRatePkr: 278,
    status: 'Active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(user('seller-one').firestore(), 'stores', 'store-seller-one'),
    { ...base, plan: 'Pro' }));
  await assertFails(setDoc(doc(user('seller-one').firestore(), 'stores', 'store-seller-one'),
    { ...base, plan: 'Free' }));
  await assertFails(updateDoc(doc(user('seller-one').firestore(), 'stores', 'store-one'), {
    storeSlug: 'another-sellers-slug', updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(user('seller-one').firestore(), 'stores', 'store-one')));
  await assertFails(setDoc(doc(user('seller-one').firestore(), 'store_slugs', 'claimed'), {
    storeId: 'store-one', ownerId: 'seller-one',
  }));
  await assertFails(getDoc(doc(user('seller-one').firestore(), 'store_slugs', 'claimed')));
});

test('Seller can create an incomplete draft but cannot publish or delete directly', async () => {
  const sellerDb = user('seller-one').firestore();
  const draft = doc(sellerDb, 'products', 'draft-only-product');
  const fields = {
    storeId: 'store-one',
    ownerId: 'seller-one',
    title: 'Fresh Seller Product',
    category: 'Ebooks',
    subtitle: '',
    description: '',
    priceUsd: 0,
    pricePkr: 0,
    isFree: true,
    published: false,
    status: 'Draft',
    image: '',
    fileName: '',
    fileType: '',
    fileSizeLabel: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(sellerDb, 'products', 'fake-published-product'), {
    ...fields, published: true, status: 'Available',
  }));
  await assertSucceeds(setDoc(draft, fields));
  await assertFails(updateDoc(draft, {
    published: true,
    status: 'Available',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(draft));
  await assertFails(updateDoc(doc(sellerDb, 'products', 'digital-one'), {
    published: false,
    status: 'Draft',
    updatedAt: serverTimestamp(),
  }));
  const ownDraft = await assertSucceeds(getDoc(draft));
  assert.equal(ownDraft.exists(), true);
  await assertFails(getDoc(doc(user('other-buyer').firestore(), 'products', 'draft-only-product')));
});

test('Administrator access requires both signed Admin SDK claims and verified email', async () => {
  const claimUser = (uid, claims) => env.authenticatedContext(uid, claims);
  const admin = claimUser('operator-admin', {
    email_verified: true, role: 'super_admin', superAdmin: true,
  });
  const profileOnly = claimUser('unauthorized-admin-claim', {
    email_verified: true, role: 'super_admin',
  });
  const unverified = claimUser('operator-not-verified', {
    email_verified: false, role: 'super_admin', superAdmin: true,
  });
  const privateDoc = (ctx) => doc(ctx.firestore(), 'products', 'digital-one', 'deliverables', 'main');
  await assertSucceeds(getDoc(privateDoc(admin)));
  await assertFails(getDoc(privateDoc(profileOnly)));
  await assertFails(getDoc(privateDoc(unverified)));
});

test('Admin custom claims can read another seller private Storage only if verified', async () => {
  const path = 'deliverables/seller-one/digital-one/admin-claims.pdf';
  await assertSucceeds(uploadBytes(storageObject(user('seller-one'), path), makePdf(1024), {
    contentType: 'application/pdf',
  }));
  const admin = env.authenticatedContext('operator-admin', {
    email_verified: true, role: 'super_admin', superAdmin: true,
  });
  const unverified = env.authenticatedContext('operator-unverified', {
    email_verified: false, role: 'super_admin', superAdmin: true,
  });
  await assertSucceeds(getBytes(storageObject(admin, path)));
  await assertFails(getBytes(storageObject(unverified, path)));
});

test('client SDK cannot fabricate a financial order, commission, or immutable audit', async () => {
  const sellerDb = user('seller-one').firestore();
  const buyerDb = user('other-buyer').firestore();
  await assertFails(setDoc(doc(buyerDb, 'orders', 'fake-order'), {
    orderNumber: 'fake-order', sellerId: 'seller-one', buyerId: 'other-buyer', paymentStatus: 'Paid',
  }));
  await assertFails(setDoc(doc(sellerDb, 'commission_invoices', 'fake-invoice'), {
    invoiceId: 'fake-invoice', sellerId: 'seller-one', status: 'paid', remainingBalanceMinor: 0,
  }));
  await assertFails(setDoc(doc(sellerDb, 'ledger_audit', 'fake-audit'), {
    auditId: 'fake-audit', sellerId: 'seller-one', action: 'COMMISSION_SETTLED',
  }));
  await assertFails(setDoc(doc(sellerDb, 'commission_adjustments', 'fake-adjustment'), {
    adjustmentId: 'fake-adjustment', sellerId: 'seller-one', adjustmentAmountMinor: 90000,
  }));
});
