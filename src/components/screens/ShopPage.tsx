import React, { useState } from 'react';
import { Search, User, Download, ShoppingBag, ChevronDown, Menu, X } from 'lucide-react';
import {
  CURRENCY_META,
  CurrencyCode,
  Product,
  resolveStoreTheme,
  ScreenId,
  StoreConfig,
} from '../../types/dreamstore';
import { EditableText, PastelImage } from '../EditableText';
import {
  DreamDashboardModule,
  DreamProductCard,
  DreamStaggerGrid,
  DreamStoreLogo,
} from '../ui/DreamUI';

interface ShopPageProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  products: Product[];
  onUpdateProduct: (productId: string, partial: Partial<Product>) => void;
  cartCount: number;
  onAddToCart: (product: Product) => void;
  onBuyNow?: (product: Product) => void;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isEditMode: boolean;
  canManageStore?: boolean;
}

const CATEGORIES: Array<'All Products' | Product['category']> = [
  'All Products',
  'Ebooks',
  'Workbooks',
  'Planners',
  'Templates',
  'Bundles',
];

export const ShopPage: React.FC<ShopPageProps> = ({
  config,
  onUpdateConfig,
  products,
  onUpdateProduct,
  cartCount,
  onAddToCart,
  onBuyNow,
  onNavigate,
  isEditMode,
  canManageStore = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<(typeof CATEGORIES)[number]>('All Products');
  const [maxPriceUsd, setMaxPriceUsd] = useState<number>(100);
  const [sortBy, setSortBy] = useState<'newest' | 'price-asc' | 'price-desc'>('newest');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const rate = config.exchangeRatePkr || 278;
  const resolvedTheme = resolveStoreTheme(config.theme, config.customAccentColor);
  const effectiveEditMode = Boolean(canManageStore && isEditMode);

  const filteredProducts = products
    .filter((prod) => prod.published)
    .filter((prod) => {
      const matchesCategory =
        selectedCategory === 'All Products' || prod.category === selectedCategory;
      const matchesSearch =
        prod.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prod.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPrice = prod.priceUsd <= maxPriceUsd;
      return matchesCategory && matchesSearch && matchesPrice;
    })
    .sort((a, b) => {
      if (sortBy === 'price-asc') return a.priceUsd - b.priceUsd;
      if (sortBy === 'price-desc') return b.priceUsd - a.priceUsd;
      return 0;
    });

  return (
    <div
      data-testid="public-shop-root"
      data-theme={resolvedTheme.id}
      className={`min-h-screen overflow-x-hidden transition-colors duration-200 ${resolvedTheme.pageClass}`}
    >
      {/* Sticky Storefront Header */}
      <header
        className={`sticky top-0 z-30 backdrop-blur-md border-b ${resolvedTheme.headerClass}`}
      >
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 lg:px-10 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <PastelImage
              src={config.logoUrl}
              alt={config.storeName}
              className={`w-10 h-10 rounded-full object-cover border-2 shrink-0 ${resolvedTheme.dividerClass}`}
            />
            <button
              type="button"
              onClick={() => onNavigate('storefront')}
              className={`${resolvedTheme.headingFontClass} text-2xl sm:text-[26px] font-bold truncate cursor-pointer ${resolvedTheme.titleClass}`}
            >
              <EditableText
                value={config.storeName}
                onChange={(val) => onUpdateConfig({ storeName: val })}
                isEditMode={effectiveEditMode}
                canEdit={canManageStore}
              />
            </button>
          </div>

          <nav
            aria-label="Shop Navigation"
            className={`hidden md:flex items-center gap-8 text-[15px] font-medium ${resolvedTheme.mutedTextClass}`}
          >
            <button
              type="button"
              onClick={() => onNavigate('storefront')}
              className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('shop')}
              className={`font-semibold border-b-2 py-1 whitespace-nowrap cursor-pointer ${resolvedTheme.accentTextClass} ${resolvedTheme.dividerClass}`}
            >
              Shop
            </button>
            <button
              type="button"
              data-testid="shop-orders-downloads-nav"
              onClick={() => onNavigate('checkout')}
              className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
            >
              Orders &amp; Downloads
            </button>
            {canManageStore && (
              <button
                type="button"
                data-testid="shop-seller-dashboard-nav"
                onClick={() => onNavigate('owner-dashboard')}
                className={`hover:${resolvedTheme.titleClass} transition-colors py-1 whitespace-nowrap cursor-pointer`}
              >
                Seller Dashboard
              </button>
            )}
          </nav>

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
              onClick={() => {
                const el = document.getElementById('shop-search-input');
                el?.focus();
              }}
              aria-label="Focus Search"
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
              data-testid="shop-cart-btn"
              onClick={() => onNavigate('checkout')}
              aria-label="Shopping Bag"
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span
                key={cartCount}
                data-testid="shop-cart-count"
                className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums animate-candy-cart-pop ${resolvedTheme.buttonClass}`}
              >
                {cartCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle Shop Menu"
              className={`md:hidden w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

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
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] ${resolvedTheme.titleClass}`}
            >
              Storefront Home
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onNavigate('checkout');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] ${resolvedTheme.titleClass}`}
            >
              Checkout Bag ({cartCount})
            </button>
          </div>
        )}
      </header>

      {/* Main Two-Column Shop Layout */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-8 lg:px-10 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
        {/* Left Sidebar Filters */}
        <DreamDashboardModule
          y={16}
          className={`lg:col-span-3 rounded-[24px] border p-6 shadow-2xs space-y-7 self-start ${resolvedTheme.cardClass}`}
        >
          <div className="space-y-2">
            <label
              htmlFor="shop-search-input"
              className={`block text-xs font-bold uppercase tracking-wider ${resolvedTheme.titleClass}`}
            >
              Search Catalog
            </label>
            <div className="relative">
              <Search
                className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 ${resolvedTheme.mutedTextClass}`}
              />
              <input
                id="shop-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search digital products..."
                className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl border text-sm focus:outline-none ${resolvedTheme.mutedSurfaceClass}`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${resolvedTheme.titleClass}`}>
              Categories
            </h3>
            <div className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              {CATEGORIES.map((category) => {
                const isActive = selectedCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className={`text-left px-3.5 py-2.5 rounded-xl text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer border ${
                      isActive
                        ? `${resolvedTheme.accentBadgeClass} font-bold`
                        : `border-transparent ${resolvedTheme.mutedTextClass} hover:${resolvedTheme.titleClass}`
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-bold uppercase tracking-wider ${resolvedTheme.titleClass}`}>
                Max Price Filter
              </h3>
              <span className={`text-xs font-bold tabular-nums ${resolvedTheme.accentTextClass}`}>
                {config.currency === 'PKR'
                  ? `Rs ${(maxPriceUsd * rate).toLocaleString()}`
                  : `$${maxPriceUsd}`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={maxPriceUsd}
              onChange={(e) => setMaxPriceUsd(Number(e.target.value))}
              aria-label="Maximum Price Range"
              className="w-full dream-slider"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="shop-sort-select"
              className={`block text-xs font-bold uppercase tracking-wider ${resolvedTheme.titleClass}`}
            >
              Sort By
            </label>
            <div className="relative">
              <select
                id="shop-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className={`w-full appearance-none px-3.5 py-2.5 pr-9 rounded-xl border text-sm focus:outline-none cursor-pointer ${resolvedTheme.mutedSurfaceClass}`}
              >
                <option value="newest">Featured & Newest</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
              <ChevronDown
                className={`w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${resolvedTheme.mutedTextClass}`}
              />
            </div>
          </div>
        </DreamDashboardModule>

        {/* Right Product Catalog Grid */}
        <section className="lg:col-span-9">
          <div className="flex items-baseline justify-between mb-6">
            <div>
              <p className={`text-xs font-bold uppercase tracking-wider ${resolvedTheme.accentTextClass}`}>
                {config.storeName} Digital Shop
              </p>
              <h1 className={`text-2xl sm:text-3xl font-extrabold mt-0.5 ${resolvedTheme.titleClass}`}>
                {selectedCategory}
              </h1>
            </div>
            <span className={`text-xs sm:text-sm font-medium tabular-nums ${resolvedTheme.mutedTextClass}`}>
              {filteredProducts.length}{' '}
              {filteredProducts.length === 1 ? 'digital item' : 'digital items'}
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div
              className={`rounded-[24px] border p-12 text-center space-y-4 shadow-2xs ${resolvedTheme.cardClass}`}
            >
              <p className={`text-xl font-bold ${resolvedTheme.titleClass}`}>
                No digital products match your current filter
              </p>
              <p className={`text-sm ${resolvedTheme.mutedTextClass}`}>
                Try clearing your search query or expanding the price range slider.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('All Products');
                  setSearchQuery('');
                  setMaxPriceUsd(100);
                }}
                className={`px-5 py-2.5 rounded-full text-[15px] font-semibold min-h-[44px] cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <DreamStaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProducts.map((prod, idx) => (
                <DreamProductCard
                  key={prod.id}
                  index={idx}
                  product={prod}
                  sellerName={config.storeName}
                  currency={config.currency}
                  exchangeRatePkr={rate}
                  theme={config.theme}
                  customAccentColor={config.customAccentColor}
                  isEditMode={effectiveEditMode}
                  onUpdateProduct={canManageStore ? onUpdateProduct : undefined}
                  onUpdateTitle={
                    canManageStore ? (val) => onUpdateProduct(prod.id, { title: val }) : undefined
                  }
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
      </main>

      {/* Footer */}
      <footer className={`border-t py-8 px-4 sm:px-8 mt-12 ${resolvedTheme.footerClass}`}>
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
