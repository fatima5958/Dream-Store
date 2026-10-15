/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Edit3,
  Layers,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  ShoppingBag,
  LogIn,
} from 'lucide-react';
import {
  calculateCommissionMinor,
  CartItem,
  CommissionStatus,
  CurrencyCode,
  formatMinorToMajor,
  GatewayServerStatus,
  getConfiguredSellerPaymentMethods,
  INDIA_STORE_CONFIG,
  INITIAL_PLATFORM_STORES,
  INITIAL_PRODUCTS,
  INITIAL_SELLER_PAYMENT_SETTINGS,
  INITIAL_SELLER_PAYMENT_SETTINGS_BY_STORE,
  INITIAL_STORE_CONFIG,
  INITIAL_STORE_CONFIGS,
  LedgerAuditEntry,
  OrderItem,
  OrderPaymentStatus,
  PaymentMethodId,
  PlatformStore,
  Product,
  resolveStoreAssetUrl,
  ScreenId,
  SellerPaymentSettings,
  StoreConfig,
  stripLegacyDemoPaymentValue,
  VerificationMode,
} from './types/dreamstore';
import {
  auth,
  db,
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
  signInWithPopup,
  signOut,
   signOutUser,
  onAuthStateChanged,
  subscribeAuthState,
  hasFirebaseSdkSession,
  googleProvider,
  handleFirestoreError,
  OperationType,
  FirebaseUser,
  getAuthHeaders,
  invalidateRejectedLegacyEmailSession,
} from './lib/firebase';
import { getDocs } from 'firebase/firestore';
import { LandingPage } from './components/screens/LandingPage';
import { StoreSetupWizard } from './components/screens/StoreSetupWizard';
import { StoreOwnerDashboard, OwnerTab } from './components/screens/StoreOwnerDashboard';
import { StorefrontHome } from './components/screens/StorefrontHome';
import { ShopPage } from './components/screens/ShopPage';
import { ProductDetailPage } from './components/screens/ProductDetailPage';
import { VisualStoreEditor } from './components/screens/VisualStoreEditor';
import { MobileDesignsView } from './components/screens/MobileDesignsView';
import { SuperAdminDashboard } from './components/screens/SuperAdminDashboard';
import { CheckoutAndOrdersPage } from './components/screens/CheckoutAndOrdersPage';
import { GeminiChatWidget } from './components/GeminiChatWidget';
import { CandylandAuthModal, AuthModalMode } from './components/CandylandAuthModal';
import { RoleOnboardingModal, OnboardingUserRole } from './components/RoleOnboardingModal';
import {
  RoleNavigationBar,
  BuyerNavSection,
  SellerNavSection,
} from './components/RoleNavigationBar';

const SCREEN_TABS: { id: ScreenId; num: string; label: string }[] = [
  { id: 'landing', num: '1', label: 'DreamStore Landing' },
  { id: 'wizard', num: '2', label: 'Setup Wizard' },
  { id: 'owner-dashboard', num: '3', label: 'Owner Dashboard' },
  { id: 'storefront', num: '4', label: 'Fatima.tech Store' },
  { id: 'shop', num: '5', label: 'Shop Page' },
  { id: 'product-detail', num: '6', label: 'Product Detail' },
  { id: 'visual-editor', num: '7', label: 'Visual Editor' },
  { id: 'mobile-designs', num: '8', label: 'Mobile Designs' },
  { id: 'super-admin', num: '9', label: 'Super Admin' },
  { id: 'checkout', num: '10', label: 'Checkout & Delivery' },
];

const LEGACY_STORAGE_KEYS = [
  'dreamstore_configs_v2',
  'dreamstore_products_v2',
  'dreamstore_wizard_step_v1',
];

// Neutral presentation before a real seller/store is selected.
// Demo creator names, payment accounts and product data must never be defaults in production.
const NEUTRAL_PUBLIC_STORE_CONFIG: StoreConfig = {
  ...INITIAL_STORE_CONFIG,
  storeId: '',
  ownerId: '',
  ownerEmail: '',
  storeSlug: '',
  storeName: '',
  ownerName: 'Creator',
  ownerRole: 'Store Owner',
  ownerAvatar: '',
  logoUrl: '',
  socialWebsite: '',
  instagramHandle: '',
  sellerCountry: 'Pakistan',
  productType: 'Digital Products',
  announcementText: 'Welcome to your store',
  heroHeadingLine1: 'Your Store',
  heroHeadingLine2: 'Your Style',
  heroSubheading: 'Digital products from independent creators.',
  heroButtonText: 'Explore Products',
  heroImage: '',
};

function buildFreshUserStoreConfig(user: {
  uid: string;
  displayName?: string | null;
  email?: string | null;
}): StoreConfig {
  const userStoreId = `store-${user.uid.slice(0, 20)}`;
  const rawName = user.displayName?.trim() || 'Creator';
  return {
    ...NEUTRAL_PUBLIC_STORE_CONFIG,
    storeId: userStoreId,
    ownerId: user.uid,
    ownerEmail: user.email || '',
    ownerName: rawName.slice(0, 100),
  };
}

export default function App() {
  const requestedUrlScreenRef = useRef<ScreenId | null>((() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const s = params.get('screen') as ScreenId | null;
      if (s && SCREEN_TABS.some((t) => t.id === s)) return s;
      if (window.location.pathname.toLowerCase().includes('super-admin')) return 'super-admin';
    } catch {}
    return null;
  })());

  const [activeScreen, setActiveScreen] = useState<ScreenId>(() => {
    const params = new URLSearchParams(window.location.search);
    const screenParam = params.get('screen') as ScreenId | null;
    // Never render super-admin before server-side SUPER_ADMIN_UID verification completes
    // A direct URL cannot render a private workspace before authentication and role resolution.
    if (
      screenParam === 'super-admin' ||
      screenParam === 'owner-dashboard' ||
      screenParam === 'wizard' ||
      screenParam === 'visual-editor' ||
      window.location.pathname.toLowerCase().includes('super-admin')
    ) {
      return 'landing';
    }
    if (screenParam && SCREEN_TABS.some((t) => t.id === screenParam)) {
      return screenParam;
    }
    // Wait for an actual store lookup before showing a seller's storefront.
    // Unknown slugs must not render the default/demo template.
    return 'landing';
  });
  const activeScreenRef = useRef<ScreenId>(activeScreen);
  useEffect(() => {
    activeScreenRef.current = activeScreen;
  }, [activeScreen]);

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [isSuperAdminVerified, setIsSuperAdminVerified] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<{
    uid: string;
    role: 'buyer' | 'seller' | 'super_admin';
    displayName: string;
    email: string;
    onboardingCompleted: boolean;
  } | null>(null);
  const [roleOnboardingOpen, setRoleOnboardingOpen] = useState<boolean>(false);
  const [activeBuyerSection, setActiveBuyerSection] = useState<BuyerNavSection>('storefronts');
  const [activeSellerTab, setActiveSellerTab] = useState<OwnerTab>('overview');
  const [blockedAccessNotice, setBlockedAccessNotice] = useState<string | null>(null);

  // Demo storefronts are only for local preview, not published visitor listings.
  const [storeConfigs, setStoreConfigs] = useState<Record<string, StoreConfig>>(
    import.meta.env.DEV ? INITIAL_STORE_CONFIGS : {}
  );
  const storeConfigsRef = useRef<Record<string, StoreConfig>>(
    import.meta.env.DEV ? INITIAL_STORE_CONFIGS : {}
  );
  useEffect(() => {
    storeConfigsRef.current = storeConfigs;
  }, [storeConfigs]);

  const [activeStoreId, setActiveStoreId] = useState<string>(() =>
    import.meta.env.DEV ? INITIAL_STORE_CONFIG.storeId : ''
  );
  const activeStoreIdRef = useRef<string>(activeStoreId);
  useEffect(() => {
    activeStoreIdRef.current = activeStoreId;
  }, [activeStoreId]);

  const config = storeConfigs[activeStoreId] || (import.meta.env.DEV ? INITIAL_STORE_CONFIG : NEUTRAL_PUBLIC_STORE_CONFIG);
  const setConfig = (
    updater: StoreConfig | ((prev: StoreConfig) => StoreConfig),
    explicitStoreId?: string
  ) => {
    const targetId = explicitStoreId || activeStoreIdRef.current;
    setStoreConfigs((prevMap) => {
      const current = prevMap[targetId] || NEUTRAL_PUBLIC_STORE_CONFIG;
      const next = typeof updater === 'function' ? updater(current) : updater;
      const resolvedId = next.storeId || targetId;
      const updatedMap = {
        ...prevMap,
        [resolvedId]: { ...next, storeId: resolvedId },
      };
      storeConfigsRef.current = updatedMap;
      return updatedMap;
    });
  };
  const [products, setProducts] = useState<Product[]>(import.meta.env.DEV ? INITIAL_PRODUCTS : []);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<LedgerAuditEntry[]>([]);
  const [paymentSettingsMap, setPaymentSettingsMap] = useState<
    Record<string, SellerPaymentSettings>
  >(INITIAL_SELLER_PAYMENT_SETTINGS_BY_STORE);
  const targetActiveStoreId = config.storeId || activeStoreId;
  const sellerPaymentSettings: SellerPaymentSettings =
    paymentSettingsMap[targetActiveStoreId] &&
    (!paymentSettingsMap[targetActiveStoreId].storeId ||
      paymentSettingsMap[targetActiveStoreId].storeId === targetActiveStoreId)
      ? paymentSettingsMap[targetActiveStoreId]
      : {
          ...INITIAL_SELLER_PAYMENT_SETTINGS,
          storeId: targetActiveStoreId,
          ownerId: config.ownerId || '',
        };
  const lastSyncedPaymentSettingsSigRef = useRef<string>('');
  const paymentSaveDebounceRef = useRef<number | null>(null);

  const reportFirestoreError = (
    error: unknown,
    operationType: OperationType,
    path: string | null
  ) => {
    try {
      handleFirestoreError(error, operationType, path);
    } catch {
      // Structured FirestoreErrorInfo has been logged by handleFirestoreError; prevent uncaught UI crash
    }
  };

  const setSellerPaymentSettings = (
    settings: SellerPaymentSettings,
    explicitStoreId?: string
  ) => {
    const targetStoreId = explicitStoreId || activeStoreIdRef.current;
    const jazzId = stripLegacyDemoPaymentValue(settings.jazzCashMerchantId, 120);
    const epId = stripLegacyDemoPaymentValue(settings.easypaisaStoreId, 120);
    const cleanSettings: SellerPaymentSettings = {
      ...settings,
      storeId: targetStoreId,
      jazzCashMerchantId: jazzId,
      jazzCashEnabled: jazzId.length >= 3 && settings.jazzCashEnabled !== false,
      easypaisaStoreId: epId,
      easypaisaEnabled: epId.length >= 3 && settings.easypaisaEnabled !== false,
      upiId: stripLegacyDemoPaymentValue(settings.upiId, 120),
      paymentLinkUrl: stripLegacyDemoPaymentValue(settings.paymentLinkUrl, 300),
      bankTransferInstructions: stripLegacyDemoPaymentValue(
        settings.bankTransferInstructions,
        1000
      ),
      payoneerReceivingEmail: stripLegacyDemoPaymentValue(
        settings.payoneerReceivingEmail,
        254
      ),
      payoneerRequestLink: stripLegacyDemoPaymentValue(settings.payoneerRequestLink, 300),
      payoneerReceivingAccountDetails: stripLegacyDemoPaymentValue(
        settings.payoneerReceivingAccountDetails,
        500
      ),
      whatsappNotificationNumber: stripLegacyDemoPaymentValue(
        settings.whatsappNotificationNumber,
        40
      ),
      stripeAccountId: stripLegacyDemoPaymentValue(settings.stripeAccountId, 120),
    };
    const methods = getConfiguredSellerPaymentMethods(cleanSettings, gatewayStatus);
    cleanSettings.configuredMethods = methods;
    cleanSettings.paymentConfigured = methods.length > 0;
    cleanSettings.setupMessage =
      methods.length > 0
        ? ''
        : 'Paid checkout is disabled for this store until the seller configures valid payment receiving details in Seller Dashboard → Payment Settings.';

    setPaymentSettingsMap((prev) => {
      const next: Record<string, SellerPaymentSettings> = {
        ...prev,
        [targetStoreId]: cleanSettings,
      };
      const activeCfg = storeConfigsRef.current[activeStoreIdRef.current];
      if (
        activeCfg &&
        cleanSettings.ownerId &&
        (activeCfg.ownerId === cleanSettings.ownerId ||
          (activeStoreIdRef.current === 'store-fatima-tech' &&
            activeCfg.storeSlug.replace(/[._-]/g, '') === 'fatimatech'))
      ) {
        next[activeStoreIdRef.current] = {
          ...cleanSettings,
          storeId: activeStoreIdRef.current,
        };
      }
      return next;
    });
  };
  const [gatewayStatus, setGatewayStatus] = useState<GatewayServerStatus>({
    paidCheckoutEnabled: false,
    jazzcashConfigured: false,
    easypaisaConfigured: false,
    stripeConfigured: false,
    emailConfigured: false,
  });

  const [platformStores, setPlatformStores] = useState<PlatformStore[]>(
    import.meta.env.DEV ? INITIAL_PLATFORM_STORES : []
  );
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [dockMinimized, setDockMinimized] = useState<boolean>(true);
  const [cartToast, setCartToast] = useState<string | null>(null);
  const cartToastTimerRef = useRef<number | null>(null);
  const isDevControlsEnabled =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dev') === 'true';

  // Fetch buyer-facing seller payment instructions exclusively for the active store
  useEffect(() => {
    const targetStoreId = config.storeId || activeStoreId;
    if (!targetStoreId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fetch(
          `/api/checkout/payment-instructions/${encodeURIComponent(targetStoreId)}`,
          { headers }
        );
        if (!r.ok || cancelled) return;
        const data = await r.json();
        const instr = data?.instructions || data?.paymentInstructions;
        if (instr && !cancelled) {
          setPaymentSettingsMap((prev) => {
            const existingForStore =
              prev[targetStoreId] && prev[targetStoreId].storeId === targetStoreId
                ? prev[targetStoreId]
                : INITIAL_SELLER_PAYMENT_SETTINGS;
            const serverConfigured = Boolean(
              data.paymentConfigured ?? instr.paymentConfigured
            );
            const existingMethods = getConfiguredSellerPaymentMethods(
              existingForStore,
              gatewayStatus
            );
            // Never wipe out already-loaded verified owner settings if server response was unconfigured prior to store sync
            if (
              !serverConfigured &&
              existingMethods.length > 0 &&
              currentUser &&
              existingForStore.ownerId === currentUser.uid
            ) {
              return prev;
            }
            return {
              ...prev,
              [targetStoreId]: {
                ...existingForStore,
                ...instr,
                storeId: targetStoreId,
                paymentConfigured: serverConfigured,
                configuredMethods: Array.isArray(data.configuredMethods)
                  ? data.configuredMethods
                  : instr.configuredMethods || [],
                setupMessage: String(data.setupMessage ?? instr.setupMessage ?? ''),
              },
            };
          });
        }
      } catch {
        // Ignore network error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.storeId, activeStoreId, activeScreen, currentUser]);

  // Public discovery: list only genuinely active stores returned by the backend.
  // No seeded sample sellers, mock email addresses or pre-filled products.
  useEffect(() => {
    let alive = true;
    fetch('/api/stores', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!alive || !Array.isArray(data?.stores)) return;
        const active = data.stores.filter(
          (s: any) => s && s.storeId && s.storeSlug && s.status === 'Active'
        );
        setStoreConfigs((prev) => {
          const next = { ...prev };
          for (const entry of active) {
            if (next[entry.storeId]) continue;
            next[entry.storeId] = {
              ...NEUTRAL_PUBLIC_STORE_CONFIG,
              storeId: String(entry.storeId),
              ownerId: String(entry.ownerId || ''),
              ownerEmail: '',
              storeSlug: String(entry.storeSlug),
              storeName: String(entry.storeName || 'Creator Store'),
              ownerName: String(entry.ownerName || 'Creator'),
              sellerCountry: String(entry.country || entry.sellerCountry || 'Pakistan'),
              currency: entry.currency || 'PKR',
              productType: String(entry.productType || 'Digital Products'),
              socialWebsite: '',
              announcementText: `Welcome to ${String(entry.storeName || 'Creator Store')}`,
              heroHeadingLine1: String(entry.storeName || 'Creator Store'),
              heroHeadingLine2: 'Digital Products',
              heroSubheading: 'Explore products from this independent creator.',
            };
          }
          storeConfigsRef.current = next;
          return next;
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Purge any legacy localStorage/sessionStorage keys so stale demo data never overwrites user inputs
  useEffect(() => {
    try {
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    } catch {}
  }, []);

  const loadStoreFromBackendOrFirestore = async (
    cleanSlug: string
  ): Promise<StoreConfig | null> => {
    // 1. Check Firestore stores collection first
    try {
      const qStore = query(
        collection(db, 'stores'),
        where('storeSlug', '==', cleanSlug),
        where('status', '==', 'Active')
      );
      const snap = await getDocs(qStore);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const d = docSnap.data();
        const loadedStoreId = docSnap.id;
        const loadedConfig: StoreConfig = {
          ...(storeConfigsRef.current[loadedStoreId] || NEUTRAL_PUBLIC_STORE_CONFIG),
          storeId: loadedStoreId,
          ownerId: d.ownerId || '',
          storeSlug: d.storeSlug || cleanSlug,
          storeName: d.storeName || cleanSlug,
          ownerName: d.ownerName || 'Creator',
          instagramHandle: d.instagramHandle || `@${d.storeSlug || cleanSlug}`,
          sellerCountry: d.sellerCountry || 'Pakistan',
          productType: d.productType || 'Ebooks & Guides',
          announcementText:
            d.announcementText ||
            `Welcome to ${d.storeName || cleanSlug} — Digital Downloads & Guides ✨`,
          heroHeadingLine1: d.heroHeadingLine1 || NEUTRAL_PUBLIC_STORE_CONFIG.heroHeadingLine1,
          heroHeadingLine2: d.heroHeadingLine2 || NEUTRAL_PUBLIC_STORE_CONFIG.heroHeadingLine2,
          heroSubheading: d.heroSubheading || NEUTRAL_PUBLIC_STORE_CONFIG.heroSubheading,
          heroButtonText: d.heroButtonText || NEUTRAL_PUBLIC_STORE_CONFIG.heroButtonText,
          heroImage: resolveStoreAssetUrl(d.heroImage, NEUTRAL_PUBLIC_STORE_CONFIG.heroImage),
          logoUrl: resolveStoreAssetUrl(
            d.logoUrl || d.ownerAvatar,
            NEUTRAL_PUBLIC_STORE_CONFIG.logoUrl
          ),
          ownerAvatar: resolveStoreAssetUrl(
            d.ownerAvatar || d.logoUrl,
            NEUTRAL_PUBLIC_STORE_CONFIG.ownerAvatar
          ),
          theme: d.theme || 'blush-rose',
          currency: d.currency || 'PKR',
          exchangeRatePkr: Number(d.exchangeRatePkr) || 278,
        };
        setStoreConfigs((prev) => {
          const next = { ...prev, [loadedStoreId]: loadedConfig };
          storeConfigsRef.current = next;
          return next;
        });
        setActiveStoreId(loadedStoreId);

        const qPubProds = query(
          collection(db, 'products'),
          where('storeId', '==', loadedStoreId),
          where('published', '==', true)
        );
        const prodSnap = await getDocs(qPubProds);
        {
          const fsProds: Product[] = prodSnap.docs.filter((pDoc) => pDoc.data().deleted !== true).map((pDoc) => {
            const pd = pDoc.data();
            return {
              id: pDoc.id,
              storeId: pd.storeId,
              ownerId: pd.ownerId,
              title: pd.title,
              category: pd.category,
              subtitle: pd.subtitle,
              description: pd.description,
              whatsIncluded: [
                `Complete ${pd.fileName} (${pd.fileSizeLabel})`,
                'Printable & Tablet-Friendly Worksheets',
              ],
              details: [
                { label: 'Format', value: pd.fileType },
                { label: 'File Size', value: pd.fileSizeLabel },
                { label: 'Delivery', value: 'Instant Digital Download' },
              ],
              price: pd.priceUsd,
              priceUsd: pd.priceUsd,
              pricePkr: pd.pricePkr,
              isFree: pd.isFree,
              published: pd.published,
              status: pd.status,
              image: resolveStoreAssetUrl(pd.image),
              gallery: [resolveStoreAssetUrl(pd.image)].filter(Boolean),
              features: INITIAL_PRODUCTS[0].features,
              fileName: pd.fileName,
              fileType: pd.fileType,
              fileSizeLabel: pd.fileSizeLabel,
            };
          });
          setProducts((prev) => {
            const existingIds = new Set(fsProds.map((fp) => fp.id));
            return [...fsProds, ...prev.filter((p) => !existingIds.has(p.id))];
          });
          setSelectedProductId(fsProds[0].id);
        }
        return loadedConfig;
      }
    } catch {
      // Fallback to server store lookup
    }

    // 2. Check server-side persistent store registry (/api/stores/by-slug/:slug)
    try {
      const res = await fetch(`/api/stores/by-slug/${encodeURIComponent(cleanSlug)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.store) {
          const s = data.store;
          const loadedStoreId = s.storeId;
          const loadedConfig: StoreConfig = {
            ...(storeConfigsRef.current[loadedStoreId] || NEUTRAL_PUBLIC_STORE_CONFIG),
            storeId: loadedStoreId,
            ownerId: s.ownerId || '',
            storeSlug: s.storeSlug || cleanSlug,
            storeName: s.storeName || cleanSlug,
            ownerName: s.ownerName || 'Creator',
            instagramHandle: s.instagramHandle || `@${s.storeSlug || cleanSlug}`,
            sellerCountry: s.sellerCountry || s.country || 'Pakistan',
            productType: s.productType || 'Ebooks & Guides',
            announcementText:
              s.announcementText ||
              `Welcome to ${s.storeName || cleanSlug} — Digital Downloads & Guides ✨`,
            heroHeadingLine1: s.heroHeadingLine1 || NEUTRAL_PUBLIC_STORE_CONFIG.heroHeadingLine1,
            heroHeadingLine2: s.heroHeadingLine2 || NEUTRAL_PUBLIC_STORE_CONFIG.heroHeadingLine2,
            heroSubheading: s.heroSubheading || NEUTRAL_PUBLIC_STORE_CONFIG.heroSubheading,
            heroButtonText: s.heroButtonText || NEUTRAL_PUBLIC_STORE_CONFIG.heroButtonText,
            heroImage: resolveStoreAssetUrl(s.heroImage, NEUTRAL_PUBLIC_STORE_CONFIG.heroImage),
            logoUrl: resolveStoreAssetUrl(
              s.logoUrl || s.ownerAvatar,
              NEUTRAL_PUBLIC_STORE_CONFIG.logoUrl
            ),
            ownerAvatar: resolveStoreAssetUrl(
              s.ownerAvatar || s.logoUrl,
              NEUTRAL_PUBLIC_STORE_CONFIG.ownerAvatar
            ),
            theme: s.theme || 'blush-rose',
            currency: s.currency || 'PKR',
            exchangeRatePkr: Number(s.exchangeRatePkr) || 278,
          };
          setStoreConfigs((prev) => {
            const next = { ...prev, [loadedStoreId]: loadedConfig };
            storeConfigsRef.current = next;
            return next;
          });
          setActiveStoreId(loadedStoreId);

          if (Array.isArray(data.products) && data.products.length > 0) {
            const apiProds: Product[] = data.products.filter((pd: any) => pd.deleted !== true && pd.published === true).map((pd: any) => ({
              id: pd.id,
              storeId: pd.storeId || loadedStoreId,
              ownerId: pd.ownerId || s.ownerId,
              title: pd.title,
              category: pd.category || 'Ebooks',
              subtitle: pd.subtitle || '',
              description: pd.description || '',
              whatsIncluded: [
                `Original file: ${pd.fileName || ''} (${pd.fileSizeLabel || 'size unknown'})`,
              ],
              details: [
                { label: 'Format', value: pd.fileType || '' },
                { label: 'Delivery', value: 'Instant Digital Download' },
              ],
              price: Number(pd.priceUsd) || 0,
              priceUsd: Number(pd.priceUsd) || 0,
              pricePkr: Number(pd.pricePkr) || 0,
              isFree: Boolean(pd.isFree),
              published: pd.published !== false,
              status: pd.status || 'Available',
              image: resolveStoreAssetUrl(pd.image),
              gallery: [resolveStoreAssetUrl(pd.image)].filter(Boolean),
              features: [],
              fileName: pd.fileName || '',
              fileType: pd.fileType || '',
              fileSizeLabel: pd.fileSizeLabel || '',
            }));
            setProducts((prev) => {
              const existingIds = new Set(apiProds.map((fp) => fp.id));
              return [...apiProds, ...prev.filter((p) => p.storeId !== loadedStoreId && !existingIds.has(p.id))];
            });
            setSelectedProductId(apiProds[0]?.id || '');
          } else {
            // No published products means an empty storefront, not fabricated goods.
            setProducts((prev) => prev.filter((p) => p.storeId !== loadedStoreId));
          }
          return loadedConfig;
        }
      }
    } catch {
      // Ignore network error
    }
    return null;
  };

  // 1. Check backend payment gateway configuration, URL store query parameter & browser popstate
  useEffect(() => {
    const syncFromUrl = async () => {
      const params = new URLSearchParams(window.location.search);
      const storeParam = params.get('store');
      const screenParam = params.get('screen') as ScreenId | null;

      if (storeParam) {
        const cleanSlug = storeParam.trim().toLowerCase();
        const loaded = await loadStoreFromBackendOrFirestore(cleanSlug);
        if (!loaded) {
          // No implicit Fatima/Ananya fallback for invalid public links.
          if (import.meta.env.DEV) {
            const localMatch = (Object.values(storeConfigsRef.current) as StoreConfig[])
              .find((sc) => sc.storeSlug.toLowerCase() === cleanSlug);
            if (localMatch) {
              setActiveStoreId(localMatch.storeId);
            } else {
              setBlockedAccessNotice('Store not found. Check the link or explore available stores.');
              setActiveScreen('landing');
              return;
            }
          } else {
            setBlockedAccessNotice('Store not found. Check the link or explore available stores.');
            setActiveScreen('landing');
            return;
          }
        }
      }

      if (screenParam && SCREEN_TABS.some((t) => t.id === screenParam)) {
        requestedUrlScreenRef.current = screenParam;
        const sellerScreen =
          screenParam === 'wizard' ||
          screenParam === 'owner-dashboard' ||
          screenParam === 'visual-editor';
        if (sellerScreen || screenParam === 'super-admin') {
          // Do not render a private workspace to a guest during auth restoration.
          setActiveScreen('landing');
        } else {
          setActiveScreen(screenParam);
        }
      } else if (storeParam && !screenParam) {
        setActiveScreen('storefront');
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);

    fetch('/api/payments/gateway-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setGatewayStatus({
            paidCheckoutEnabled: data.paidCheckoutEnabled === true,
            jazzcashConfigured: Boolean(data.jazzcashConfigured),
            easypaisaConfigured: Boolean(data.easypaisaConfigured),
            razorpayConfigured: Boolean(data.razorpayConfigured),
            stripeConfigured: Boolean(data.stripeConfigured),
            payoneerConfigured: Boolean(data.payoneerConfigured),
            payoneerMode: data.payoneerMode === 'live_api' ? 'live_api' : 'manual_settlement',
            emailConfigured: Boolean(data.emailConfigured),
            platformCommissionBps: Number(data.platformCommissionBps) || 500,
          });
        }
      })
      .catch(() => {});

    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // 2. Listen to Firebase & Email Authentication state
  useEffect(() => {
    const unsub = subscribeAuthState(async (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      // Clear any previous session's orders & audit logs immediately to prevent cross-account leakage
      setOrders([]);
      setAuditLogs([]);

      if (!user) {
        setIsSuperAdminVerified(false);
        setUserProfile(null);
        setRoleOnboardingOpen(false);
        return;
      }

      if (user) {
        let verifiedSuperAdmin = false;
        // Verify whether the authenticated user's UID matches the server's SUPER_ADMIN_UID
        try {
          const authHeaders = await getAuthHeaders();
          const adminRes = await fetch('/api/admin/verify-session', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({}),
          });
          if (adminRes.ok) {
            const adminData = await adminRes.json();
            verifiedSuperAdmin = Boolean(
              adminData.isSuperAdmin && adminData.uid === user.uid
            );
            setIsSuperAdminVerified(verifiedSuperAdmin);
          } else {
            setIsSuperAdminVerified(false);
          }
        } catch {
          setIsSuperAdminVerified(false);
        }

        const userStoreId = `store-${user.uid.slice(0, 20)}`;
        const freshDefault = buildFreshUserStoreConfig(user);
        const defaultName =
          user.displayName?.trim() ||
          (user.email ? user.email.split('@')[0] : '') ||
          'Shopper';
        const defaultEmail = user.email || '';

        // Check existing user profile & store status to preserve existing users, roles, and stores
        let existingRole: 'buyer' | 'seller' | 'super_admin' | null = verifiedSuperAdmin
          ? 'super_admin'
          : null;
        let existingName = defaultName;
        let existingEmail = defaultEmail;
        let hasExistingStoreDoc = false;
        let existingStoreData: Record<string, any> | null = null;

        if (hasFirebaseSdkSession()) {
          try {
            const storeSnap = await getDoc(doc(db, 'stores', userStoreId));
            if (storeSnap.exists()) {
              hasExistingStoreDoc = true;
              existingStoreData = storeSnap.data();
              // Store metadata may be used to populate the UI, but never to
              // grant a role before the verified backend confirms ownership.
            }
          } catch {
            // Ignore store check error
          }

        }

        if (!existingRole) {
          // Role and onboarding state must come from the verified backend.
          // Do not grant Seller/Buyer dashboards from editable localStorage.
          try {
            const authHeaders = await getAuthHeaders({}, { forceRefresh: true, requireAuth: true });
            const profRes = await fetch('/api/users/profile', {
              headers: authHeaders,
              cache: 'no-store',
            });
            if (profRes.status === 401) {
              invalidateRejectedLegacyEmailSession();
              await signOutUser().catch(() => {});
              setUserProfile(null);
              setRoleOnboardingOpen(false);
              setAuthModalMode('signin');
              setAuthModalOpen(true);
              setBlockedAccessNotice('Your session expired. Sign in again to open your account.');
              return;
            }
            if (!profRes.ok) {
              setUserProfile(null);
              setRoleOnboardingOpen(false);
              setBlockedAccessNotice('Account verification is temporarily unavailable. Please refresh and retry.');
              return;
            }
            const profData = await profRes.json();
            if (
              profData &&
              profData.needsOnboarding === false &&
              profData.profile &&
              (profData.profile.role === 'buyer' ||
                profData.profile.role === 'seller' ||
                (verifiedSuperAdmin && profData.profile.role === 'super_admin'))
            ) {
              existingRole = profData.profile.role;
              existingName = String(profData.profile.displayName || defaultName);
              existingEmail = String(profData.profile.email || defaultEmail);
            }
          } catch {
            setUserProfile(null);
            setRoleOnboardingOpen(false);
            setBlockedAccessNotice('Could not verify your account. Check your connection and retry.');
            return;
          }
        }

        // If brand-new user on first login (no existing role and no existing store), prompt Role Onboarding
        if (!existingRole) {
          setUserProfile(null);
          setAuthModalOpen(false);
          setRoleOnboardingOpen(true);
          return;
        }

        const resolvedRole: 'buyer' | 'seller' | 'super_admin' = verifiedSuperAdmin
          ? 'super_admin'
          : existingRole === 'buyer'
          ? 'buyer'
          : 'seller';
        const resolvedProfile = {
          uid: user.uid,
          role: resolvedRole,
          displayName: existingName,
          email: existingEmail,
          onboardingCompleted: true,
        };
        setUserProfile(resolvedProfile);
        setRoleOnboardingOpen(false);
        setAuthModalOpen(false);
        try {
          if (resolvedRole !== 'super_admin') {
            localStorage.setItem(
              `dreamstore_user_profile_${user.uid}`,
              JSON.stringify(resolvedProfile)
            );
          }
        } catch {}

        // Role-based post-login landing & direct URL enforcement for returning users
        const currentUrlScreen = new URLSearchParams(window.location.search).get(
          'screen'
        ) as ScreenId | null;

        if (resolvedRole === 'buyer' && !hasExistingStoreDoc) {
          const isUnauthorizedForBuyer =
            currentUrlScreen === 'owner-dashboard' ||
            currentUrlScreen === 'wizard' ||
            currentUrlScreen === 'visual-editor' ||
            currentUrlScreen === 'super-admin' ||
            activeScreenRef.current === 'owner-dashboard' ||
            activeScreenRef.current === 'wizard' ||
            activeScreenRef.current === 'visual-editor' ||
            activeScreenRef.current === 'super-admin';

          if (isUnauthorizedForBuyer) {
            setBlockedAccessNotice(
              'Access Blocked: Seller & Admin screens are restricted for Buyer accounts.'
            );
            setActiveScreen('storefront');
            try {
              const u = new URL(window.location.href);
              u.searchParams.set('screen', 'storefront');
              window.history.replaceState({ screen: 'storefront' }, '', u.toString());
            } catch {}
          } else if (activeScreenRef.current === 'landing' && !currentUrlScreen) {
            setActiveScreen('storefront');
          }
          return;
        }

        if (resolvedRole === 'super_admin' && verifiedSuperAdmin) {
          if (
            requestedUrlScreenRef.current === 'super-admin' ||
            currentUrlScreen === 'super-admin' ||
            (activeScreenRef.current === 'landing' && !currentUrlScreen)
          ) {
            setActiveScreen('super-admin');
          }
        } else if (resolvedRole === 'seller') {
          if (
            (requestedUrlScreenRef.current === 'wizard' ||
              requestedUrlScreenRef.current === 'owner-dashboard' ||
              requestedUrlScreenRef.current === 'visual-editor') &&
            activeScreenRef.current === 'landing'
          ) {
            setActiveScreen(requestedUrlScreenRef.current);
          }
          if (
            requestedUrlScreenRef.current === 'super-admin' ||
            currentUrlScreen === 'super-admin' ||
            activeScreenRef.current === 'super-admin'
          ) {
            setBlockedAccessNotice(
              'Access Blocked: Platform Dashboard is exclusively restricted to verified SUPER_ADMIN_UID.'
            );
            setActiveScreen('owner-dashboard');
            try {
              const u = new URL(window.location.href);
              u.searchParams.set('screen', 'owner-dashboard');
              window.history.replaceState({ screen: 'owner-dashboard' }, '', u.toString());
            } catch {}
          } else if (activeScreenRef.current === 'landing' && !currentUrlScreen) {
            setActiveScreen('owner-dashboard');
          }
        }

        // Preserve existing Seller / Super Admin store and payment settings
        setPaymentSettingsMap((prev) => {
          if (prev[userStoreId]) return prev;
          return {
            ...prev,
            [userStoreId]: {
              ownerId: user.uid,
              storeId: userStoreId,
              email: existingEmail,
              jazzCashMerchantId: '',
              jazzCashEnabled: false,
              easypaisaStoreId: '',
              easypaisaEnabled: false,
              upiId: '',
              paymentLinkUrl: '',
              payoneerEnabled: false,
              payoneerReceivingEmail: '',
              payoneerRequestLink: '',
              payoneerReceivingAccountDetails: '',
              whatsappNotificationNumber: '',
              whatsappNotificationsEnabled: false,
              stripeAccountId: '',
              stripeEnabled: false,
              bankTransferInstructions: '',
            },
          };
        });

        const params = new URLSearchParams(window.location.search);
        const urlStore = (params.get('store') || '').trim().toLowerCase();
        const urlScreen = params.get('screen');

        if (hasExistingStoreDoc && existingStoreData) {
          const d = existingStoreData;
          const existingConfig: StoreConfig = {
            ...freshDefault,
            storeId: userStoreId,
            ownerId: d.ownerId || user.uid,
            storeSlug: d.storeSlug || freshDefault.storeSlug,
            storeName: d.storeName || freshDefault.storeName,
            ownerName: d.ownerName || freshDefault.ownerName,
            instagramHandle: d.instagramHandle || freshDefault.instagramHandle,
            sellerCountry: d.sellerCountry || freshDefault.sellerCountry,
            productType: d.productType || freshDefault.productType,
            announcementText: d.announcementText || freshDefault.announcementText,
            heroHeadingLine1: d.heroHeadingLine1 || freshDefault.heroHeadingLine1,
            heroHeadingLine2: d.heroHeadingLine2 || freshDefault.heroHeadingLine2,
            heroSubheading: d.heroSubheading || freshDefault.heroSubheading,
            heroButtonText: d.heroButtonText || freshDefault.heroButtonText,
            heroImage: resolveStoreAssetUrl(d.heroImage, freshDefault.heroImage),
            logoUrl: resolveStoreAssetUrl(
              d.logoUrl || d.ownerAvatar,
              freshDefault.logoUrl
            ),
            ownerAvatar: resolveStoreAssetUrl(
              d.ownerAvatar || d.logoUrl,
              freshDefault.ownerAvatar
            ),
            theme: d.theme || freshDefault.theme,
            customAccentColor: d.customAccentColor || freshDefault.customAccentColor || '',
            currency: d.currency || freshDefault.currency,
            exchangeRatePkr: Number(d.exchangeRatePkr) || 278,
          };
          setStoreConfigs((prev) => {
            const next = { ...prev, [userStoreId]: existingConfig };
            storeConfigsRef.current = next;
            return next;
          });

          if (
            !urlStore ||
            urlScreen === 'wizard' ||
            urlScreen === 'owner-dashboard' ||
            urlScreen === 'visual-editor' ||
            urlStore === existingConfig.storeSlug.toLowerCase() ||
            urlStore.replace(/[._-]/g, '') ===
              existingConfig.storeSlug.toLowerCase().replace(/[._-]/g, '')
          ) {
            setActiveStoreId(userStoreId);
          }

          try {
            const authHeaders = await getAuthHeaders();
            await fetch('/api/stores/create', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                ...existingConfig,
                ownerEmail: existingEmail,
              }),
            }).catch(() => {});
          } catch {
            // Ignore network error
          }
        } else {
          // Initialize in-memory store config for the authenticated seller
          setStoreConfigs((prev) => {
            if (prev[userStoreId]) return prev;
            const next = { ...prev, [userStoreId]: freshDefault };
            storeConfigsRef.current = next;
            return next;
          });
          if (
            !urlStore ||
            urlScreen === 'wizard' ||
            urlScreen === 'owner-dashboard' ||
            urlScreen === 'visual-editor' ||
            urlStore === freshDefault.storeSlug
          ) {
            setActiveStoreId(userStoreId);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  // 3. Real-time Firestore listeners once authenticated
  useEffect(() => {
    if (!authReady || !currentUser || !hasFirebaseSdkSession()) return;

    const userStoreId = `store-${currentUser.uid.slice(0, 20)}`;
    const isBuyerOnly = userProfile?.role === 'buyer';

    // Listen to Seller Store Document (only for sellers / Super Admin)
    const unsubStore = isBuyerOnly
      ? () => {}
      : onSnapshot(
          doc(db, 'stores', userStoreId),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setConfig(
            (prev) => ({
              ...prev,
              storeId: userStoreId,
              ownerId: d.ownerId || currentUser.uid,
              storeSlug: d.storeSlug || prev.storeSlug,
              storeName: d.storeName || prev.storeName,
              ownerName: d.ownerName || prev.ownerName,
              instagramHandle:
                d.instagramHandle !== undefined ? d.instagramHandle : prev.instagramHandle,
              sellerCountry: d.sellerCountry || prev.sellerCountry || 'Pakistan',
              productType: d.productType || prev.productType || 'Ebooks & Guides',
              announcementText: d.announcementText || prev.announcementText,
              heroHeadingLine1: d.heroHeadingLine1 || prev.heroHeadingLine1,
              heroHeadingLine2: d.heroHeadingLine2 || prev.heroHeadingLine2,
              heroSubheading: d.heroSubheading || prev.heroSubheading,
              heroButtonText: d.heroButtonText || prev.heroButtonText,
              heroImage: resolveStoreAssetUrl(d.heroImage, prev.heroImage),
              logoUrl: resolveStoreAssetUrl(d.logoUrl || d.ownerAvatar, prev.logoUrl),
              ownerAvatar: resolveStoreAssetUrl(
                d.ownerAvatar || d.logoUrl,
                prev.ownerAvatar
              ),
              theme: d.theme || prev.theme,
              customAccentColor:
                d.customAccentColor !== undefined
                  ? d.customAccentColor
                  : prev.customAccentColor || '',
              currency: d.currency || prev.currency,
              exchangeRatePkr: Number(d.exchangeRatePkr) || prev.exchangeRatePkr || 278,
            }),
            userStoreId
          );
        }
      },
      (err) => reportFirestoreError(err, OperationType.GET, `stores/${userStoreId}`)
    );

    // Listen to Seller's Products
    const qProducts = query(
      collection(db, 'products'),
      where('ownerId', '==', currentUser.uid)
    );
    const unsubProducts = onSnapshot(
      qProducts,
      (snap) => {
        const loaded: Product[] = snap.docs.filter((docSnap) => docSnap.data().deleted !== true).map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              storeId: d.storeId || userStoreId,
              ownerId: d.ownerId || currentUser.uid,
              title: d.title,
              category: d.category,
              subtitle: d.subtitle,
              description: d.description,
              whatsIncluded: d.fileName ? [`Original file: ${d.fileName} (${d.fileSizeLabel || 'size unknown'})`] : [],
              details: [
                { label: 'Format', value: d.fileType },
                { label: 'File Size', value: d.fileSizeLabel },
                { label: 'Delivery', value: 'Instant Digital Download' },
              ],
              price: d.priceUsd,
              priceUsd: d.priceUsd,
              pricePkr: d.pricePkr,
              isFree: d.isFree,
              published: d.published,
              status: d.status,
              image: resolveStoreAssetUrl(d.image),
              gallery: [resolveStoreAssetUrl(d.image)].filter(Boolean),
              features: [],
              fileName: d.fileName,
              fileType: d.fileType,
              fileSizeLabel: d.fileSizeLabel,
            };
          });
          setProducts((prev) => {
            const loadedIds = new Set(loaded.map((p) => p.id));
            const others = prev.filter(
              (p) => !loadedIds.has(p.id) && p.ownerId !== currentUser.uid
            );
            return [...loaded, ...others];
          });
          setSelectedProductId((prevId) =>
            loaded.some((p) => p.id === prevId) ? prevId : (loaded[0]?.id || '')
          );
          setCart((prevCart) =>
            prevCart.filter((item) =>
              item.product.ownerId !== currentUser.uid ||
              loaded.some((p) => p.id === item.product.id && p.published)
            )
          );
      },
      (err) => reportFirestoreError(err, OperationType.LIST, 'products')
    );

    const mapOrderDoc = (docSnap: { id: string; data: () => Record<string, any> }): OrderItem => {
      const d = docSnap.data();
      const curr = (d.currency || 'PKR') as CurrencyCode;
      const formattedAmount =
        d.totalAmount === 0
          ? 'Free ($0.00)'
          : formatMinorToMajor(Math.round(Number(d.totalAmount) * 100), curr);
      const commissionBreakdown = calculateCommissionMinor(
        Number(d.totalAmount) || 0,
        curr,
        gatewayStatus.platformCommissionBps || 500,
        d.paymentMethod
      );
      return {
        id: docSnap.id,
        orderNumber: d.orderNumber,
        storeId: d.storeId,
        sellerId: d.sellerId,
        buyerId: d.buyerId,
        primaryProductId: d.primaryProductId,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        productTitle: d.itemTitlesSummary,
        itemTitlesSummary: d.itemTitlesSummary,
        itemCount: d.itemCount,
        currency: d.currency,
        subtotal: d.subtotal,
        totalAmount: d.totalAmount,
        amount: formattedAmount,
        paymentMethod: d.paymentMethod,
        paymentStatus: d.paymentStatus,
        paymentReference: d.paymentReference,
        downloadToken: d.downloadToken,
        downloadCount: d.downloadCount,
        maxDownloads: d.maxDownloads,
        expiresAtMs: d.expiresAtMs,
        date: 'Verified Record',
        status: d.paymentStatus === 'Paid' ? 'Completed' : 'Processing',
        verificationMode:
          d.totalAmount === 0
            ? 'Instant Free'
            : d.paymentStatus === 'Paid'
            ? 'Manually Verified by Seller'
            : 'Unverified',
        commissionBreakdown,
      };
    };

    const mergeLoadedOrders = (incomingOrders: OrderItem[]) => {
      setOrders((prev) => {
        const byOrderNum = new Map<string, OrderItem>();
        for (const existing of prev) {
          byOrderNum.set(existing.orderNumber, existing);
        }
        for (const inc of incomingOrders) {
          byOrderNum.set(inc.orderNumber, {
            ...(byOrderNum.get(inc.orderNumber) || {}),
            ...inc,
          });
        }
        return Array.from(byOrderNum.values());
      });
    };

    // Listen to Orders where current user is Seller
    const qSellerOrders = query(
      collection(db, 'orders'),
      where('sellerId', '==', currentUser.uid)
    );
    const unsubOrders = onSnapshot(
      qSellerOrders,
      (snap) => {
        mergeLoadedOrders(snap.docs.map(mapOrderDoc));
      },
      (err) => reportFirestoreError(err, OperationType.LIST, 'orders')
    );

    // Listen to Orders where current user is Buyer (real-time buyer order status updates)
    const qBuyerOrders = query(
      collection(db, 'orders'),
      where('buyerId', '==', currentUser.uid)
    );
    const unsubBuyerOrders = onSnapshot(
      qBuyerOrders,
      (snap) => {
        mergeLoadedOrders(snap.docs.map(mapOrderDoc));
      },
      (err) => reportFirestoreError(err, OperationType.LIST, 'orders')
    );

    // Listen to Seller Private Settings (strictly scoped to currentUser's storeId and hydrated from Firestore)
    const applyAndSyncSellerSettingsDoc = async (d: Record<string, any>) => {
      const jazzId = stripLegacyDemoPaymentValue(d.jazzCashMerchantId, 120);
      const epId = stripLegacyDemoPaymentValue(d.easypaisaStoreId, 120);
      const cleanBank = stripLegacyDemoPaymentValue(d.bankTransferInstructions, 1000);
      const cleanUpi = stripLegacyDemoPaymentValue(d.upiId, 120);
      const cleanLink = stripLegacyDemoPaymentValue(d.paymentLinkUrl, 300);
      const loadedSettings: SellerPaymentSettings = {
        ownerId: d.ownerId || currentUser.uid,
        storeId: userStoreId,
        email: d.email || currentUser.email || '',
        jazzCashMerchantId: jazzId,
        jazzCashEnabled: jazzId.length >= 3 && d.jazzCashEnabled !== false,
        easypaisaStoreId: epId,
        easypaisaEnabled: epId.length >= 3 && d.easypaisaEnabled !== false,
        upiId: cleanUpi,
        paymentLinkUrl: cleanLink,
        payoneerEnabled:
          d.payoneerEnabled !== undefined ? Boolean(d.payoneerEnabled) : false,
        payoneerReceivingEmail: stripLegacyDemoPaymentValue(d.payoneerReceivingEmail, 254),
        payoneerRequestLink: stripLegacyDemoPaymentValue(d.payoneerRequestLink, 300),
        payoneerReceivingAccountDetails: stripLegacyDemoPaymentValue(
          d.payoneerReceivingAccountDetails,
          500
        ),
        whatsappNotificationNumber: stripLegacyDemoPaymentValue(
          d.whatsappNotificationNumber,
          40
        ),
        whatsappNotificationsEnabled:
          d.whatsappNotificationsEnabled !== undefined
            ? Boolean(d.whatsappNotificationsEnabled)
            : false,
        stripeAccountId: stripLegacyDemoPaymentValue(d.stripeAccountId, 120),
        stripeEnabled: Boolean(d.stripeEnabled),
        bankTransferInstructions: cleanBank,
      };
      setSellerPaymentSettings(loadedSettings, userStoreId);

      // Deduplicate background hydration to prevent infinite onSnapshot -> POST -> Firestore loops
      const sig = JSON.stringify({
        ownerId: loadedSettings.ownerId,
        jazz: loadedSettings.jazzCashMerchantId,
        jazzEn: loadedSettings.jazzCashEnabled,
        ep: loadedSettings.easypaisaStoreId,
        epEn: loadedSettings.easypaisaEnabled,
        upi: loadedSettings.upiId,
        bank: loadedSettings.bankTransferInstructions,
        payoneerEn: loadedSettings.payoneerEnabled,
        payoneerEmail: loadedSettings.payoneerReceivingEmail,
        payoneerLink: loadedSettings.payoneerRequestLink,
        payoneerDetails: loadedSettings.payoneerReceivingAccountDetails,
        waNum: loadedSettings.whatsappNotificationNumber,
        waEn: loadedSettings.whatsappNotificationsEnabled,
      });
      if (lastSyncedPaymentSettingsSigRef.current === sig) {
        return;
      }
      lastSyncedPaymentSettingsSigRef.current = sig;

      // Hydrate backend seller settings registry from verified Firestore document (hydrateOnly avoids re-triggering Firestore updatedAt)
      try {
        const authHeaders = await getAuthHeaders();
        await fetch('/api/seller-settings', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ...loadedSettings,
            hydrateOnly: true,
          }),
        });
      } catch {
        // Ignore background sync errors
      }
    };

    const settingsRef = doc(db, 'users', currentUser.uid, 'private', 'settings');
    const unsubSettings = isBuyerOnly
      ? () => {}
      : onSnapshot(
          settingsRef,
          async (snap) => {
            if (snap.exists()) {
              await applyAndSyncSellerSettingsDoc(snap.data());
            } else {
              try {
                const legacySnap = await getDoc(doc(db, 'sellerSettings', currentUser.uid));
                if (legacySnap.exists()) {
                  await applyAndSyncSellerSettingsDoc(legacySnap.data());
                }
              } catch {
                // Ignore fallback error
              }
            }
          },
          (err) =>
            reportFirestoreError(
              err,
              OperationType.GET,
              `users/${currentUser.uid}/private/settings`
            )
        );

    // Only the verified Super Admin may receive private audit logs
    const unsubAudit = isSuperAdminVerified
      ? onSnapshot(
          query(collection(db, 'ledger_audit')),
          (snap) => {
            const loadedAudits: LedgerAuditEntry[] = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                auditId: d.auditId || docSnap.id,
                orderNumber: d.orderNumber,
                orderId: d.orderId,
                sellerId: d.sellerId,
                actorUid: d.actorUid,
                action: d.action,
                previousStatus: d.previousStatus,
                newStatus: d.newStatus,
                verificationMode: d.verificationMode,
                detail: d.detail,
                createdAtIso: new Date().toISOString(),
              };
            });
            if (loadedAudits.length > 0) {
              setAuditLogs(loadedAudits);
            }
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'ledger_audit')
        )
      : () => {};

    return () => {
      unsubStore();
      unsubProducts();
      unsubOrders();
      unsubBuyerOrders();
      unsubSettings();
      unsubAudit();
    };
  }, [authReady, currentUser, userProfile?.role]);

  // 3A. URL Manipulation & Role Access Guard: Enforce verified backend role permissions on direct URLs and screen state
  useEffect(() => {
    if (!authReady) return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlScreen = urlParams.get('screen') as ScreenId | null;
    const isSuperAdminUrlRequested =
      urlScreen === 'super-admin' ||
      activeScreen === 'super-admin' ||
      requestedUrlScreenRef.current === 'super-admin' ||
      window.location.pathname.toLowerCase().includes('super-admin');

    // 1. Block Super Admin screen for anyone who is NOT verified SUPER_ADMIN_UID
    if (isSuperAdminUrlRequested && (!currentUser || !isSuperAdminVerified)) {
      requestedUrlScreenRef.current = null;
      const fallbackScreen: ScreenId =
        currentUser && userProfile?.role === 'seller'
          ? 'owner-dashboard'
          : currentUser && userProfile?.role === 'buyer'
          ? 'storefront'
          : 'landing';
      setBlockedAccessNotice(
        'Access Blocked: Platform Dashboard is exclusively restricted to verified SUPER_ADMIN_UID.'
      );
      if (activeScreen !== fallbackScreen) {
        setActiveScreen(fallbackScreen);
      }
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('screen') === 'super-admin') {
          u.searchParams.set('screen', fallbackScreen);
        }
        if (u.pathname.toLowerCase().includes('super-admin')) {
          u.pathname = '/';
        }
        window.history.replaceState({ screen: fallbackScreen }, '', u.toString());
      } catch {}
      return;
    }

    if (!currentUser) return;

    // 2. Block Seller & Super Admin screens for Buyer accounts (verified via backend /api/navigation/access)
    const isSellerOrAdminScreen =
      activeScreen === 'owner-dashboard' ||
      activeScreen === 'wizard' ||
      activeScreen === 'visual-editor' ||
      activeScreen === 'super-admin' ||
      urlScreen === 'owner-dashboard' ||
      urlScreen === 'wizard' ||
      urlScreen === 'visual-editor' ||
      urlScreen === 'super-admin';

    if (userProfile?.role === 'buyer' && isSellerOrAdminScreen) {
      setBlockedAccessNotice(
        'Access Blocked: Seller & Admin screens are hidden and restricted for Buyer accounts.'
      );
      if (activeScreen !== 'storefront') {
        setActiveScreen('storefront');
      }
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('screen', 'storefront');
        window.history.replaceState({ screen: 'storefront' }, '', u.toString());
      } catch {}
      // Also verify with backend endpoint for audit logging / strict server check
      getAuthHeaders()
        .then((headers) =>
          fetch(
            `/api/navigation/access?screen=${encodeURIComponent(
              urlScreen || activeScreen
            )}`,
            { headers }
          )
        )
        .catch(() => {});
      return;
    }

    // 3. Prevent an authenticated seller from managing another seller's store via ?store= or ?screen=
    if (isSuperAdminVerified) return;
    const userStoreId = `store-${currentUser.uid.slice(0, 20)}`;
    const isSellerManagementScreen =
      activeScreen === 'owner-dashboard' ||
      activeScreen === 'wizard' ||
      activeScreen === 'visual-editor';
    if (
      isSellerManagementScreen &&
      activeStoreId !== userStoreId &&
      config.ownerId !== currentUser.uid
    ) {
      setActiveStoreId(userStoreId);
    }
  }, [
    authReady,
    currentUser,
    isSuperAdminVerified,
    userProfile?.role,
    activeScreen,
    activeStoreId,
    config.ownerId,
  ]);

  // 3B. Real-Time Express Order Synchronization Across Authenticated Seller & Buyer Sessions
  useEffect(() => {
    const effectiveUid = currentUser?.uid || null;
    if (!effectiveUid) return;
    let active = true;

    const syncExpressOrders = async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/orders/list', {
          headers: authHeaders,
        });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (Array.isArray(data.orders) && data.orders.length > 0) {
          setOrders((prev) => {
            const byOrderNumber = new Map<string, OrderItem>();
            for (const o of prev) {
              if (
                isSuperAdminVerified ||
                o.sellerId === effectiveUid ||
                o.buyerId === effectiveUid
              ) {
                byOrderNumber.set(o.orderNumber, o);
              }
            }
            for (const sOrd of data.orders) {
              if (
                !isSuperAdminVerified &&
                sOrd.sellerId !== effectiveUid &&
                sOrd.buyerId !== effectiveUid
              ) {
                continue;
              }
              const curr = (sOrd.currency || 'PKR') as CurrencyCode;
              const totalMajor = Number(sOrd.totalAmount) || 0;
              const formattedAmount =
                totalMajor === 0
                  ? 'Free ($0.00)'
                  : formatMinorToMajor(Math.round(totalMajor * 100), curr);
              const existing = byOrderNumber.get(sOrd.orderNumber);
              byOrderNumber.set(sOrd.orderNumber, {
                ...(existing || {}),
                ...sOrd,
                id: existing?.id || sOrd.id,
                primaryProductId: existing?.primaryProductId || sOrd.primaryProductId,
                buyerId: sOrd.buyerId || existing?.buyerId,
                sellerId: sOrd.sellerId || existing?.sellerId,
                storeId: existing?.storeId || sOrd.storeId,
                amount: formattedAmount,
                date: existing?.date || 'Just now',
                status: sOrd.paymentStatus === 'Paid' ? 'Completed' : 'Processing',
              });
            }
            return Array.from(byOrderNumber.values());
          });
        }
        // Private audit logs are strictly restricted to the verified Super Admin
        if (isSuperAdminVerified && Array.isArray(data.audits) && data.audits.length > 0) {
          setAuditLogs((prev) => {
            const byAuditId = new Map<string, LedgerAuditEntry>();
            for (const a of prev) {
              byAuditId.set(a.auditId, a);
            }
            for (const sa of data.audits) {
              byAuditId.set(sa.auditId, sa);
            }
            return Array.from(byAuditId.values());
          });
        } else if (!isSuperAdminVerified) {
          setAuditLogs([]);
        }
      } catch {
        // Ignore background sync errors
      }
    };

    syncExpressOrders();
    const timer = window.setInterval(syncExpressOrders, 3500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeScreen, activeStoreId, currentUser, isSuperAdminVerified]);

  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin');

  const handleOpenAuthModal = (mode: AuthModalMode = 'signin') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleSignInGoogle = async () => {
    setAuthModalMode('signin');
    setAuthModalOpen(true);
  };

  const handleSignOutGoogle = async () => {
    setUserProfile(null);
    setRoleOnboardingOpen(false);
    await signOutUser();
  };

  const handleCompleteRoleOnboarding = async (payload: {
    role: OnboardingUserRole;
    displayName: string;
    email: string;
  }) => {
    const requireNewSignIn = async () => {
      // Clear browser-only legacy sessions that may survive a server restart.
      // Never retry a denied request with an invented UID or without a token.
      invalidateRejectedLegacyEmailSession();
      await signOutUser().catch(() => {});
      setRoleOnboardingOpen(false);
      setAuthModalMode('signin');
      setAuthModalOpen(true);
    };

    if (!currentUser) {
      await requireNewSignIn();
      throw new Error('Please sign in again to select Buyer or Seller.');
    }
    // Strictly allow only 'buyer' or 'seller' — never allow Super Admin self-assignment
    const safeRole: OnboardingUserRole = payload.role === 'seller' ? 'seller' : 'buyer';
    const cleanName = payload.displayName.trim().slice(0, 120) || 'Shopper';
    const cleanEmail = (payload.email.trim() || currentUser.email || '').slice(0, 254);
    const userStoreId = `store-${currentUser.uid.slice(0, 20)}`;

    let authHeaders: Record<string, string>;
    try {
      // A just-restored or recently signed-up Firebase identity must use a
      // fresh, cryptographically valid ID token before saving its role.
      authHeaders = await getAuthHeaders({}, { forceRefresh: true, requireAuth: true });
    } catch {
      await requireNewSignIn();
      throw new Error('Your login needs refreshing. Please sign in again to continue.');
    }
    const res = await fetch('/api/users/profile', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        role: safeRole,
        displayName: cleanName,
        email: cleanEmail,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await requireNewSignIn();
      throw new Error('Your login session expired. Please sign in again to finish setup.');
    }
    if (!res.ok) {
      throw new Error(data.error || 'Unable to save your role right now. Please try again.');
    }

    if (hasFirebaseSdkSession() && currentUser.emailVerified !== false) {
      try {
        const userRef = doc(db, 'users', currentUser.uid);
        const existingSnap = await getDoc(userRef);
        const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : null;
        await setDoc(
          userRef,
          {
            uid: currentUser.uid,
            role: safeRole,
            displayName: cleanName,
            email: cleanEmail,
            onboardingCompleted: true,
            ...(safeRole === 'seller' ? { storeId: userStoreId } : {}),
            createdAt: existingCreatedAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        reportFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
      }
    }

    const savedUserObj = {
      uid: currentUser.uid,
      role: safeRole,
      displayName: cleanName,
      email: cleanEmail,
      onboardingCompleted: true,
    };
    setUserProfile(savedUserObj);
    setRoleOnboardingOpen(false);
    try {
      localStorage.setItem(
        `dreamstore_user_profile_${currentUser.uid}`,
        JSON.stringify(savedUserObj)
      );
    } catch {}

    if (safeRole === 'buyer') {
      // Buyer: collect only name and email (prefilled from Google). No store setup.
      setActiveBuyerSection('storefronts');
      if (
        activeScreen === 'landing' ||
        activeScreen === 'wizard' ||
        activeScreen === 'owner-dashboard' ||
        activeScreen === 'visual-editor' ||
        activeScreen === 'super-admin'
      ) {
        handleNavigate('storefront');
      }
      return;
    }

    // Seller ("I want to Sell"): initialize seller store draft & immediately start the existing store setup wizard
    const freshSellerStore = {
      ...buildFreshUserStoreConfig({
        uid: currentUser.uid,
        displayName: cleanName,
        email: cleanEmail,
      }),
      ownerName: cleanName,
    };

    setPaymentSettingsMap((prev) => ({
      ...prev,
      [userStoreId]: prev[userStoreId] || {
        ownerId: currentUser.uid,
        storeId: userStoreId,
        email: cleanEmail,
        jazzCashMerchantId: '',
        jazzCashEnabled: false,
        easypaisaStoreId: '',
        easypaisaEnabled: false,
        upiId: '',
        paymentLinkUrl: '',
        payoneerEnabled: false,
        payoneerReceivingEmail: '',
        payoneerRequestLink: '',
        payoneerReceivingAccountDetails: '',
        whatsappNotificationNumber: '',
        whatsappNotificationsEnabled: false,
        stripeAccountId: '',
        stripeEnabled: false,
        bankTransferInstructions: '',
      },
    }));

    setStoreConfigs((prev) => {
      const next = { ...prev, [userStoreId]: freshSellerStore };
      storeConfigsRef.current = next;
      return next;
    });
    setActiveStoreId(userStoreId);
    activeStoreIdRef.current = userStoreId;
    handleNavigate('wizard');
  };

  const persistStoreEverywhere = async (nextConfig: StoreConfig) => {
    const resolvedStoreId = currentUser
      ? `store-${currentUser.uid.slice(0, 20)}`
      : nextConfig.storeId &&
        nextConfig.storeId !== 'store-fatima-tech' &&
        nextConfig.storeId !== 'store-in-ananya'
      ? nextConfig.storeId
      : nextConfig.storeSlug &&
        nextConfig.storeSlug !== 'fatima.tech' &&
        nextConfig.storeSlug !== 'ananya.creates'
      ? `store-${nextConfig.storeSlug.replace(/[^a-z0-9_-]/g, '-').slice(0, 28)}`
      : nextConfig.storeId || 'store-fatima-tech';

    const resolvedOwnerId = currentUser?.uid || nextConfig.ownerId || `owner-${resolvedStoreId}`;
    const cleanSlug =
      (nextConfig.storeSlug || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 40) || `store-${resolvedStoreId.slice(-8)}`;
    const cleanName = (nextConfig.storeName || '').trim().slice(0, 100) || cleanSlug;

    const fullStore: StoreConfig = {
      ...nextConfig,
      storeId: resolvedStoreId,
      ownerId: resolvedOwnerId,
      storeSlug: cleanSlug,
      storeName: cleanName,
      ownerName: (nextConfig.ownerName || currentUser?.displayName || cleanName).slice(0, 100),
      instagramHandle: (nextConfig.instagramHandle || '').slice(0, 100),
      sellerCountry: (nextConfig.sellerCountry || 'Pakistan').slice(0, 80),
      productType: (nextConfig.productType || 'Ebooks & Guides').slice(0, 100),
      announcementText: (
        nextConfig.announcementText ||
        `Welcome to ${cleanName} — Digital Downloads & Guides ✨`
      ).slice(0, 240),
    };

    if (!currentUser) {
      throw new Error('Sign in before launching your store.');
    }

    // The server is authoritative. A network error, duplicate store slug, or
    // rejected Firebase save must not be reported as a successful launch.
    const authHeaders = await getAuthHeaders();
    const saveResponse = await fetch('/api/stores/create', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ...fullStore,
        ownerEmail: currentUser.email || '',
      }),
    });
    const saveResult = await saveResponse.json().catch(() => ({}));
    if (!saveResponse.ok || !saveResult.ok) {
      throw new Error(saveResult.error || 'Could not save your store. Please retry.');
    }

    setStoreConfigs((prev) => {
      const next = { ...prev, [resolvedStoreId]: fullStore };
      storeConfigsRef.current = next;
      return next;
    });
    if (activeStoreIdRef.current !== resolvedStoreId) {
      setActiveStoreId(resolvedStoreId);
    }
    // A new store has no products until its seller uploads real originals.

    // Store documents are committed by the verified backend before success;
    // no conflicting browser-side second write or synthetic starter products.

    return fullStore;
  };

  const handleUpdateConfig = async (partial: Partial<StoreConfig>) => {
    const current = storeConfigsRef.current[activeStoreIdRef.current] || config;
    const userStoreId = currentUser ? `store-${currentUser.uid.slice(0, 20)}` : null;

    // Prevent an authenticated seller from modifying another seller's store (except buyer currency switch)
    if (
      currentUser &&
      !isSuperAdminVerified &&
      current.storeId !== userStoreId &&
      current.ownerId !== currentUser.uid
    ) {
      const partialKeys = Object.keys(partial);
      const isCurrencySwitchOnly =
        partialKeys.length === 1 && partialKeys[0] === 'currency';
      if (isCurrencySwitchOnly) {
        setConfig({ ...current, currency: partial.currency || current.currency });
      }
      return;
    }

    const next: StoreConfig = { ...current, ...partial };
    if (activeScreen === 'wizard' || !currentUser) {
      setConfig(next);
      return;
    }
    try {
      const response = await fetch('/api/stores/update', {
        method: 'POST',
        headers: await getAuthHeaders({}, { forceRefresh: true, requireAuth: true }),
        body: JSON.stringify({ storeId: current.storeId, updates: partial }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Store changes could not be saved.');
      setConfig({ ...next, ...data.store });
    } catch (error) {
      setBlockedAccessNotice(error instanceof Error ? error.message : 'Store changes could not be saved. Please retry.');
    }
  };

  const handleCompleteWizard = async (finalPartial?: Partial<StoreConfig>) => {
    const current = storeConfigsRef.current[activeStoreIdRef.current] || config;
    const merged: StoreConfig = { ...current, ...(finalPartial || {}) };
    const savedStore = await persistStoreEverywhere(merged);

    // Update URL with the newly created store slug and navigate to Owner Dashboard
    setActiveScreen('owner-dashboard');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('screen', 'owner-dashboard');
      url.searchParams.set('store', savedStore.storeSlug);
      window.history.pushState(
        { screen: 'owner-dashboard', storeSlug: savedStore.storeSlug },
        '',
        url.toString()
      );
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddProduct = async (newProduct: Product) => {
    const fileDataUrl = String(newProduct.fileDataUrl || '');
    if (newProduct.published && !fileDataUrl.startsWith('storage://')) {
      throw new Error('Upload the original file before publishing a digital product.');
    }
    if (fileDataUrl.startsWith('data:') && fileDataUrl.length >= 700000) {
      throw new Error('Original file is too large for beta storage. The product was not published.');
    }
    if (!currentUser) {
      throw new Error('Please sign in before publishing products.');
    }

    // Firebase accounts stage the draft in Firestore. Authenticated server-email
    // accounts stage private file metadata through /api/uploads/product.
    if (hasFirebaseSdkSession()) {
      try {
        await setDoc(doc(db, 'products', newProduct.id), {
          storeId: config.storeId,
          ownerId: currentUser.uid,
          title: newProduct.title.slice(0, 160),
          category: newProduct.category,
          subtitle: newProduct.subtitle.slice(0, 300),
          description: newProduct.description.slice(0, 3000),
          priceUsd: newProduct.isFree ? 0 : Math.max(1, Number(newProduct.priceUsd)),
          pricePkr: newProduct.isFree ? 0 : Math.max(100, Number(newProduct.pricePkr)),
          isFree: Boolean(newProduct.isFree),
          published: false,
          status: 'Draft',
          image: newProduct.image,
          fileName: newProduct.fileName.slice(0, 255),
          fileType: newProduct.fileType.slice(0, 100),
          fileSizeLabel: newProduct.fileSizeLabel.slice(0, 60),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (fileDataUrl) {
          await setDoc(doc(db, 'products', newProduct.id, 'deliverables', 'main'), {
            productId: newProduct.id,
            ownerId: currentUser.uid,
            fileName: newProduct.fileName.slice(0, 255),
            fileMimeType: newProduct.fileType.slice(0, 100) || 'application/octet-stream',
            fileDataUrl,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        reportFirestoreError(err, OperationType.CREATE, `products/${newProduct.id}`);
        throw new Error('Product could not be saved to Firebase. Please try again.');
      }
    }

    const authHeaders = await getAuthHeaders();
    const response = await fetch('/api/products/upsert', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: newProduct.id,
        storeId: config.storeId,
        title: newProduct.title,
        category: newProduct.category,
        subtitle: newProduct.subtitle,
        description: newProduct.description,
        isFree: Boolean(newProduct.isFree),
        priceUsd: newProduct.isFree ? 0 : Math.max(1, Number(newProduct.priceUsd)),
        pricePkr: newProduct.isFree ? 0 : Math.max(100, Number(newProduct.pricePkr)),
        published: Boolean(newProduct.published),
        image: newProduct.image,
        fileName: newProduct.fileName,
        fileType: newProduct.fileType,
        fileSizeLabel: newProduct.fileSizeLabel,
        fileDataUrl,
      }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || 'The server could not publish this product. Please try again.');
    }
    setProducts((prev) => [newProduct, ...prev]);
  };

  const handleUpdateProduct = async (productId: string, partial: Partial<Product>) => {
    const target = products.find((p) => p.id === productId);
    if (!target) throw new Error('Product no longer exists.');
    if (!currentUser) {
      throw new Error('Sign in before editing products.');
    }
    const merged: Product = { ...target, ...partial };
    if (merged.ownerId !== currentUser.uid && !isSuperAdminVerified) {
      throw new Error('You cannot edit another seller’s product.');
    }

    // Store the replacement private file reference before the server verifies
    // the object and publishes a new version of this listing.
    if (hasFirebaseSdkSession() &&
        merged.fileDataUrl?.startsWith('storage://') &&
        merged.fileDataUrl !== target.fileDataUrl) {
      try {
        await setDoc(doc(db, 'products', productId, 'deliverables', 'main'), {
          productId,
          ownerId: merged.ownerId,
          fileName: merged.fileName.slice(0, 255),
          fileMimeType: merged.fileType.slice(0, 100) || 'application/octet-stream',
          fileDataUrl: merged.fileDataUrl,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        reportFirestoreError(err, OperationType.UPDATE, `products/${productId}/deliverables/main`);
        throw new Error('Replacement file was not saved. Product was not updated.');
      }
    }

    const authHeaders = await getAuthHeaders();
    const response = await fetch('/api/products/upsert', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: merged.id,
        storeId: merged.storeId || config.storeId,
        title: merged.title,
        category: merged.category,
        subtitle: merged.subtitle,
        description: merged.description,
        isFree: Boolean(merged.isFree),
        priceUsd: merged.isFree ? 0 : Math.max(1, Number(merged.priceUsd)),
        pricePkr: merged.isFree ? 0 : Math.max(100, Number(merged.pricePkr)),
        published: Boolean(merged.published),
        status: merged.status,
        image: merged.image,
        fileName: merged.fileName,
        fileType: merged.fileType,
        fileSizeLabel: merged.fileSizeLabel,
        fileDataUrl: merged.fileDataUrl,
      }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || 'Product update was rejected by the server.');
    }
    setProducts((prev) => prev.map((p) => (p.id === productId ? merged : p)));
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!currentUser) throw new Error('Sign in to manage products.');
    const headers = await getAuthHeaders();
    const response = await fetch('/api/products/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ productId }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || 'Product could not be removed. Please try again.');
    }
    // Keep original files and purchase history for existing buyers.
    // Only remove the item from visible catalog after the durable server write.
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
    if (selectedProductId === productId) setSelectedProductId('');
  };

  const handleSavePaymentSettings = async (settings: SellerPaymentSettings) => {
    const userStoreId = currentUser
      ? `store-${currentUser.uid.slice(0, 20)}`
      : activeStoreIdRef.current;
    const jazzId = stripLegacyDemoPaymentValue(settings.jazzCashMerchantId, 120);
    const epId = stripLegacyDemoPaymentValue(settings.easypaisaStoreId, 120);
    const isolatedSettings: SellerPaymentSettings = {
      ...settings,
      ownerId: currentUser?.uid || settings.ownerId,
      storeId: userStoreId,
      jazzCashMerchantId: jazzId,
      jazzCashEnabled: jazzId.length >= 3 && settings.jazzCashEnabled !== false,
      easypaisaStoreId: epId,
      easypaisaEnabled: epId.length >= 3 && settings.easypaisaEnabled !== false,
      upiId: stripLegacyDemoPaymentValue(settings.upiId, 120),
      paymentLinkUrl: stripLegacyDemoPaymentValue(settings.paymentLinkUrl, 300),
      bankTransferInstructions: stripLegacyDemoPaymentValue(
        settings.bankTransferInstructions,
        1000
      ),
      payoneerReceivingEmail: stripLegacyDemoPaymentValue(
        settings.payoneerReceivingEmail,
        254
      ),
      payoneerRequestLink: stripLegacyDemoPaymentValue(settings.payoneerRequestLink, 300),
      payoneerReceivingAccountDetails: stripLegacyDemoPaymentValue(
        settings.payoneerReceivingAccountDetails,
        500
      ),
      whatsappNotificationNumber: stripLegacyDemoPaymentValue(
        settings.whatsappNotificationNumber,
        40
      ),
      stripeAccountId: stripLegacyDemoPaymentValue(settings.stripeAccountId, 120),
    };
    setSellerPaymentSettings(isolatedSettings, userStoreId);

    if (currentUser) {
      const sig = JSON.stringify({
        ownerId: isolatedSettings.ownerId,
        jazz: isolatedSettings.jazzCashMerchantId,
        jazzEn: isolatedSettings.jazzCashEnabled,
        ep: isolatedSettings.easypaisaStoreId,
        epEn: isolatedSettings.easypaisaEnabled,
        upi: isolatedSettings.upiId,
        bank: isolatedSettings.bankTransferInstructions,
        payoneerEn: isolatedSettings.payoneerEnabled,
        payoneerEmail: isolatedSettings.payoneerReceivingEmail,
        payoneerLink: isolatedSettings.payoneerRequestLink,
        payoneerDetails: isolatedSettings.payoneerReceivingAccountDetails,
        waNum: isolatedSettings.whatsappNotificationNumber,
        waEn: isolatedSettings.whatsappNotificationsEnabled,
      });
      lastSyncedPaymentSettingsSigRef.current = sig;

      if (paymentSaveDebounceRef.current) {
        window.clearTimeout(paymentSaveDebounceRef.current);
      }

      paymentSaveDebounceRef.current = window.setTimeout(async () => {
        try {
          const authHeaders = await getAuthHeaders();
          await fetch('/api/seller-settings', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(isolatedSettings),
          });
        } catch {
          // Ignore network error if offline
        }

        if (!hasFirebaseSdkSession()) return;
        const firestorePayload = {
          ownerId: currentUser.uid,
          email: (currentUser.email || isolatedSettings.email || 'seller@email.com').slice(
            0,
            254
          ),
          jazzCashMerchantId: isolatedSettings.jazzCashMerchantId.slice(0, 120),
          jazzCashEnabled: Boolean(isolatedSettings.jazzCashEnabled),
          easypaisaStoreId: isolatedSettings.easypaisaStoreId.slice(0, 120),
          easypaisaEnabled: Boolean(isolatedSettings.easypaisaEnabled),
          upiId: (isolatedSettings.upiId || '').slice(0, 120),
          paymentLinkUrl: (isolatedSettings.paymentLinkUrl || '').slice(0, 300),
          payoneerEnabled: Boolean(isolatedSettings.payoneerEnabled),
          payoneerReceivingEmail: (isolatedSettings.payoneerReceivingEmail || '').slice(0, 254),
          payoneerRequestLink: (isolatedSettings.payoneerRequestLink || '').slice(0, 300),
          payoneerReceivingAccountDetails: (
            isolatedSettings.payoneerReceivingAccountDetails || ''
          ).slice(0, 500),
          whatsappNotificationNumber: (
            isolatedSettings.whatsappNotificationNumber || ''
          ).slice(0, 40),
          whatsappNotificationsEnabled: Boolean(
            isolatedSettings.whatsappNotificationsEnabled
          ),
          stripeAccountId: isolatedSettings.stripeAccountId.slice(0, 120),
          stripeEnabled: Boolean(isolatedSettings.stripeEnabled),
          bankTransferInstructions: isolatedSettings.bankTransferInstructions.slice(0, 1000),
          updatedAt: serverTimestamp(),
        };

        const ref = doc(db, 'users', currentUser.uid, 'private', 'settings');
        try {
          await setDoc(ref, firestorePayload);
          await setDoc(doc(db, 'sellerSettings', currentUser.uid), firestorePayload);
        } catch (err) {
          reportFirestoreError(
            err,
            OperationType.WRITE,
            `users/${currentUser.uid}/private/settings`
          );
        }
      }, 250);
    }
  };

  // Shopping Cart Handlers
  const handleAddToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: Math.min(10, i.quantity + 1) } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });

    if (cartToastTimerRef.current) {
      window.clearTimeout(cartToastTimerRef.current);
    }
    setCartToast(`Added "${product.title}" to your bag!`);
    cartToastTimerRef.current = window.setTimeout(() => {
      setCartToast(null);
    }, 3200);
  };

  const handleBuyNow = (product: Product) => {
    handleAddToCart(product);
    setCartToast(null);
    handleNavigate('checkout');
  };

  const handleUpdateCartQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product.id === productId ? { ...i, quantity: i.quantity + delta } : i
        )
        .filter((i) => i.quantity > 0)
    );
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  // Checkout & Server-Validated Order Creation
  const handlePlaceOrder = async (params: {
    customerName: string;
    customerEmail: string;
    currency: CurrencyCode;
    paymentMethod: PaymentMethodId;
    paymentReference: string;
    buyerUid?: string;
  }): Promise<OrderItem | null> => {
    // Resolve cart products to the authenticated user's seeded Firestore products if applicable BEFORE calling server
    const resolvedCart = cart.map((c) => {
      if (currentUser) {
        const userStoreId = `store-${currentUser.uid.slice(0, 20)}`;
        const userSeededProdId = `${c.product.id}-${currentUser.uid.slice(0, 8)}`;
        const matchingUserProd = products.find(
          (p) =>
            p.id === userSeededProdId ||
            (p.id === c.product.id && p.storeId === userStoreId)
        );
        if (matchingUserProd && (config.storeId === userStoreId || config.ownerId === currentUser.uid)) {
          return { ...c, product: matchingUserProd };
        }
      }
      return c;
    });

    if (!currentUser) throw new Error('Sign in before placing an order.');
    if (resolvedCart.length === 0) throw new Error('Your bag is empty. Choose a product before checkout.');
    if (resolvedCart.length !== 1 || resolvedCart[0].quantity !== 1) {
      throw new Error('Please check out one digital product at a time, with quantity 1. Remove the other items from your bag before continuing.');
    }
    const primaryProduct = resolvedCart[0].product;
    const rawBuyerUid = currentUser.uid;
    const targetSellerId = String(primaryProduct.ownerId || '');
    if (!targetSellerId || !config.storeId) {
      throw new Error('Seller or store is unavailable. Refresh the product page.');
    }
    const serverBuyerId = rawBuyerUid;
    const cartSig = resolvedCart.map((c) => `${c.product.id}:${c.quantity}`).join('|');
    const refSig = (params.paymentReference || 'free').trim();
    const idempotencyKey = `idem-${serverBuyerId}-${config.storeId}-${cartSig}-${refSig}`;
    const authHeaders = await getAuthHeaders();
    const response = await fetch('/api/checkout/validate-and-prepare', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        idempotencyKey,
        buyerId: serverBuyerId,
        sellerId: targetSellerId,
        storeId: config.storeId,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        currency: params.currency,
        exchangeRatePkr: config.exchangeRatePkr,
        paymentMethod: params.paymentMethod,
        paymentReference: params.paymentReference,
        items: resolvedCart.map((c) => ({
          id: c.product.id,
          title: c.product.title,
          isFree: c.product.isFree,
          priceUsd: c.product.priceUsd,
          pricePkr: c.product.pricePkr,
          quantity: c.quantity,
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Server checkout validation failed.');
    }

    const orderId = data.orderId || `order-${Date.now()}`;

    const itemTitlesSummary = resolvedCart
      .map((c) => `${c.product.title}${c.quantity > 1 ? ` x${c.quantity}` : ''}`)
      .join(', ')
      .slice(0, 1000);
    const totalCount = resolvedCart.reduce((s, c) => s + c.quantity, 0);

    // Order/ledger records are now committed atomically by the verified backend.
    // The browser must never write financial ledger entries or duplicate orders.
    const sellerId = String(data.sellerId || '');
    const storeId = String(data.storeId || '');
    const primaryProductId = String(primaryProduct.id);
    if (!sellerId || !storeId) {
      throw new Error('Server did not confirm a verified seller and store.');
    }
    const verificationMode: VerificationMode =
      data.verificationMode || (data.calculatedTotal === 0 ? 'Instant Free' : 'Unverified');
    const commissionStatus: CommissionStatus =
      data.commissionStatus || (data.calculatedTotal === 0 ? 'not_applicable' : 'outstanding');

    if (data.auditEntry) {
      setAuditLogs((prev) => [data.auditEntry, ...prev]);
    }

    const formattedAmount =
      data.calculatedTotal === 0
        ? 'Free ($0.00)'
        : formatMinorToMajor(Math.round(Number(data.calculatedTotal) * 100), params.currency);

    const createdItem: OrderItem = {
      id: orderId,
      orderNumber: data.orderNumber,
      storeId: storeId || data.storeId,
      sellerId: sellerId || data.sellerId,
      buyerId: serverBuyerId,
      primaryProductId,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      productTitle: itemTitlesSummary,
      itemTitlesSummary,
      itemCount: totalCount,
      currency: params.currency,
      subtotal: data.calculatedSubtotal,
      totalAmount: data.calculatedTotal,
      amount: formattedAmount,
      paymentMethod: params.paymentMethod,
      paymentStatus: data.initialPaymentStatus,
      paymentReference: params.paymentReference,
      downloadToken: data.downloadToken,
      downloadCount: 0,
      maxDownloads: data.maxDownloads,
      expiresAtMs: data.expiresAtMs,
      date: 'Just now',
      status: data.initialPaymentStatus === 'Paid' ? 'Completed' : 'Processing',
      commissionBreakdown: data.commissionBreakdown,
      payoutStatus: data.payoutStatus,
      verificationMode,
      commissionStatus,
      ...(data.emailNotification ? { buyerEmailNotification: data.emailNotification } : {}),
    };

    setOrders((prev) => [createdItem, ...prev]);
    setCart([]);
    return createdItem;
  };

  // Seller Order Verification, Refund, Commission Status & Entitlement Granting
  const handleUpdateOrderStatus = async (
    orderId: string,
    newStatus: OrderPaymentStatus
  ) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;

    // Prevent repeated verification on already-Paid or Refunded orders
    if (target.paymentStatus === 'Paid' && newStatus === 'Paid') {
      return;
    }
    if (target.paymentStatus === 'Refunded') {
      return;
    }

    let updatedToken = target.downloadToken;
    let updatedVerificationMode: VerificationMode =
      target.verificationMode || 'Unverified';
    let updatedCommissionStatus: CommissionStatus =
      target.commissionStatus || 'outstanding';
    let updatedPayoutStatus = target.payoutStatus;
    let updatedEmailNotification = target.buyerEmailNotification;
    const callerUid = currentUser?.uid || target.sellerId || config.ownerId;

    try {
      const authHeaders = await getAuthHeaders();
      if (newStatus === 'Refunded') {
        const refundReference = window.prompt(
          'Enter the REAL bank/wallet transaction reference after refunding this buyer. Never mark Refunded before funds are returned.'
        )?.trim();
        if (!refundReference) return;
        const refundConfirmed = window.confirm(
          'Have you independently checked that the refund actually reached the buyer? This will revoke their download access.'
        );
        if (!refundConfirmed) return;
        const refRes = await fetch('/api/orders/refund', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            orderNumber: target.orderNumber,
            refundConfirmed,
            refundReference,
          }),
        });
        if (!refRes.ok) {
          const details = await refRes.json().catch(() => ({}));
          throw new Error(details.error || 'Refund was not confirmed by the server.');
        }
        updatedToken = 'REVOKED-REFUNDED';
        updatedCommissionStatus = 'reversed';
        updatedPayoutStatus = 'Reversed (Refunded)';
        if (refRes.ok) {
          const rData = await refRes.json();
          if (rData.auditEntry) {
            setAuditLogs((prev) => [rData.auditEntry, ...prev]);
          }
        }
      } else if (newStatus === 'Paid' || newStatus === 'Failed') {
        const statementConfirmed = newStatus === 'Paid'
          ? window.confirm('Have you verified that cleared funds arrived in your actual bank/wallet statement? A transaction ID or screenshot alone is not proof.')
          : false;
        if (newStatus === 'Paid' && !statementConfirmed) return;
        const verifyRes = await fetch('/api/orders/verify-payment', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            orderNumber: target.orderNumber,
            newStatus,
            statementConfirmed,
          }),
        });
        if (!verifyRes.ok) {
          const details = await verifyRes.json().catch(() => ({}));
          throw new Error(details.error || 'Payment status could not be verified.');
        }
        if (verifyRes.ok) {
          const vData = await verifyRes.json();
          if (vData.downloadToken) {
            updatedToken = vData.downloadToken;
          }
          if (vData.verificationMode) {
            updatedVerificationMode = vData.verificationMode;
          }
          if (vData.commissionStatus) {
            updatedCommissionStatus = vData.commissionStatus;
          }
          if (vData.payoutStatus) {
            updatedPayoutStatus = vData.payoutStatus;
          }
          if (vData.emailNotification) {
            updatedEmailNotification = vData.emailNotification;
          }
          if (vData.auditEntry) {
            setAuditLogs((prev) => [vData.auditEntry, ...prev]);
          }
        }
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error('Order update failed. Please try again.');
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              paymentStatus: newStatus,
              downloadToken: updatedToken,
              verificationMode: updatedVerificationMode,
              commissionStatus: updatedCommissionStatus,
              payoutStatus: updatedPayoutStatus,
              verifiedByUid: callerUid,
              verifiedAtIso: new Date().toISOString(),
              status: newStatus === 'Paid' ? 'Completed' : 'Processing',
              ...(updatedEmailNotification
                ? { buyerEmailNotification: updatedEmailNotification }
                : {}),
            }
          : o
      )
    );

    // Financial status, order document and download access are server-authoritative.
    // The browser does not independently write verification, refunds or entitlements.

  };

  // Commission Status Handler (outstanding, paid, reversed, disputed)
  const handleUpdateCommissionStatus = async (
    orderNumber: string,
    newCommissionStatus: CommissionStatus,
    _callerRole: 'seller' | 'super_admin' = 'seller'
  ) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ledger/commission-status', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          orderNumber,
          newCommissionStatus,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auditEntry) {
          setAuditLogs((prev) => [data.auditEntry, ...prev]);
        }
      }
    } catch {
      // Server sync best-effort
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.orderNumber === orderNumber
          ? { ...o, commissionStatus: newCommissionStatus }
          : o
      )
    );
  };

  // Verified Digital Download Handler
  const handleDownloadOrderFile = async (
    order: OrderItem
  ): Promise<{ ok: boolean; message: string }> => {
    const authHeaders = await getAuthHeaders();
    const verifyRes = await fetch('/api/delivery/verify-download', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        orderNumber: order.orderNumber,
        productId: order.primaryProductId,
        buyerId: order.buyerId,
        paymentStatus: order.paymentStatus,
        downloadToken: order.downloadToken,
        downloadCount: order.downloadCount,
        maxDownloads: order.maxDownloads,
        expiresAtMs: order.expiresAtMs,
      }),
    });

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.allowed) {
      return {
        ok: false,
        message:
          verifyData.error ||
          'Download denied: Payment is not verified or download limit reached.',
      };
    }

    // Download the actual authorized original supplied by the server. Never fabricate a sample.
    const fileDataUrl = String(verifyData.fileDataUrl || '');
    const fileName = String(verifyData.fileName || 'Digital-Download').slice(0, 255);
    if (!/^data:[a-z0-9.+/-]+(?:;[a-z0-9=+\-]+)*[,;]/i.test(fileDataUrl)) {
      return {
        ok: false,
        message: 'Original product file is unavailable. Please contact the seller.',
      };
    }

    const nextDownloadCount = Number(verifyData.downloadCount) || order.downloadCount + 1;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id ? { ...o, downloadCount: nextDownloadCount } : o
      )
    );

    const a = document.createElement('a');
    a.href = fileDataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return {
      ok: true,
      message: `Downloading "${fileName}" (${nextDownloadCount}/${order.maxDownloads} downloads used).`,
    };
  };

  const handleUpdateBuyerProfile = async (displayName: string, email: string) => {
    if (!currentUser) return;
    const cleanName = displayName.trim().slice(0, 120) || 'Shopper';
    const cleanEmail = (email.trim() || currentUser.email || '').slice(0, 254);
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/users/profile', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        role: 'buyer',
        displayName: cleanName,
        email: cleanEmail,
      }),
    });
    if (res.ok) {
      const updated = {
        uid: currentUser.uid,
        role: 'buyer' as const,
        displayName: cleanName,
        email: cleanEmail,
        onboardingCompleted: true,
      };
      setUserProfile(updated);
      try {
        localStorage.setItem(`dreamstore_user_profile_${currentUser.uid}`, JSON.stringify(updated));
      } catch {}
    }
  };

  const handleSelectBuyerNavSection = (section: BuyerNavSection) => {
    setActiveBuyerSection(section);
    if (section === 'storefronts') {
      handleNavigate('storefront');
    } else {
      handleNavigate('checkout');
    }
  };

  const handleSelectSellerNavSection = (section: SellerNavSection) => {
    if (section === 'my-store') {
      handleNavigate('storefront');
    } else {
      setActiveSellerTab(section);
      handleNavigate('owner-dashboard');
    }
  };

  const handleNavigate = (screen: ScreenId, productId?: string) => {
    if (!currentUser && (screen === 'wizard' || screen === 'owner-dashboard' || screen === 'visual-editor')) {
      setAuthModalMode('signup');
      setAuthModalOpen(true);
      return;
    }
    // Role-based navigation enforcement
    if (screen === 'super-admin' && !isSuperAdminVerified) {
      setBlockedAccessNotice(
        'Access Blocked: Platform Dashboard is exclusively restricted to verified SUPER_ADMIN_UID.'
      );
      return;
    }
    if (
      userProfile?.role === 'buyer' &&
      (screen === 'owner-dashboard' ||
        screen === 'wizard' ||
        screen === 'visual-editor' ||
        screen === 'super-admin')
    ) {
      setBlockedAccessNotice(
        'Access Blocked: Seller & Admin screens are hidden and restricted for Buyer accounts.'
      );
      setActiveScreen('storefront');
      return;
    }

    setBlockedAccessNotice(null);
    if (productId) {
      setSelectedProductId(productId);
    }
    setActiveScreen(screen);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('screen', screen);
      if (config.storeSlug) {
        url.searchParams.set('store', config.storeSlug);
      }
      window.history.pushState({ screen, storeSlug: config.storeSlug }, '', url.toString());
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddPlatformStore = (store: PlatformStore) => {
    setPlatformStores((prev) => [store, ...prev]);
  };

  const handleToggleStoreStatus = (id: string) => {
    setPlatformStores((prev) =>
      prev.map((st) =>
        st.id === id
          ? { ...st, status: st.status === 'Active' ? 'Pending' : 'Active' }
          : st
      )
    );
  };

  const handleSwitchSellerStore = (targetStoreId: string) => {
    setActiveStoreId(targetStoreId);
    const targetConfig = storeConfigs[targetStoreId];
    const storeProds = products.filter((p) => p.storeId === targetStoreId && p.published);
    setSelectedProductId(storeProds[0]?.id || '');
    // Switching stores never auto-adds a product or carries across seller carts.
    setCart([]);
    try {
      const url = new URL(window.location.href);
      if (targetConfig?.storeSlug) {
        url.searchParams.set('store', targetConfig.storeSlug);
      }
      window.history.pushState(
        { screen: activeScreen, storeSlug: targetConfig?.storeSlug },
        '',
        url.toString()
      );
    } catch {}
  };

  const handleAdminControlStore = (
    targetStoreId: string,
    targetScreen: ScreenId = 'owner-dashboard',
    storeOverrides?: Partial<StoreConfig>
  ) => {
    if (!isSuperAdminVerified) return;
    if (storeOverrides) {
      setStoreConfigs((prev) => {
        const existing = prev[targetStoreId] || {
          ...INITIAL_STORE_CONFIG,
          storeId: targetStoreId,
        };
        const merged = { ...existing, ...storeOverrides, storeId: targetStoreId };
        const next = { ...prev, [targetStoreId]: merged };
        storeConfigsRef.current = next;
        return next;
      });
    }
    setActiveStoreId(targetStoreId);
    activeStoreIdRef.current = targetStoreId;
    const storeProds = products.filter((p) => p.storeId === targetStoreId);
    setSelectedProductId(storeProds[0]?.id || '');
    setCart([]);
    setActiveScreen(targetScreen);
    try {
      const targetConfig = storeConfigsRef.current[targetStoreId];
      const url = new URL(window.location.href);
      url.searchParams.set('screen', targetScreen);
      if (targetConfig?.storeSlug || storeOverrides?.storeSlug) {
        url.searchParams.set('store', storeOverrides?.storeSlug || targetConfig?.storeSlug || '');
      }
      window.history.pushState(
        { screen: targetScreen, storeSlug: storeOverrides?.storeSlug || targetConfig?.storeSlug },
        '',
        url.toString()
      );
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (
      config?.storeId &&
      (activeScreen === 'storefront' || activeScreen === 'shop' || activeScreen === 'product-detail')
    ) {
      fetch('/api/stores/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: config.storeId,
          storeSlug: config.storeSlug,
          isCheckoutView: false,
        }),
      }).catch(() => {});
    }
  }, [config?.storeId, activeScreen]);

  const handleResetDemo = () => {
    try {
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    } catch {}
    setStoreConfigs(INITIAL_STORE_CONFIGS);
    storeConfigsRef.current = INITIAL_STORE_CONFIGS;
    setPaymentSettingsMap(INITIAL_SELLER_PAYMENT_SETTINGS_BY_STORE);
    setActiveStoreId('store-fatima-tech');
    setProducts(INITIAL_PRODUCTS);
    setCart([{ product: INITIAL_PRODUCTS[0], quantity: 1 }]);
  };

  // Strictly isolate products, orders, audit logs, and payment settings per active store & authenticated seller
  const userOwnedStoreId = currentUser ? `store-${currentUser.uid.slice(0, 20)}` : null;
  const activeStoreProducts = products.filter(
    (p) =>
      p.storeId === config.storeId ||
      (currentUser &&
        config.storeId === userOwnedStoreId &&
        p.ownerId === currentUser.uid)
  );
  const activeStoreOrders = orders.filter(
    (o) =>
      (o.storeId === config.storeId ||
        (currentUser &&
          config.storeId === userOwnedStoreId &&
          o.sellerId === currentUser.uid)) &&
      (!currentUser || isSuperAdminVerified || o.sellerId === currentUser.uid)
  );
  const activeStoreAuditLogs: LedgerAuditEntry[] = isSuperAdminVerified ? auditLogs : [];
  const isolatedSellerPaymentSettings =
    currentUser && !isSuperAdminVerified && userOwnedStoreId
      ? paymentSettingsMap[userOwnedStoreId] || {
          ...INITIAL_SELLER_PAYMENT_SETTINGS,
          ownerId: currentUser.uid,
          storeId: userOwnedStoreId,
          email: currentUser.email || '',
          jazzCashMerchantId: '',
          easypaisaStoreId: '',
          upiId: '',
          paymentLinkUrl: '',
          payoneerReceivingEmail: '',
          payoneerRequestLink: '',
          payoneerReceivingAccountDetails: '',
          whatsappNotificationNumber: '',
          stripeAccountId: '',
          bankTransferInstructions: '',
        }
      : sellerPaymentSettings;

  const currentProduct =
    activeStoreProducts.find((p) => p.id === selectedProductId) ||
    activeStoreProducts[0] || null;
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div
      className={`min-h-screen relative bg-[#FFF2DF] overflow-x-hidden ${
        isDevControlsEnabled && activeScreen !== 'landing' ? 'pb-16' : ''
      }`}
    >
      {/* Cute Candyland Add-to-Cart Success Toast */}
      {cartToast && activeScreen !== 'checkout' && (
        <div
          data-testid="candy-cart-toast"
          role="status"
          aria-live="polite"
          className="fixed top-20 right-4 z-50 max-w-sm animate-ds-sparkle-once candy-card-pink rounded-[24px] p-3.5 shadow-[0_14px_30px_-8px_rgba(80,53,47,0.22)] flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-[#FFFDF8] border-2 border-[#50352F]/15 flex items-center justify-center shrink-0 animate-candy-cart-pop">
              <ShoppingBag className="w-4 h-4 text-[#D66795]" />
            </span>
            <div className="min-w-0">
              <p className="font-candy text-xs font-bold text-[#50352F] truncate">
                ✨ {cartToast}
              </p>
              <p className="text-[11px] font-extrabold text-[#50352F]/80">
                Bag count: {totalCartItems} {totalCartItems === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="candy-cart-toast-checkout-btn"
            onClick={() => {
              setCartToast(null);
              handleNavigate('checkout');
            }}
            className="px-3.5 py-2 rounded-full candy-btn-butter text-xs font-extrabold text-[#50352F] shrink-0 cursor-pointer min-h-[36px]"
          >
            Checkout →
          </button>
        </div>
      )}

      {/* Role-Specific Navigation Bar after Authentication */}
      {currentUser && userProfile && !roleOnboardingOpen && (
        <RoleNavigationBar
          role={
            isSuperAdminVerified
              ? 'super_admin'
              : userProfile.role === 'seller'
              ? 'seller'
              : 'buyer'
          }
          isSuperAdminVerified={isSuperAdminVerified}
          userName={userProfile.displayName || currentUser.displayName || ''}
          userEmail={userProfile.email || currentUser.email || ''}
          activeScreen={activeScreen}
          activeBuyerSection={activeBuyerSection}
          activeSellerTab={activeSellerTab}
          cartCount={totalCartItems}
          ordersCount={
            orders.filter((o) => o.buyerId === currentUser.uid).length
          }
          downloadsCount={
            orders.filter(
              (o) => o.buyerId === currentUser.uid && o.paymentStatus === 'Paid'
            ).length
          }
          allStores={storeConfigs}
          activeStoreId={activeStoreId}
          onSelectBuyerSection={handleSelectBuyerNavSection}
          onSelectSellerSection={handleSelectSellerNavSection}
          onNavigateSuperAdmin={() => handleNavigate('super-admin')}
          onSwitchStore={(targetId) => {
            handleSwitchSellerStore(targetId);
            if (
              activeScreen !== 'storefront' &&
              activeScreen !== 'shop' &&
              activeScreen !== 'product-detail'
            ) {
              handleNavigate('storefront');
            }
          }}
          onSignOut={handleSignOutGoogle}
        />
      )}

      {/* Blocked Direct URL / Unauthorized Screen Access Notice */}
      {blockedAccessNotice && (
        <div
          data-testid="role-access-blocked-banner"
          className="bg-[#FFE7F1] border-b-2 border-[#F58CB7] px-4 py-2.5 text-center text-xs sm:text-sm font-extrabold text-[#9E3B66] flex items-center justify-center gap-3"
        >
          <span>{blockedAccessNotice}</span>
          <button
            type="button"
            onClick={() => setBlockedAccessNotice(null)}
            className="px-2.5 py-0.5 rounded-full bg-white/80 border border-[#F58CB7] text-[11px] font-extrabold text-[#50352F] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeScreen === 'landing' && (
        <LandingPage
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          onNavigate={handleNavigate}
          allStores={storeConfigs}
          onSwitchStore={(slugOrId, navigateToStorefront) => {
            const match = (Object.values(storeConfigs) as StoreConfig[]).find(
              (sc) => sc.storeId === slugOrId || sc.storeSlug === slugOrId
            );
            if (!match) return;
            // Fetch real products/branding before opening the chosen public store.
            void loadStoreFromBackendOrFirestore(match.storeSlug).then((loaded) => {
              if (!loaded) {
                setBlockedAccessNotice('This store is not available right now.');
                return;
              }
              setCart([]);
              setSelectedProductId('');
              if (navigateToStorefront) {
                setActiveScreen('storefront');
                const u = new URL(window.location.href);
                u.searchParams.set('screen', 'storefront');
                u.searchParams.set('store', loaded.storeSlug);
                window.history.pushState({ screen: 'storefront', storeSlug: loaded.storeSlug }, '', u.toString());
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            });
          }}
          onAddToCart={handleAddToCart}
          isAuthenticated={Boolean(currentUser)}
          userEmail={currentUser?.email || null}
          onSignInGoogle={handleSignInGoogle}
          onOpenAuthModal={handleOpenAuthModal}
          onSignOut={handleSignOutGoogle}
          isEditMode={isEditMode}
          canManageStore={Boolean(
            currentUser &&
              userProfile?.role !== 'buyer' &&
              (isSuperAdminVerified ||
                Boolean(userOwnedStoreId && storeConfigs[userOwnedStoreId]) ||
                config.ownerId === currentUser.uid)
          )}
        />
      )}

      <CandylandAuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        brandName={config.landingBrand || 'DreamStore'}
      />

      <RoleOnboardingModal
        isOpen={Boolean(currentUser && roleOnboardingOpen)}
        defaultName={
          currentUser?.displayName ||
          (currentUser?.email ? currentUser.email.split('@')[0] : '') ||
          ''
        }
        defaultEmail={currentUser?.email || ''}
        emailVerified={currentUser?.emailVerified !== false}
        onCompleteOnboarding={handleCompleteRoleOnboarding}
      />

      {activeScreen === 'wizard' && currentUser && (userProfile?.role === 'seller' || userProfile?.role === 'super_admin') && (
        <StoreSetupWizard
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onCompleteWizard={handleCompleteWizard}
          sellerPaymentSettings={isolatedSellerPaymentSettings}
          onSavePaymentSettings={handleSavePaymentSettings}
          products={activeStoreProducts}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
          currentUserUid={currentUser?.uid || null}
        />
      )}

      {activeScreen === 'owner-dashboard' && currentUser && (userProfile?.role === 'seller' || userProfile?.role === 'super_admin') && (
        <StoreOwnerDashboard
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          onAddProduct={handleAddProduct}
          onUpdateProduct={handleUpdateProduct}
          onDeleteProduct={handleDeleteProduct}
          orders={activeStoreOrders}
          auditLogs={activeStoreAuditLogs}
          onUpdateOrderStatus={handleUpdateOrderStatus}
          onUpdateCommissionStatus={(orderNum, status) =>
            handleUpdateCommissionStatus(orderNum, status, 'seller')
          }
          sellerPaymentSettings={isolatedSellerPaymentSettings}
          onSavePaymentSettings={handleSavePaymentSettings}
          gatewayStatus={gatewayStatus}
          currentUserUid={currentUser?.uid || null}
          currentUserEmail={currentUser?.email || null}
          onSignInGoogle={handleSignInGoogle}
          onSignOutGoogle={handleSignOutGoogle}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
          activeOwnerTab={activeSellerTab}
          onSelectOwnerTab={setActiveSellerTab}
        />
      )}

      {activeScreen === 'storefront' && (
        <StorefrontHome
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          cartCount={totalCartItems}
          onAddToCart={handleAddToCart}
          onBuyNow={handleBuyNow}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
        />
      )}

      {activeScreen === 'shop' && (
        <ShopPage
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          onUpdateProduct={handleUpdateProduct}
          cartCount={totalCartItems}
          onAddToCart={handleAddToCart}
          onBuyNow={handleBuyNow}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
        />
      )}

      {activeScreen === 'product-detail' && currentProduct && (
        <ProductDetailPage
          product={currentProduct}
          allProducts={activeStoreProducts}
          currency={config.currency}
          exchangeRatePkr={config.exchangeRatePkr}
          cartCount={totalCartItems}
          theme={config.theme}
          customAccentColor={config.customAccentColor}
          onSelectProduct={(id) => setSelectedProductId(id)}
          onUpdateProduct={handleUpdateProduct}
          onAddToCart={handleAddToCart}
          onBuyNow={handleBuyNow}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
        />
      )}

      {activeScreen === 'product-detail' && !currentProduct && (
        <div className="mx-auto max-w-xl p-8 text-center text-[#50352F]">
          <h2 className="text-xl font-bold">This store has no published products yet.</h2>
          <button type="button" className="candy-btn-pink mt-4 px-5 py-2" onClick={() => handleNavigate('shop')}>
            Explore Store
          </button>
        </div>
      )}

      {activeScreen === 'visual-editor' && currentUser && (userProfile?.role === 'seller' || userProfile?.role === 'super_admin') && (
        <VisualStoreEditor
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          onNavigate={handleNavigate}
        />
      )}

      {activeScreen === 'mobile-designs' && (
        <MobileDesignsView
          config={config}
          onUpdateConfig={handleUpdateConfig}
          products={activeStoreProducts}
          onNavigate={handleNavigate}
          onAddToCart={handleAddToCart}
          cartCount={totalCartItems}
          isEditMode={isEditMode}
        />
      )}

      {activeScreen === 'super-admin' && isSuperAdminVerified && (
        <SuperAdminDashboard
          config={config}
          platformStores={platformStores}
          products={products}
          orders={orders}
          auditLogs={auditLogs}
          gatewayStatus={gatewayStatus}
          currentUserUid={currentUser?.uid || null}
          currentUserEmail={currentUser?.email || null}
          isSuperAdminVerified={isSuperAdminVerified}
          onSignInGoogle={handleSignInGoogle}
          onAddPlatformStore={handleAddPlatformStore}
          onToggleStoreStatus={handleToggleStoreStatus}
          onUpdateProduct={handleUpdateProduct}
          onUpdateOrderStatus={handleUpdateOrderStatus}
          onUpdateCommissionStatus={(orderNum, status) =>
            handleUpdateCommissionStatus(orderNum, status, 'super_admin')
          }
          onAdminControlStore={handleAdminControlStore}
          onNavigate={handleNavigate}
          isEditMode={isEditMode}
        />
      )}

      {activeScreen === 'checkout' && (
        <CheckoutAndOrdersPage
          config={config}
          onUpdateConfig={handleUpdateConfig}
          cart={cart}
          onUpdateCartQuantity={handleUpdateCartQuantity}
          onRemoveFromCart={handleRemoveFromCart}
          onClearCart={() => setCart([])}
          orders={orders}
          currentUserUid={currentUser?.uid || null}
          currentUserName={userProfile?.displayName || currentUser?.displayName || null}
          currentUserEmail={currentUser?.email || userProfile?.email || null}
          onSignInGoogle={handleSignInGoogle}
          gatewayStatus={gatewayStatus}
          sellerPaymentSettings={sellerPaymentSettings}
          onPlaceOrder={handlePlaceOrder}
          onDownloadOrderFile={handleDownloadOrderFile}
          onNavigate={handleNavigate}
          activeBuyerSection={activeBuyerSection}
          onSelectBuyerSection={handleSelectBuyerNavSection}
          onUpdateBuyerProfile={handleUpdateBuyerProfile}
          allStores={storeConfigs}
          onSwitchStore={(targetId) => handleSwitchSellerStore(targetId)}
        />
      )}

      {/* Developer Screen Switcher Dock (Hidden unless ?dev=true) */}
      {isDevControlsEnabled && activeScreen !== 'landing' && (
        <div className="fixed bottom-3 left-3 z-30 flex justify-start px-2 pointer-events-none max-w-[calc(100vw-11rem)] sm:max-w-[calc(100vw-14rem)]">
          <div className="pointer-events-auto bg-[#FFFDF8]/95 backdrop-blur-md border-2 border-[#E8D2B5] rounded-full shadow-[0_6px_0_#D8BE9E,0_16px_32px_rgba(80,53,47,0.14)] px-2.5 py-1.5 flex items-center gap-1.5 max-w-full overflow-x-auto">
            <button
              onClick={() => setDockMinimized(!dockMinimized)}
              title={dockMinimized ? 'Expand Preview Switcher' : 'Minimize Switcher'}
              className="candy-btn-pink px-3.5 py-1.5 rounded-full text-[12px] font-extrabold flex items-center gap-1.5 shrink-0 cursor-pointer min-h-[38px]"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{dockMinimized ? 'Switch View' : 'Screens'}</span>
              {dockMinimized ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {!dockMinimized && (
              <>
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  {SCREEN_TABS.filter(
                    (tab) => tab.id !== 'super-admin' || isSuperAdminVerified
                  ).map((tab) => {
                    const isActive = activeScreen === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleNavigate(tab.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-extrabold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                          isActive
                            ? 'candy-btn-pink'
                            : 'text-[#50352F] hover:bg-[#FFF2DF] hover:text-[#D66795]'
                        }`}
                      >
                        <span className="opacity-75 mr-1 tabular-nums">{tab.num}.</span>
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-[2px] bg-[#E8D2B5] mx-1 shrink-0" />

                {/* Multi-Vendor Seller Store Switcher (PK Seller vs IN Seller) */}
                <div className="flex items-center gap-1 bg-[#FFF2DF] p-0.5 rounded-full border border-[#E8D2B5] shrink-0">
                  <button
                    onClick={() => handleSwitchSellerStore('store-fatima-tech')}
                    title="Switch to Pakistan Seller Store (Fatima.tech · PKR)"
                    className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold transition-all cursor-pointer ${
                      config.storeId === 'store-fatima-tech'
                        ? 'candy-btn-pink'
                        : 'text-[#50352F] hover:text-[#D66795]'
                    }`}
                  >
                    🇵🇰 PK Store (PKR)
                  </button>
                  <button
                    onClick={() => handleSwitchSellerStore('store-in-ananya')}
                    title="Switch to India Seller Store (Ananya Creates · INR)"
                    className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold transition-all cursor-pointer ${
                      config.storeId === 'store-in-ananya'
                        ? 'candy-btn-pink'
                        : 'text-[#50352F] hover:text-[#D66795]'
                    }`}
                  >
                    🇮🇳 IN Store (INR)
                  </button>
                </div>

                {/* Quick Cart Button */}
                <button
                  onClick={() => handleNavigate('checkout')}
                  className="candy-btn-butter px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Bag ({totalCartItems})</span>
                </button>

                {/* Auth Status Button */}
                {!currentUser && (
                  <button
                    onClick={handleSignInGoogle}
                    className="candy-btn-white px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Google Sign-In</span>
                  </button>
                )}

                {/* Inline Edit Mode Toggle */}
                <button
                  onClick={() => setIsEditMode(!isEditMode)}
                  title="Toggle inline text editing across all headings and copy"
                  className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isEditMode
                      ? 'candy-btn-mint'
                      : 'candy-btn-white'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{isEditMode ? 'Editing On' : 'Edit Text'}</span>
                </button>

                <button
                  onClick={handleResetDemo}
                  title="Reset local preview state"
                  className="p-1.5 rounded-full text-[#7A5A52] hover:text-[#50352F] hover:bg-[#FFF2DF] transition-colors shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Free-Tier Multi-Turn Gemini Store Assistant */}
      <GeminiChatWidget
        storeName={config.storeName}
        storeSlug={config.storeSlug}
        currency={config.currency}
        productCount={products.filter((p) => p.published !== false).length}
      />
    </div>
  );
}
