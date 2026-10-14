import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Sparkles,
  ArrowRight,
  Check,
  ShieldCheck,
  Heart,
  ExternalLink,
  ChevronDown,
  Lock,
  ShoppingBag,
  Palette,
  Crown,
  Menu,
  X,
  Upload,
  Share2,
  BookOpen,
} from 'lucide-react';
import {
  StoreConfig,
  Product,
  ScreenId,
  STORE_THEMES,
  StoreThemeDefinition,
  INITIAL_ASSETS,
  resolveStoreAssetUrl,
} from '../../types/dreamstore';
import { SquishyPricing } from '../ui/squishy-pricing';
import {
  ClayIcon,
  CandyFeatureCard,
  CandySparkleStar,
} from '../ui/DreamUI';
import { CandylandAuthModal, AuthModalMode } from '../CandylandAuthModal';
import avatarFatimaBundled from '../../assets/images/avatar_fatima_1791519592784.jpg';
import book30DayResetBundled from '../../assets/images/book_30_day_reset_1791519551780.jpg';
import bookProductivityPlannerBundled from '../../assets/images/book_productivity_planner_1791519565673.jpg';
import bookSelfCareToolkitBundled from '../../assets/images/book_self_care_toolkit_1791519580325.jpg';
import heroBannerBundled from '../../assets/images/fatima_hero_banner_1791519534532.jpg';

function resolveBundledLandingImage(rawUrl?: string | null, fallbackUrl = ''): string {
  const cleaned = resolveStoreAssetUrl(rawUrl, fallbackUrl);
  if (!cleaned) return '';
  if (cleaned.includes('avatar_fatima_1791519592784')) return avatarFatimaBundled;
  if (cleaned.includes('book_30_day_reset_1791519551780')) return book30DayResetBundled;
  if (cleaned.includes('book_productivity_planner_1791519565673')) return bookProductivityPlannerBundled;
  if (cleaned.includes('book_self_care_toolkit_1791519580325')) return bookSelfCareToolkitBundled;
  if (cleaned.includes('fatima_hero_banner_1791519534532')) return heroBannerBundled;
  return cleaned;
}

const StoreAvatarImage: React.FC<{
  logoUrl?: string;
  ownerAvatar?: string;
  storeName: string;
  className?: string;
}> = ({ logoUrl, ownerAvatar, storeName, className = '' }) => {
  const resolvedSrc = resolveBundledLandingImage(
    logoUrl || ownerAvatar,
    INITIAL_ASSETS.avatarFatima
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    const initial = (storeName || 'D').trim().charAt(0).toUpperCase();
    return (
      <div
        aria-label={storeName}
        className={`flex items-center justify-center bg-[#F58CB7] text-[#50352F] font-candy font-bold select-none ${className}`}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={storeName}
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

const ProductCoverImage: React.FC<{
  product?: Product;
  className?: string;
}> = ({ product, className = '' }) => {
  const defaultByProductId =
    product?.id?.includes('30-day-reset')
      ? book30DayResetBundled
      : product?.id?.includes('productivity-planner') || product?.id?.includes('mindful-journal')
      ? bookProductivityPlannerBundled
      : product?.id?.includes('self-care-toolkit') || product?.id?.includes('free-habit-sheet')
      ? bookSelfCareToolkitBundled
      : '';

  const resolvedSrc = resolveBundledLandingImage(product?.image, defaultByProductId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#FFF2DF] border border-[#F2DEC4] text-[#50352F] p-3 text-center select-none ${className}`}
      >
        <div className="w-9 h-9 rounded-xl bg-[#F58CB7]/25 border border-[#F58CB7]/50 flex items-center justify-center mb-1.5">
          <BookOpen className="w-4 h-4 text-[#50352F]" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#7A5A52]">
          {product?.category || 'Digital Guide'}
        </span>
        <span className="font-candy text-xs font-bold text-[#50352F] line-clamp-1 mt-0.5 px-1">
          {product?.title || 'Creator Product'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={product?.title || 'Digital product cover'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

type LegalDocType = 'terms' | 'privacy' | 'refund' | 'commission' | 'contact';

interface LandingPageProps {
  config: StoreConfig;
  onUpdateConfig?: (partial: Partial<StoreConfig>) => Promise<void> | void;
  products: Product[];
  onNavigate: (screen: ScreenId, productId?: string) => void;
  onSelectProduct?: (product: Product) => void;
  onAddToCart?: (product: Product) => void;
  allStores?: Record<string, StoreConfig>;
  onSwitchStore?: (slugOrId: string, navigateToStorefront?: boolean) => void;
  isAuthenticated?: boolean;
  userEmail?: string | null;
  onSignIn?: () => void;
  onSignInGoogle?: () => Promise<void> | void;
  onOpenAuthModal?: (mode: AuthModalMode) => void;
  onSignOut?: () => void;
  isEditMode?: boolean;
  canManageStore?: boolean;
}

const FAQ_ITEMS = [
  {
    q: 'Is DreamStore really free to start?',
    a: 'Yes! Creating your storefront, customizing your starter theme, and publishing digital products costs Rs. 0 upfront. DreamStore only charges a 5% platform commission on verified paid sales (you keep 95%). Free lead-magnet downloads have 0% commission.',
  },
  {
    q: 'How does the 5% commission billing work?',
    a: 'As you verify buyer payments into your own JazzCash, Easypaisa, UPI, Payoneer, or bank account, DreamStore tracks your 5% commission in a transparent ledger. After every 5 verified paid sales, an invoice is generated automatically and you get 7 days to settle it.',
  },
  {
    q: 'How do buyers receive their digital files?',
    a: 'Free guides unlock immediately after checkout. For paid orders using manual wallet, Payoneer, or bank transfers, the download token remains securely locked until you confirm receipt against your statement.',
  },
  {
    q: 'What is included in DreamStore Pro?',
    a: 'DreamStore Pro (Coming Soon) adds 3 luxury themes (Rose Garden, Midnight Fairy, and Minimal Muse), the Advanced Visual Store Builder, custom section ordering, and conversion analytics. You can join the waitlist today.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  config,
  products,
  onNavigate,
  onSelectProduct,
  allStores = {},
  onSwitchStore,
  isAuthenticated = false,
  userEmail = null,
  onOpenAuthModal,
  onSignOut,
  canManageStore = false,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [previewThemeId, setPreviewThemeId] = useState<StoreThemeDefinition['id']>('blush-bloom');
  const [showExploreStoresModal, setShowExploreStoresModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [localAuthModalOpen, setLocalAuthModalOpen] = useState(false);
  const [localAuthModalMode, setLocalAuthModalMode] = useState<AuthModalMode>('signin');

  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const firstMobileLinkRef = useRef<HTMLAnchorElement | null>(null);

  const storeList = Object.values(allStores);
  const featuredProducts = products.filter((p) => p.published).slice(0, 3);
  const activePreviewTheme =
    STORE_THEMES.find((t) => t.id === previewThemeId) || STORE_THEMES[0];

  const NAV_LINKS = [
    { label: 'Themes', href: '#themes', targetId: 'themes' },
    { label: 'How It Works', href: '#how-it-works', targetId: 'how-it-works' },
    { label: 'Benefits', href: '#benefits', targetId: 'benefits' },
    { label: 'Pricing', href: '#pricing', targetId: 'pricing' },
    { label: 'FAQ', href: '#faq', targetId: 'faq' },
  ] as const;

  // Close mobile menu on Escape, manage focus, and auto-close when viewport widens to desktop (>=1024px)
  useEffect(() => {
    if (!mobileNavOpen) return;

    const focusTimer = window.setTimeout(() => {
      firstMobileLinkRef.current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileNavOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileNavOpen(false);
      }
    };

    const handlePointerDownOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        mobileMenuPanelRef.current &&
        !mobileMenuPanelRef.current.contains(target) &&
        mobileMenuButtonRef.current &&
        !mobileMenuButtonRef.current.contains(target)
      ) {
        setMobileNavOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    document.addEventListener('mousedown', handlePointerDownOutside);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousedown', handlePointerDownOutside);
    };
  }, [mobileNavOpen]);

  const handleNavSectionClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    targetId: string
  ) => {
    e.preventDefault();
    setMobileNavOpen(false);
    const el =
      document.getElementById(targetId) ||
      (targetId === 'themes' ? document.getElementById('storefront-preview') : null);
    if (el) {
      el.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      try {
        window.history.replaceState(null, '', `#${targetId}`);
      } catch {}
    }
  };

  const triggerAuthModal = (mode: AuthModalMode) => {
    setMobileNavOpen(false);
    if (onOpenAuthModal) {
      onOpenAuthModal(mode);
    } else {
      setLocalAuthModalMode(mode);
      setLocalAuthModalOpen(true);
    }
  };

  const handleSignInClick = () => {
    setMobileNavOpen(false);
    if (isAuthenticated) {
      onNavigate(canManageStore ? 'owner-dashboard' : 'checkout');
      return;
    }
    triggerAuthModal('signin');
  };

  const handleSignUpClick = () => {
    setMobileNavOpen(false);
    if (isAuthenticated) {
      onNavigate(canManageStore ? 'owner-dashboard' : 'wizard');
      return;
    }
    triggerAuthModal('signup');
  };

  const handleExploreStores = () => {
    const previewSection =
      document.getElementById('themes') || document.getElementById('storefront-preview');
    if (previewSection) {
      previewSection.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    } else {
      onNavigate('storefront');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF2DF] text-[#50352F] font-sans-body selection:bg-[#F58CB7]/40 selection:text-[#50352F] overflow-x-hidden">
      {/* 1. RESPONSIVE STICKY NAVBAR (Desktop >=1024px full bar | Tablet & Mobile <1024px compact bar + animated panel) */}
      <header
        data-testid="dreamstore-navbar"
        className="sticky top-0 z-40 bg-[#FFFDF8]/95 backdrop-blur-md border-b-2 border-[#F2DEC4] shadow-[0_6px_22px_-8px_rgba(80,53,47,0.1)]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[74px] flex items-center justify-between gap-6">
          {/* LEFT: DreamStore Logo aligned to the left (Sculpted 3D Clay Icon + Bold Wordmark) */}
          <div className="flex items-center justify-start lg:flex-1 shrink-0">
            <button
              type="button"
              data-testid="navbar-brand-logo"
              onClick={() => {
                setMobileNavOpen(false);
                window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
              }}
              className="inline-flex items-center gap-2.5 text-left cursor-pointer group shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F58CB7] rounded-2xl py-1"
            >
              <div className="relative w-10 h-10 rounded-2xl candy-btn-pink flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-[1.04]">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 left-2 w-2 h-1 rounded-full bg-white/75 rotate-[-20deg]"
                />
                <Sparkles className="w-4 h-4 text-[#50352F]" />
              </div>
              <span className="font-wordmark text-xl sm:text-2xl tracking-tight text-[#50352F] leading-none whitespace-nowrap">
                {config.landingBrand || 'DreamStore'}
              </span>
            </button>
          </div>

          {/* CENTER: Desktop Navigation Links (Flexbox with consistent gap-6 and whitespace-nowrap on all links) */}
          <nav
            aria-label="Primary Navigation"
            data-testid="desktop-navbar-links"
            className="hidden lg:flex items-center justify-center gap-6 shrink-0 text-[15px] font-bold text-[#6E4F47]"
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.targetId}
                href={link.href}
                onClick={(e) => handleNavSectionClick(e, link.targetId)}
                className="inline-flex items-center relative py-2 whitespace-nowrap text-[#6E4F47] hover:text-[#50352F] transition-colors duration-200 after:content-[''] after:absolute after:left-0 after:right-0 after:bottom-0.5 after:h-[3px] after:rounded-full after:bg-[#F58CB7] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-200"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* RIGHT (DESKTOP >=1024px): Sign In / Sign Up (or User Session) + Candy-Pink "Create My Free Store" CTA */}
          <div
            data-testid="desktop-navbar-actions"
            className="hidden lg:flex lg:flex-1 items-center justify-end gap-2.5 shrink-0"
          >
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  data-testid="desktop-nav-dashboard"
                  onClick={() => onNavigate(canManageStore ? 'owner-dashboard' : 'checkout')}
                  className="min-h-[42px] px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] cursor-pointer whitespace-nowrap"
                >
                  {canManageStore ? 'Dashboard' : 'Orders & Downloads'}
                </button>
                {onSignOut && (
                  <button
                    type="button"
                    data-testid="desktop-nav-signout"
                    onClick={onSignOut}
                    className="min-h-[42px] px-3.5 py-2 rounded-full text-xs font-bold text-[#6E4F47] hover:text-[#50352F] hover:bg-[#FFF2DF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sign Out
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="desktop-nav-signin"
                  onClick={handleSignInClick}
                  className="min-h-[42px] px-4 py-2 rounded-full candy-btn-white text-xs sm:text-sm font-extrabold text-[#50352F] cursor-pointer whitespace-nowrap"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  data-testid="desktop-nav-signup"
                  onClick={handleSignUpClick}
                  className="min-h-[42px] px-4 py-2 rounded-full candy-btn-butter text-xs sm:text-sm font-extrabold text-[#50352F] cursor-pointer whitespace-nowrap"
                >
                  Sign Up
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => onNavigate('wizard')}
              data-testid="navbar-create-store-cta"
              className="candy-btn-pink min-h-[44px] px-5 py-2.5 rounded-full text-sm font-extrabold text-[#50352F] cursor-pointer whitespace-nowrap inline-flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">Create My Free Store</span>
            </button>
          </div>

          {/* RIGHT (TABLET & MOBILE <1024px): Cute Rounded Pastel Soft 3D Clay Hamburger Menu Button */}
          <div className="flex lg:hidden items-center justify-end shrink-0">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              data-testid="mobile-menu-toggle"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="dreamstore-mobile-menu"
              className="w-11 h-11 rounded-2xl clay-icon-pink flex items-center justify-center text-[#50352F] active:scale-95 transition-all duration-200 cursor-pointer shrink-0"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* TABLET & MOBILE DROPDOWN PANEL (<1024px) */}
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.div
              ref={mobileMenuPanelRef}
              id="dreamstore-mobile-menu"
              data-testid="mobile-menu-panel"
              role="dialog"
              aria-label="Mobile Navigation Menu"
              initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="lg:hidden px-4 sm:px-6 pb-5 pt-2 bg-[#FFF2DF]/98 border-b-2 border-[#F2DEC4] shadow-[0_20px_44px_-12px_rgba(80,53,47,0.18)]"
            >
              <div className="max-w-lg mx-auto rounded-[28px] candy-card-white p-4 flex flex-col gap-2">
                <nav aria-label="Mobile Primary Navigation" className="flex flex-col gap-1.5">
                  {NAV_LINKS.map((link, index) => (
                    <a
                      key={link.targetId}
                      ref={index === 0 ? firstMobileLinkRef : undefined}
                      href={link.href}
                      data-testid={`mobile-nav-link-${link.targetId}`}
                      onClick={(e) => handleNavSectionClick(e, link.targetId)}
                      className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl text-[15px] font-bold text-[#50352F] hover:bg-[#FFF2DF] transition-colors min-h-[46px] whitespace-nowrap"
                    >
                      <span className="whitespace-nowrap">{link.label}</span>
                      <ArrowRight className="w-4 h-4 text-[#F58CB7] shrink-0" />
                    </a>
                  ))}
                </nav>

                <div className="pt-2.5 mt-2 border-t-2 border-[#F2DEC4] flex flex-col gap-2.5">
                  {isAuthenticated ? (
                    <>
                      <button
                        type="button"
                        data-testid="mobile-nav-dashboard"
                        onClick={() => {
                          setMobileNavOpen(false);
                          onNavigate(canManageStore ? 'owner-dashboard' : 'checkout');
                        }}
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl candy-btn-white text-[15px] font-bold text-[#50352F] flex items-center justify-center cursor-pointer whitespace-nowrap"
                      >
                        {canManageStore ? 'Dashboard' : 'Orders & Downloads'}
                      </button>
                      {onSignOut && (
                        <button
                          type="button"
                          data-testid="mobile-nav-signout"
                          onClick={() => {
                            setMobileNavOpen(false);
                            onSignOut();
                          }}
                          className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-[#FFF2DF] border border-[#E8D2B5] text-sm font-bold text-[#6E4F47] flex items-center justify-center cursor-pointer"
                        >
                          Sign Out
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        data-testid="mobile-nav-signin"
                        onClick={handleSignInClick}
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl candy-btn-white text-sm font-extrabold text-[#50352F] flex items-center justify-center cursor-pointer whitespace-nowrap"
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        data-testid="mobile-nav-signup"
                        onClick={handleSignUpClick}
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl candy-btn-butter text-sm font-extrabold text-[#50352F] flex items-center justify-center cursor-pointer whitespace-nowrap"
                      >
                        Sign Up Free
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid="mobile-nav-create-store-cta"
                    onClick={() => {
                      setMobileNavOpen(false);
                      onNavigate('wizard');
                    }}
                    className="w-full min-h-[48px] px-5 py-3 rounded-full candy-btn-pink text-[15px] font-extrabold text-[#50352F] flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>Create My Free Store</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1">
        {/* 2. HERO — DREAMSTORE CANDYLAND 3D CREATOR WORLD */}
        <section className="relative pt-8 pb-14 sm:pt-12 sm:pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#FFF2DF]">
          <div className="max-w-[960px] xl:max-w-5xl mx-auto">
            {/* Hero Top Composition: Balanced 2-Column 3D Creator World Showcase */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center mb-12 sm:mb-16">
              {/* LEFT COLUMN: Clean Kicker + Refined Headline + Tactile Candy CTAs */}
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                className="lg:col-span-7 text-center lg:text-left"
              >
                {/* Quiet Editorial Kicker */}
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#7A5A52] mb-3">
                  Digital Storefronts for Creators
                </p>

                {/* Hero Headline — Keep exact product message */}
                <h1
                  data-testid="hero-headline"
                  className="ds-hero-title text-[#50352F] max-w-xl mx-auto lg:mx-0 mb-4"
                >
                  Your Dream Store Starts Here.
                </h1>

                {/* Supporting Copy */}
                <p className="ds-subtitle text-[#6E4F47] max-w-lg mx-auto lg:mx-0 mb-7">
                  Create your digital store, add your ebooks, planners, or templates, and share one
                  link with your audience in minutes.
                </p>

                {/* Tactile Soft 3D Candy-Pink Primary & Warm-White Secondary CTAs */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3.5 max-w-md sm:max-w-none mx-auto lg:mx-0 mb-6">
                  <button
                    type="button"
                    onClick={() => onNavigate('wizard')}
                    data-testid="hero-primary-cta"
                    className="candy-btn-pink min-h-[52px] px-7 py-3.5 rounded-full font-extrabold text-base text-[#50352F] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-[#50352F]" />
                    <span>Create My Free Store</span>
                    <ArrowRight className="w-4 h-4 text-[#50352F]" />
                  </button>

                  <button
                    type="button"
                    onClick={handleExploreStores}
                    data-testid="hero-secondary-cta"
                    className="candy-btn-white min-h-[52px] px-6 py-3.5 rounded-full font-extrabold text-base text-[#50352F] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShoppingBag className="w-4 h-4 text-[#F58CB7]" />
                    <span>Explore Stores</span>
                  </button>
                </div>

                {/* Honest Unboxed Reassurance Line (Zero-Pill Clutter) */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-2.5 gap-y-1 text-xs sm:text-[13px] font-bold text-[#6E4F47]">
                  <span>Free to launch (Rs. 0 upfront)</span>
                  <span aria-hidden="true" className="text-[#C8A98E]">·</span>
                  <span>5% fee only on verified paid sales</span>
                  <span aria-hidden="true" className="text-[#C8A98E]">·</span>
                  <span>PKR, INR &amp; USD ready</span>
                </div>
              </motion.div>

              {/* RIGHT COLUMN: SCULPTED 3D CLAY CREATOR BOUTIQUE SCENE */}
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="lg:col-span-5 relative mx-auto w-full max-w-md lg:max-w-none"
              >
                {/* Main 3D Clay Boutique House Frame */}
                <div className="candy-card-lilac rounded-[34px] p-4 sm:p-5 relative">
                  {/* 3D Scalloped Candy Awning Roof */}
                  <div className="grid grid-cols-6 gap-1.5 mb-3 px-1" aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <div
                        key={idx}
                        className={`h-7 rounded-b-2xl rounded-t-lg border-2 ${
                          idx % 2 === 0
                            ? 'bg-[#F58CB7] border-[#FAD0E2] shadow-[inset_0_3px_4px_rgba(255,255,255,0.7),0_3px_0_#D66795]'
                            : 'bg-[#FFFDF8] border-[#F3E2CB] shadow-[inset_0_3px_4px_rgba(255,255,255,0.95),0_3px_0_#E5CEB1]'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Boutique Signboard Header */}
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F3E2CB] shadow-[0_3px_0_#E5CEB1] mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <StoreAvatarImage
                        logoUrl={config.logoUrl}
                        ownerAvatar={config.ownerAvatar}
                        storeName={config.storeName}
                        className="w-9 h-9 rounded-xl object-cover border-2 border-[#F58CB7] shrink-0"
                      />
                      <div className="min-w-0 text-left">
                        <p className="font-candy text-sm font-bold text-[#50352F] truncate">
                          {config.storeName}
                        </p>
                        <p className="text-[11px] font-bold text-[#7A5A52] truncate">
                          dreamstore.app/?store={config.storeSlug}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-extrabold text-[#50352F] shrink-0">
                      Storefront
                    </span>
                  </div>

                  {/* Sculpted 3D Product Display Window */}
                  <div className="candy-inner-bed rounded-[24px] p-3.5 space-y-3">
                    {/* Featured Product Card inside Hero Boutique */}
                    <div className="rounded-2xl bg-[#FFF2DF] border-2 border-[#F2DEC4] p-3 flex items-center gap-3.5 shadow-[0_3px_0_#EBD5B8]">
                      <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-[#F2DEC4] bg-[#FFFDF8] shrink-0">
                        <ProductCoverImage
                          product={featuredProducts[0]}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-[#7A5A52] uppercase tracking-wider">
                          {featuredProducts[0]?.category || 'Digital Guide'}
                        </p>
                        <p className="font-candy text-sm sm:text-base font-bold text-[#50352F] truncate">
                          {featuredProducts[0]?.title || 'The 30-Day Life Reset'}
                        </p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="font-candy text-sm font-bold text-[#50352F]">
                            {featuredProducts[0]
                              ? featuredProducts[0].isFree
                                ? 'Free'
                                : config.currency === 'PKR'
                                ? `Rs ${featuredProducts[0].pricePkr.toLocaleString()}`
                                : `$${featuredProducts[0].priceUsd}`
                              : 'Rs 1,000'}
                          </span>
                          <button
                            type="button"
                            onClick={() => onNavigate('storefront')}
                            className="px-3 py-1 rounded-full bg-[#F58CB7] text-[11px] font-extrabold text-[#50352F] shadow-[0_2px_0_#D1608F] cursor-pointer"
                          >
                            Preview Store →
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Clean Summary Bar inside Boutique Window */}
                    <div className="rounded-xl bg-[#FFFDF8] border border-[#F3E2CB] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-bold text-[#6E4F47]">
                      <span>6 Themes</span>
                      <span aria-hidden="true">·</span>
                      <span>PKR, INR &amp; USD</span>
                      <span aria-hidden="true">·</span>
                      <span>Instant Bio Link</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* 3. INTERACTIVE STOREFRONT PREVIEW & THEME SHOWCASE */}
            <div id="themes" className="scroll-mt-24">
              <div
                id="storefront-preview"
                className="w-full mx-auto text-left scroll-mt-24"
              >
                {/* Interactive Theme Selector above the Sculpted Clay Browser Frame */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <ClayIcon tone="pink" size="sm">
                      <Palette className="w-4 h-4 text-[#50352F]" />
                    </ClayIcon>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#6E4F47]">
                      Live Theme Preview:
                    </span>
                    <span className="font-candy text-sm font-bold text-[#50352F]">
                      {activePreviewTheme.name}
                    </span>
                    {activePreviewTheme.tier === 'pro' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#50352F] text-[#FFD47B]">
                        <Crown className="w-3 h-3" /> PRO
                      </span>
                    )}
                  </div>

                  <div
                    role="tablist"
                    aria-label="Preview Storefront Themes"
                    className="flex items-center gap-2 overflow-x-auto pb-1.5 sm:pb-0 no-scrollbar"
                  >
                    {STORE_THEMES.map((theme) => {
                      const isSelected = theme.id === activePreviewTheme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          onClick={() => setPreviewThemeId(theme.id)}
                          data-testid={`landing-theme-pill-${theme.id}`}
                          className={`min-h-[40px] px-4 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 border-2 transition-all cursor-pointer shrink-0 ${
                            isSelected
                              ? 'bg-[#50352F] text-[#FFFDF8] border-[#50352F] shadow-[0_3px_0_#38231E]'
                              : 'candy-btn-white text-[#50352F]'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/15 shrink-0"
                            style={{ backgroundColor: theme.swatches[1] }}
                          />
                          <span>{theme.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#FFD47B]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Sculpted Clay Browser Window Wrapping Live Storefront Mockup */}
                <div className="candy-card-pink rounded-[34px] p-3 sm:p-4">
                  <div
                    className={`rounded-[26px] border-2 border-[#FFFDF8] overflow-hidden transition-colors duration-200 ${activePreviewTheme.pageClass}`}
                  >
                    {/* Browser Top Bar */}
                    <div
                      className={`px-4 sm:px-6 py-3.5 border-b flex items-center justify-between gap-2 ${activePreviewTheme.headerClass}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-[#F58CB7] border border-black/10" />
                        <span className="w-3 h-3 rounded-full bg-[#FFD47B] border border-black/10" />
                        <span className="w-3 h-3 rounded-full bg-[#AFE0BE] border border-black/10" />
                      </div>
                      <div className="px-3.5 py-1 rounded-full bg-[#FFFDF8] border-2 border-[#F2DEC4] text-xs font-bold text-[#50352F] truncate max-w-[200px] sm:max-w-xs">
                        dreamstore.app/?store={config.storeSlug}
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('storefront')}
                        className="text-xs font-extrabold text-[#50352F] hover:underline flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <span>Visit Live Store</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Storefront Inside Preview */}
                    <div className="p-5 sm:p-7">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-current/10">
                        <div className="flex items-center gap-3.5">
                          <StoreAvatarImage
                            logoUrl={config.logoUrl}
                            ownerAvatar={config.ownerAvatar}
                            storeName={config.storeName}
                            className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 border-[#F58CB7] shadow-xs shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h2
                                className={`font-candy text-xl sm:text-2xl font-bold ${activePreviewTheme.titleClass}`}
                              >
                                {config.storeName}
                              </h2>
                              <span className={`text-xs font-bold ${activePreviewTheme.mutedTextClass}`}>
                                · {activePreviewTheme.name}
                              </span>
                            </div>
                            <p className={`text-xs sm:text-sm mt-0.5 ${activePreviewTheme.mutedTextClass}`}>
                              {config.heroSubheading}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate('storefront')}
                          className={`ds-btn-interactive min-h-[44px] px-5 py-2.5 rounded-full text-xs sm:text-sm font-extrabold shrink-0 cursor-pointer ${activePreviewTheme.buttonClass}`}
                        >
                          Browse Storefront
                        </button>
                      </div>

                      {/* Featured Product Cards inside Preview */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {featuredProducts.map((product) => (
                          <div
                            key={product.id}
                            onClick={() => {
                              if (onSelectProduct) {
                                onSelectProduct(product);
                              } else {
                                onNavigate('product-detail', product.id);
                              }
                            }}
                            className={`ds-card-interactive group rounded-2xl border p-3.5 transition-all cursor-pointer flex flex-col justify-between ${activePreviewTheme.cardClass}`}
                          >
                            <div>
                              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#FFF2DF] mb-3">
                                <ProductCoverImage
                                  product={product}
                                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                                />
                              </div>
                              <span
                                className={`text-xs font-extrabold uppercase tracking-wider ${activePreviewTheme.accentTextClass}`}
                              >
                                {product.category}
                              </span>
                              <h3
                                className={`font-candy text-sm font-bold mt-0.5 line-clamp-1 ${activePreviewTheme.titleClass}`}
                              >
                                {product.title}
                              </h3>
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-current/10">
                              <span className={`text-sm font-extrabold ${activePreviewTheme.titleClass}`}>
                                {product.isFree
                                  ? 'Free'
                                  : config.currency === 'PKR'
                                  ? `Rs ${product.pricePkr.toLocaleString()}`
                                  : `$${product.priceUsd}`}
                              </span>
                              <span
                                className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform ${activePreviewTheme.accentTextClass}`}
                              >
                                View →
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Switch Live Sample Stores Bar */}
                      {storeList.length > 1 && onSwitchStore && (
                        <div className="mt-6 pt-4 border-t border-current/10 flex flex-wrap items-center justify-between gap-2">
                          <span className={`text-xs font-bold ${activePreviewTheme.mutedTextClass}`}>
                            Explore live creator storefronts:
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            {storeList.map((s) => (
                              <button
                                key={s.storeId}
                                type="button"
                                onClick={() => onSwitchStore(s.storeSlug, true)}
                                className="min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-bold candy-btn-white cursor-pointer"
                              >
                                {s.storeName} ({s.currency})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. HOW IT WORKS — 3 SCULPTED CANDY CLAY STEPS */}
        <section
          id="how-it-works"
          className="py-16 sm:py-22 px-4 sm:px-6 lg:px-8 bg-[#FFFDF8] border-y-2 border-[#F2DEC4]"
        >
          <div className="max-w-5xl mx-auto">
            <div className="text-center max-w-xl mx-auto mb-12">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full ds-pill-3d mb-3">
                <CandySparkleStar color="#F58CB7" size={14} />
                <span className="text-xs font-extrabold uppercase tracking-widest text-[#50352F]">
                  How It Works
                </span>
              </div>
              <h2 className="ds-editorial-title text-[#50352F] mt-1">
                Launch Your Store in Three Simple Steps
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  step: '01',
                  tone: 'pink' as const,
                  icon: Palette,
                  title: 'Create Your Store & Pick a Theme',
                  desc: 'Choose your custom store link, upload your avatar or logo, and pick from dreamy starter themes like Blush Princess or Lavender Dreams.',
                },
                {
                  step: '02',
                  tone: 'lilac' as const,
                  icon: Upload,
                  title: 'Upload Your Digital Products',
                  desc: 'Add your PDF ebooks, planners, templates, or guides with pricing in PKR, INR, USD, or local currency.',
                },
                {
                  step: '03',
                  tone: 'mint' as const,
                  icon: Share2,
                  title: 'Share Your Link & Get Paid',
                  desc: 'Put your store link in your Instagram or TikTok bio. Buyers pay you directly and receive protected digital downloads.',
                },
              ].map((item) => {
                const StepIcon = item.icon;
                return (
                  <CandyFeatureCard
                    key={item.step}
                    tone={item.tone}
                    badgeText={`Step ${item.step}`}
                    icon={<StepIcon className="w-5 h-5 text-[#50352F]" />}
                    title={item.title}
                    description={item.desc}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {/* 5. KEY BENEFITS — 4 SCULPTED 3D CLAYMORPHIC PASTEL CARDS */}
        <section id="benefits" className="py-16 sm:py-22 px-4 sm:px-6 lg:px-8 bg-[#FFF2DF]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center max-w-xl mx-auto mb-12">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full ds-pill-3d mb-3">
                <CandySparkleStar color="#FFD47B" size={14} />
                <span className="text-xs font-extrabold uppercase tracking-widest text-[#50352F]">
                  Why Creators Love DreamStore
                </span>
              </div>
              <h2 className="ds-editorial-title text-[#50352F] mt-1">
                Everything You Need, Nothing You Don&apos;t
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-7">
              <CandyFeatureCard
                tone="pink"
                badgeText="Keep 95%"
                icon={<Heart className="w-5 h-5 text-[#50352F]" />}
                title="Keep 95% of Verified Sales"
                description="No monthly fees to launch. DreamStore charges a transparent 5% commission only on verified sales, invoiced every 5 sales with a 7-day payment window."
              />

              <CandyFeatureCard
                tone="lilac"
                badgeText="Protected Files"
                icon={<Lock className="w-5 h-5 text-[#50352F]" />}
                title="Protected Digital Delivery"
                description="Free guides unlock immediately after checkout. For manual wallet or bank transfers, downloads stay safely locked until you confirm receipt."
              />

              <CandyFeatureCard
                tone="mint"
                badgeText="PKR · INR · USD"
                icon={<ShieldCheck className="w-5 h-5 text-[#50352F]" />}
                title="Local & Global Payments"
                description="Accept JazzCash, Easypaisa, UPI, Payoneer, or Bank Transfer with built-in multi-currency pricing in PKR, INR, USD, GBP, and AED."
              />

              <CandyFeatureCard
                tone="butter"
                badgeText="Bio-Link Ready"
                icon={<Sparkles className="w-5 h-5 text-[#50352F]" />}
                title="1-Click Creator Boutique"
                description="Designed for Instagram, TikTok, and Pinterest creators. Share one cute link where fans can browse, checkout, and download on any phone."
              />
            </div>
          </div>
        </section>

        {/* 6. CANONICAL PRICING SECTION — SQUISHY PRICING (Free Rs. 0 vs DreamStore Pro Coming Soon) */}
        <SquishyPricing
          onStartFreeStore={() => onNavigate('wizard')}
          onExploreStores={handleExploreStores}
          defaultWaitlistEmail={userEmail || ''}
        />

        {/* 7. FAQ */}
        <section
          id="faq"
          className="py-16 sm:py-22 px-4 sm:px-6 lg:px-8 bg-[#FFFDF8] border-t-2 border-[#F2DEC4]"
        >
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full ds-pill-3d mb-3">
                <CandySparkleStar color="#AFE0BE" size={14} />
                <span className="text-xs font-extrabold uppercase tracking-widest text-[#50352F]">
                  Questions &amp; Answers
                </span>
              </div>
              <h2 className="ds-editorial-title text-[#50352F] mt-1">
                Frequently Asked Questions
              </h2>
            </div>

            <div className="space-y-3.5">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div
                    key={item.q}
                    className="candy-card-white rounded-[24px] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      className="w-full min-h-[56px] px-5 py-4 text-left flex items-center justify-between gap-4 font-candy font-bold text-[#50352F] text-base cursor-pointer"
                    >
                      <span>{item.q}</span>
                      <span className="w-8 h-8 rounded-xl bg-[#FFF2DF] border border-[#F2DEC4] flex items-center justify-center shrink-0">
                        <ChevronDown
                          className={`w-4 h-4 text-[#50352F] shrink-0 transition-transform duration-200 ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 text-sm text-[#6E4F47] font-medium leading-relaxed border-t-2 border-[#F2DEC4]/70 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* 8. FOOTER */}
      <footer className="bg-[#FFF2DF] border-t-2 border-[#F2DEC4] py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl candy-btn-pink flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-[#50352F]" />
            </div>
            <span className="font-wordmark text-lg text-[#50352F]">
              {config.landingBrand || 'DreamStore'}
            </span>
            <span className="text-xs font-medium text-[#7A5A52]">
              © {new Date().getFullYear()} DreamStore. All rights reserved.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-bold text-[#6E4F47]">
            <button
              type="button"
              onClick={() => onNavigate('storefront')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Explore Stores
            </button>
            <button
              type="button"
              onClick={() => onNavigate('wizard')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Create Store
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('privacy')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('terms')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('refund')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Refund &amp; Dispute Policy
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('commission')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              5% Commission Policy
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('contact')}
              className="hover:text-[#50352F] cursor-pointer"
            >
              Contact &amp; Support
            </button>
          </div>
        </div>
      </footer>

      {legalDoc && (
        <div
          className="fixed inset-0 z-50 bg-[#50352F]/45 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLegalDoc(null)}
        >
          <div
            data-testid={`legal-modal-${legalDoc}`}
            className="candy-card-white rounded-3xl p-6 sm:p-8 max-w-xl w-full max-h-[88vh] overflow-y-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b-2 border-[#F2DEC4] pb-3">
              <h3 className="font-candy text-2xl font-bold text-[#50352F]">
                {legalDoc === 'terms'
                  ? 'Terms of Service'
                  : legalDoc === 'privacy'
                  ? 'Privacy Policy'
                  : legalDoc === 'refund'
                  ? 'Refund & Dispute Policy'
                  : legalDoc === 'commission'
                  ? '5% Platform Commission Policy'
                  : 'Contact & Support'}
              </h3>
              <button
                type="button"
                onClick={() => setLegalDoc(null)}
                className="px-3.5 py-1.5 rounded-xl candy-btn-white text-xs font-extrabold text-[#50352F] cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="text-sm text-[#6E4F47] font-medium space-y-3 leading-relaxed">
              {legalDoc === 'terms' && (
                <>
                  <p>
                    <strong>1. Platform Role &amp; Seller-Managed Payments:</strong> DreamStore provides digital storefront software for independent creators. DreamStore is not a bank, money transmitter, or escrow agent. Buyers send payments directly to the seller&apos;s designated bank or mobile wallet account (e.g., Bank Transfer/IBAN, Raast, JazzCash, Easypaisa, or India UPI) and submit their transaction reference for seller verification.
                  </p>
                  <p>
                    <strong>2. Digital Fulfillment:</strong> Paid digital files remain locked in Pending status until the seller verifies actual payment receipt against their bank or wallet statement. Submitting a screenshot or reference number never automatically unlocks a paid file.
                  </p>
                  <p>
                    <strong>3. Prohibited Content:</strong> Sellers must own the rights to all uploaded digital files and may not list unlawful, infringing, or deceptive products.
                  </p>
                  <p className="text-xs bg-[#FFF2DF] p-3 rounded-xl border border-[#E8D2B5]">
                    <strong>Owner / Legal Entity Notice (Manual Review Required):</strong> Governing law, official business registration details, and registered mailing address must be completed by the platform owner prior to commercial launch.
                  </p>
                </>
              )}
              {legalDoc === 'privacy' && (
                <>
                  <p>
                    <strong>1. Data Collected:</strong> DreamStore collects Firebase Authentication profile identifiers (UID, email, display name) for sellers and buyers, store configuration metadata, order records, and buyer-submitted payment transaction references.
                  </p>
                  <p>
                    <strong>2. Strict Tenant Isolation:</strong> Private seller payment settings, customer order lists, and protected digital deliverables are isolated per seller account via Firebase Authentication and Firestore/Storage security rules. Public storefront documents never expose private seller email addresses or customer PII.
                  </p>
                  <p>
                    <strong>3. Data Usage:</strong> Buyer contact information and payment references are shared only with the specific store seller from whom the buyer purchased, strictly for payment verification, download delivery, and order support.
                  </p>
                  <p className="text-xs bg-[#FFF2DF] p-3 rounded-xl border border-[#E8D2B5]">
                    <strong>Data Controller Details (Manual Review Required):</strong> Insert the platform owner&apos;s designated privacy contact email and jurisdiction before public release.
                  </p>
                </>
              )}
              {legalDoc === 'refund' && (
                <>
                  <p>
                    <strong>1. Direct Seller Settlement:</strong> Because buyer payments are sent directly to the seller&apos;s bank or mobile wallet account, refund requests are handled directly between the buyer and the store seller.
                  </p>
                  <p>
                    <strong>2. Unverified or Rejected Payments:</strong> If a buyer submits an invalid or unverified transaction reference, the seller may mark the order as Failed/Rejected and no digital download entitlement is granted.
                  </p>
                  <p>
                    <strong>3. Refunded Orders &amp; Commission Reversal:</strong> When a seller or platform administrator marks an order as Refunded or Disputed, the download token is revoked and any associated 5% platform commission is automatically reversed or adjusted on the seller&apos;s invoice.
                  </p>
                </>
              )}
              {legalDoc === 'commission' && (
                <>
                  <p>
                    <strong>1. 95% Creator / 5% Platform Split:</strong> Starting a store on DreamStore is free (Rs. 0 / $0 monthly fee). Sellers receive 100% of buyer payments directly into their bank or wallet and retain 95% of verified sales.
                  </p>
                  <p>
                    <strong>2. Eligible Verified Sales Only:</strong> The 5% platform commission applies only to paid orders that have been verified as Paid. Free products ($0), Pending orders, Failed/Rejected references, and Refunded orders incur zero commission.
                  </p>
                  <p>
                    <strong>3. Settlement Invoices &amp; Buyer Protection:</strong> After every 5 verified paid sales, DreamStore generates a 5% commission settlement invoice with a 7-day payment window. Unpaid seller commissions never block buyers from purchasing existing products or downloading previously verified files, and sellers without a usable commission payment method in their region are not penalized.
                  </p>
                </>
              )}
              {legalDoc === 'contact' && (
                <>
                  <p>
                    <strong>Platform &amp; Seller Support:</strong> For questions regarding store setup, order verification, commission invoices, or account access, please reach out through our support channels below.
                  </p>
                  <div className="p-3.5 rounded-2xl bg-[#FFF2DF] border border-[#E8D2B5] space-y-1.5 text-xs">
                    <p>
                      <strong>Buyer Order Assistance:</strong> Contact the seller directly using the store handle listed on the storefront header or your order confirmation screen.
                    </p>
                    <p>
                      <strong>Platform Support Email (Manual Review Required):</strong> Platform owner must configure the live support email address and business contact details prior to launch.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showExploreStoresModal && (
        <div
          className="fixed inset-0 z-50 bg-[#50352F]/40 flex items-center justify-center p-4"
          onClick={() => setShowExploreStoresModal(false)}
        >
          <div
            className="candy-card-white rounded-3xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-candy text-xl font-bold text-[#50352F] mb-3">
              Explore Creator Stores
            </h3>
            <div className="space-y-2">
              {storeList.map((s) => (
                <button
                  key={s.storeId}
                  type="button"
                  onClick={() => {
                    setShowExploreStoresModal(false);
                    if (onSwitchStore) onSwitchStore(s.storeSlug, true);
                  }}
                  className="w-full p-3 rounded-xl border-2 border-[#F2DEC4] hover:bg-[#FFF2DF] text-left flex items-center justify-between cursor-pointer"
                >
                  <span className="font-bold text-sm text-[#50352F]">{s.storeName}</span>
                  <span className="text-xs text-[#50352F] font-extrabold">Visit →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!onOpenAuthModal && (
        <CandylandAuthModal
          isOpen={localAuthModalOpen}
          initialMode={localAuthModalMode}
          onClose={() => setLocalAuthModalOpen(false)}
          brandName={config.landingBrand || 'DreamStore'}
        />
      )}
    </div>
  );
};
