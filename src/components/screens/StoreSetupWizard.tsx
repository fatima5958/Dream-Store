import React, { useState, useEffect } from 'react';
import { getAuthHeaders } from '../../lib/firebase';
import {
  Store,
  Folder,
  ArrowRight,
  ArrowLeft,
  Check,
  DollarSign,
  BookOpen,
  Eye,
  Upload,
  Globe,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  ChevronDown,
  Palette,
  Sparkles,
  Rocket,
  CreditCard,
} from 'lucide-react';
import {
  buildPublicStoreUrl,
  CURRENCY_META,
  CurrencyCode,
  INITIAL_ASSETS,
  normalizeStoreThemeId,
  Product,
  ScreenId,
  SellerPaymentSettings,
  STORE_THEMES,
  StoreConfig,
} from '../../types/dreamstore';
import { PastelImage } from '../EditableText';
import {
  CandyButton,
  CandySparkleStar,
  CandyTone,
  ClayIcon,
  DreamFadeIn,
  DreamStoreLogo,
} from '../ui/DreamUI';

interface StoreSetupWizardProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  onCompleteWizard?: (finalPartial?: Partial<StoreConfig>) => Promise<void>;
  sellerPaymentSettings?: SellerPaymentSettings;
  onSavePaymentSettings?: (settings: SellerPaymentSettings) => Promise<void>;
  products: Product[];
  onNavigate: (screen: ScreenId) => void;
  isEditMode: boolean;
  currentUserUid?: string | null;
}

const WIZARD_STAGES: Array<{
  number: number;
  label: string;
  subtitle: string;
  tone: CandyTone;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    number: 1,
    label: 'Store Identity',
    subtitle: 'Name, bio link & social handle',
    tone: 'pink',
    icon: Store,
  },
  {
    number: 2,
    label: 'Products & Category',
    subtitle: 'Digital catalog & format focus',
    tone: 'lilac',
    icon: BookOpen,
  },
  {
    number: 3,
    label: 'Theme & Branding',
    subtitle: 'Palette, logo, banner & greeting',
    tone: 'butter',
    icon: Palette,
  },
  {
    number: 4,
    label: 'Country & Payments',
    subtitle: 'Currency & receiving accounts',
    tone: 'mint',
    icon: CreditCard,
  },
  {
    number: 5,
    label: 'Preview & Publish',
    subtitle: 'Review & launch your store',
    tone: 'pink',
    icon: Rocket,
  },
];

const COUNTRIES = [
  { name: 'Pakistan', defaultCurrency: 'PKR' as CurrencyCode },
  { name: 'India', defaultCurrency: 'INR' as CurrencyCode },
  { name: 'United States', defaultCurrency: 'USD' as CurrencyCode },
  { name: 'United Kingdom', defaultCurrency: 'GBP' as CurrencyCode },
  { name: 'United Arab Emirates', defaultCurrency: 'AED' as CurrencyCode },
  { name: 'Saudi Arabia', defaultCurrency: 'SAR' as CurrencyCode },
  { name: 'Canada', defaultCurrency: 'CAD' as CurrencyCode },
  { name: 'Australia', defaultCurrency: 'AUD' as CurrencyCode },
  { name: 'European Union', defaultCurrency: 'EUR' as CurrencyCode },
];

const RESERVED_SLUGS = ['admin', 'superadmin', 'api', 'login', 'checkout', 'support'];
const SLUG_REGEX = /^[a-z0-9_.-]{2,40}$/;

function deriveSlugFromStoreName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const StoreSetupWizard: React.FC<StoreSetupWizardProps> = ({
  config,
  onUpdateConfig,
  onCompleteWizard,
  sellerPaymentSettings,
  onSavePaymentSettings,
  products,
  onNavigate,
  currentUserUid,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [welcomeChoice, setWelcomeChoice] = useState<'create' | 'manage'>('create');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [remainingFounderSpots, setRemainingFounderSpots] = useState<number | null>(null);

  // Display the same server-verified launch count during onboarding; opening
  // the wizard never reserves a spot. A spot is claimed on successful final save.
  useEffect(() => {
    let active = true;
    const refreshSpots = async () => {
      try {
        const response = await fetch('/api/launch/creator-spots', { cache: 'no-store' });
        if (!response.ok) throw new Error('Creator counter unavailable');
        const data = await response.json();
        if (data.limit !== 100 ||
            !Number.isSafeInteger(data.claimed) ||
            data.claimed < 0 || data.claimed > 100 ||
            data.remaining !== 100 - data.claimed) {
          throw new Error('Unverified creator counter');
        }
        if (active) setRemainingFounderSpots(data.remaining);
      } catch {
        if (active) setRemainingFounderSpots(null);
      }
    };
    void refreshSpots();
    const timer = window.setInterval(() => { void refreshSpots(); }, 30000);
    const handleFocus = () => { void refreshSpots(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
  const [copiedSlugUrl, setCopiedSlugUrl] = useState(false);

  // Controlled form state for Stage 1 so user input is never overwritten by demo defaults or stale async snapshots
  const [storeNameInput, setStoreNameInput] = useState<string>(() => {
    if (
      config.storeName &&
      config.storeName !== 'Fatima.tech' &&
      config.storeName !== 'Ananya Creates'
    ) {
      return config.storeName;
    }
    return config.storeName || '';
  });
  const [storeSlugInput, setStoreSlugInput] = useState<string>(() => {
    if (
      config.storeSlug &&
      config.storeSlug !== 'fatima.tech' &&
      config.storeSlug !== 'ananya.creates'
    ) {
      return config.storeSlug;
    }
    return config.storeSlug || '';
  });
  const [instagramInput, setInstagramInput] = useState<string>(() => {
    if (
      config.instagramHandle &&
      config.instagramHandle !== '@fatima.tech' &&
      config.instagramHandle !== '@ananya.creates'
    ) {
      return config.instagramHandle;
    }
    return config.instagramHandle || '';
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState<boolean>(() => {
    const currentSlug = (config.storeSlug || '').trim().toLowerCase();
    const derived = deriveSlugFromStoreName(config.storeName || '');
    return Boolean(
      currentSlug &&
        currentSlug !== 'fatima.tech' &&
        currentSlug !== 'ananya.creates' &&
        currentSlug !== derived
    );
  });

  const [slugCheckStatus, setSlugCheckStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');
  const [slugCheckMessage, setSlugCheckMessage] = useState<string | null>(null);
  const [isSubmittingStep, setIsSubmittingStep] = useState<boolean>(false);

  // Local draft state for Stage 4 payment accounts so typing does not trigger API/Firestore writes on every keystroke
  const [jazzCashDraft, setJazzCashDraft] = useState<string>(
    () => sellerPaymentSettings?.jazzCashMerchantId || ''
  );
  const [easypaisaDraft, setEasypaisaDraft] = useState<string>(
    () => sellerPaymentSettings?.easypaisaStoreId || ''
  );
  const [upiDraft, setUpiDraft] = useState<string>(
    () => sellerPaymentSettings?.upiId || ''
  );
  const [bankTransferDraft, setBankTransferDraft] = useState<string>(
    () => sellerPaymentSettings?.bankTransferInstructions || ''
  );
  const [paymentDraftEdited, setPaymentDraftEdited] = useState<boolean>(false);

  // Hydrate payment drafts when sellerPaymentSettings loads from Firestore (unless user already edited)
  useEffect(() => {
    if (!sellerPaymentSettings || paymentDraftEdited) return;
    setJazzCashDraft(sellerPaymentSettings.jazzCashMerchantId || '');
    setEasypaisaDraft(sellerPaymentSettings.easypaisaStoreId || '');
    setUpiDraft(sellerPaymentSettings.upiId || '');
    setBankTransferDraft(sellerPaymentSettings.bankTransferInstructions || '');
  }, [
    sellerPaymentSettings?.storeId,
    sellerPaymentSettings?.jazzCashMerchantId,
    sellerPaymentSettings?.easypaisaStoreId,
    sellerPaymentSettings?.upiId,
    sellerPaymentSettings?.bankTransferInstructions,
    paymentDraftEdited,
  ]);

  // Sync local inputs ONLY when switching to a different storeId
  useEffect(() => {
    setStoreNameInput(config.storeName || '');
    setStoreSlugInput(config.storeSlug || '');
    setInstagramInput(config.instagramHandle || '');
    setPaymentDraftEdited(false);
  }, [config.storeId]);

  const slugTrimmed = storeSlugInput.trim().toLowerCase();
  const isSlugReserved = RESERVED_SLUGS.includes(slugTrimmed);
  const isSlugFormatValid = SLUG_REGEX.test(slugTrimmed) && !isSlugReserved;
  const isSlugValid = isSlugFormatValid && slugCheckStatus !== 'taken';

  const checkSlugUniqueness = async (
    candidateSlug: string
  ): Promise<{ available: boolean; reason: string | null }> => {
    const normalized = candidateSlug.trim().toLowerCase();
    if (!normalized || normalized.length < 2) {
      return {
        available: false,
        reason: 'Please enter a valid Store URL slug (at least 2 characters: a-z, 0-9, -, _, .).',
      };
    }
    if (!SLUG_REGEX.test(normalized)) {
      return {
        available: false,
        reason:
          'Store slug may only contain lowercase letters, numbers, hyphens (-), underscores (_), or dots (.).',
      };
    }
    if (RESERVED_SLUGS.includes(normalized)) {
      return {
        available: false,
        reason: `The slug "${normalized}" is a reserved system path. Please choose another store URL.`,
      };
    }

    // Never assume a slug is free after a network or authorization failure.
    try {
      const params = new URLSearchParams({
        slug: normalized,
        excludeStoreId: config.storeId || '',
      });
      const authHeaders = await getAuthHeaders({}, { requireAuth: true });
      const res = await fetch(`/api/stores/check-slug?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.available !== true) {
        return {
          available: false,
          reason: data.reason || 'Store URL verification unavailable. Please retry.',
        };
      }
      return { available: true, reason: null };
    } catch {
      return { available: false, reason: 'Connection lost. Please retry URL verification.' };
    }
  };

  useEffect(() => {
    if (currentStep !== 1) return;
    if (!slugTrimmed) {
      setSlugCheckStatus('invalid');
      setSlugCheckMessage('Enter a unique slug for your public store link.');
      return;
    }
    if (!SLUG_REGEX.test(slugTrimmed) || isSlugReserved) {
      setSlugCheckStatus('invalid');
      setSlugCheckMessage(
        isSlugReserved
          ? `"${slugTrimmed}" is a reserved system URL.`
          : 'Use 2–40 lowercase letters, numbers, hyphens, dots, or underscores.'
      );
      return;
    }

    let cancelled = false;
    setSlugCheckStatus('checking');
    setSlugCheckMessage('Checking availability...');
    const timer = setTimeout(async () => {
      const result = await checkSlugUniqueness(slugTrimmed);
      if (cancelled) return;
      if (result.available) {
        setSlugCheckStatus('available');
        setSlugCheckMessage(`"${slugTrimmed}" is available!`);
      } else {
        setSlugCheckStatus('taken');
        setSlugCheckMessage(result.reason);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slugTrimmed, currentStep, config.storeId, currentUserUid]);

  const validateCurrentStep = async (): Promise<boolean> => {
    setValidationError(null);
    if (currentStep === 1) {
      const trimmedName = storeNameInput.trim();
      if (!trimmedName || trimmedName.length < 2) {
        setValidationError('Please enter a Store Display Name (at least 2 characters).');
        return false;
      }
      const uniqueness = await checkSlugUniqueness(slugTrimmed);
      if (!uniqueness.available) {
        setSlugCheckStatus('taken');
        setSlugCheckMessage(uniqueness.reason);
        setValidationError(
          uniqueness.reason || 'Please enter a valid and unique Store URL slug.'
        );
        return false;
      }
      onUpdateConfig({
        storeName: trimmedName,
        storeSlug: slugTrimmed,
        instagramHandle: instagramInput.trim(),
        announcementText: `Welcome to ${trimmedName} — Digital Downloads & Guides ✨`,
      });
    }
    if (currentStep === 4 && sellerPaymentSettings && onSavePaymentSettings && paymentDraftEdited) {
      await onSavePaymentSettings({
        ...sellerPaymentSettings,
        jazzCashMerchantId: jazzCashDraft.trim(),
        jazzCashEnabled: jazzCashDraft.trim().length >= 3,
        easypaisaStoreId: easypaisaDraft.trim(),
        easypaisaEnabled: easypaisaDraft.trim().length >= 3,
        upiId: upiDraft.trim(),
        bankTransferInstructions: bankTransferDraft.trim(),
      });
      setPaymentDraftEdited(false);
    }
    return true;
  };

  const handleContinue = async () => {
    if (isSubmittingStep) return;
    if (currentStep === 1 && welcomeChoice === 'manage') {
      onNavigate('owner-dashboard');
      return;
    }
    setIsSubmittingStep(true);
    try {
      const valid = await validateCurrentStep();
      if (!valid) {
        return;
      }
      if (currentStep < WIZARD_STAGES.length) {
        setCurrentStep((prev) => prev + 1);
      } else {
        if (sellerPaymentSettings && onSavePaymentSettings && paymentDraftEdited) {
          await onSavePaymentSettings({
            ...sellerPaymentSettings,
            jazzCashMerchantId: jazzCashDraft.trim(),
            jazzCashEnabled: jazzCashDraft.trim().length >= 3,
            easypaisaStoreId: easypaisaDraft.trim(),
            easypaisaEnabled: easypaisaDraft.trim().length >= 3,
            upiId: upiDraft.trim(),
            bankTransferInstructions: bankTransferDraft.trim(),
          });
          setPaymentDraftEdited(false);
        }
        const finalPartial: Partial<StoreConfig> = {
          storeName: storeNameInput.trim() || config.storeName,
          storeSlug: slugTrimmed || config.storeSlug,
          instagramHandle: instagramInput.trim(),
        };
        if (onCompleteWizard) {
          await onCompleteWizard(finalPartial);
        } else {
          onUpdateConfig(finalPartial);
          onNavigate('owner-dashboard');
        }
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Could not save your store. Please retry.');
    } finally {
      setIsSubmittingStep(false);
    }
  };

  const handleStepSelect = async (targetStep: number) => {
    if (targetStep > currentStep) {
      const valid = await validateCurrentStep();
      if (!valid) return;
    }
    setValidationError(null);
    setCurrentStep(targetStep);
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateConfig({ heroImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateConfig({ logoUrl: reader.result, ownerAvatar: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const shareableBioUrl = buildPublicStoreUrl(slugTrimmed || 'your-store');

  const currentStageMeta = WIZARD_STAGES[currentStep - 1] || WIZARD_STAGES[0];
  const progressPercent = Math.round((currentStep / WIZARD_STAGES.length) * 100);
  const StageIcon = currentStageMeta.icon;

  return (
    <div className="min-h-screen bg-[#FFF2DF] flex flex-col justify-center py-5 sm:py-10 px-4 sm:px-6 text-[#50352F] relative overflow-hidden">
      {/* Subtle decorative Candyland stars */}
      <CandySparkleStar
        color="#FFD47B"
        size={26}
        className="hidden md:block absolute top-8 left-10 animate-candy-float pointer-events-none"
      />
      <CandySparkleStar
        color="#F58CB7"
        size={22}
        className="hidden md:block absolute bottom-10 right-12 animate-candy-float pointer-events-none"
      />

      <div className="max-w-[1160px] w-full mx-auto candy-card-white rounded-[34px] overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative z-10">
        {/* Desktop Stepper Sidebar (Sculpted Candyland Progress Rail) */}
        <aside className="hidden lg:flex lg:col-span-4 bg-[#FFF2DF]/65 border-r-2 border-[#F3E2CB] p-6 xl:p-7 flex-col justify-between">
          <div>
            <div className="pb-5 mb-5 border-b-2 border-[#F3E2CB] flex items-center justify-between">
              <DreamStoreLogo
                size="sm"
                brandName={config.landingBrand}
                showTagline={true}
                onClick={() => onNavigate('landing')}
              />
            </div>

            <div className="mb-4 px-1">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#7A5A52]">
                5-Stage Creator Setup
              </span>
              <h2 className="font-candy text-lg font-bold text-[#50352F] mt-0.5">
                Build Your Dream Store
              </h2>
            </div>

            <div className="space-y-2.5">
              {WIZARD_STAGES.map((stage) => {
                const isActive = stage.number === currentStep;
                const isCompleted = stage.number < currentStep;
                const StepIcon = stage.icon;
                return (
                  <button
                    key={stage.number}
                    type="button"
                    data-testid={`wizard-stage-pill-${stage.number}`}
                    onClick={() => handleStepSelect(stage.number)}
                    className={`w-full flex items-center gap-3.5 p-3 rounded-[22px] text-left transition-all cursor-pointer min-h-[60px] ${
                      isActive
                        ? 'candy-card-white ring-2 ring-[#F58CB7]/40 translate-x-1'
                        : isCompleted
                        ? 'bg-[#FFFDF8]/90 border-2 border-[#CBEED6] hover:bg-[#FFFDF8]'
                        : 'bg-[#FFFDF8]/50 border-2 border-transparent hover:bg-[#FFFDF8]/85 hover:border-[#F3E2CB]'
                    }`}
                  >
                    <ClayIcon
                      tone={isCompleted ? 'mint' : isActive ? stage.tone : 'white'}
                      size="sm"
                    >
                      {isCompleted ? (
                        <Check className="w-4 h-4 text-[#50352F] animate-candy-check" />
                      ) : (
                        <StepIcon className="w-4 h-4 text-[#50352F]" />
                      )}
                    </ClayIcon>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#7A5A52] tabular-nums">
                          Stage {stage.number}
                        </span>
                        {isCompleted && (
                          <span className="text-[11px] font-extrabold text-[#236B56]">
                            Done ✓
                          </span>
                        )}
                      </div>
                      <div className="text-[15px] font-extrabold text-[#50352F] truncate">
                        {stage.label}
                      </div>
                      <div className="text-xs text-[#7A5A52] truncate">{stage.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-5 mt-6 border-t-2 border-[#F3E2CB] flex items-center justify-between">
            <button
              type="button"
              onClick={() => onNavigate('landing')}
              className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer min-h-[40px]"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Home
            </button>
            <span className="px-3 py-1.5 rounded-full bg-[#FFFDF8] border-2 border-[#F3E2CB] text-xs font-extrabold text-[#50352F] tabular-nums">
              Stage {currentStep} / {WIZARD_STAGES.length}
            </span>
          </div>
        </aside>

        {/* Main Onboarding Workspace */}
        <main className="lg:col-span-8 p-5 sm:p-8 lg:p-10 flex flex-col justify-between min-h-[600px] bg-[#FFFDF8]">
          {/* Top Candy Progress Header */}
          <div className="space-y-4 pb-5 border-b-2 border-[#F3E2CB]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('landing')}
                  className="lg:hidden px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer min-h-[42px]"
                >
                  <ArrowLeft className="w-4 h-4" /> Home
                </button>
                <ClayIcon tone={currentStageMeta.tone} size="md" className="hidden sm:flex">
                  <StageIcon className="w-5 h-5 text-[#50352F]" />
                </ClayIcon>
                <div>
                  <span className="text-xs font-extrabold text-[#7A5A52] uppercase tracking-wider block">
                    Stage {currentStep} of {WIZARD_STAGES.length} · {currentStageMeta.label}
                  </span>
                  <h1 className="ds-page-title font-candy font-bold text-[#50352F] mt-0.5">
                    Create Your Free Store
                  </h1>
                </div>
              </div>

              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#FFF2DF] border-2 border-[#F3E2CB] text-xs font-extrabold text-[#50352F]">
                <Sparkles className="w-3.5 h-3.5 text-[#D66795]" />
                <span className="tabular-nums">{progressPercent}% Complete</span>
              </div>
            </div>

            {/* Mobile Horizontal Candy Step Pills */}
            <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1">
              {WIZARD_STAGES.map((stage) => {
                const isActive = stage.number === currentStep;
                const isCompleted = stage.number < currentStep;
                return (
                  <button
                    key={stage.number}
                    type="button"
                    onClick={() => handleStepSelect(stage.number)}
                    className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer min-h-[36px] ${
                      isActive
                        ? 'candy-btn-pink text-[#50352F]'
                        : isCompleted
                        ? 'candy-btn-mint text-[#50352F]'
                        : 'bg-[#FFF2DF] border border-[#F3E2CB] text-[#7A5A52]'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3 h-3" /> : <span>{stage.number}.</span>}
                    <span>{stage.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Visible Sculpted Candy Progress Bar */}
            <div
              data-testid="wizard-progress-bar"
              className="w-full h-3.5 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] p-0.5 overflow-hidden shadow-inner"
            >
              <div
                className="h-full rounded-full bg-[#F58CB7] transition-all duration-300 relative"
                style={{ width: `${progressPercent}%` }}
              >
                <span className="absolute inset-x-1 top-0.5 h-1 rounded-full bg-white/60" />
              </div>
            </div>
          </div>

          {/* Stage-Specific Task Body */}
          <DreamFadeIn key={currentStep} className="my-6 flex-1 flex flex-col justify-center">
            {validationError && (
              <div className="mb-5 p-4 rounded-[22px] bg-[#FFF2F5] border-2 border-[#F58CB7] text-sm font-bold text-[#50352F] flex items-center gap-3 max-w-2xl shadow-xs">
                <ClayIcon tone="pink" size="sm">
                  <AlertCircle className="w-4 h-4 text-[#50352F]" />
                </ClayIcon>
                <span>{validationError}</span>
              </div>
            )}

            {/* STAGE 1: STORE IDENTITY (Mode Choice + Store Name, Unique Bio Link & Instagram) */}
            {currentStep === 1 && (
              <div className="space-y-6 max-w-2xl">
                <div data-testid="wizard-founder-spots"
                  aria-live="polite"
                  className="rounded-2xl border border-[#F5B6D3] bg-[#FFF1F7] px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-[#8D3863] text-xs uppercase tracking-wider">Founding 100 Creators</p>
                    <p className="text-[#50352F] text-sm font-extrabold">
                      {remainingFounderSpots === null
                        ? 'Checking live creator spots...'
                        : remainingFounderSpots === 0
                        ? 'All 100 free launch spots claimed'
                        : `${remainingFounderSpots} of 100 free storefront spots remaining`}
                    </p>
                    <p className="text-xs text-[#765C68] mt-0.5">
                      Your spot counts only after you finish setup and launch your store.
                    </p>
                  </div>
                  <span data-testid="wizard-founder-count"
                    className="shrink-0 rounded-xl bg-white px-3 py-2 text-xl font-extrabold tabular-nums text-[#8D3863]">
                    {remainingFounderSpots === null ? '—' : remainingFounderSpots}
                  </span>
                </div>
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    1. Store Identity — What would you like to do today?
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-1">
                    Choose your store name, link and design. Your new store is saved after the final step.
                  </p>
                </div>

                {/* Quick Action Mode Cards */}
                <div className="grid grid-cols-1 gap-4">
                  <button
                    type="button"
                    onClick={() => setWelcomeChoice('create')}
                    className={`p-4 rounded-[24px] text-left transition-all flex items-center gap-3.5 cursor-pointer min-h-[84px] ${
                      welcomeChoice === 'create'
                        ? 'candy-card-pink text-[#50352F]'
                        : 'candy-card-white hover:border-[#F58CB7]'
                    }`}
                  >
                    <ClayIcon tone={welcomeChoice === 'create' ? 'butter' : 'pink'} size="md">
                      <Store className="w-5 h-5" />
                    </ClayIcon>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-candy font-bold text-base text-[#50352F]">
                          Create my free store
                        </span>
                        {welcomeChoice === 'create' && (
                          <span className="w-6 h-6 rounded-full bg-[#FFFDF8] flex items-center justify-center shrink-0 animate-candy-check">
                            <Check className="w-3.5 h-3.5 text-[#50352F]" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-[#50352F]/80 mt-0.5">
                        Choose a name and shareable link to begin
                      </p>
                    </div>
                  </button>


                </div>

                {/* Creamy Form Card for Store Name, Custom Slug & Instagram */}
                {welcomeChoice === 'create' && (
                  <div className="p-5 sm:p-6 rounded-[28px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="wizard-store-name-input"
                          className="ds-label block mb-1.5"
                        >
                          Store Display Name <span className="text-[#D66795]">*</span>
                        </label>
                        <input
                          id="wizard-store-name-input"
                          data-testid="wizard-store-name-input"
                          type="text"
                          value={storeNameInput}
                          onChange={(e) => {
                            setValidationError(null);
                            const val = e.target.value;
                            setStoreNameInput(val);
                            const nextSlug = slugManuallyEdited
                              ? storeSlugInput
                              : deriveSlugFromStoreName(val);
                            if (!slugManuallyEdited) {
                              setStoreSlugInput(nextSlug);
                            }
                            onUpdateConfig({
                              storeName: val,
                              storeSlug: nextSlug,
                              announcementText: val.trim()
                                ? `Welcome to ${val.trim()} — Digital Downloads & Guides ✨`
                                : config.announcementText,
                            });
                          }}
                          className="w-full px-4 py-3 rounded-2xl candy-input text-base min-h-[46px]"
                          placeholder="e.g. Noor Digital Studio"
                        />
                        <span className="ds-helper block mt-1">
                          Example: Fatima.tech or Ayla Studio
                        </span>
                      </div>

                      <div>
                        <label
                          htmlFor="wizard-store-slug-input"
                          className="ds-label block mb-1.5"
                        >
                          Custom Store Slug <span className="text-[#D66795]">*</span>
                        </label>
                        <input
                          id="wizard-store-slug-input"
                          data-testid="wizard-store-slug-input"
                          type="text"
                          value={storeSlugInput}
                          onChange={(e) => {
                            setValidationError(null);
                            const raw = e.target.value;
                            const cleaned = raw
                              .toLowerCase()
                              .replace(/\s+/g, '-')
                              .replace(/[^a-z0-9_.-]/g, '')
                              .slice(0, 40);
                            setSlugManuallyEdited(cleaned.length > 0);
                            setStoreSlugInput(cleaned);
                            onUpdateConfig({ storeSlug: cleaned });
                          }}
                          className="w-full px-4 py-3 rounded-2xl candy-input text-base min-h-[46px]"
                          placeholder="e.g. noor-studio"
                        />
                        {slugCheckMessage && (
                          <p
                            data-testid="wizard-slug-status"
                            className={`mt-1.5 text-xs font-extrabold flex items-center gap-1.5 ${
                              slugCheckStatus === 'available'
                                ? 'text-[#236B56]'
                                : slugCheckStatus === 'checking'
                                ? 'text-[#7A5A52]'
                                : 'text-[#C93B5B]'
                            }`}
                          >
                            {slugCheckStatus === 'checking' && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            )}
                            {slugCheckStatus === 'available' && (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 animate-candy-check" />
                            )}
                            {(slugCheckStatus === 'taken' || slugCheckStatus === 'invalid') && (
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{slugCheckMessage}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="wizard-instagram-input"
                        className="ds-label block mb-1.5"
                      >
                        Instagram or TikTok Handle (Optional)
                      </label>
                      <input
                        id="wizard-instagram-input"
                        data-testid="wizard-instagram-input"
                        type="text"
                        value={instagramInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setInstagramInput(val);
                          onUpdateConfig({ instagramHandle: val });
                        }}
                        className="w-full px-4 py-3 rounded-2xl candy-input text-base min-h-[46px]"
                        placeholder="@your.handle"
                      />
                    </div>

                    {/* Shareable Bio URL Pill Bar */}
                    <div className="p-3.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        {isSlugValid ? (
                          <CheckCircle2 className="w-4 h-4 text-[#236B56] shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-[#C93B5B] shrink-0" />
                        )}
                        <span
                          data-testid="wizard-shareable-bio-url"
                          className="font-bold text-[#50352F] truncate"
                        >
                          {shareableBioUrl}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(shareableBioUrl);
                          setCopiedSlugUrl(true);
                          setTimeout(() => setCopiedSlugUrl(false), 2000);
                        }}
                        className="px-3.5 py-2 rounded-full candy-btn-butter text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer min-h-[38px]"
                      >
                        {copiedSlugUrl ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedSlugUrl ? 'Copied ✓' : 'Copy Bio Link'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STAGE 2: PRODUCTS & CATEGORY */}
            {currentStep === 2 && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    2. What kind of digital products will you sell?
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-1">
                    Pick your primary digital creator category. You can upload PDFs, eBooks, Notion templates, or ZIP bundles anytime.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {[
                    { label: 'Ebooks & Guides', tone: 'pink' as CandyTone },
                    { label: 'Digital Planners', tone: 'lilac' as CandyTone },
                    { label: 'Workbooks', tone: 'butter' as CandyTone },
                    { label: 'Notion Templates', tone: 'mint' as CandyTone },
                    { label: 'Self-Care Bundles', tone: 'pink' as CandyTone },
                    { label: 'Courses & ZIP Packs', tone: 'lilac' as CandyTone },
                  ].map((item) => {
                    const isSelected = config.productType === item.label;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => onUpdateConfig({ productType: item.label })}
                        className={`p-4 rounded-[24px] text-left transition-all cursor-pointer min-h-[96px] flex flex-col justify-between ${
                          isSelected
                            ? 'candy-card-pink text-[#50352F]'
                            : 'candy-card-white hover:border-[#F58CB7]'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <ClayIcon tone={isSelected ? 'butter' : item.tone} size="sm">
                            <BookOpen className="w-4 h-4" />
                          </ClayIcon>
                          {isSelected && (
                            <span className="w-6 h-6 rounded-full bg-[#FFFDF8] flex items-center justify-center animate-candy-check">
                              <Check className="w-3.5 h-3.5 text-[#50352F]" />
                            </span>
                          )}
                        </div>
                        <div className="font-candy font-bold text-[15px] text-[#50352F] mt-2">
                          {item.label}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="p-4 rounded-[24px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <ClayIcon tone="mint" size="sm">
                      <Sparkles className="w-4 h-4" />
                    </ClayIcon>
                    <div>
                      <div className="text-sm font-extrabold text-[#50352F]">
                        {products.length > 0
                          ? `${products.length} Digital ${products.length === 1 ? 'Product' : 'Products'} in Your Catalog`
                          : 'Beginner-Friendly Digital Product Upload'}
                      </div>
                      <p className="ds-helper">
                        {products.length > 0
                          ? 'Manage, edit, or add new products anytime from your Seller Dashboard.'
                          : 'After launching your store, click "Add Product" in your Seller Dashboard to upload your first PDF, eBook, or template.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 3: THEME & BRANDING (Color Theme + Logo + Cover Banner + Welcome Greeting) */}
            {currentStep === 3 && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    3. Choose Your Store Color Theme & Branding
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-1">
                    Pick a signature storefront palette, upload your store avatar or cover banner, and customize your welcome message.
                  </p>
                </div>

                {/* Theme Selector Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {STORE_THEMES.map((t) => {
                    const isSelected = normalizeStoreThemeId(config.theme) === t.id;
                    const isProTheme = t.tier === 'pro';
                    return (
                      <button
                        key={t.id}
                        type="button"
                        data-testid={`wizard-theme-${t.id}`}
                        onClick={() => {
                          if (isProTheme) {
                            setValidationError(
                              `${t.name} is a DreamStore Pro theme (Coming Soon). Please choose one of the 3 Free Starter Themes to launch your free store.`
                            );
                            return;
                          }
                          setValidationError(null);
                          onUpdateConfig({ theme: t.id });
                        }}
                        className={`p-4 rounded-[24px] flex items-center justify-between transition-all cursor-pointer min-h-[74px] text-left ${
                          isSelected
                            ? 'candy-card-butter text-[#50352F]'
                            : 'candy-card-white hover:border-[#F58CB7]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-candy text-[15px] font-bold text-[#50352F]">
                              {t.name}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                                isProTheme
                                  ? 'bg-[#BBA0EA]/35 text-[#50352F] border border-[#9677CC]'
                                  : 'bg-[#AFE0BE]/50 text-[#50352F] border border-[#82BF96]'
                              }`}
                            >
                              {isProTheme ? 'Pro · Soon' : 'Free'}
                            </span>
                          </div>
                          <div className="ds-helper mt-0.5">{t.subtitle}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {t.swatchClasses.map((swatchCls, idx) => (
                            <span
                              key={idx}
                              className={`w-4 h-4 rounded-full border border-[#50352F]/20 ${swatchCls}`}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Branding & Greeting Card */}
                <div className="p-5 rounded-[28px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <PastelImage
                        src={config.logoUrl}
                        alt="Store Logo"
                        className="w-14 h-14 rounded-2xl object-cover border-2 border-[#F0DEC6] bg-[#FFFDF8]"
                      />
                      <label className="px-4 py-2.5 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] cursor-pointer inline-flex items-center gap-2 min-h-[42px]">
                        <Upload className="w-4 h-4 text-[#D66795]" />
                        <span>Upload Logo</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      {[
                        { label: 'Studio Banner', src: INITIAL_ASSETS.heroBanner },
                        { label: 'Guide Banner', src: INITIAL_ASSETS.book30DayReset },
                      ].map((img) => (
                        <button
                          key={img.label}
                          type="button"
                          onClick={() => onUpdateConfig({ heroImage: img.src })}
                          className={`px-3 py-2 rounded-full text-xs font-bold border-2 cursor-pointer transition-all ${
                            config.heroImage === img.src
                              ? 'bg-[#F58CB7] border-[#D66795] text-[#50352F]'
                              : 'bg-[#FFFDF8] border-[#F0DEC6] text-[#7A5A52]'
                          }`}
                        >
                          {img.label}
                        </button>
                      ))}
                      <label className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] cursor-pointer inline-flex items-center gap-1.5 min-h-[38px]">
                        <Upload className="w-3.5 h-3.5 text-[#D66795]" />
                        <span>Banner</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleBannerUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="ds-label block mb-1">Welcome Heading Line 1</label>
                      <input
                        type="text"
                        value={config.heroHeadingLine1}
                        onChange={(e) => onUpdateConfig({ heroHeadingLine1: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="ds-label block mb-1">Welcome Heading Line 2 (Accent)</label>
                      <input
                        type="text"
                        value={config.heroHeadingLine2}
                        onChange={(e) => onUpdateConfig({ heroHeadingLine2: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base text-[#D66795] min-h-[44px]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 4: COUNTRY & PAYMENTS */}
            {currentStep === 4 && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    4. Select Your Country, Currency & Payments
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-1">
                    Product prices automatically display in your chosen currency. Manual wallet & bank receiving accounts are optional now and editable anytime.
                  </p>
                </div>

                <div>
                  <label className="ds-label block mb-2">Seller Country</label>
                  <div className="flex flex-wrap gap-2">
                    {COUNTRIES.map((c) => {
                      const isSelected = config.sellerCountry === c.name;
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() =>
                            onUpdateConfig({
                              sellerCountry: c.name,
                              currency: c.defaultCurrency,
                            })
                          }
                          className={`px-4 py-2.5 rounded-full text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer min-h-[44px] ${
                            isSelected
                              ? 'candy-btn-pink text-[#50352F]'
                              : 'candy-btn-white text-[#50352F]'
                          }`}
                        >
                          <Globe className="w-4 h-4" />
                          <span>{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="ds-label block mb-2">Store Currency</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                    {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => {
                      const isSelected = config.currency === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => onUpdateConfig({ currency: code })}
                          className={`p-2.5 rounded-2xl text-sm font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer min-h-[44px] ${
                            isSelected
                              ? 'candy-btn-butter text-[#50352F]'
                              : 'candy-btn-white text-[#50352F]'
                          }`}
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          <span>{code}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {sellerPaymentSettings && onSavePaymentSettings && (
                  <details className="rounded-[24px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] p-4">
                    <summary className="ds-label cursor-pointer flex items-center justify-between text-[#50352F]">
                      <span>Add manual payment receiving accounts now (Optional)</span>
                      <ChevronDown className="w-4 h-4" />
                    </summary>
                    <div className="mt-4 pt-3 border-t-2 border-[#F0DEC6] grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="ds-label block mb-1">JazzCash Number (Pakistan)</label>
                        <input
                          type="text"
                          value={jazzCashDraft}
                          onChange={(e) => {
                            setPaymentDraftEdited(true);
                            setJazzCashDraft(e.target.value);
                          }}
                          placeholder="JazzCash mobile & account name"
                          className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label className="ds-label block mb-1">Easypaisa Number (Pakistan)</label>
                        <input
                          type="text"
                          value={easypaisaDraft}
                          onChange={(e) => {
                            setPaymentDraftEdited(true);
                            setEasypaisaDraft(e.target.value);
                          }}
                          placeholder="Easypaisa mobile & account name"
                          className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label className="ds-label block mb-1">India UPI ID</label>
                        <input
                          type="text"
                          value={upiDraft}
                          onChange={(e) => {
                            setPaymentDraftEdited(true);
                            setUpiDraft(e.target.value);
                          }}
                          placeholder="creator@okaxis"
                          className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label className="ds-label block mb-1">Bank Transfer / IBAN</label>
                        <input
                          type="text"
                          value={bankTransferDraft}
                          onChange={(e) => {
                            setPaymentDraftEdited(true);
                            setBankTransferDraft(e.target.value);
                          }}
                          placeholder="Bank Name & IBAN"
                          className="w-full px-3.5 py-2.5 rounded-2xl candy-input text-base min-h-[44px]"
                        />
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* STAGE 5: PREVIEW & PUBLISH */}
            {currentStep === 5 && (
              <div className="space-y-5 max-w-2xl">
                <div className="inline-flex items-center gap-2 text-xs font-extrabold text-[#50352F] candy-btn-mint px-4 py-1.5 rounded-full">
                  <ShieldCheck className="w-4 h-4" /> Final Review
                </div>

                <div>
                  <h2 className="ds-page-title font-candy font-bold text-[#50352F]">
                    5. Review Your Store ✨
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-1">
                    Check the name and link. Click{' '}
                    <strong className="text-[#50352F]">Launch My Store</strong> to save securely, then add your first product in the Dashboard.
                  </p>
                </div>

                {/* Sculpted Candyland Store Summary Card */}
                <div className="candy-card-pink rounded-[28px] p-4 sm:p-5">
                  <div className="candy-inner-bed rounded-[22px] p-5 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <PastelImage
                        src={config.logoUrl}
                        alt={config.storeName}
                        className="w-14 h-14 rounded-2xl object-cover border-2 border-[#F0DEC6] shrink-0"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <div className="ds-card-title font-candy font-bold text-[#50352F] truncate">
                          {storeNameInput.trim() || config.storeName} ({config.currency})
                        </div>
                        <p className="ds-helper truncate">
                          {config.sellerCountry} · {instagramInput.trim() || config.instagramHandle || 'Creator Store'} ·{' '}
                          {products.length > 0
                            ? `${products.length} ${products.length === 1 ? 'product' : 'products'} in catalog`
                            : 'Ready to add your first product'}
                        </p>
                        <p className="text-xs font-extrabold text-[#D66795] truncate">
                          {shareableBioUrl}
                        </p>
                      </div>
                    </div>

                    <span className="text-xs font-semibold text-[#6E4F47]">Public link becomes available after saving.</span>
                  </div>
                </div>

                {/* Delightful Checkmark Readiness Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { title: 'Bio Link Preview', desc: `/?store=${slugTrimmed || config.storeSlug}` },
                    { title: 'Theme Selected', desc: `${STORE_THEMES.find((t) => t.id === normalizeStoreThemeId(config.theme))?.name || 'Blush Bloom'}` },
                    { title: 'Keep 95% Share', desc: '5% fee only on verified sales' },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="p-3.5 rounded-2xl bg-[#FFF2DF]/80 border-2 border-[#F0DEC6] flex items-center gap-2.5"
                    >
                      <ClayIcon tone="mint" size="sm">
                        <Check className="w-4 h-4 animate-candy-check" />
                      </ClayIcon>
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-[#50352F] truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] font-semibold text-[#7A5A52] truncate">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DreamFadeIn>

          {/* Bottom Navigation Bar (Tactile 3D Back & Continue Buttons) */}
          <div className="pt-5 border-t-2 border-[#F3E2CB] flex items-center justify-between gap-3">
            <div>
              {currentStep > 1 && (
                <CandyButton
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="wizard-prev-button"
                  onClick={() => {
                    setValidationError(null);
                    setCurrentStep((prev) => Math.max(1, prev - 1));
                  }}
                >
                  ← Back
                </CandyButton>
              )}
            </div>

            <CandyButton
              type="button"
              variant="primary"
              size="lg"
              data-testid="wizard-continue-button"
              disabled={isSubmittingStep}
              onClick={handleContinue}
            >
              <span>
                {isSubmittingStep
                  ? 'Saving...'
                  : currentStep === WIZARD_STAGES.length
                  ? 'Launch My Store'
                  : 'Continue'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </CandyButton>
          </div>
        </main>
      </div>
    </div>
  );
};
