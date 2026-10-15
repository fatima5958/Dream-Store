// Test-only loader. Production entry points never import this file.
export async function resolve(specifier, context, nextResolve) {
  if (['firebase-admin/firestore', 'firebase-admin/auth', 'firebase-admin/storage'].includes(specifier)) {
    return { url: new URL('./firebase-fakes.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
