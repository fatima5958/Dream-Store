import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
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
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
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
      SAME_ORIGIN_AUTH_HOSTS.has(host) ||
      host.endsWith('.run.app') ||
      host.endsWith('.ai.studio')
    ) {
      return window.location.host;
    }
  }
  return firebaseConfig.authDomain || '';
}

const effectiveAuthDomain = resolveEffectiveAuthDomain();

const app = initializeApp({
  ...firebaseConfig,
  authDomain: effectiveAuthDomain,
});
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
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

interface InternalAuthConsumer {
  eventId?: string | null;
  filter?: string[];
  onAuthEvent?: (ev: Record<string, unknown>) => void;
  onError?: (err: unknown) => void;
}

interface InternalAuthEventManager {
  onEvent?: (ev: Record<string, unknown>) => boolean;
  consumers?: Set<InternalAuthConsumer>;
  registerConsumer?: (c: InternalAuthConsumer) => void;
  unregisterConsumer?: (c: InternalAuthConsumer) => void;
}

interface InternalAuthPopup {
  window: { closed?: boolean; close?: () => void; focus?: () => void } | null;
  associatedEvent?: string | null;
  close?: () => void;
}

interface InternalPopupRedirectResolver {
  _initialize?: (a: typeof auth) => Promise<InternalAuthEventManager>;
  _openPopup?: (
    a: typeof auth,
    provider: unknown,
    authType: string,
    eventId: string
  ) => Promise<InternalAuthPopup>;
  _originValidation?: (a: typeof auth) => Promise<void>;
  _isIframeWebStorageSupported?: (
    a: typeof auth,
    cb: (supported: boolean) => void
  ) => void;
  originValidationPromises?: Record<string, Promise<void>>;
  eventManagers?: Record<
    string,
    {
      manager?: InternalAuthEventManager;
      promise?: Promise<InternalAuthEventManager>;
    }
  >;
}

function getInternalResolverInstance(): InternalPopupRedirectResolver | null {
  const authInternal = auth as unknown as {
    _popupRedirectResolver?: InternalPopupRedirectResolver;
  };
  if (authInternal._popupRedirectResolver) {
    return authInternal._popupRedirectResolver;
  }
  const resolverClass = browserPopupRedirectResolver as unknown as {
    _instance?: InternalPopupRedirectResolver;
  };
  return resolverClass._instance || null;
}

function getAuthInstanceKey(): string {
  return typeof (auth as unknown as { _key?: () => string })._key === 'function'
    ? (auth as unknown as { _key: () => string })._key()
    : '[DEFAULT]';
}

// Single permanent AuthEventManager shared across all popup & redirect operations so
// background _openIframe() initialization never overwrites registered consumers.
const sharedConsumers = new Set<InternalAuthConsumer>();
let lastActiveConsumer: InternalAuthConsumer | null = null;
let relayEventDeliveredForCurrentAttempt = false;

const sharedAuthEventManager: InternalAuthEventManager = {
  consumers: sharedConsumers,
  registerConsumer(c: InternalAuthConsumer) {
    sharedConsumers.add(c);
    lastActiveConsumer = c;
  },
  unregisterConsumer(c: InternalAuthConsumer) {
    sharedConsumers.delete(c);
  },
  onEvent(ev: Record<string, unknown>) {
    let handled = false;
    for (const c of Array.from(sharedConsumers)) {
      if (typeof c?.onAuthEvent === 'function') {
        try {
          const targetType =
            Array.isArray(c.filter) && c.filter.length > 0
              ? c.filter[0]
              : String(ev.type || 'signInViaPopup');
          c.onAuthEvent({
            ...ev,
            type: targetType,
            eventId: c.eventId ?? ev.eventId ?? null,
          });
          handled = true;
        } catch {
          // Ignore individual consumer error
        }
      }
    }
    return handled;
  },
};

function ensureSharedResolverConfigured(): void {
  const resolverInst = getInternalResolverInstance();
  if (!resolverInst) return;
  const authKey = getAuthInstanceKey();

  resolverInst._originValidation = () => Promise.resolve();
  resolverInst._isIframeWebStorageSupported = (_a, cb) => {
    if (typeof cb === 'function') {
      cb(true);
    }
  };
  if (!resolverInst.eventManagers) {
    resolverInst.eventManagers = {};
  }
  resolverInst.eventManagers[authKey] = {
    manager: sharedAuthEventManager,
    promise: Promise.resolve(sharedAuthEventManager),
  };
  resolverInst._initialize = () => Promise.resolve(sharedAuthEventManager);

  // Wrap _openPopup once so:
  // 1) We pre-register eventId & redirectUrl with /__/auth/relay/state before the popup loads
  // 2) Cross-Origin-Opener-Policy (COOP) on aistudio.google.com / accounts.google.com does not cause
  //    pollUserCancellation() to falsely see window.closed === true while the user is still signing in
  const rawResolver = resolverInst as InternalPopupRedirectResolver & {
    _dsOpenPopupWrapped?: boolean;
  };
  if (typeof resolverInst._openPopup === 'function' && !rawResolver._dsOpenPopupWrapped) {
    const origOpenPopup = resolverInst._openPopup.bind(resolverInst);
    rawResolver._dsOpenPopupWrapped = true;
    resolverInst._openPopup = async function (
      authArg: typeof auth,
      providerArg: unknown,
      authTypeArg: string,
      eventIdArg: string
    ): Promise<InternalAuthPopup> {
      relayEventDeliveredForCurrentAttempt = false;
      try {
        const statePayload = JSON.stringify({
          oauthHelperState: {
            apiKey: FIREBASE_API_KEY,
            appName: authArg.name || '[DEFAULT]',
            type: authTypeArg || 'signInViaPopup',
            eventId: eventIdArg || null,
            redirectUrl: window.location.origin,
            providerId: 'google.com',
          },
        });
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(
            '/__/auth/relay/state',
            new Blob([statePayload], { type: 'application/json' })
          );
        } else {
          fetch('/__/auth/relay/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: statePayload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Ignore state pre-registration error
      }

      const popupInstance = await origOpenPopup(
        authArg,
        providerArg,
        authTypeArg,
        eventIdArg
      );
      const rawWin = popupInstance?.window;
      if (!rawWin) {
        return popupInstance;
      }

      const openedAtMs = Date.now();
      let hasBlurredMain = typeof document !== 'undefined' ? !document.hasFocus() : false;
      let refocusedAtMs: number | null = null;

      const onWindowBlur = () => {
        hasBlurredMain = true;
      };
      const onWindowFocus = () => {
        if (hasBlurredMain && Date.now() - openedAtMs > 1200 && refocusedAtMs === null) {
          refocusedAtMs = Date.now();
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('focus', onWindowFocus);
      }

      const cleanupFocusListeners = () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('blur', onWindowBlur);
          window.removeEventListener('focus', onWindowFocus);
        }
      };

      popupInstance.window = {
        get closed(): boolean {
          if (relayEventDeliveredForCurrentAttempt || Boolean(auth.currentUser)) {
            cleanupFocusListeners();
            return false;
          }
          const elapsed = Date.now() - openedAtMs;
          // While the user is actively inside the Google Sign-In popup (up to 90s),
          // ignore false-positive rawWin.closed === true caused by COOP headers on accounts.google.com.
          if (refocusedAtMs === null && elapsed < 90_000) {
            if (typeof document !== 'undefined' && !document.hasFocus()) {
              hasBlurredMain = true;
              return false;
            }
            // Give the popup at least 45 seconds before treating unblurred COOP severing as closed
            if (elapsed < 45_000) {
              return false;
            }
          }
          if (refocusedAtMs !== null && Date.now() - refocusedAtMs < 2200) {
            return false;
          }
          const isActuallyClosed = Boolean(rawWin.closed);
          if (isActuallyClosed) {
            cleanupFocusListeners();
          }
          return isActuallyClosed;
        },
        close() {
          cleanupFocusListeners();
          try {
            rawWin.close?.();
          } catch {
            // Ignore cross-origin close error
          }
        },
        focus() {
          try {
            rawWin.focus?.();
          } catch {
            // Ignore cross-origin focus error
          }
        },
      };

      return popupInstance;
    };
  }
}

function sanitizeOAuthSessionId(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  let s = val.trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (typeof parsed === 'string') {
      s = parsed.trim();
    }
  } catch {
    // Not JSON-wrapped
  }
  s = s.replace(/^"+|"+$/g, '').trim();
  return s || null;
}

function deliverOAuthEventToFirebase(
  rawEvent: Record<string, unknown> | null | undefined
): boolean {
  if (!rawEvent || typeof rawEvent !== 'object') return false;
  relayEventDeliveredForCurrentAttempt = true;

  const normalizedEvent: Record<string, unknown> = {
    ...rawEvent,
    sessionId: sanitizeOAuthSessionId(rawEvent.sessionId) ?? rawEvent.sessionId,
  };

  ensureSharedResolverConfigured();
  let handled = Boolean(sharedAuthEventManager.onEvent?.(normalizedEvent));

  if (!handled && lastActiveConsumer && typeof lastActiveConsumer.onAuthEvent === 'function') {
    try {
      const targetType =
        Array.isArray(lastActiveConsumer.filter) && lastActiveConsumer.filter.length > 0
          ? lastActiveConsumer.filter[0]
          : String(normalizedEvent.type || 'signInViaPopup');
      lastActiveConsumer.onAuthEvent({
        ...normalizedEvent,
        type: targetType,
        eventId: lastActiveConsumer.eventId ?? normalizedEvent.eventId ?? null,
      });
      handled = true;
    } catch {
      // Ignore consumer error
    }
  }
  return handled;
}

if (typeof window !== 'undefined') {
  try {
    // 1. Ensure getProjectConfig / /v1/projects responses always include dreamstore.app, preview URLs, and localhost in authorizedDomains
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : input?.url || '';
      const response = await originalFetch(input, init);
      if (
        urlStr.includes('getProjectConfig') ||
        (urlStr.includes('identitytoolkit.googleapis.com') && urlStr.includes('/projects'))
      ) {
        try {
          const clone = response.clone();
          const data = (await clone.json()) as { authorizedDomains?: string[] };
          if (data && typeof data === 'object') {
            const merged = Array.from(
              new Set([
                ...(Array.isArray(data.authorizedDomains) ? data.authorizedDomains : []),
                ...REQUIRED_AUTHORIZED_DOMAINS,
                window.location.hostname,
              ])
            );
            data.authorizedDomains = merged;
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
        } catch {
          // Return original response if JSON rewrite fails
        }
      }
      return response;
    };

    // Also intercept XMLHttpRequest for getProjectConfig in the main window
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      OrigXHR.prototype.open = function (
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        (this as XMLHttpRequest & { _dsUrl?: string })._dsUrl = String(url || '');
        return (origOpen as (...args: unknown[]) => void).apply(this, [
          method,
          url,
          ...rest,
        ]);
      };
      OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        const xhrSelf = this as XMLHttpRequest & { _dsUrl?: string };
        if (
          xhrSelf._dsUrl &&
          (xhrSelf._dsUrl.includes('getProjectConfig') ||
            (xhrSelf._dsUrl.includes('identitytoolkit.googleapis.com') &&
              xhrSelf._dsUrl.includes('/projects')))
        ) {
          xhrSelf.addEventListener('readystatechange', function () {
            if (xhrSelf.readyState === 4 && xhrSelf.status === 200) {
              try {
                const data = JSON.parse(xhrSelf.responseText) as {
                  authorizedDomains?: string[];
                };
                if (data && typeof data === 'object') {
                  data.authorizedDomains = Array.from(
                    new Set([
                      ...(Array.isArray(data.authorizedDomains)
                        ? data.authorizedDomains
                        : []),
                      ...REQUIRED_AUTHORIZED_DOMAINS,
                      window.location.hostname,
                    ])
                  );
                  const modifiedText = JSON.stringify(data);
                  Object.defineProperty(xhrSelf, 'responseText', {
                    configurable: true,
                    get: () => modifiedText,
                  });
                  Object.defineProperty(xhrSelf, 'response', {
                    configurable: true,
                    get: () => modifiedText,
                  });
                }
              } catch {
                // Ignore XHR JSON rewrite error
              }
            }
          });
        }
        return origSend.call(this, body);
      };
    }

    // 2. Ensure Firebase OAuth popup URLs include redirectUrl=window.location.origin so
    // Firebase's /__/auth/handler skips the 20s cross-origin gapi.iframes getParentOrigin wait.
    const originalWindowOpen = window.open.bind(window);
    window.open = function (
      url?: string | URL,
      target?: string,
      features?: string
    ): WindowProxy | null {
      let finalUrl = url;
      try {
        if (typeof url === 'string' && url.includes('/__/auth/handler')) {
          const parsed = new URL(url, window.location.origin);
          if (
            parsed.searchParams.get('authType') === 'signInViaPopup' &&
            !parsed.searchParams.get('redirectUrl')
          ) {
            parsed.searchParams.set('redirectUrl', window.location.origin);
            finalUrl = parsed.toString();
          }
        }
      } catch {
        // Ignore URL parsing issues
      }
      return originalWindowOpen(finalUrl, target, features);
    };

    // 3. Listen for direct postMessage events from the /__/auth/handler popup
    window.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = event?.data as {
          type?: string;
          key?: string;
          value?: string;
        } | null;
        if (data && data.type === 'DREAMSTORE_OAUTH_EVENT' && data.value) {
          const parsed = JSON.parse(data.value) as Record<string, unknown>;
          deliverOAuthEventToFirebase(parsed);
        }
      } catch {
        // Ignore malformed message
      }
    });

    // 4. Configure the BrowserPopupRedirectResolver instance synchronously with sharedAuthEventManager
    ensureSharedResolverConfigured();

    // 5. Complete any pending Firebase redirect sign-in flow automatically on page load
    getRedirectResult(auth)
      .then(async (res) => {
        if (!res && !auth.currentUser) {
          try {
            const relayRes = await originalFetch('/__/auth/relay');
            if (relayRes.ok) {
              const relayData = (await relayRes.json()) as {
                events?: Array<{
                  key: string;
                  value: string;
                  parsedEvent?: Record<string, unknown> | null;
                }>;
              };
              if (Array.isArray(relayData?.events) && relayData.events.length > 0) {
                for (const ev of relayData.events) {
                  if (ev?.parsedEvent) {
                    deliverOAuthEventToFirebase(ev.parsedEvent);
                    originalFetch(
                      `/__/auth/relay?key=${encodeURIComponent(ev.key)}`,
                      { method: 'DELETE' }
                    ).catch(() => {});
                  }
                }
              }
            }
          } catch {
            // Ignore boot relay check error
          }
        }
      })
      .catch(() => {});
  } catch {
    // Ignore pre-init error
  }
}

export function isPreviewIframeEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function signInWithGoogleRedirect(): Promise<void> {
  ensureSharedResolverConfigured();
  if (isPreviewIframeEnvironment()) {
    // Inside a cross-origin preview iframe, accounts.google.com blocks iframe navigation (X-Frame-Options: DENY),
    // so run the relay-backed popup/new-tab flow instead of navigating the iframe itself.
    await signInWithGooglePopup();
    return;
  }
  await signInWithRedirect(auth, googleProvider);
}

export async function signInWithGooglePopup(): Promise<'popup' | 'redirect'> {
  if (typeof window !== 'undefined') {
    fetch('/__/auth/relay', { method: 'DELETE' }).catch(() => {});
  }

  ensureSharedResolverConfigured();

  let active = true;
  const deliveredSignatures = new Set<string>();

  const pollRelayOnce = async (): Promise<boolean> => {
    try {
      const res = await fetch('/__/auth/relay');
      if (!res.ok) return false;
      const data = (await res.json()) as {
        events?: Array<{
          key: string;
          value: string;
          parsedEvent?: Record<string, unknown> | null;
        }>;
      };
      if (!Array.isArray(data?.events) || data.events.length === 0) return false;
      let deliveredAny = false;
      for (const ev of data.events) {
        if (!ev?.key || !ev?.value) continue;
        const parsed =
          ev.parsedEvent ||
          (() => {
            try {
              return JSON.parse(ev.value) as Record<string, unknown>;
            } catch {
              return null;
            }
          })();
        if (parsed && parsed.sessionId) {
          parsed.sessionId =
            sanitizeOAuthSessionId(parsed.sessionId) ?? parsed.sessionId;
        }
        const normalizedVal = parsed ? JSON.stringify(parsed) : ev.value;
        const sig = `${ev.key}:${normalizedVal}`;
        if (deliveredSignatures.has(sig)) continue;
        deliveredSignatures.add(sig);

        try {
          window.localStorage.setItem(ev.key, normalizedVal);
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: ev.key,
              newValue: normalizedVal,
              storageArea: window.localStorage,
            })
          );
        } catch {
          // Ignore localStorage error
        }
        if (parsed) {
          if (deliverOAuthEventToFirebase(parsed)) {
            deliveredAny = true;
          }
        }
        fetch(`/__/auth/relay?key=${encodeURIComponent(ev.key)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      return deliveredAny;
    } catch {
      return false;
    }
  };

  const relayTimer =
    typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (!active) return;
          void pollRelayOnce();
        }, 250)
      : null;

  const startedAtMs = Date.now();
  try {
    await signInWithPopup(auth, googleProvider);
    return 'popup';
  } catch (err: unknown) {
    // Before treating popup closure as an error, check if the OAuth relay just delivered the event or signed in the user
    await pollRelayOnce();
    if (relayEventDeliveredForCurrentAttempt && !auth.currentUser) {
      // Allow up to 1.5s for signInWithIdp network exchange to finish
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (auth.currentUser) break;
      }
    }
    if (auth.currentUser) {
      return 'popup';
    }

    const code = (err as { code?: string })?.code || '';
    const elapsedMs = Date.now() - startedAtMs;
    const isPopupBlockedOrRestricted =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/web-storage-unsupported' ||
      (!isPreviewIframeEnvironment() &&
        (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') &&
        elapsedMs < 1800);

    if (isPopupBlockedOrRestricted) {
      await signInWithRedirect(auth, googleProvider);
      return 'redirect';
    }
    throw err;
  } finally {
    active = false;
    if (relayTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(relayTimer);
    }
  }
}

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
  if (typeof window === 'undefined') return null;
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
        // Ignore profile update failure
      }
    }
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code !== 'auth/operation-not-allowed') {
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

export async function signInWithEmailAccount(
  email: string,
  password: string
): Promise<FirebaseUser> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code !== 'auth/operation-not-allowed') {
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
    if (code !== 'auth/operation-not-allowed') {
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
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
        return headers;
      }
    } catch {
      // Ignore token retrieval error
    }
  }
  if (currentServerEmailSession && Date.now() < currentServerEmailSession.expiresAtMs) {
    headers.Authorization = `Bearer ${currentServerEmailSession.token}`;
  }
  return headers;
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
