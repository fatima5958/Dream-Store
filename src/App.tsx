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

function buildFreshUserStoreConfig(user: {
  uid: string;
  displayName?: string | null;
  email?: string | null;
}): StoreConfig {
  const userStoreId = `store-${user.uid.slice(0, 20)}`;
  const rawName =
    user.displayName?.trim() ||
    (user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9 ]/g, ' ').trim() : '') ||
    'Creator';
  const cleanSlug =
    rawName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_.-]/g, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || `store-${user.uid.slice(0, 8).toLowerCase()}`;
  const slugWithSuffix =
    cleanSlug === 'fatima.tech' || cleanSlug === 'ananya.creates' || cleanSlug.length < 2
      ? `creator-${user.uid.slice(0, 8).toLowerCase()}`
      : cleanSlug;
  const displayStoreName = `${rawName}'s Studio`.slice(0, 100);

  return {
    ...INITIAL_STORE_CONFIG,
    storeId: userStoreId,
    ownerId: user.uid,
    storeName: displayStoreName,
    storeSlug: slugWithSuffix,
    ownerName: rawName.slice(0, 100),
    instagramHandle: `@${slugWithSuffix}`,
    sellerCountry: 'Pakistan',
    productType: 'Ebooks & Guides',
    announcementText: `Welcome to ${displayStoreName} — Digital Downloads & Guides ✨`,
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
    if (screenParam === 'super-admin' || window.location.pathname.toLowerCase().includes('super-admin')) {
      return 'landing';
    }
    if (screenParam && SCREEN_TABS.some((t) => t.id === screenParam)) {
      return screenParam;
    }
    if (params.get('store')) {
      return 'storefront';
    }
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

  const [storeConfigs, setStoreConfigs] = useState<Record<string, StoreConfig>>(
    INITIAL_STORE_CONFIGS
  );
  const storeConfigsRef = useRef<Record<string, StoreConfig>>(INITIAL_STORE_CONFIGS);
  useEffect(() => {
    storeConfigsRef.current = storeConfigs;
  }, [storeConfigs]);

  const [activeStoreId, setActiveStoreId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const storeParam = (params.get('store') || '').trim().toLowerCase();
    if (storeParam === 'ananya.creates') {
      return 'store-in-ananya';
    }
    if (storeParam === 'fatima.tech' || storeParam === 'fatimatech') {
      return 'store-fatima-tech';
    }
    return 'store-fatima-tech';
  });
  const activeStoreIdRef = useRef<string>(activeStoreId);
  useEffect(() => {
    activeStoreIdRef.current = activeStoreId;
  }, [activeStoreId]);

  const config = storeConfigs[activeStoreId] || INITIAL_STORE_CONFIG;
  const setConfig = (
    updater: StoreConfig | ((prev: StoreConfig) => StoreConfig),
    explicitStoreId?: string
  ) => {
    const targetId = explicitStoreId || activeStoreIdRef.current;
    setStoreConfigs((prevMap) => {
      const current = prevMap[targetId] || INITIAL_STORE_CONFIG;
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
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [selectedProductId, setSelectedProductId] = useState<string>(INITIAL_PRODUCTS[0].id);
  const [cart, setCart] = useState<CartItem[]>([
    { product: INITIAL_PRODUCTS[0], quantity: 1 },
  ]);
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
    jazzcashConfigured: false,
    easypaisaConfigured: false,
    stripeConfigured: false,
    emailConfigured: false,
  });

  const [platformStores, setPlatformStores] = useState<PlatformStore[]>(INITIAL_PLATFORM_STORES);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [dockMinimized, setDockMinimized] = useState<boolean>(true);
  const [cartToast, setCartToast] = useState<string | null>(null);
  const cartToastTimerRef = useRef<number | null>(null);
  const isDevControlsEnabled =
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
          ...(storeConfigsRef.current[loadedStoreId] || INITIAL_STORE_CONFIG),
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
          heroHeadingLine1: d.heroHeadingLine1 || INITIAL_STORE_CONFIG.heroHeadingLine1,
          heroHeadingLine2: d.heroHeadingLine2 || INITIAL_STORE_CONFIG.heroHeadingLine2,
          heroSubheading: d.heroSubheading || INITIAL_STORE_CONFIG.heroSubheading,
          heroButtonText: d.heroButtonText || INITIAL_STORE_CONFIG.heroButtonText,
          heroImage: resolveStoreAssetUrl(d.heroImage, INITIAL_STORE_CONFIG.heroImage),
          logoUrl: resolveStoreAssetUrl(
            d.logoUrl || d.ownerAvatar,
            INITIAL_STORE_CONFIG.logoUrl
          ),
          ownerAvatar: resolveStoreAssetUrl(
            d.ownerAvatar || d.logoUrl,
            INITIAL_STORE_CONFIG.ownerAvatar
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
        if (!prodSnap.empty) {
          const fsProds: Product[] = prodSnap.docs.map((pDoc) => {
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
            ...(storeConfigsRef.current[loadedStoreId] || INITIAL_STORE_CONFIG),
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
            heroHeadingLine1: s.heroHeadingLine1 || INITIAL_STORE_CONFIG.heroHeadingLine1,
            heroHeadingLine2: s.heroHeadingLine2 || INITIAL_STORE_CONFIG.heroHeadingLine2,
            heroSubheading: s.heroSubheading || INITIAL_STORE_CONFIG.heroSubheading,
            heroButtonText: s.heroButtonText || INITIAL_STORE_CONFIG.heroButtonText,
            heroImage: resolveStoreAssetUrl(s.heroImage, INITIAL_STORE_CONFIG.heroImage),
            logoUrl: resolveStoreAssetUrl(
              s.logoUrl || s.ownerAvatar,
              INITIAL_STORE_CONFIG.logoUrl
            ),
            ownerAvatar: resolveStoreAssetUrl(
              s.ownerAvatar || s.logoUrl,
              INITIAL_STORE_CONFIG.ownerAvatar
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
            const apiProds: Product[] = data.products.map((pd: any) => ({
              id: pd.id,
              storeId: pd.storeId || loadedStoreId,
              ownerId: pd.ownerId || s.ownerId,
              title: pd.title,
              category: pd.category || 'Ebooks & Guides',
              subtitle: pd.subtitle || 'Instant Digital Download',
              description: pd.description || pd.subtitle || 'Digital guide',
              whatsIncluded: [
                `Complete ${pd.fileName || 'Guide.pdf'} (${pd.fileSizeLabel || '2.4 MB'})`,
              ],
              details: [
                { label: 'Format', value: pd.fileType || 'PDF' },
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
              features: INITIAL_PRODUCTS[0].features,
              fileName: pd.fileName || 'Guide.pdf',
              fileType: pd.fileType || 'PDF',
              fileSizeLabel: pd.fileSizeLabel || '2.4 MB',
            }));
            setProducts((prev) => {
              const existingIds = new Set(apiProds.map((fp) => fp.id));
              return [...apiProds, ...prev.filter((p) => !existingIds.has(p.id))];
            });
            setSelectedProductId(apiProds[0].id);
          } else {
            // Ensure default sample products exist for this custom store so storefront is populated
            setProducts((prev) => {
              const hasStoreProds = prev.some((p) => p.storeId === loadedStoreId);
              if (hasStoreProds) return prev;
              const cloned = INITIAL_PRODUCTS.slice(0, 3).map((base) => ({
                ...base,
                id: `${base.id}-${loadedStoreId.slice(-6)}`,
                storeId: loadedStoreId,
                ownerId: s.ownerId || 'creator',
              }));
              return [...cloned, ...prev];
            });
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
          if (cleanSlug === 'ananya.creates') {
            setActiveStoreId('store-in-ananya');
            setSelectedProductId('prod-in-mindful-journal');
          } else if (cleanSlug === 'fatima.tech' || cleanSlug === 'fatimatech') {
            setActiveStoreId('store-fatima-tech');
            setSelectedProductId('prod-30-day-reset');
          } else {
            const localMatch = (Object.values(storeConfigsRef.current) as StoreConfig[]).find(
              (sc) => sc.storeSlug.toLowerCase() === cleanSlug
            );
            if (localMatch) {
              setActiveStoreId(localMatch.storeId);
            }
          }
        }
      }

      if (screenParam && SCREEN_TABS.some((t) => t.id === screenParam)) {
        requestedUrlScreenRef.current = screenParam;
        if (screenParam !== 'super-admin') {
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
              if (!existingRole) {
                existingRole = 'seller';
              }
            }
          } catch {
            // Ignore store check error
          }

          if (!existingRole) {
            try {
              const userSnap = await getDoc(doc(db, 'users', user.uid));
              if (userSnap.exists()) {
                const ud = userSnap.data();
                if (ud.onboardingCompleted && (ud.role === 'buyer' || ud.role === 'seller')) {
                  existingRole = ud.role;
                  existingName = String(ud.displayName || defaultName);
                  existingEmail = String(ud.email || defaultEmail);
                }
              }
            } catch {
              // Ignore user doc check error
            }
          }
        }

        if (!existingRole) {
          try {
            const authHeaders = await getAuthHeaders();
            const profRes = await fetch('/api/users/profile', {
              headers: authHeaders,
            });
            if (profRes.ok) {
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
            }
          } catch {
            // Ignore network error
          }
        }

        // Fallback to localStorage profile cache for returning users if offline
        if (!existingRole) {
          try {
            const cachedRaw = localStorage.getItem(`dreamstore_user_profile_${user.uid}`);
            if (cachedRaw) {
              const cached = JSON.parse(cachedRaw);
              if (
                cached &&
                cached.uid === user.uid &&
                cached.onboardingCompleted &&
                (cached.role === 'buyer' || cached.role === 'seller')
              ) {
                existingRole = cached.role;
                existingName = String(cached.displayName || defaultName);
                existingEmail = String(cached.email || defaultEmail);
              }
            }
          } catch {
            // Ignore storage error
          }
        }

        // If brand-new user on first login (no existing role and no existing store), prompt Role Onboarding
        if (!existingRole && !hasExistingStoreDoc) {
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
              jazzCashEnabled: true,
              easypaisaStoreId: '',
              easypaisaEnabled: true,
              upiId: '',
              paymentLinkUrl: '',
              payoneerEnabled: false,
              payoneerReceivingEmail: existingEmail,
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
        if (!snap.empty) {
          const loaded: Product[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              storeId: d.storeId || userStoreId,
              ownerId: d.ownerId || currentUser.uid,
              title: d.title,
              category: d.category,
              subtitle: d.subtitle,
              description: d.description,
              whatsIncluded: [
                `Complete ${d.fileName} (${d.fileSizeLabel})`,
                'Morning & Evening Gentle Routine Trackers',
                'Printable & Tablet-Friendly Worksheets',
              ],
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
              gallery: [
                resolveStoreAssetUrl(d.image),
                INITIAL_STORE_CONFIG.heroImage,
              ].filter(Boolean),
              features: INITIAL_PRODUCTS[0].features,
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
          // Ensure cart and selectedProductId use the authenticated user's real Firestore product
          // instead of the unpersisted demo product template
          setSelectedProductId((prevId) =>
            prevId === 'prod-30-day-reset' && loaded[0] ? loaded[0].id : prevId
          );
          setCart((prevCart) => {
            if (
              prevCart.length === 1 &&
              prevCart[0].product.id === 'prod-30-day-reset' &&
              loaded[0]
            ) {
              return [{ product: loaded[0], quantity: prevCart[0].quantity }];
            }
            return prevCart;
          });
        }
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
    if (!currentUser) return;
    // Strictly allow only 'buyer' or 'seller' — never allow Super Admin self-assignment
    const safeRole: OnboardingUserRole = payload.role === 'seller' ? 'seller' : 'buyer';
    const cleanName = payload.displayName.trim().slice(0, 120) || 'Shopper';
    const cleanEmail = (payload.email.trim() || currentUser.email || '').slice(0, 254);
    const userStoreId = `store-${currentUser.uid.slice(0, 20)}`;

    const authHeaders = await getAuthHeaders();
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
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save your selected role.');
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
        jazzCashEnabled: true,
        easypaisaStoreId: '',
        easypaisaEnabled: true,
        upiId: '',
        paymentLinkUrl: '',
        payoneerEnabled: false,
        payoneerReceivingEmail: cleanEmail,
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

    setStoreConfigs((prev) => {
      const next = { ...prev, [resolvedStoreId]: fullStore };
      storeConfigsRef.current = next;
      return next;
    });
    if (activeStoreIdRef.current !== resolvedStoreId) {
      setActiveStoreId(resolvedStoreId);
    }

    // Ensure products exist in local state for this storeId
    setProducts((prev) => {
      const hasProds = prev.some((p) => p.storeId === resolvedStoreId);
      if (hasProds) return prev;
      const seeded = INITIAL_PRODUCTS.slice(0, 3).map((base) => ({
        ...base,
        id: `${base.id}-${resolvedStoreId.slice(-8)}`,
        storeId: resolvedStoreId,
        ownerId: resolvedOwnerId,
      }));
      return [...seeded, ...prev];
    });

    // Save to backend persistent store registry when authenticated
    if (currentUser) {
      try {
        const authHeaders = await getAuthHeaders();
        await fetch('/api/stores/create', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ...fullStore,
            ownerEmail: currentUser?.email || '',
          }),
        });
      } catch {
        // Ignore network error if offline
      }
    }

    // Save to Firestore when authenticated via Firebase SDK
    if (currentUser && hasFirebaseSdkSession()) {
      const storeRef = doc(db, 'stores', resolvedStoreId);
      try {
        const existingSnap = await getDoc(storeRef);
        const existingData = existingSnap.exists() ? existingSnap.data() : null;
        await setDoc(
          storeRef,
          {
            ownerId: existingData?.ownerId || currentUser.uid,
            storeSlug: cleanSlug,
            storeName: cleanName,
            ownerName: fullStore.ownerName.slice(0, 100),
            instagramHandle: (fullStore.instagramHandle || '').slice(0, 100),
            sellerCountry: (fullStore.sellerCountry || 'Pakistan').slice(0, 80),
            productType: (fullStore.productType || 'Ebooks & Guides').slice(0, 100),
            announcementText: fullStore.announcementText.slice(0, 240),
            heroHeadingLine1: (fullStore.heroHeadingLine1 || 'Small Steps').slice(0, 120),
            heroHeadingLine2: (fullStore.heroHeadingLine2 || 'Big Changes.').slice(0, 120),
            heroSubheading: (fullStore.heroSubheading || 'Digital products').slice(0, 500),
            heroButtonText: (fullStore.heroButtonText || 'Shop Now').slice(0, 60),
            heroImage: fullStore.heroImage || INITIAL_STORE_CONFIG.heroImage,
            logoUrl: fullStore.logoUrl || INITIAL_STORE_CONFIG.logoUrl,
            theme: fullStore.theme || 'blush-bloom',
            customAccentColor: (fullStore.customAccentColor || '').slice(0, 20),
            currency: fullStore.currency || 'PKR',
            exchangeRatePkr: Number(fullStore.exchangeRatePkr) || 278,
            status: existingData?.status || 'Active',
            plan: existingData?.plan || 'Pro',
            ...(existingSnap.exists() ? {} : { createdAt: serverTimestamp() }),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        reportFirestoreError(err, OperationType.WRITE, `stores/${resolvedStoreId}`);
      }
    }

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
    setConfig(next);

    if (
      currentUser &&
      hasFirebaseSdkSession() &&
      (next.storeId === userStoreId ||
        next.ownerId === currentUser.uid ||
        isSuperAdminVerified) &&
      next.storeId.startsWith('store-')
    ) {
      const storeRef = doc(db, 'stores', next.storeId);
      const validSlug =
        (next.storeSlug || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '')
          .slice(0, 40);
      if (validSlug.length >= 2 && (next.storeName || '').trim().length >= 1) {
        try {
          const existingSnap = await getDoc(storeRef);
          const existingData = existingSnap.exists() ? existingSnap.data() : null;
          await setDoc(
            storeRef,
            {
              ownerId:
                existingData?.ownerId ||
                (isSuperAdminVerified && next.ownerId ? next.ownerId : currentUser.uid),
              storeSlug: validSlug,
              storeName: (next.storeName || validSlug).trim().slice(0, 100),
              ownerName: (next.ownerName || currentUser.displayName || 'Creator').slice(0, 100),
              instagramHandle: (next.instagramHandle || '').slice(0, 100),
              sellerCountry: (next.sellerCountry || 'Pakistan').slice(0, 80),
              productType: (next.productType || 'Ebooks & Guides').slice(0, 100),
              announcementText: (next.announcementText || 'Welcome').slice(0, 240),
              heroHeadingLine1: (next.heroHeadingLine1 || 'Small Steps').slice(0, 120),
              heroHeadingLine2: (next.heroHeadingLine2 || 'Big Changes.').slice(0, 120),
              heroSubheading: (next.heroSubheading || 'Digital products').slice(0, 500),
              heroButtonText: (next.heroButtonText || 'Shop Now').slice(0, 60),
              heroImage: next.heroImage || INITIAL_STORE_CONFIG.heroImage,
              logoUrl: next.logoUrl || INITIAL_STORE_CONFIG.logoUrl,
              theme: next.theme || 'blush-bloom',
              customAccentColor: (next.customAccentColor || '').slice(0, 20),
              currency: next.currency || 'PKR',
              exchangeRatePkr: Number(next.exchangeRatePkr) || 278,
              status: existingData?.status || 'Active',
              plan: existingData?.plan || 'Pro',
              ...(existingSnap.exists() ? {} : { createdAt: serverTimestamp() }),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          reportFirestoreError(err, OperationType.UPDATE, `stores/${next.storeId}`);
        }
      }
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
    if (newProduct.published && !fileDataUrl.startsWith('data:')) {
      throw new Error('Upload the original file before publishing a digital product.');
    }
    if (fileDataUrl.length >= 700000) {
      throw new Error('Original file is too large for beta storage. The product was not published.');
    }
    if (!currentUser) throw new Error('Sign in before adding a product.');

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
          published: Boolean(newProduct.published),
          status: newProduct.status,
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
      throw new Error('The server could not publish this product. Please try again.');
    }
    setProducts((prev) => [newProduct, ...prev]);
  };

  const handleUpdateProduct = async (productId: string, partial: Partial<Product>) => {
    const target = products.find((p) => p.id === productId);
    if (!target) return;
    const merged: Product = { ...target, ...partial };
    setProducts((prev) => prev.map((p) => (p.id === productId ? merged : p)));

    if (currentUser && (merged.ownerId === currentUser.uid || isSuperAdminVerified)) {
      try {
        const authHeaders = await getAuthHeaders();
        fetch('/api/products/upsert', {
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
            image: merged.image,
            fileName: merged.fileName,
            fileType: merged.fileType,
            fileSizeLabel: merged.fileSizeLabel,
            fileDataUrl: merged.fileDataUrl,
          }),
        }).catch(() => {});
      } catch {
        // Ignore network error if offline
      }

      if (!hasFirebaseSdkSession()) return;
      try {
        await updateDoc(doc(db, 'products', productId), {
          title: merged.title.slice(0, 160),
          category: merged.category,
          subtitle: merged.subtitle.slice(0, 300),
          description: merged.description.slice(0, 3000),
          priceUsd: merged.isFree ? 0 : Math.max(1, Number(merged.priceUsd)),
          pricePkr: merged.isFree ? 0 : Math.max(100, Number(merged.pricePkr)),
          isFree: Boolean(merged.isFree),
          published: Boolean(merged.published),
          status: merged.status,
          image: merged.image,
          fileName: merged.fileName.slice(0, 255),
          fileType: merged.fileType.slice(0, 100),
          fileSizeLabel: merged.fileSizeLabel.slice(0, 60),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        reportFirestoreError(err, OperationType.UPDATE, `products/${productId}`);
      }
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    if (currentUser && hasFirebaseSdkSession()) {
      try {
        await deleteDoc(doc(db, 'products', productId));
      } catch (err) {
        reportFirestoreError(err, OperationType.DELETE, `products/${productId}`);
      }
    }
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

    let primaryProduct = resolvedCart[0].product;
    const rawBuyerUid = params.buyerUid || currentUser?.uid || 'sandbox-test-buyer-uid';
    const targetSellerId =
      (primaryProduct.ownerId &&
      primaryProduct.ownerId !== 'demo-owner' &&
      primaryProduct.ownerId !== 'seller-pk-fatima' &&
      primaryProduct.ownerId !== 'seller-in-ananya'
        ? primaryProduct.ownerId
        : config.ownerId) || 'seller-pk-fatima';
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
        const refRes = await fetch('/api/orders/refund', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            orderNumber: target.orderNumber,
          }),
        });
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
        const verifyRes = await fetch('/api/orders/verify-payment', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            orderNumber: target.orderNumber,
            newStatus,
            statementConfirmed: true,
          }),
        });
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
    } catch {
      // Server sync best-effort
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

    if (!currentUser || !hasFirebaseSdkSession()) return;

    const orderRef = doc(db, 'orders', orderId);
    const ledgerRef = doc(db, 'ledger', target.orderNumber);
    const auditId = `aud-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
    const auditRef = doc(db, 'ledger_audit', auditId);

    try {
      await runTransaction(db, async (tx) => {
        const [orderSnap, ledgerSnap] = await Promise.all([
          tx.get(orderRef),
          tx.get(ledgerRef),
        ]);

        // If the order only exists in Express memory (e.g. guest checkout prior to sign-in),
        // skip Firestore document update so tx.update never runs against a null resource.
        if (!orderSnap.exists()) {
          return;
        }

        const ordData = orderSnap.data();
        const ordSellerId = String(ordData.sellerId || target.sellerId || '');
        if (!isSuperAdminVerified && ordSellerId !== currentUser.uid) {
          return;
        }

        const fsProductId = String(ordData.primaryProductId || target.primaryProductId || '');
        const fsBuyerId = String(ordData.buyerId || target.buyerId || '');
        const validIdRegex = /^[a-zA-Z0-9_-]+$/;
        const canWriteEntitlement =
          validIdRegex.test(fsProductId) && validIdRegex.test(fsBuyerId);
        const entRef = canWriteEntitlement
          ? doc(db, 'products', fsProductId, 'entitlements', fsBuyerId)
          : null;
        const entSnap = entRef ? await tx.get(entRef) : null;

        const safePaymentRef = String(
          target.paymentReference || ordData.paymentReference || 'VERIFIED-REF'
        ).slice(0, 200);
        const safeToken = String(
          updatedToken || ordData.downloadToken || 'LOCKED-PENDING-VERIFICATION'
        ).slice(0, 128);

        tx.update(orderRef, {
          paymentStatus: newStatus,
          paymentReference: safePaymentRef,
          downloadToken: safeToken,
          updatedAt: serverTimestamp(),
        });

        if (
          ledgerSnap.exists() &&
          (isSuperAdminVerified || ledgerSnap.data().sellerId === currentUser.uid)
        ) {
          const ledgerUpdate: Record<string, unknown> = {
            paymentStatus: newStatus,
            verificationMode: updatedVerificationMode,
            commissionStatus: updatedCommissionStatus,
            updatedAt: serverTimestamp(),
          };
          if (newStatus === 'Refunded') {
            ledgerUpdate.platformCommissionMinor = 0;
            ledgerUpdate.sellerShareBeforeFeesMinor = 0;
            ledgerUpdate.sellerNetEarningsMinor = 0;
          }
          tx.update(ledgerRef, ledgerUpdate);
        }

        tx.set(auditRef, {
          auditId,
          orderNumber: String(ordData.orderNumber || target.orderNumber).slice(0, 40),
          orderId: orderRef.id,
          sellerId: ordSellerId || currentUser.uid,
          actorUid: currentUser.uid,
          action:
            newStatus === 'Paid'
              ? 'MANUAL_PAYMENT_VERIFIED'
              : newStatus === 'Refunded'
              ? 'ORDER_REFUNDED_REVERSED'
              : 'PAYMENT_REJECTED',
          previousStatus: String(ordData.paymentStatus || target.paymentStatus || 'Pending').slice(
            0,
            40
          ),
          newStatus,
          verificationMode: String(updatedVerificationMode || 'Unverified').slice(0, 80),
          detail: (
            newStatus === 'Paid'
              ? `Manually verified by seller against statement (Ref: ${safePaymentRef}).`
              : newStatus === 'Refunded'
              ? 'Order refunded and 5% commission reversed.'
              : 'Payment reference rejected by seller.'
          ).slice(0, 500),
          createdAt: serverTimestamp(),
        });

        if (entRef && entSnap) {
          const safeExpiresAtMs = Number(
            ordData.expiresAtMs || target.expiresAtMs || Date.now() + 7 * 24 * 60 * 60 * 1000
          );
          if (entSnap.exists()) {
            tx.update(entRef, {
              status: newStatus === 'Paid' ? 'Active' : 'Revoked',
              expiresAtMs: safeExpiresAtMs,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(entRef, {
              productId: fsProductId,
              buyerId: fsBuyerId,
              sellerId: ordSellerId || currentUser.uid,
              orderId: orderRef.id,
              status: newStatus === 'Paid' ? 'Active' : 'Revoked',
              expiresAtMs: safeExpiresAtMs,
              updatedAt: serverTimestamp(),
            });
          }
        }
      });
    } catch (err) {
      reportFirestoreError(err, OperationType.UPDATE, `orders/${orderId}`);
    }
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
    const storeProds = products.filter((p) => p.storeId === targetStoreId);
    if (storeProds.length > 0) {
      setSelectedProductId(storeProds[0].id);
      setCart([{ product: storeProds[0], quantity: 1 }]);
    }
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
    if (storeProds.length > 0) {
      setSelectedProductId(storeProds[0].id);
      setCart([{ product: storeProds[0], quantity: 1 }]);
    }
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
          payoneerReceivingEmail: currentUser.email || '',
          payoneerRequestLink: '',
          payoneerReceivingAccountDetails: '',
          whatsappNotificationNumber: '',
          stripeAccountId: '',
          bankTransferInstructions: '',
        }
      : sellerPaymentSettings;

  const currentProduct =
    activeStoreProducts.find((p) => p.id === selectedProductId) ||
    activeStoreProducts[0] ||
    products[0];
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
            if (match) {
              handleSwitchSellerStore(match.storeId);
            }
            if (navigateToStorefront) {
              handleNavigate('storefront');
            }
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
        onCompleteOnboarding={handleCompleteRoleOnboarding}
      />

      {activeScreen === 'wizard' && userProfile?.role !== 'buyer' && (
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

      {activeScreen === 'owner-dashboard' && userProfile?.role !== 'buyer' && (
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

      {activeScreen === 'product-detail' && (
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

      {activeScreen === 'visual-editor' && userProfile?.role !== 'buyer' && (
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
          currentUserEmail={userProfile?.email || currentUser?.email || null}
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
