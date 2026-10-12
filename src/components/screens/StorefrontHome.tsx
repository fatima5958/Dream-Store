import React, { useState } from 'react';
import {
  Search,
  User,
  ShoppingBag,
  ArrowRight,
  Download,
  Sparkles,
  Heart,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';
import {
  CURRENCY_META,
  CurrencyCode,
  Product,
  resolveStoreTheme,
  ScreenId,
  StoreConfig,
} from '../../types/dreamstore';
import { BlossomAccentSVG, EditableText, PastelImage } from '../EditableText';
import {
  DreamDashboardModule,
  DreamProductCard,
  DreamStaggerGrid,
  DreamStoreLogo,
} from '../ui/DreamUI';

interface StorefrontHomeProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  products: Product[];
  cartCount: number;
  onAddToCart: (product: Product) => void;
  onBuyNow?: (product: Product) => void;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isEditMode: boolean;
  canManageStore?: boolean;
}

export const StorefrontHome: React.FC<StorefrontHomeProps> = ({
  config,
  onUpdateConfig,
  products,
  cartCount,
  onAddToCart,
  onBuyNow,
  onNavigate,
  isEditMode,
  canManageStore = false,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const publishedProducts = products.filter((p) => p.published);
  const resolvedTheme = resolveStoreTheme(config.theme, config.customAccentColor);
  const effectiveEditMode = Boolean(canManageStore && isEditMode);

  return (
    <div
      data-testid="public-storefront-root"
      data-theme={resolvedTheme.id}
      className={`min-h-screen overflow-x-hidden transition-colors duration-200 ${resolvedTheme.pageClass}`}
    >
      {/* Top Announcement Strip */}
      <div
        className={`text-xs font-semibold py-2.5 px-4 text-center border-b ${resolvedTheme.announcementClass}`}
      >
        <EditableText
          value={config.announcementText}
          onChange={(val) => onUpdateConfig({ announcementText: val })}
          isEditMode={effectiveEditMode}
          canEdit={canManageStore}
        />
      </div>

      {/* Sticky Storefront Navigation Header */}
      <header
        className={`sticky top-0 z-30 backdrop-blur-md border-b ${resolvedTheme.headerClass}`}
      >
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 lg:px-10 h-20 flex items-center justify-between gap-4">
          {/* Store Logo & Brand Wordmark */}
          <div className="flex items-center gap-3 min-w-0">
            <PastelImage
              src={config.logoUrl}
              alt={config.storeName}
              className={`w-10 h-10 rounded-full object-cover border-2 shrink-0 ${resolvedTheme.dividerClass}`}
            />
            <button
              type="button"
              onClick={() => onNavigate('storefront')}
              className={`${resolvedTheme.headingFontClass} text-2xl sm:text-[26px] font-bold truncate cursor-pointer text-left ${resolvedTheme.titleClass}`}
            >
              <EditableText
                value={config.storeName}
                onChange={(val) => onUpdateConfig({ storeName: val })}
                isEditMode={effectiveEditMode}
                canEdit={canManageStore}
              />
            </button>
          </div>

          {/* Center Navigation Links (Desktop) — Buyers see Shopping, Checkout, Orders & Downloads */}
          <nav
            aria-label="Storefront Navigation"
            className={`hidden md:flex items-center gap-8 text-[15px] font-medium ${resolvedTheme.mutedTextClass}`}
          >
            <button
              type="button"
              onClick={() => onNavigate('storefront')}
              className={`font-semibold border-b-2 py-1 whitespace-nowrap cursor-pointer ${resolvedTheme.accentTextClass} ${resolvedTheme.dividerClass}`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('shop')}
              className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
            >
              Shop
            </button>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('storefront-about');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
            >
              Collection
            </button>
            <button
              type="button"
              data-testid="storefront-orders-downloads-nav"
              onClick={() => onNavigate('checkout')}
              className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
            >
              Orders &amp; Downloads
            </button>
            {canManageStore && (
              <button
                type="button"
                data-testid="storefront-seller-dashboard-nav"
                onClick={() => onNavigate('owner-dashboard')}
                className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
              >
                Seller Dashboard
              </button>
            )}
          </nav>

          {/* Right Utility Controls (9-Currency Selector, Search, Orders & Downloads, Bag, Mobile Menu) */}
          <div className={`flex items-center gap-2.5 sm:gap-3.5 shrink-0 ${resolvedTheme.titleClass}`}>
            <select
              aria-label="Select Store Currency"
              value={config.currency}
              onChange={(e) =>
                onUpdateConfig({ currency: e.target.value as CurrencyCode })
              }
              className={`px-3 py-1.5 rounded-full text-xs font-bold focus:outline-none cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
                <option key={code} value={code}>
                  {code} ({CURRENCY_META[code].symbol})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => onNavigate('shop')}
              aria-label="Search Products"
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate(canManageStore ? 'owner-dashboard' : 'checkout')}
              aria-label={canManageStore ? 'Store Owner Account' : 'My Orders & Downloads'}
              title={canManageStore ? 'Seller Dashboard' : 'My Orders & Downloads'}
              className={`hidden sm:flex w-10 h-10 rounded-full items-center justify-center transition-colors cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              {canManageStore ? <User className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            </button>

            <button
              type="button"
              data-testid="storefront-cart-btn"
              onClick={() => onNavigate('checkout')}
              aria-label="Shopping Bag & Checkout"
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span
                key={cartCount}
                data-testid="storefront-cart-count"
                className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums animate-candy-cart-pop ${resolvedTheme.buttonClass}`}
              >
                {cartCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle Store Menu"
              className={`md:hidden w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Storefront Drawer */}
        {mobileMenuOpen && (
          <div
            className={`md:hidden border-b px-5 py-4 space-y-2 animate-ds-reveal ${resolvedTheme.cardClass}`}
          >
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onNavigate('storefront');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] border ${resolvedTheme.accentBadgeClass}`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onNavigate('shop');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] ${resolvedTheme.titleClass}`}
            >
              Shop All Digital Products
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onNavigate('checkout');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] ${resolvedTheme.titleClass}`}
            >
              Checkout, Orders &amp; Downloads ({cartCount})
            </button>
            {canManageStore && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('owner-dashboard');
                }}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] ${resolvedTheme.titleClass}`}
              >
                Seller Dashboard
              </button>
            )}
          </div>
        )}
      </header>

      {/* Main Hero Banner Container */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-6">
        <DreamDashboardModule
          y={18}
          className={`relative rounded-[28px] overflow-hidden border shadow-[0_18px_42px_-12px_rgba(61,41,64,0.12)] min-h-[390px] sm:min-h-[450px] flex items-center ${resolvedTheme.mutedSurfaceClass}`}
        >
          <PastelImage
            src={config.heroImage}
            alt={`${config.storeName} Hero Banner`}
            className="absolute inset-0 w-full h-full object-cover object-center"
          />

          <div
            className={`absolute inset-0 w-full md:w-[70%] lg:w-[62%] ${resolvedTheme.heroOverlayClass}`}
          />

          <BlossomAccentSVG className="hidden sm:block absolute -left-8 -bottom-6 w-48 h-40 opacity-85" />

          <div className="relative z-10 px-6 sm:px-14 py-12 max-w-[560px] space-y-5">
            <div
              className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${resolvedTheme.accentTextClass}`}
            >
              <span>{config.storeName}</span>
              <span aria-hidden="true">·</span>
              <span>{config.sellerCountry || 'Digital Storefront'}</span>
            </div>

            <h1 className={`ds-hero-title font-extrabold ${resolvedTheme.titleClass}`}>
              <span className="block">
                <EditableText
                  value={config.heroHeadingLine1}
                  onChange={(val) => onUpdateConfig({ heroHeadingLine1: val })}
                  isEditMode={effectiveEditMode}
                  canEdit={canManageStore}
                />
              </span>
              <span
                className={`block ${resolvedTheme.headingFontClass} italic font-semibold mt-1 ${resolvedTheme.accentTextClass}`}
              >
                <EditableText
                  value={config.heroHeadingLine2}
                  onChange={(val) => onUpdateConfig({ heroHeadingLine2: val })}
                  isEditMode={effectiveEditMode}
                  canEdit={canManageStore}
                />
              </span>
            </h1>

            <div className={`text-[15px] sm:text-base leading-relaxed ${resolvedTheme.mutedTextClass}`}>
              <EditableText
                value={config.heroSubheading}
                onChange={(val) => onUpdateConfig({ heroSubheading: val })}
                isEditMode={effectiveEditMode}
                canEdit={canManageStore}
                multiline
              />
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('shop')}
                className={`px-6 py-3 rounded-full text-base font-semibold min-h-[48px] inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer active:scale-[0.98] ${resolvedTheme.buttonClass}`}
              >
                <EditableText
                  value={config.heroButtonText}
                  onChange={(val) => onUpdateConfig({ heroButtonText: val })}
                  isEditMode={effectiveEditMode}
                  canEdit={canManageStore}
                />
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('checkout')}
                className={`px-6 py-3 rounded-full text-base font-semibold min-h-[48px] inline-flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer active:scale-[0.98] ${resolvedTheme.secondaryButtonClass}`}
              >
                <span>View Bag ({cartCount})</span>
              </button>
            </div>
          </div>
        </DreamDashboardModule>

        {/* 4-Column Trust & Value Bar Below Hero */}
        <DreamDashboardModule
          delay={0.08}
          y={14}
          className={`mt-6 rounded-[22px] border px-6 py-5 shadow-2xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 ${resolvedTheme.cardClass}`}
        >
          {[
            {
              title: 'Digital Downloads',
              subtitle: 'Instant Verified Access',
              icon: Download,
            },
            {
              title: 'Beautiful Resources',
              subtitle: 'Thoughtfully Designed',
              icon: Sparkles,
            },
            {
              title: 'Personal Growth',
              subtitle: 'One Step at a Time',
              icon: Heart,
            },
            {
              title: 'Secure Checkout',
              subtitle: 'Safe & Easy Payments',
              icon: ShieldCheck,
            },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className={`flex items-center gap-3.5 ${
                  idx > 0 ? `lg:border-l lg:pl-6 ${resolvedTheme.dividerClass}` : ''
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${resolvedTheme.accentBadgeClass}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${resolvedTheme.titleClass}`}>
                    {item.title}
                  </h3>
                  <p className={`text-xs mt-0.5 ${resolvedTheme.mutedTextClass}`}>
                    {item.subtitle}
                  </p>
                </div>
              </div>
            );
          })}
        </DreamDashboardModule>
      </section>

      {/* Featured Collection Preview using DreamProductCard */}
      <section id="storefront-about" className="max-w-[1280px] mx-auto px-4 sm:px-8 lg:px-10 py-14">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-3">
          <div>
            <p
              className={`text-xs font-bold uppercase tracking-widest ${resolvedTheme.accentTextClass}`}
            >
              Curated Digital Collection
            </p>
            <h2 className={`ds-section-title font-bold mt-1 ${resolvedTheme.titleClass}`}>
              Featured Digital Guides & Planners
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('shop')}
            className={`px-4 py-2 rounded-full text-[15px] font-semibold min-h-[44px] inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
          >
            <span>View All Products</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {publishedProducts.length === 0 ? (
          <div
            className={`rounded-[28px] border p-10 text-center space-y-4 shadow-2xs ${resolvedTheme.cardClass}`}
          >
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-[#FFE7F1] border-2 border-[#F58CB7] text-[#D66795]">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className={`text-xl font-bold ${resolvedTheme.titleClass}`}>
              New Digital Collection Coming Soon
            </h3>
            <p className={`text-sm max-w-md mx-auto ${resolvedTheme.mutedTextClass}`}>
              {canManageStore
                ? 'This storefront is live! Open your Seller Dashboard to upload and publish your first digital product.'
                : 'New digital guides, planners, and templates are being prepared for this store. Check back soon or view your existing orders and downloads.'}
            </p>
            <button
              type="button"
              onClick={() => onNavigate(canManageStore ? 'owner-dashboard' : 'checkout')}
              className={`px-6 py-3 rounded-full text-sm font-bold inline-flex items-center gap-2 cursor-pointer min-h-[44px] ${resolvedTheme.buttonClass}`}
            >
              <span>{canManageStore ? 'Open Seller Dashboard' : 'My Orders & Downloads'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <DreamStaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
            {publishedProducts.map((prod, idx) => (
              <DreamProductCard
                key={prod.id}
                index={idx}
                product={prod}
                sellerName={config.storeName}
                currency={config.currency}
                exchangeRatePkr={config.exchangeRatePkr}
                theme={config.theme}
                customAccentColor={config.customAccentColor}
                isEditMode={effectiveEditMode}
                onSelect={(id) => onNavigate('product-detail', id)}
                onAddToCart={onAddToCart}
                onBuyNow={
                  onBuyNow ||
                  ((p) => {
                    onAddToCart(p);
                    onNavigate('checkout');
                  })
                }
              />
            ))}
          </DreamStaggerGrid>
        )}
      </section>

      {/* Storefront Footer powered by DreamStore */}
      <footer className={`border-t py-8 px-4 sm:px-8 ${resolvedTheme.footerClass}`}>
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className={`text-xs ${resolvedTheme.mutedTextClass}`}>
            © {new Date().getFullYear()}{' '}
            <strong className={resolvedTheme.titleClass}>{config.storeName}</strong> · Powered by
            DreamStore
          </div>
          <DreamStoreLogo
            brandText="DreamStore"
            showTagline={false}
            size="sm"
            onClick={() => onNavigate('landing')}
          />
        </div>
      </footer>
    </div>
  );
};
