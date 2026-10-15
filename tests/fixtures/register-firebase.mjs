import { register } from 'node:module';
register('./firebase-loader.mjs', import.meta.url);
// Seed only the public catalog. These tests never contact a real Firebase project.
const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('http://127.0.0.1')) {
    const query = JSON.parse(options?.body || '{}')?.structuredQuery;
    if (query?.from?.[0]?.collectionId === 'stores') {
      const values = { ownerId: 'seller-test', storeSlug: 'test-shop', storeName: 'Test Shop', status: 'Active', plan: 'Free', currency: 'USD' };
      return Response.json([{ document: { name: 'projects/test/databases/test/documents/stores/store-seller-test',
        fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }])) } }]);
    }
    return Response.json([]);
  }
  return actualFetch(url, options);
};
