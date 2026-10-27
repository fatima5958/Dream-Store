import React from 'react';
import {
  Search,
  ShoppingBag,
  ArrowRight,
  ChevronLeft,
  Heart,
  FileText,
  BookOpen,
  CheckSquare,
  Plus,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  Smartphone,
} from 'lucide-react';
import { formatCurrency, Product, ScreenId, StoreConfig } from '../../types/dreamstore';
import { PastelImage } from '../EditableText';
import { CandyButton, ClayIcon, DreamStoreLogo } from '../ui/DreamUI';

interface MobileDesignsViewProps {
  config: StoreConfig;
  onUpdateConfig?: (partial: Partial<StoreConfig>) => void;
  products: Product[];
  onNavigate: (screen: ScreenId, productId?: string) => void;
  onAddToCart: (product: Product) => void;
  cartCount?: number;
  isEditMode?: boolean;
  canManageStore?: boolean;
}

export const MobileDesignsView: React.FC<MobileDesignsViewProps> = ({
  config,
  products,
  onNavigate,
  onAddToCart,
  canManageStore = false,
}) => {
  const featuredProduct: Product = products[0] || {
    id: 'p1',
    title: 'The 30-Day Life Reset Guide',
    category: 'Ebooks',
    subtitle: 'Reset your habits and daily routine',
    description: 'A step-by-step guide to resetting your habits, mindset, and daily routine.',
    whatsIncluded: ['PDF Guide (65 Pages)', 'Daily Reflection Prompts'],
    details: [
      { label: 'Format', value: 'PDF Guide' },
      { label: 'Delivery', value: 'Instant Digital Download' },
    ],
    price: 7,
    priceUsd: 7,
    pricePkr: 1999,
    isFree: false,
    published: true,
    status: 'Available',
    image: '',
    gallery: [],
    features: [],
    fileName: '30-day-reset-guide.pdf',
    fileType: 'application/pdf',
    fileSizeLabel: '4.2 MB',
  };
  const rate = config.exchangeRatePkr || 278;

  return (
    <div className="min-h-screen bg-[#FFF2DF] py-8 px-4 sm:px-8 text-[#50352F]">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-wrap items-center justify-between gap-4 candy-card-white rounded-[28px] px-6 py-4">
        <div className="flex items-center gap-3.5">
          <ClayIcon tone="pink" size="md">
            <Smartphone className="w-5 h-5" />
          </ClayIcon>
          <div>
            <span className="inline-block px-3 py-0.5 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-xs font-extrabold text-[#9E3B66] mb-1">
              Screen 8 · Mobile Responsive Designs
            </span>
            <h1 className="font-wordmark text-2xl sm:text-3xl font-extrabold text-[#50352F]">
              Candyland Mobile Storefront &amp; Seller Suite
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CandyButton variant="cream" size="sm" onClick={() => onNavigate('storefront')}>
            Open Live Storefront
          </CandyButton>
          {canManageStore ? (
            <CandyButton variant="pink" size="sm" onClick={() => onNavigate('owner-dashboard')}>
              Seller Dashboard
            </CandyButton>
          ) : (
            <CandyButton variant="pink" size="sm" onClick={() => onNavigate('checkout')}>
              Orders &amp; Downloads
            </CandyButton>
          )}
        </div>
      </div>

      {/* 4 Mobile Phone Frames Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 justify-items-center">
        {/* PHONE 1: STOREFRONT HOME (MOBILE) */}
        <div className="w-full max-w-[335px] candy-card-white rounded-[42px] p-3.5">
          <div className="w-24 h-1.5 bg-[#E8D2B5] rounded-full mx-auto mb-2.5" />

          <div className="bg-[#FFF2DF] rounded-[30px] overflow-hidden border-2 border-[#E8D2B5]">
            <div className="bg-[#FFE7F1] text-[10px] font-extrabold text-[#9E3B66] py-1.5 px-3 text-center">
              {config.announcementText}
            </div>

            <div className="px-4 py-3 flex items-center justify-between bg-[#FFFDF8] border-b border-[#E8D2B5]">
              <button
                onClick={() => onNavigate('storefront')}
                className="font-wordmark text-sm font-extrabold text-[#50352F] cursor-pointer"
              >
                {config.storeName}
              </button>
              <div className="flex items-center gap-2.5 text-[#50352F]">
                <Search className="w-3.5 h-3.5" />
                <ShoppingBag className="w-3.5 h-3.5 text-[#D66795]" />
              </div>
            </div>

            {/* Hero Card */}
            <div className="p-3.5 space-y-3.5">
              <div className="relative rounded-2xl overflow-hidden border-2 border-[#E8D2B5] bg-[#FFFDF8] p-4">
                <h2 className="font-wordmark text-lg font-extrabold leading-tight text-[#50352F]">
                  <span className="block">{config.heroHeadingLine1}</span>
                  <span className="block text-[#D66795]">{config.heroHeadingLine2}</span>
                </h2>
                <p className="text-[11px] text-[#6E4D45] mt-1 line-clamp-2">
                  {config.heroSubheading}
                </p>
                <button
                  onClick={() => onNavigate('shop')}
                  className="candy-btn-pink mt-3 px-4 py-1.5 rounded-xl text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                >
                  {config.heroButtonText} <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {/* Featured Products */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-wordmark text-xs font-extrabold text-[#50352F]">
                    Featured Downloads
                  </span>
                  <button
                    onClick={() => onNavigate('shop')}
                    className="text-[10px] font-extrabold text-[#D66795] cursor-pointer"
                  >
                    View All →
                  </button>
                </div>

                <div className="space-y-2.5">
                  {products.slice(0, 2).map((p) => (
                    <div
                      key={p.id}
                      onClick={() => onNavigate('product-detail', p.id)}
                      className="bg-[#FFFDF8] rounded-2xl p-2.5 border-2 border-[#F0DEC6] flex items-center gap-3 cursor-pointer hover:border-[#F58CB7] transition-colors"
                    >
                      <div className="w-12 h-14 rounded-xl overflow-hidden shrink-0 border border-[#F0DEC6]">
                        <PastelImage
                          src={p.image}
                          alt={p.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-xs text-[#50352F] truncate">
                          {p.title}
                        </div>
                        <div className="text-[10px] text-[#7A5A52] truncate">{p.subtitle}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-xs font-extrabold text-[#D66795]">
                            {formatCurrency(p, config.currency, rate)}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#FFE7F1] text-[#9E3B66] text-[9px] font-extrabold">
                            Instant PDF
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PHONE 2: SHOP CATALOG (MOBILE) */}
        <div className="w-full max-w-[335px] candy-card-white rounded-[42px] p-3.5">
          <div className="w-24 h-1.5 bg-[#E8D2B5] rounded-full mx-auto mb-2.5" />

          <div className="bg-[#FFF2DF] rounded-[30px] overflow-hidden border-2 border-[#E8D2B5]">
            <div className="px-4 py-3 flex items-center justify-between bg-[#FFFDF8] border-b border-[#E8D2B5]">
              <button
                onClick={() => onNavigate('storefront')}
                className="font-wordmark text-sm font-extrabold text-[#50352F] cursor-pointer"
              >
                {config.storeName}
              </button>
              <div className="flex items-center gap-2.5 text-[#50352F]">
                <Search className="w-3.5 h-3.5" />
                <ShoppingBag className="w-3.5 h-3.5 text-[#D66795]" />
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <h2 className="font-wordmark text-lg font-extrabold text-[#50352F]">Shop</h2>
                <p className="text-[10px] font-semibold text-[#7A5A52]">
                  Browse all digital resources &amp; instant downloads
                </p>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#7A5A52] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  readOnly
                  placeholder="Search products..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#FFFDF8] border-2 border-[#F0DEC6] text-[11px] font-semibold"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {['All', 'eBooks', 'Guides', 'Templates'].map((tab, i) => (
                  <span
                    key={tab}
                    className={`px-2.5 py-1 rounded-xl text-[10px] font-extrabold ${
                      i === 0
                        ? 'candy-btn-pink'
                        : 'bg-[#FFFDF8] text-[#6E4D45] border border-[#F0DEC6]'
                    }`}
                  >
                    {tab}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {products.slice(0, 4).map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onNavigate('product-detail', p.id)}
                    className="bg-[#FFFDF8] rounded-2xl p-2 border-2 border-[#F0DEC6] cursor-pointer hover:border-[#F58CB7] transition-colors"
                  >
                    <div className="relative h-20 rounded-xl overflow-hidden mb-1.5">
                      <PastelImage
                        src={p.image}
                        alt={p.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="font-extrabold text-[11px] text-[#50352F] line-clamp-1">
                      {p.title}
                    </div>
                    <div className="pt-1.5 mt-1 flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-[#D66795]">
                        {formatCurrency(p, config.currency, rate)}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-[#FFE7F1] text-[#9E3B66] text-[9px] font-extrabold">
                        Buy
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* PHONE 3: PRODUCT DETAIL PAGE (MOBILE) */}
        <div className="w-full max-w-[335px] candy-card-white rounded-[42px] p-3.5">
          <div className="w-24 h-1.5 bg-[#E8D2B5] rounded-full mx-auto mb-2.5" />

          <div className="bg-[#FFF2DF] rounded-[30px] overflow-hidden border-2 border-[#E8D2B5]">
            <div className="px-4 py-3 flex items-center justify-between bg-[#FFFDF8] border-b border-[#E8D2B5]">
              <button
                onClick={() => onNavigate('shop')}
                className="text-[#50352F] cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-wordmark text-sm font-extrabold text-[#50352F]">
                {config.storeName}
              </span>
              <Heart className="w-4 h-4 text-[#D66795]" />
            </div>

            <div className="p-4 space-y-3">
              <div className="rounded-2xl overflow-hidden h-40 border-2 border-[#F0DEC6] bg-[#FFFDF8]">
                <PastelImage
                  src={featuredProduct.image}
                  alt={featuredProduct.title}
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <span className="px-2 py-0.5 rounded-lg bg-[#FFE7F1] text-[9px] font-extrabold text-[#9E3B66] uppercase">
                  {featuredProduct.category}
                </span>
                <h2 className="font-wordmark text-base font-extrabold text-[#50352F] mt-1">
                  {featuredProduct.title}
                </h2>
                <div className="text-base font-extrabold text-[#D66795]">
                  {formatCurrency(featuredProduct, config.currency, rate)}
                </div>
              </div>

              <p className="text-[11px] text-[#6E4D45] leading-relaxed">
                {featuredProduct.description}
              </p>

              <button
                onClick={() => {
                  onAddToCart(featuredProduct);
                  onNavigate('checkout');
                }}
                className="candy-btn-pink w-full py-2.5 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Buy Now
              </button>

              <div className="pt-2 border-t border-[#E8D2B5] space-y-1.5 text-[10px] text-[#50352F]">
                <div className="font-extrabold">What’s Included</div>
                <div className="flex items-center gap-2 text-[#6E4D45] font-semibold">
                  <FileText className="w-3 h-3 text-[#D66795]" />
                  <span>PDF Guide (65 Pages)</span>
                </div>
                <div className="flex items-center gap-2 text-[#6E4D45] font-semibold">
                  <BookOpen className="w-3 h-3 text-[#D66795]" />
                  <span>Daily Reflection Prompts</span>
                </div>
                <div className="flex items-center gap-2 text-[#6E4D45] font-semibold">
                  <CheckSquare className="w-3 h-3 text-[#D66795]" />
                  <span>Printable Habit Tracker</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PHONE 4: SELLER DASHBOARD (MOBILE) — Only shown to store owners / Super Admin */}
        {canManageStore && (
          <div className="w-full max-w-[335px] candy-card-white rounded-[42px] p-3.5">
            <div className="w-24 h-1.5 bg-[#E8D2B5] rounded-full mx-auto mb-2.5" />

            <div className="bg-[#FFF2DF] rounded-[30px] overflow-hidden border-2 border-[#E8D2B5] flex flex-col justify-between">
              <div>
                <div className="px-4 py-3 flex items-center justify-between bg-[#FFFDF8] border-b border-[#E8D2B5]">
                  <DreamStoreLogo size="sm" brandName={config.landingBrand} />
                  <PastelImage
                    src={config.ownerAvatar}
                    alt={config.ownerName}
                    className="w-6 h-6 rounded-full object-cover border border-[#E8D2B5]"
                  />
                </div>

                <div className="p-4 space-y-3">
                  <h2 className="font-wordmark text-base font-extrabold text-[#50352F]">
                    Welcome back, {config.ownerName}!
                  </h2>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#FFFDF8] p-2.5 rounded-2xl border-2 border-[#F0DEC6]">
                      <div className="text-[9px] font-bold text-[#7A5A52]">Total Revenue</div>
                      <div className="text-sm font-extrabold text-[#50352F]">$3,240</div>
                    </div>
                    <div className="bg-[#FFFDF8] p-2.5 rounded-2xl border-2 border-[#F0DEC6]">
                      <div className="text-[9px] font-bold text-[#7A5A52]">Net (After 5%)</div>
                      <div className="text-sm font-extrabold text-[#236B56]">$3,078</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-wordmark text-xs font-extrabold text-[#50352F]">
                      Products
                    </span>
                    <button
                      onClick={() => onNavigate('owner-dashboard')}
                      className="candy-btn-pink px-2.5 py-1 rounded-xl text-[9px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-2.5 h-2.5" /> Add Product
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {products.slice(0, 3).map((p) => (
                      <div
                        key={p.id}
                        className="p-2 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <PastelImage
                            src={p.image}
                            alt={p.title}
                            className="w-8 h-9 rounded-lg object-cover"
                          />
                          <div>
                            <div className="text-[10px] font-extrabold text-[#50352F] line-clamp-1">
                              {p.title}
                            </div>
                            <div className="text-[9px] text-[#D66795] font-extrabold">
                              {formatCurrency(p, config.currency, rate)}
                            </div>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-lg bg-[#E6F8EC] text-[#236B56] text-[8px] font-extrabold">
                          Published
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Mobile Tab Bar */}
              <div className="bg-[#FFFDF8] border-t border-[#E8D2B5] px-4 py-2.5 grid grid-cols-4 gap-1 text-center">
                <button
                  onClick={() => onNavigate('owner-dashboard')}
                  className="flex flex-col items-center gap-0.5 text-[#D66795] cursor-pointer"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-extrabold">Dashboard</span>
                </button>
                <button
                  onClick={() => onNavigate('owner-dashboard')}
                  className="flex flex-col items-center gap-0.5 text-[#7A5A52] cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-bold">Products</span>
                </button>
                <button
                  onClick={() => onNavigate('owner-dashboard')}
                  className="flex flex-col items-center gap-0.5 text-[#7A5A52] cursor-pointer"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-bold">Orders</span>
                </button>
                <button
                  onClick={() => onNavigate('owner-dashboard')}
                  className="flex flex-col items-center gap-0.5 text-[#7A5A52] cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-bold">Settings</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
