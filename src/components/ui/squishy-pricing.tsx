import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Sparkles,
  Check,
  ArrowRight,
  Crown,
  Palette,
  Layout,
  BarChart3,
  X,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';

export interface SquishyPricingProps {
  onStartFreeStore: () => void;
  onExploreStores?: () => void;
  defaultWaitlistEmail?: string;
}

export const SquishyPricing: React.FC<SquishyPricingProps> = ({
  onStartFreeStore,
  defaultWaitlistEmail = '',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [showProModal, setShowProModal] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState(defaultWaitlistEmail);
  const [waitlistStoreType, setWaitlistStoreType] = useState('Planners & Digital Guides');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<'themes' | 'builder' | 'analytics'>('themes');

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = waitlistEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setWaitlistError('Please enter a valid email address so we can send your Pro invite.');
      return;
    }
    setWaitlistError(null);
    setWaitlistSubmitted(true);
    try {
      const existing = JSON.parse(localStorage.getItem('ds_pro_waitlist_v1') || '[]');
      existing.unshift({
        email: trimmed,
        interest: waitlistStoreType,
        joinedAtIso: new Date().toISOString(),
      });
      localStorage.setItem('ds_pro_waitlist_v1', JSON.stringify(existing.slice(0, 50)));
    } catch {
      // Ignore storage quota errors
    }
  };

  const cardTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#FFF2DF] border-t-2 border-[#F2DEC4] relative overflow-hidden"
    >
      {/* Decorative 3D Clay Floating Ornaments */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-10 left-8 hidden lg:block animate-candy-float"
      >
        <div className="w-10 h-10 rounded-full candy-card-butter flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-[#50352F]" />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-12 right-10 hidden lg:block animate-candy-float"
      >
        <div className="w-11 h-11 rounded-2xl candy-card-mint flex items-center justify-center rotate-12">
          <Crown className="w-5 h-5 text-[#50352F]" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full ds-pill-3d mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#F58CB7]" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
              Simple, Creator-First Plans
            </span>
          </div>
          <h2
            id="pricing-heading"
            className="ds-editorial-title text-[#50352F] tracking-tight mb-3"
          >
            Start Free Today. Grow Into Your Dream Brand.
          </h2>
          <p className="text-base text-[#6E4F47] font-medium leading-relaxed">
            Launch your digital store for Rs. 0 upfront. Our standard{' '}
            <strong className="font-extrabold text-[#50352F]">5% sales commission</strong> applies
            only when you make verified sales—completely separate from optional Pro studio tools.
          </p>
        </div>

        {/* 2-Card Candyland 3D Clay Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-7 lg:gap-8 items-stretch max-w-4xl mx-auto">
          {/* PLAN 1: FREE — Rs. 0 (Sculpted Candy Pink Clay Shell + Warm White Inner Bed) */}
          <motion.div
            whileHover={prefersReducedMotion ? undefined : 'hover'}
            transition={cardTransition}
            variants={{
              hover: { y: -5 },
            }}
            data-testid="pricing-card-free"
            className="candy-card-pink group relative flex flex-col justify-between rounded-[34px] p-4 sm:p-5 overflow-hidden transition-shadow duration-200 min-h-[500px]"
          >
            {/* Top Clay Header Strip */}
            <div className="flex items-center justify-between gap-2 px-2 pb-3.5">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-[#FFFDF8] text-[#50352F] border-2 border-[#50352F]/15 shadow-[0_3px_0_rgba(80,53,47,0.12)]">
                Starter Creator Plan
              </span>
              <span className="text-xs font-extrabold text-[#50352F] bg-[#AFE0BE] border-2 border-[#D9F3E1] px-3 py-1 rounded-full shadow-[0_3px_0_#82BF96]">
                Available Now
              </span>
            </div>

            {/* Warm White Inner Clay Bed */}
            <div className="candy-inner-bed rounded-[26px] p-5 sm:p-6 flex-1 flex flex-col justify-between relative overflow-hidden">
              {/* Sculpted 3D Clay Blob Ornament */}
              <motion.svg
                width="240"
                height="240"
                viewBox="0 0 240 240"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -bottom-12 w-48 h-48 opacity-40"
                variants={
                  prefersReducedMotion
                    ? undefined
                    : {
                        hover: { scale: 1.06 },
                      }
                }
                transition={cardTransition}
              >
                <circle cx="140" cy="140" r="80" fill="#FFD47B" fillOpacity="0.45" />
                <ellipse cx="140" cy="195" rx="64" ry="26" fill="#F58CB7" fillOpacity="0.4" />
              </motion.svg>

              <div className="relative z-10">
                <h3 className="font-candy text-2xl sm:text-3xl font-bold text-[#50352F] mb-1">
                  Free
                </h3>
                <div className="flex items-baseline gap-2 mb-3">
                  <motion.span
                    variants={
                      prefersReducedMotion
                        ? undefined
                        : {
                            hover: { scale: 1.02 },
                          }
                    }
                    transition={cardTransition}
                    className="font-candy text-3xl sm:text-4xl font-bold text-[#50352F] tracking-tight origin-left"
                  >
                    Rs. 0
                  </motion.span>
                  <span className="text-sm font-bold text-[#7A5A52]">/ forever free to launch</span>
                </div>

                <p className="text-sm sm:text-base text-[#6E4F47] font-medium mb-5 leading-relaxed">
                  Everything you need to create your storefront, publish digital products, and share
                  your link with your audience.
                </p>

                {/* Butter Yellow 3D Clay Callout for 5% Sales Commission */}
                <div className="p-4 rounded-2xl bg-[#FFF2DF] border-2 border-[#FFD47B] shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_3px_0_#E8C26B] mb-6">
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#50352F] mb-1">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#50352F] shrink-0" />
                      5% Verified Sales Commission
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-[#FFD47B] text-[#50352F]">
                      Keep 95%
                    </span>
                  </div>
                  <p className="text-xs text-[#6E4F47] font-medium leading-relaxed">
                    You pay Rs. 0 monthly. A 5% commission is billed only after every 5 verified
                    paid sales, with 7 days to settle.
                  </p>
                </div>

                <ul className="space-y-3 mb-7 text-sm font-medium text-[#50352F]">
                  {[
                    '3 Starter Themes: Blush Princess, Lavender Dreams & Vanilla Bloom',
                    'Basic store branding, logo upload & custom shareable link',
                    'Unlimited digital products & protected download links',
                    'Direct payouts via JazzCash, Easypaisa, UPI & Bank Transfer',
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#AFE0BE] border border-[#82BF96] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_2px_0_#82BF96]">
                        <Check className="w-3 h-3 text-[#50352F]" />
                      </span>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative z-10 pt-2">
                <button
                  type="button"
                  onClick={onStartFreeStore}
                  data-testid="pricing-cta-free"
                  className="candy-btn-pink w-full min-h-[50px] px-6 py-3.5 rounded-full font-extrabold text-sm sm:text-base text-[#50352F] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Create My Free Store</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* PLAN 2: DREAMSTORE PRO — Coming Soon (Sculpted Soft Lilac Clay Shell + Deep Cocoa Bed) */}
          <motion.div
            whileHover={prefersReducedMotion ? undefined : 'hover'}
            transition={cardTransition}
            variants={{
              hover: { y: -5 },
            }}
            data-testid="pricing-card-pro"
            className="candy-card-lilac group relative flex flex-col justify-between rounded-[34px] p-4 sm:p-5 overflow-hidden transition-shadow duration-200 min-h-[500px]"
          >
            {/* Top Clay Header Strip */}
            <div className="flex items-center justify-between gap-2 px-2 pb-3.5">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-[#50352F] text-[#FFD47B] border-2 border-[#6E4B43] shadow-[0_3px_0_rgba(56,35,30,0.4)]">
                <Crown className="w-3.5 h-3.5 text-[#FFD47B]" />
                Studio Upgrade
              </span>
              <span className="text-xs font-extrabold text-[#50352F] bg-[#FFD47B] border-2 border-[#FFECB8] px-3 py-1 rounded-full shadow-[0_3px_0_#E0AE48]">
                Early Access Waitlist
              </span>
            </div>

            {/* Deep Cocoa Sculpted Inner Bed */}
            <div className="candy-card-cocoa rounded-[26px] p-5 sm:p-6 flex-1 flex flex-col justify-between text-[#FFFDF8] relative overflow-hidden">
              <motion.svg
                width="240"
                height="240"
                viewBox="0 0 240 240"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -bottom-12 w-48 h-48 opacity-25"
                variants={
                  prefersReducedMotion
                    ? undefined
                    : {
                        hover: { scale: 1.06 },
                      }
                }
                transition={cardTransition}
              >
                <circle cx="140" cy="140" r="80" fill="#BBA0EA" />
                <ellipse cx="140" cy="195" rx="64" ry="26" fill="#FFD47B" />
              </motion.svg>

              <div className="relative z-10">
                <h3 className="font-candy text-2xl sm:text-3xl font-bold text-[#FFFDF8] mb-1">
                  DreamStore Pro
                </h3>
                <div className="flex items-baseline gap-2 mb-3">
                  <motion.span
                    variants={
                      prefersReducedMotion
                        ? undefined
                        : {
                            hover: { scale: 1.02 },
                          }
                    }
                    transition={cardTransition}
                    className="font-candy text-3xl sm:text-4xl font-bold text-[#FFD47B] tracking-tight origin-left"
                  >
                    Coming Soon
                  </motion.span>
                </div>

                <p className="text-sm sm:text-base text-[#F3E2CB] font-medium mb-5 leading-relaxed">
                  Designed for established digital creators who want luxury themes, deep layout
                  control, and conversion analytics.
                </p>

                {/* Separate Subscription vs 5% Commission Note */}
                <div className="p-4 rounded-2xl bg-[#3D2722] border-2 border-[#6E4B43] mb-6">
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#FFD47B] mb-1">
                    <span>Optional Studio Subscription</span>
                    <span className="text-[#AFE0BE]">No Fake Checkout</span>
                  </div>
                  <p className="text-xs text-[#E8D5BE] leading-relaxed">
                    Pro unlocks advanced design &amp; analytics tools. The standard 5% verified sales
                    commission remains separate.
                  </p>
                </div>

                <ul className="space-y-3 mb-7 text-sm font-medium text-[#FFFDF8]">
                  {[
                    '3 Premium Themes: Rose Garden, Midnight Fairy & Minimal Muse',
                    'Advanced Visual Store Builder & section arrangement',
                    'Advanced layout customization & premium storefront sections',
                    'Advanced conversion & audience analytics dashboard',
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#BBA0EA] border border-[#DFD2F8] flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3 h-3 text-[#50352F]" />
                      </span>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative z-10 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProModal(true)}
                  data-testid="pricing-cta-pro"
                  className="candy-btn-butter w-full min-h-[50px] px-6 py-3.5 rounded-full text-[#50352F] font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Crown className="w-4 h-4 text-[#50352F]" />
                  <span>Preview Pro &amp; Join Waitlist</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* PRO FEATURE PREVIEW & WAITLIST MODAL */}
      <AnimatePresence>
        {showProModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-[#50352F]/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setShowProModal(false)}
          >
            <motion.div
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              data-testid="pro-waitlist-modal"
              className="w-full max-w-lg rounded-[32px] bg-[#FFF2DF] border-2 border-[#F58CB7] shadow-xl overflow-hidden my-auto"
            >
              {/* Modal Header */}
              <div className="px-6 py-5 bg-[#50352F] text-[#FFFDF8] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl candy-btn-butter flex items-center justify-center">
                    <Crown className="w-4 h-4 text-[#50352F]" />
                  </div>
                  <div>
                    <h3 className="font-candy text-xl font-bold text-[#FFFDF8]">
                      DreamStore Pro — Interactive Preview
                    </h3>
                    <p className="text-xs text-[#FFD47B] font-semibold">
                      Coming Soon · Early Access &amp; Feature Tour
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProModal(false)}
                  aria-label="Close Pro Preview"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
                {/* Interactive Feature Preview Tabs */}
                <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F2DEC4]">
                  {[
                    { id: 'themes' as const, label: 'Pro Themes', icon: Palette },
                    { id: 'builder' as const, label: 'Visual Builder', icon: Layout },
                    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activePreviewTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActivePreviewTab(tab.id)}
                        className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#50352F] text-[#FFFDF8] shadow-2xs'
                            : 'text-[#7A5A52] hover:text-[#50352F]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Preview Content Box */}
                <div className="p-4 rounded-2xl candy-inner-bed">
                  {activePreviewTab === 'themes' && (
                    <div className="space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
                        3 Exclusive Pro Storefront Themes
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {[
                          {
                            name: 'Rose Garden',
                            desc: 'Candy rose & cocoa',
                            colors: ['#FFFDF8', '#F58CB7', '#50352F'],
                          },
                          {
                            name: 'Midnight Fairy',
                            desc: 'Deep cocoa & lilac',
                            colors: ['#50352F', '#BBA0EA', '#FFD47B'],
                          },
                          {
                            name: 'Minimal Muse',
                            desc: 'Warm cream & mint',
                            colors: ['#FFF2DF', '#AFE0BE', '#50352F'],
                          },
                        ].map((t) => (
                          <div
                            key={t.name}
                            className="p-3 rounded-xl bg-[#FFF2DF] border border-[#F2DEC4]"
                          >
                            <div className="flex items-center gap-1.5 mb-2">
                              {t.colors.map((c) => (
                                <span
                                  key={c}
                                  className="w-4 h-4 rounded-full border border-black/15"
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                            <p className="text-xs font-extrabold text-[#50352F]">{t.name}</p>
                            <p className="text-[11px] font-medium text-[#7A5A52]">{t.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activePreviewTab === 'builder' && (
                    <div className="space-y-2">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
                        Advanced Visual Store Builder
                      </p>
                      <p className="text-sm text-[#50352F] font-medium leading-relaxed">
                        Customize hero layouts, toggle custom editorial sections, and preview
                        mobile &amp; desktop layouts side-by-side before publishing.
                      </p>
                    </div>
                  )}

                  {activePreviewTab === 'analytics' && (
                    <div className="space-y-2">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
                        Conversion &amp; Traffic Insights
                      </p>
                      <p className="text-sm text-[#50352F] font-medium leading-relaxed">
                        See which Instagram or TikTok links bring the highest-converting buyers and
                        track top-performing digital bundles over time.
                      </p>
                    </div>
                  )}
                </div>

                {/* Waitlist Form */}
                {waitlistSubmitted ? (
                  <div
                    data-testid="pro-waitlist-success"
                    className="p-5 rounded-2xl bg-[#AFE0BE]/40 border-2 border-[#82BF96] text-center space-y-2 animate-ds-sparkle-once"
                  >
                    <CheckCircle2 className="w-8 h-8 text-[#50352F] mx-auto" />
                    <h4 className="font-candy text-base font-bold text-[#50352F]">
                      You&apos;re on the DreamStore Pro Priority List! ✨
                    </h4>
                    <p className="text-xs text-[#50352F] font-medium leading-relaxed">
                      We&apos;ve reserved early-access notification for{' '}
                      <span className="font-extrabold">{waitlistEmail}</span>. In the meantime, you can
                      launch and sell on the Free plan today!
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowProModal(false);
                          onStartFreeStore();
                        }}
                        className="candy-btn-pink min-h-[44px] px-5 py-2.5 rounded-full text-xs font-extrabold text-[#50352F] cursor-pointer"
                      >
                        Start With My Free Store Now
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleWaitlistSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-extrabold text-[#50352F] mb-1">
                        Your Creator Email
                      </label>
                      <input
                        type="email"
                        required
                        value={waitlistEmail}
                        onChange={(e) => setWaitlistEmail(e.target.value)}
                        placeholder="you@example.com"
                        data-testid="pro-waitlist-email"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FFFDF8] border-2 border-[#E5CEB1] text-base text-[#50352F] focus:outline-none focus:border-[#F58CB7]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-[#50352F] mb-1">
                        What do you sell (or plan to create)?
                      </label>
                      <select
                        value={waitlistStoreType}
                        onChange={(e) => setWaitlistStoreType(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FFFDF8] border-2 border-[#E5CEB1] text-base text-[#50352F] focus:outline-none focus:border-[#F58CB7]"
                      >
                        <option value="Planners & Digital Guides">Planners &amp; Digital Guides</option>
                        <option value="Ebooks & Study Notes">Ebooks &amp; Study Notes</option>
                        <option value="Notion & Canva Templates">Notion &amp; Canva Templates</option>
                        <option value="Art Prints & Creative Assets">Art Prints &amp; Creative Assets</option>
                      </select>
                    </div>

                    {waitlistError && (
                      <p className="text-xs font-bold text-[#BE123C]">{waitlistError}</p>
                    )}

                    <button
                      type="submit"
                      data-testid="pro-waitlist-submit"
                      className="candy-btn-pink w-full min-h-[48px] px-5 py-3 rounded-full text-[#50352F] font-extrabold text-sm cursor-pointer"
                    >
                      Join Pro Waitlist (Free)
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
