import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFirestore, MemoryBucket } from './fixtures/v2-repositories.mjs';
import { createFirestoreStoreRepository, publicStoreProjection } from '../server/v2/modules/stores.ts';
import { createFirestoreProfileRepository } from '../server/v2/modules/users.ts';
import { createFirestoreProductRepository, productProjection } from '../server/v2/modules/products.ts';
import { createFirebaseUploadRepository, validateFileBytes, MAX_UPLOAD_BYTES, cleanupExpiredUploads } from '../server/v2/modules/uploads.ts';
import { requireSeller } from '../server/v2/modules/policy.ts';
import { assertIsolatedV2Environment } from '../server/v2/config/staging.ts';
const p = uid => ({ uid, email: uid+'@example.test', emailVerified:true, displayName:uid });
const owner = p('seller');
const store = { ownerId:'seller', storeSlug:'books', storeName:'Books', status:'Active', plan:'Free', currency:'PKR', bankTransferInstructions:'secret' };
const draft = { id:'book', storeId:'legacy-store', title:'Real Book', category:'Ebooks', isFree:false, priceUsd:2, pricePkr:556, published:false, image:'' };
const pdf = Buffer.from('%PDF-1.7\nOriginal digital book\n%%EOF');
function fixture() {
  const db=new MemoryFirestore(), bucket=new MemoryBucket();
  db.seed('stores/legacy-store',store);
  return {db,bucket,stores:createFirestoreStoreRepository(db),profiles:createFirestoreProfileRepository(db),products:createFirestoreProductRepository(db,bucket),uploads:createFirebaseUploadRepository(db,bucket)};
}
const code = expected => error => error.code===expected;
const upload = f => f.uploads.save(owner,{ productId:'book',storeId:'legacy-store',fileName:'book.pdf',contentType:'application/pdf',data:pdf,kind:'product' });

test('store creation is durable, preserves caller IDs, and retries cannot overwrite edits',async()=>{
 const f=fixture(), seller=p('new-seller');
 const input={storeId:'store-new-seller',storeSlug:'new-books',storeName:'New Books',currency:'EUR',plan:'Pro'};
 const created=await f.stores.create(seller,input);
 assert.equal(created.existed,false);assert.equal(created.store.plan,'Free');assert.equal(created.creatorClaimNumber,1);
 const retry=await createFirestoreStoreRepository(f.db).create(seller,{...input,storeName:'retry stale value'});
 assert.equal(retry.existed,true);assert.equal(retry.store.storeName,'New Books');
 assert.equal(f.db.data.get('creator_launch_campaigns/first-100-creators').claimedCount,1);
});
test('98→99→100, concurrent 101st rejection and duplicate idempotency',async()=>{
 const f=fixture();f.db.seed('creator_launch_campaigns/first-100-creators',{claimedCount:98});
 const outcomes=await Promise.allSettled(['a','b','c'].map(uid=>f.stores.create(p(uid),{storeName:uid,storeSlug:'store-'+uid})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);
 assert.deepEqual(outcomes.filter(r=>r.status==='fulfilled').map(r=>r.value.creatorClaimNumber),[99,100]);
 assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'creator-spots-full');
 await Promise.all(Array.from({length:8},()=>f.stores.create(p('a'),{storeName:'a',storeSlug:'store-a'})));
 assert.equal(f.db.data.get('creator_launch_campaigns/first-100-creators').claimedCount,100);
});
test('legacy store restoration and update never consume another founder spot',async()=>{
 const f=fixture();assert.equal((await f.profiles.find(owner)).storeId,'legacy-store');
 const restored=await f.stores.create(owner,{storeName:'Old retry',storeSlug:'changed'});
 assert.equal(restored.store.storeId,'legacy-store');
 await f.stores.update(owner,'legacy-store',{storeName:'Updated',storeSlug:'fresh-books'});
 assert.equal((await f.stores.find('fresh-books')).storeName,'Updated');
 assert.equal(f.db.data.has('creator_launch_campaigns/first-100-creators'),false);
 const saved=await f.profiles.save(owner,'seller','Returning');assert.equal(saved.storeId,'legacy-store');
 await assert.rejects(f.profiles.save(owner,'buyer','Returning'),code('profile/store-owner-role'));
});
test('failed slug collision and failed Firestore commits consume no spots',async()=>{
 const f=fixture();
 await assert.rejects(f.stores.create(p('other'),{storeName:'Other',storeSlug:'books'}),code('store/slug-taken'));
 f.db.failCommit=true;
 await assert.rejects(f.stores.create(p('other'),{storeName:'Other',storeSlug:'other-books'}));
 assert.equal(f.db.data.has('creator_launch_campaigns/first-100-creators'),false);
 assert.equal(f.db.data.has('creator_launch_claims/other'),false);
});
test('competing full/truncated IDs cannot create two stores or consume two spots',async()=>{
 const f=fixture(), uid='seller-with-a-very-long-uid';
 const results=await Promise.allSettled([uid,uid.slice(0,20)].map((part,i)=>f.stores.create(p(uid),{storeId:'store-'+part,storeSlug:'long-store-'+i,storeName:'Long'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(f.db.data.get('creator_launch_campaigns/first-100-creators').claimedCount,1);
});
test('cross-seller, unverified and suspended store writes fail closed',async()=>{
 const f=fixture();
 await assert.rejects(f.stores.update(p('attacker'),'legacy-store',{storeName:'Stolen'}),code('store/owner-forbidden'));
 await assert.rejects(f.stores.update({...owner,emailVerified:false},'legacy-store',{storeName:'Unverified'}),code('auth/email-not-verified'));
 f.db.seed('stores/legacy-store',{...store,status:'Suspended'});
 await assert.rejects(f.stores.update(owner,'legacy-store',{storeName:'Hidden'}),code('store/suspended'));
 await assert.rejects(f.stores.create(owner,{storeName:'Hidden',storeSlug:'hidden'}),code('store/suspended'));
});
test('slug changes are atomic and preserve payment config and protected fields',async()=>{
 const f=fixture();f.db.seed('store_slugs/books',{storeId:'legacy-store'});
 f.db.seed('stores/another',{...store,ownerId:'other',storeSlug:'taken'});
 await assert.rejects(f.stores.update(owner,'legacy-store',{storeSlug:'taken'}),code('store/slug-taken'));
 assert.equal(f.db.data.has('store_slugs/books'),true);
 await f.stores.update(owner,'legacy-store',{storeSlug:'updated'});
 assert.equal(f.db.data.has('store_slugs/books'),false);
 assert.equal(f.db.data.get('store_slugs/updated').storeId,'legacy-store');
 assert.equal(f.db.data.get('stores/legacy-store').bankTransferInstructions,'secret');
 for(const patch of [{plan:'Pro'},{ownerId:'other'},{status:'Active'},{theme:'rose-garden'}]) await assert.rejects(f.stores.update(owner,'legacy-store',patch),e=>e.status===403);
});
test('buyer signup consumes no claim and cannot call seller operations',async()=>{
 const f=fixture();await f.profiles.save(p('buyer'),'buyer','Buyer');
 const deps={profiles:f.profiles,allowWrites:true};
 await assert.rejects(requireSeller(p('buyer'),deps),code('store/seller-required'));
 assert.equal(f.db.data.has('creator_launch_claims/buyer'),false);
 await assert.rejects(requireSeller(owner,{...deps,allowWrites:false}),code('backend/staging-readonly'));
});
test('public store and product projections never expose private arbitrary fields',()=>{
 assert.equal(publicStoreProjection('id',{...store,ownerEmail:'secret',nested:{bank:'secret'}}).ownerEmail,undefined);
 const out=productProjection('id',{...draft,fileDataUrl:'storage://secret',downloadToken:'secret',deliverables:{secret:true},storageGeneration:'secret'});
 for(const key of ['fileDataUrl','downloadToken','deliverables','storageGeneration']) assert.equal(Object.hasOwn(out,key),false);
});
test('visits require active real store, persist and deduplicate without leaking stats',async()=>{
 const f=fixture();await assert.rejects(f.stores.visit('missing',false,'ip'),code('store/not-found'));
 await Promise.all(Array.from({length:5},()=>f.stores.visit('books',false,'same-ip')));
 assert.equal(f.db.data.get('stores/legacy-store').visitsCount,1);
 await createFirestoreStoreRepository(f.db).visit('books',true,'same-ip');
 assert.equal(f.db.data.get('stores/legacy-store').checkoutViewsCount,1);
 assert.equal(publicStoreProjection('id',f.db.data.get('stores/legacy-store')).visitsCount,undefined);
});
test('product create/edit/delete survives repository restart and preserves server metrics',async()=>{
 const f=fixture();await f.products.save(owner,draft);
 f.db.seed('products/book',{...f.db.data.get('products/book'),salesCount:4,downloadCount:7});
 const saved=await f.products.save(owner,{...draft,title:'Edited',salesCount:999,downloadCount:999});
 assert.equal(saved.salesCount,4);assert.equal(saved.downloadCount,7);
 const restarted=createFirestoreProductRepository(f.db,f.bucket);
 assert.equal((await restarted.list('legacy-store',owner))[0].title,'Edited');
 await restarted.remove(owner,'book');assert.equal((await restarted.list('legacy-store',owner)).length,0);
 await assert.rejects(restarted.save(owner,draft),code('product/deleted'));
});
test('drafts are owner-only and published listings exclude all private file references',async()=>{
 const f=fixture();await f.products.save(owner,draft);
 assert.equal((await f.products.list('legacy-store')).length,0);
 await upload(f);
 const published=await f.products.save(owner,{...draft,published:true});
 assert.equal(published.published,true);
 const publicProducts=await f.products.list('legacy-store',p('buyer'));
 assert.equal(publicProducts.length,1);assert.equal(publicProducts[0].fileDataUrl,undefined);
 assert.equal(f.db.data.get('products/book/deliverables/main').storageGeneration,'1');
 await f.products.save(owner,{...draft,published:false});assert.equal((await f.products.list('legacy-store')).length,0);
});
test('unverified/missing/foreign/public-token files cannot be published',async()=>{
 const f=fixture();
 await assert.rejects(f.products.save(owner,{...draft,published:true,fileDataUrl:'storage://foreign'}),code('product/file-required'));
 await upload(f);
 const path=f.db.data.get('products/book/deliverables/main').fileDataUrl.slice(10);
 f.bucket.objects.get(path).metadata={firebaseStorageDownloadTokens:'public-token'};
 await assert.rejects(f.products.save(owner,{...draft,published:true}),code('product/public-file'));
});
test('product ownership cannot be changed by nested request or guessed product ID',async()=>{
 const f=fixture();await f.products.save(owner,draft);
 await assert.rejects(f.products.save(p('other'),{...draft,ownerId:'seller'}),code('product/owner-forbidden'));
 await assert.rejects(f.products.remove(p('other'),'book'),code('product/owner-forbidden'));
 f.db.seed('stores/other-store',{...store,ownerId:'other',storeSlug:'other'});
 await assert.rejects(f.products.save(p('other'),{...draft,storeId:'other-store'}),code('product/owner-forbidden'));
});
test('suspended stores reject product edits, deletion and uploads; stay hidden publicly',async()=>{
 const f=fixture();await f.products.save(owner,draft);f.db.seed('stores/legacy-store',{...store,status:'Suspended'});
 await assert.rejects(f.products.save(owner,draft),code('store/suspended'));
 await assert.rejects(f.products.remove(owner,'book'),code('store/suspended'));
 await assert.rejects(upload(f),code('store/suspended'));
 await assert.rejects(f.products.list('legacy-store'),code('store/not-found'));
});
test('valid private upload returns only after Storage and Firestore are durable',async()=>{
 const f=fixture();const result=await upload(f);
 assert.equal(result.ok,true);assert.match(result.fileReference,/^storage:\/\/deliverables\/seller\/book\//);
 assert.equal(f.db.data.get('products/book').pendingUpload,null);
 assert.equal(f.db.data.get('products/book/deliverables/main').fileDataUrl,result.fileReference);
 assert.equal([...f.db.data.values()].filter(x=>x.state==='completed').length,1);
});
test('file signatures, MIME and extension, size and path validation enforce 5 MiB',()=>{
 assert.equal(MAX_UPLOAD_BYTES,5*1024*1024);
 for(const [name,mime,data] of [['a.pdf','application/pdf',Buffer.from('wrong')],['a.txt','application/pdf',pdf],['../a.pdf','application/pdf',pdf],['a.svg','image/svg+xml',Buffer.from('<svg/>')],['a.pdf','application/pdf',Buffer.alloc(MAX_UPLOAD_BYTES+1)]]) {
  assert.throws(()=>validateFileBytes(name,mime,data,'product'),e=>e.status===422);
 }
 validateFileBytes('a.pdf','application/pdf',pdf,'product');
 for(const [name,mime] of [['a.zip','application/zip'],['a.epub','application/epub+zip'],['a.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) validateFileBytes(name,mime,Buffer.from('504b030401020304','hex'),'product');
 validateFileBytes('a.txt','text/plain',Buffer.from('Original UTF-8 content'),'product');
});
test('cross-seller uploads reject before any Storage write',async()=>{
 const f=fixture();await f.products.save(owner,draft);f.db.seed('stores/other-store',{...store,ownerId:'other'});
 await assert.rejects(f.uploads.save(p('other'),{productId:'book',storeId:'other-store',fileName:'book.pdf',contentType:'application/pdf',data:pdf,kind:'product'}),code('product/owner-forbidden'));
 assert.equal(f.bucket.objects.size,0);
});
test('Storage failure unlocks reservation and never reports successful upload',async()=>{
 const f=fixture();f.bucket.failSave=true;
 await assert.rejects(upload(f),code('storage/upload-failed'));
 assert.equal(f.db.data.get('products/book').pendingUpload,null);assert.equal(f.bucket.objects.size,0);
});
test('Firestore commit failure before upload cannot leave an orphan',async()=>{
 const f=fixture();f.db.failCommit=true;await assert.rejects(upload(f));
 assert.equal(f.bucket.objects.size,0);assert.equal(f.db.data.has('products/book'),false);
});
test('Firestore failure after bytes saves compensates by deleting object and leaves durable recovery job',async()=>{
 const f=fixture();const original=f.bucket.file.bind(f.bucket);
 f.bucket.file=path=>{const object=original(path);return {...object,save:async(...args)=>{await object.save(...args);f.db.failCommit=true;}};};
 await assert.rejects(upload(f),code('storage/upload-failed'));assert.equal(f.bucket.objects.size,0);
 assert.ok(f.db.data.get('products/book').pendingUpload);
 f.db.failCommit=false;
 await cleanupExpiredUploads(f.db,f.bucket,new Date(Date.now()+7200000));
 assert.equal(f.db.data.get('products/book').pendingUpload,null);
});
test('cover uploads use public image namespace, private files retain private namespace',async()=>{
 const f=fixture();const result=await f.uploads.save(owner,{productId:'book',storeId:'legacy-store',fileName:'cover.png',contentType:'image/png',data:Buffer.from('89504e470d0a1a0a010203','hex'),kind:'cover'});
 assert.match(result.coverUrl,/^\/api\/assets\/covers\/seller\//);
 assert.equal(f.db.data.has('products/book/deliverables/main'),false);
});
test('staging cannot mix emulator writes with production Firebase services',()=>{
 const env={DREAMSTORE_V2_STAGING:'1',DREAMSTORE_V2_PROJECT_ID:'demo-dreamstore-v2',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'};
 assert.doesNotThrow(()=>assertIsolatedV2Environment(env));
 for(const key of Object.keys(env)) assert.throws(()=>assertIsolatedV2Environment({...env,[key]:''}));
 assert.throws(()=>assertIsolatedV2Environment({...env,DREAMSTORE_V2_PROJECT_ID:'dulcet-trees-qk6n5'}));
 assert.throws(()=>assertIsolatedV2Environment({...env,FIRESTORE_EMULATOR_HOST:'remote:8080'}));
});

test('replaced original file is scheduled for bounded staging cleanup only after publish commits',async()=>{
 const f=fixture();await upload(f);await f.products.save(owner,{...draft,published:true,fileName:'book.pdf'});
 const original=f.db.data.get('products/book/deliverables/main').fileDataUrl;
 const changed=Buffer.from('%PDF-1.7\nNew edition\n%%EOF');
 await f.uploads.save(owner,{productId:'book',storeId:'legacy-store',fileName:'book.pdf',contentType:'application/pdf',data:changed,kind:'product'});
 const next=f.db.data.get('products/book/deliverables/main').fileDataUrl;
 assert.notEqual(original,next);assert.equal(f.bucket.objects.size,2);
 await f.products.save(owner,{...draft,published:true,fileName:'book.pdf'});
 assert.ok([...f.db.data.values()].some(job=>job.kind==='orphan'&&job.objectPath===original.slice('storage://'.length)));
 await cleanupExpiredUploads(f.db,f.bucket,new Date(Date.now()+2*86400000));
 assert.equal(f.bucket.objects.has(original.slice('storage://'.length)),false);
 assert.equal(f.bucket.objects.has(next.slice('storage://'.length)),true);
});
