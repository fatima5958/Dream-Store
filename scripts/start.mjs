// Set production explicitly even when the hosting platform omits NODE_ENV.
process.env.NODE_ENV = process.argv.includes('--dev') ? 'development' : 'production';
await import('tsx/esm/api').then(({ register }) => register());
await import('../server.ts');
