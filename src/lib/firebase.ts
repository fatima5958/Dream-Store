import { initializeApp } from 'firebase/app';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { selectFrontendBackend } from './backend-mode';

export const REQUIRED_AUTHORIZED_DOMAINS = [
  'dreamstore.app',
  'www.dreamstore.app',
  'dreamstore.ai.studio',
  'dreamstore-582009353900.asia-southeast1.run.app',
  'ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'ais-mob-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'dulcet-trees-qk6n5.firebaseapp.com',
  'dulcet-trees-qk6n5.web.app',
  'localhost',
  '127.0.0.1',
];

const SAME_ORIGIN_AUTH_HOSTS = new Set([
  'dreamstore.app',
  'www.dreamstore.app',
  'dreamstore.ai.studio',
  'dreamstore-582009353900.asia-southeast1.run.app',
  'ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'ais-mob-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'dulcet-trees-qk6n5.firebaseapp.com',
  'dulcet-trees-qk6n5.web.app',
  'localhost',
  '127.0.0.1',
]);

function resolveEffectiveAuthDomain(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname.toLowerCase();
    // Use same-origin authDomain on dreamstore.app, preview .run.app, and localhost so /__/auth/handler
    // runs through our server proxy without cross-origin storage partitioning.
    if (
      SAME_ORIGIN_AUTH_HOSTS.has(host)
    ) {
      return window.location.host;
    }
  }
  return firebaseConfig.authDomain || '';
}

export const IS_V2_STAGING = import.meta.env.DEV && import.meta.env.VITE_DREAMSTORE_V2_STAGING === '1';
const backendMode = selectFrontendBackend(import.meta.env);
export const IS_V2_PRODUCTION = backendMode.productionV2;
export const USE_V2_API = backendMode.apiOnly;
const stagingProjectId = String(import.meta.env.VITE_DREAMSTORE_V2_PROJECT_ID || '');
if (import.meta.env.VITE_DREAMSTORE_V2_STAGING === '1' &&
    (!IS_V2_STAGING || !/^demo-[a-z0-9-]+$/.test(stagingProjectId) ||
     !['localhost', '127.0.0.1'].includes(window.location.hostname))) {
  throw new Error('V2 frontend requires localhost development and a demo-* Firebase project.');
}
// The V2 web server does not proxy Firebase's /__/auth helper. Use the real
// Firebase hosted handler instead of pointing redirects at a SPA fallback.
const effectiveAuthDomain = IS_V2_STAGING ? 'localhost'
  : IS_V2_PRODUCTION ? firebaseConfig.authDomain : resolveEffectiveAuthDomain();

const app = initializeApp({
  ...firebaseConfig,
  ...(IS_V2_STAGING ? { projectId: stagingProjectId, storageBucket: stagingProjectId + '.appspot.com' } : {}),
  authDomain: effectiveAuthDomain,
});
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const auth = getAuth(app);
if (IS_V2_STAGING) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId || '';
export const FIREBASE_AUTH_DOMAIN = firebaseConfig.authDomain || '';
export const FIREBASE_EFFECTIVE_AUTH_DOMAIN = effectiveAuthDomain;
export const FIREBASE_API_KEY = firebaseConfig.apiKey || '';
export const FIREBASE_OAUTH_CLIENT_ID =
  (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';
export const FIREBASE_GOOGLE_REDIRECT_URI = `https://${effectiveAuthDomain}/__/auth/handler`;

// Keep Firebase's origin validation, event correlation, and popup cancellation intact.
// A blocked embedded preview should be opened in a normal browser tab.
export function isPreviewIframeEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.self !== window.top; } catch { return true; }
}

export async function signInWithGoogleRedirect(): Promise<void> {
  if (isPreviewIframeEnvironment()) {
    // Google/Firebase redirects cannot complete reliably inside AI Studio's
    // embedded preview. Never claim to redirect and secretly retry a popup.
    throw Object.assign(new Error('Open the published website in a full browser tab to sign in.'), {
      code: 'auth/embedded-preview',
    });
  }
  await signInWithRedirect(auth, googleProvider);
}

export async function signInWithGooglePopup(): Promise<'popup' | 'redirect'> {
  if (isPreviewIframeEnvironment()) {
    throw Object.assign(new Error('Open the published website in a full browser tab to sign in.'), {
      code: 'auth/embedded-preview',
    });
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return 'popup';
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'auth/popup-blocked' && !isPreviewIframeEnvironment()) {
      await signInWithRedirect(auth, googleProvider);
      return 'redirect';
    }
    throw err;
  }
}

// Complete a Firebase redirect through the SDK, with no server-wide event relay.
void getRedirectResult(auth).catch(() => {
  // The sign-in dialog can be reopened after a cancelled or failed redirect.
});

interface StoredServerEmailSession {
  token: string;
  expiresAtMs: number;
  user: {
    uid: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
  };
}

const EMAIL_SESSION_STORAGE_KEY = 'dreamstore_email_auth_session_v1';
const authStateSubscribers = new Set<(user: FirebaseUser | null) => void>();
let currentServerEmailSession: StoredServerEmailSession | null = null;

function loadStoredEmailSession(): StoredServerEmailSession | null {
  if (USE_V2_API || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EMAIL_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredServerEmailSession;
    if (
      !parsed ||
      !parsed.token ||
      !parsed.user?.uid ||
      typeof parsed.expiresAtMs !== 'number' ||
      Date.now() >= parsed.expiresAtMs
    ) {
      window.localStorage.removeItem(EMAIL_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

currentServerEmailSession = loadStoredEmailSession();

function buildFirebaseCompatibleUser(session: StoredServerEmailSession): FirebaseUser {
  const compat = {
    uid: session.user.uid,
    email: session.user.email,
    displayName: session.user.displayName,
    emailVerified: true,
    isAnonymous: false,
    photoURL: null,
    phoneNumber: null,
    tenantId: null,
    providerId: 'password',
    providerData: [
      {
        providerId: 'password',
        uid: session.user.email,
        displayName: session.user.displayName,
        email: session.user.email,
        phoneNumber: null,
        photoURL: null,
      },
    ],
    getIdToken: async () => session.token,
    getIdTokenResult: async () => ({
      token: session.token,
      claims: { sub: session.user.uid, email: session.user.email, email_verified: true },
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(session.expiresAtMs).toISOString(),
      signInProvider: 'password',
      signInSecondFactor: null,
    }),
    reload: async () => {},
    delete: async () => {},
    toJSON: () => ({
      uid: session.user.uid,
      email: session.user.email,
      displayName: session.user.displayName,
      emailVerified: true,
    }),
  };
  return compat as unknown as FirebaseUser;
}

function getEffectiveCurrentUser(): FirebaseUser | null {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (currentServerEmailSession && Date.now() < currentServerEmailSession.expiresAtMs) {
    return buildFirebaseCompatibleUser(currentServerEmailSession);
  }
  return null;
}

function notifyAuthSubscribers(): void {
  const effectiveUser = getEffectiveCurrentUser();
  for (const cb of authStateSubscribers) {
    try {
      cb(effectiveUser);
    } catch {
      // Ignore subscriber error
    }
  }
}

function setServerEmailSession(session: StoredServerEmailSession | null): void {
  currentServerEmailSession = session;
  if (typeof window !== 'undefined') {
    try {
      if (session) {
        window.localStorage.setItem(EMAIL_SESSION_STORAGE_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(EMAIL_SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage error
    }
  }
  notifyAuthSubscribers();
}

export function hasFirebaseSdkSession(): boolean {
  return Boolean(auth.currentUser);
}

export function subscribeAuthState(
  callback: (user: FirebaseUser | null) => void
): () => void {
  authStateSubscribers.add(callback);
  const unsubFirebase = onAuthStateChanged(auth, (fbUser) => {
    if (fbUser) {
      callback(fbUser);
    } else {
      callback(getEffectiveCurrentUser());
    }
  });
  return () => {
    authStateSubscribers.delete(callback);
    unsubFirebase();
  };
}

export async function signUpWithEmailAccount(
  email: string,
  password: string,
  displayName: string
): Promise<FirebaseUser> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (cred.user && displayName) {
      try {
        await updateProfile(cred.user, { displayName });
      } catch {
        // Display name can be updated later.
      }
    }
    if (cred.user && !cred.user.emailVerified) {
      try {
        await sendEmailVerification(cred.user);
      } catch (err) {
        console.warn('Email verification could not be sent. Product uploads remain locked until verified.', err);
      }
    }
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (IS_V2_STAGING || import.meta.env.PROD || code !== 'auth/operation-not-allowed') {
      throw err;
    }
    // Seamless fallback to server-verified Email/Password account when Firebase Console provider is disabled
    const res = await fetch('/api/auth/email/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      const errorObj = new Error(data?.error || 'Sign-up failed.') as Error & {
        code?: string;
      };
      errorObj.code = data?.code || 'auth/unknown';
      throw errorObj;
    }
    const session: StoredServerEmailSession = {
      token: data.token,
      expiresAtMs: data.expiresAtMs,
      user: data.user,
    };
    setServerEmailSession(session);
    return buildFirebaseCompatibleUser(session);
  }
}

export async function resendCurrentUserVerificationEmail(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again to resend your verification email.');
  await user.reload();
  if (user.emailVerified) return;
  await sendEmailVerification(user);
}

export async function signInWithEmailAccount(
  email: string,
  password: string
): Promise<FirebaseUser> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (IS_V2_STAGING || import.meta.env.PROD || code !== 'auth/operation-not-allowed') {
      throw err;
    }
    const res = await fetch('/api/auth/email/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      const errorObj = new Error(data?.error || 'Sign-in failed.') as Error & {
        code?: string;
      };
      errorObj.code = data?.code || 'auth/invalid-credential';
      throw errorObj;
    }
    const session: StoredServerEmailSession = {
      token: data.token,
      expiresAtMs: data.expiresAtMs,
      user: data.user,
    };
    setServerEmailSession(session);
    return buildFirebaseCompatibleUser(session);
  }
}

export async function resetEmailAccountPassword(
  email: string,
  options?: { resetToken?: string; newPassword?: string }
): Promise<void> {
  if (options?.resetToken !== undefined || options?.newPassword !== undefined) {
    if (import.meta.env.PROD) throw new Error('Request a new password reset email from Sign In. Legacy reset links are no longer supported.');
    const res = await fetch('/api/auth/email/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        resetToken: options.resetToken,
        newPassword: options.newPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      const errorObj = new Error(data?.error || 'Password reset failed.') as Error & {
        code?: string;
      };
      errorObj.code = data?.code || 'auth/invalid-reset-token';
      throw errorObj;
    }
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (IS_V2_STAGING || import.meta.env.PROD || code !== 'auth/operation-not-allowed') {
      throw err;
    }
    const res = await fetch('/api/auth/email/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      const errorObj = new Error(data?.error || 'Password reset failed.') as Error & {
        code?: string;
      };
      errorObj.code = data?.code || 'auth/invalid-email';
      throw errorObj;
    }
  }
}

export async function signOutUser(): Promise<void> {
  if (currentServerEmailSession) {
    const token = currentServerEmailSession.token;
    setServerEmailSession(null);
    fetch('/api/auth/email/signout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => {});
  }
  await signOut(auth);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  if (USE_V2_API) return; // V2's named Firestore is accessed only by its backend.
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Retrieve cryptographically signed Firebase ID token (or server-verified Email session token) for authenticated backend API calls
export async function getAuthHeaders(
  extraHeaders: Record<string, string> = {},
  options: { forceRefresh?: boolean; requireAuth?: boolean } = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (auth.currentUser) {
    try {
      // Sensitive mutations can request a newly refreshed Firebase ID token.
      const idToken = await auth.currentUser.getIdToken(options.forceRefresh === true);
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
        return headers;
      }
    } catch {
      if (options.requireAuth) {
        throw new Error('Your Firebase sign-in needs refreshing. Please sign in again.');
      }
    }
    // Never fall back to a potentially stale legacy session while a Firebase
    // SDK identity is present. Two different accounts must not be mixed.
    if (options.requireAuth) {
      throw new Error('Your Firebase sign-in needs refreshing. Please sign in again.');
    }
    return headers;
  }
  if (currentServerEmailSession && Date.now() < currentServerEmailSession.expiresAtMs) {
    headers.Authorization = `Bearer ${currentServerEmailSession.token}`;
  }
  if (options.requireAuth && !headers.Authorization) {
    throw new Error('Your login session has expired. Please sign in again.');
  }
  return headers;
}

// A legacy email session stored in the browser can become invalid when a
// Cloud Run instance restarts. On a verified 401, discard ONLY that stale
// local session, so the user can sign in again without weakening backend auth.
export function invalidateRejectedLegacyEmailSession(): boolean {
  if (auth.currentUser || !currentServerEmailSession) return false;
  setServerEmailSession(null);
  return true;
}

export {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  browserPopupRedirectResolver,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
};
export type { FirebaseUser };
