import React, { useState } from 'react';
import {
  Heart,
  FileText,
  BookOpen,
  CheckSquare,
  ArrowLeft,
  Check,
  ShoppingBag,
  ArrowRight,
} from 'lucide-react';
import {
  CurrencyCode,
  formatCurrency,
  Product,
  resolveStoreTheme,
  ScreenId,
  StoreThemeId,
} from '../../types/dreamstore';
import { EditableText, PastelImage } from '../EditableText';
import { DreamDashboardModule, DreamFadeIn, DreamStoreLogo } from '../ui/DreamUI';

interface ProductDetailPageProps {
  product: Product;
  allProducts: Product[];
  currency: CurrencyCode;
  exchangeRatePkr: number;
  theme?: StoreThemeId;
  customAccentColor?: string;
  cartCount: number;
  onSelectProduct: (productId: string) => void;
  onUpdateProduct: (productId: string, partial: Partial<Product>) => void;
  onAddToCart: (product: Product) => void;
  onBuyNow?: (product: Product) => void;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isEditMode: boolean;
  canManageStore?: boolean;
}

export const ProductDetailPage: React.FC<ProductDetailPageProps> = ({
  product,
  allProducts,
  currency,
  exchangeRatePkr,
  theme,
  customAccentColor,
  cartCount,
  onSelectProduct,
  onUpdateProduct,
  onAddToCart,
  onBuyNow,
  onNavigate,
  isEditMode,
  canManageStore = false,
}) => {
  const [selectedImage, setSelectedImage] = useState<string>(product.image);
  const [activeTab, setActiveTab] = useState<'description' | 'included' | 'details'>('description');
  const [wishlisted, setWishlisted] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const resolvedTheme = resolveStoreTheme(theme, customAccentColor);
  const effectiveEditMode = Boolean(canManageStore && isEditMode);

  React.useEffect(() => {
    setSelectedImage(product.image);
    setJustAdded(false);
  }, [product.id, product.image]);

  return (
    <div
      data-testid="public-product-detail-root"
      data-theme={resolvedTheme.id}
      className={`min-h-screen py-8 px-4 sm:px-8 overflow-x-hidden transition-colors duration-200 ${resolvedTheme.pageClass}`}
    >
      {/* Top Breadcrumb Navigation */}
      <div className="max-w-[1180px] mx-auto mb-6 flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onNavigate('shop')}
          className={`inline-flex items-center gap-2 text-xs sm:text-sm font-semibold hover:${resolvedTheme.accentTextClass} transition-colors cursor-pointer ${resolvedTheme.mutedTextClass}`}
        >
          <ArrowLeft className="w-4 h-4" /> Back to Digital Shop
        </button>

        {/* Quick product switcher tabs & Checkout bag */}
        <div className="flex items-center gap-2.5">
          <div
            className={`hidden md:flex items-center gap-1.5 p-1 rounded-full border ${resolvedTheme.cardClass}`}
          >
            {allProducts
              .filter((p) => p.published)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProduct(p.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    p.id === product.id
                      ? `${resolvedTheme.buttonClass} shadow-2xs`
                      : `${resolvedTheme.mutedTextClass} hover:${resolvedTheme.titleClass}`
                  }`}
                >
                  {p.title}
                </button>
              ))}
          </div>

          <button
            type="button"
            data-testid="product-detail-cart-btn"
            onClick={() => onNavigate('checkout')}
            className={`px-4 py-2 rounded-full text-[15px] font-semibold min-h-[44px] inline-flex items-center justify-center gap-2 cursor-pointer ${resolvedTheme.secondaryButtonClass}`}
          >
            <ShoppingBag className={`w-3.5 h-3.5 ${resolvedTheme.accentTextClass}`} />
            <span key={cartCount} className="animate-candy-cart-pop">
              Bag ({cartCount})
            </span>
          </button>
        </div>
      </div>

      {/* Main Product Detail Card Container */}
      <DreamDashboardModule
        y={18}
        className={`max-w-[1180px] mx-auto rounded-[32px] border shadow-[0_20px_50px_-15px_rgba(61,41,64,0.12)] p-6 sm:p-10 lg:p-12 ${resolvedTheme.cardClass}`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Left Column: Main Book Cover Image + 4 Thumbnail Previews */}
          <div className="lg:col-span-6 space-y-4">
            <div
              className={`rounded-[24px] overflow-hidden aspect-[4/4.2] border shadow-xs ${resolvedTheme.mutedSurfaceClass}`}
            >
              <PastelImage
                src={selectedImage}
                alt={product.title}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="grid grid-cols-4 gap-3.5 pt-1">
              {product.gallery.map((thumbUrl, index) => {
                const isSelected = selectedImage === thumbUrl;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedImage(thumbUrl)}
                    className={`rounded-2xl overflow-hidden aspect-square border-2 transition-all cursor-pointer ${
                      isSelected
                        ? `${resolvedTheme.dividerClass} scale-[1.02] shadow-xs`
                        : `${resolvedTheme.dividerClass} opacity-75 hover:opacity-100`
                    }`}
                  >
                    <PastelImage
                      src={thumbUrl}
                      alt={`${product.title} preview ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Product Title, Category, Price, Add to Bag CTA, Tabs & Feature Highlights */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-2.5">
              {/* Unboxed Metadata Line */}
              <div
                className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${resolvedTheme.accentTextClass}`}
              >
                <span>{product.category}</span>
                <span aria-hidden="true">·</span>
                <span className={resolvedTheme.mutedTextClass}>
                  {product.isFree ? 'Free Digital Download' : 'Instant Paid Digital Product'}
                </span>
              </div>

              <h1
                className={`text-3xl sm:text-4xl font-extrabold leading-tight ${resolvedTheme.titleClass}`}
              >
                <EditableText
                  value={product.title}
                  onChange={(val) => onUpdateProduct(product.id, { title: val })}
                  isEditMode={effectiveEditMode}
                  canEdit={canManageStore}
                />
              </h1>

              <div className={`text-2xl font-extrabold tabular-nums pt-0.5 ${resolvedTheme.accentTextClass}`}>
                {formatCurrency(product, currency, exchangeRatePkr)}
              </div>

              <div className={`text-[15px] pt-1 leading-relaxed ${resolvedTheme.mutedTextClass}`}>
                <EditableText
                  value={product.subtitle}
                  onChange={(val) => onUpdateProduct(product.id, { subtitle: val })}
                  isEditMode={effectiveEditMode}
                  canEdit={canManageStore}
                />
              </div>
            </div>

            {/* Action Row: Add to Cart + Buy Now (Direct to Checkout) + Wishlist Heart */}
            <div className="flex flex-wrap items-center justify-between pt-1 pb-2 gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="add-to-cart-btn"
                  onClick={() => {
                    onAddToCart(product);
                    setJustAdded(true);
                  }}
                  className={`ds-btn-interactive px-6 py-3 rounded-full text-base font-semibold min-h-[48px] inline-flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer active:scale-[0.98] ${resolvedTheme.secondaryButtonClass}`}
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>{justAdded ? 'Added to Cart ✓' : 'Add to Cart'}</span>
                </button>

                <button
                  type="button"
                  data-testid="buy-now-btn"
                  onClick={() => {
                    if (onBuyNow) {
                      onBuyNow(product);
                    } else {
                      onAddToCart(product);
                      onNavigate('checkout');
                    }
                  }}
                  className={`ds-btn-interactive px-6 py-3 rounded-full text-base font-semibold min-h-[48px] inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer active:scale-[0.98] ${resolvedTheme.buttonClass}`}
                >
                  <span>
                    {product.isFree
                      ? 'Get Free Download Now'
                      : `Buy Now — ${formatCurrency(product, currency, exchangeRatePkr)}`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setWishlisted(!wishlisted)}
                aria-label="Save to Wishlist"
                className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  wishlisted
                    ? `${resolvedTheme.accentBadgeClass}`
                    : `${resolvedTheme.secondaryButtonClass}`
                }`}
              >
                <Heart className={`w-4 h-4 ${wishlisted ? 'fill-current' : ''}`} />
              </button>
            </div>

            {/* Tabs Navigation (Description | What's Included | Details) */}
            <div className={`border-b flex items-center gap-7 ${resolvedTheme.dividerClass}`}>
              {[
                { id: 'description', label: 'Description' },
                { id: 'included', label: "What's Included" },
                { id: 'details', label: 'File Details' },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`pb-3 text-sm font-semibold transition-colors relative cursor-pointer whitespace-nowrap ${
                      isActive
                        ? `${resolvedTheme.accentTextClass} border-b-2 ${resolvedTheme.dividerClass}`
                        : `${resolvedTheme.mutedTextClass} hover:${resolvedTheme.titleClass}`
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content Area */}
            <div className={`text-sm leading-relaxed min-h-[76px] ${resolvedTheme.titleClass}`}>
              {activeTab === 'description' && (
                <div>
                  <EditableText
                    value={product.description}
                    onChange={(val) => onUpdateProduct(product.id, { description: val })}
                    isEditMode={effectiveEditMode}
                    canEdit={canManageStore}
                    multiline
                  />
                </div>
              )}

              {activeTab === 'included' && (
                <ul className="space-y-2.5">
                  {product.whatsIncluded.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2.5">
                      <Check className={`w-4 h-4 shrink-0 ${resolvedTheme.accentTextClass}`} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              {activeTab === 'details' && (
                <div className="grid grid-cols-2 gap-3">
                  {product.details.map((detail, idx) => (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-2xl border ${resolvedTheme.mutedSurfaceClass}`}
                    >
                      <div className={`text-[11px] font-medium ${resolvedTheme.mutedTextClass}`}>
                        {detail.label}
                      </div>
                      <div className={`text-xs font-bold mt-0.5 ${resolvedTheme.titleClass}`}>
                        {detail.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3 Stacked Feature Cards */}
            <div className="space-y-3 pt-2">
              {product.features.map((feat, idx) => {
                const IconComponent =
                  feat.icon === 'pdf'
                    ? FileText
                    : feat.icon === 'guide'
                    ? BookOpen
                    : CheckSquare;
                return (
                  <DreamFadeIn
                    key={idx}
                    delay={idx * 0.06}
                    y={12}
                    className={`flex items-center gap-4 p-4 rounded-2xl border ${resolvedTheme.mutedSurfaceClass}`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${resolvedTheme.accentBadgeClass}`}
                    >
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className={`text-sm font-bold ${resolvedTheme.titleClass}`}>
                        {feat.title}
                      </h3>
                      <p className={`text-xs mt-0.5 ${resolvedTheme.mutedTextClass}`}>
                        {feat.subtitle}
                      </p>
                    </div>
                  </DreamFadeIn>
                );
              })}
            </div>
          </div>
        </div>
      </DreamDashboardModule>

      <div className="max-w-[1180px] mx-auto mt-8 flex justify-center">
        <DreamStoreLogo
          brandText="DreamStore"
          showTagline={true}
          size="sm"
          onClick={() => onNavigate('landing')}
        />
      </div>
    </div>
  );
};
