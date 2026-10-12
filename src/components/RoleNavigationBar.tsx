import React from 'react';
import {
  ShoppingBag,
  Store,
  Package,
  FileText,
  Download,
  User,
  Home,
  Palette,
  Settings,
  ShieldAlert,
  LogOut,
  CheckCircle2,
} from 'lucide-react';
import { ScreenId, StoreConfig } from '../types/dreamstore';

export type BuyerNavSection = 'storefronts' | 'cart' | 'orders' | 'downloads' | 'profile';
export type SellerNavSection =
  | 'overview'
  | 'my-store'
  | 'products'
  | 'orders'
  | 'appearance'
  | 'settings';

export interface RoleNavigationBarProps {
  role: 'buyer' | 'seller' | 'super_admin';
  isSuperAdminVerified: boolean;
  userName: string;
  userEmail: string;
  activeScreen: ScreenId;
  activeBuyerSection: BuyerNavSection;
  activeSellerTab: 'overview' | 'products' | 'orders' | 'appearance' | 'settings';
  cartCount: number;
  ordersCount: number;
  downloadsCount: number;
  allStores: Record<string, StoreConfig>;
  activeStoreId: string;
  onSelectBuyerSection: (section: BuyerNavSection) => void;
  onSelectSellerSection: (section: SellerNavSection) => void;
  onNavigateSuperAdmin: () => void;
  onSwitchStore: (storeId: string) => void;
  onSignOut: () => void;
}

export const RoleNavigationBar: React.FC<RoleNavigationBarProps> = ({
  role,
  isSuperAdminVerified,
  userName,
  userEmail,
  activeScreen,
  activeBuyerSection,
  activeSellerTab,
  cartCount,
  ordersCount,
  downloadsCount,
  allStores,
  activeStoreId,
  onSelectBuyerSection,
  onSelectSellerSection,
  onNavigateSuperAdmin,
  onSwitchStore,
  onSignOut,
}) => {
  const effectiveRole: 'buyer' | 'seller' | 'super_admin' =
    isSuperAdminVerified && role === 'super_admin'
      ? 'super_admin'
      : role === 'seller'
      ? 'seller'
      : 'buyer';

  const isStorefrontScreen =
    activeScreen === 'storefront' ||
    activeScreen === 'shop' ||
    activeScreen === 'product-detail';

  const storeList = Object.values(allStores);

  return (
    <div
      data-testid="role-nav-bar"
      data-role={effectiveRole}
      className="sticky top-0 z-40 w-full bg-[#FFFDF8]/95 backdrop-blur-md border-b-2 border-[#E8D2B5] shadow-[0_4px_18px_-6px_rgba(80,53,47,0.12)]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Verified Role Identity Indicator */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            data-testid={`role-badge-${effectiveRole}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border-2 whitespace-nowrap ${
              effectiveRole === 'super_admin'
                ? 'bg-[#50352F] text-[#FFD47B] border-[#50352F]'
                : effectiveRole === 'seller'
                ? 'bg-[#FFF2DF] text-[#50352F] border-[#E8D2B5]'
                : 'bg-[#FFE7F1] text-[#9E3B66] border-[#F58CB7]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {effectiveRole === 'super_admin'
                ? 'Super Admin'
                : effectiveRole === 'seller'
                ? 'Seller Workspace'
                : 'Shopper Account'}
            </span>
          </span>

          <span className="hidden md:inline-block text-xs font-bold text-[#7A5A52] truncate max-w-[200px]">
            {userName || userEmail}
          </span>
        </div>

        {/* Center: Role-Specific Navigation Items */}
        {effectiveRole === 'buyer' && (
          <nav
            aria-label="Buyer Navigation"
            data-testid="role-nav-buyer"
            className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full"
          >
            <button
              type="button"
              data-testid="buyer-nav-storefronts"
              onClick={() => onSelectBuyerSection('storefronts')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                isStorefrontScreen ||
                (activeScreen === 'checkout' && activeBuyerSection === 'storefronts')
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>Storefronts</span>
            </button>

            <button
              type="button"
              data-testid="buyer-nav-cart"
              onClick={() => onSelectBuyerSection('cart')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'checkout' && activeBuyerSection === 'cart'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span>Cart</span>
              <span className="px-1.5 py-0.2 rounded-full bg-[#FFFDF8] border border-[#50352F]/15 text-[11px] font-extrabold tabular-nums">
                {cartCount}
              </span>
            </button>

            <button
              type="button"
              data-testid="buyer-nav-orders"
              onClick={() => onSelectBuyerSection('orders')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'checkout' && activeBuyerSection === 'orders'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span>Orders</span>
              {ordersCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#FFFDF8] border border-[#50352F]/15 text-[11px] font-extrabold tabular-nums">
                  {ordersCount}
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="buyer-nav-downloads"
              onClick={() => onSelectBuyerSection('downloads')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'checkout' && activeBuyerSection === 'downloads'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Downloads</span>
              {downloadsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#E3F9ED] border border-[#8CE0B5] text-[#236B56] text-[11px] font-extrabold tabular-nums">
                  {downloadsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="buyer-nav-profile"
              onClick={() => onSelectBuyerSection('profile')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'checkout' && activeBuyerSection === 'profile'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <User className="w-3.5 h-3.5 shrink-0" />
              <span>Profile</span>
            </button>
          </nav>
        )}

        {effectiveRole === 'seller' && (
          <nav
            aria-label="Seller Navigation"
            data-testid="role-nav-seller"
            className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full"
          >
            <button
              type="button"
              data-testid="seller-nav-dashboard"
              onClick={() => onSelectSellerSection('overview')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'overview'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Home className="w-3.5 h-3.5 shrink-0" />
              <span>Dashboard</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-my-store"
              onClick={() => onSelectSellerSection('my-store')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                isStorefrontScreen
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>My Store</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-products"
              onClick={() => onSelectSellerSection('products')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'products'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Package className="w-3.5 h-3.5 shrink-0" />
              <span>Products</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-orders"
              onClick={() => onSelectSellerSection('orders')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'orders'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span>Orders</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-store-design"
              onClick={() => onSelectSellerSection('appearance')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                (activeScreen === 'owner-dashboard' && activeSellerTab === 'appearance') ||
                activeScreen === 'visual-editor'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Palette className="w-3.5 h-3.5 shrink-0" />
              <span>Store Design</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-settings"
              onClick={() => onSelectSellerSection('settings')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'settings'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span>Settings</span>
            </button>
          </nav>
        )}

        {effectiveRole === 'super_admin' && (
          <nav
            aria-label="Super Admin Navigation"
            data-testid="role-nav-super-admin"
            className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full"
          >
            <button
              type="button"
              data-testid="super-admin-nav-platform"
              onClick={onNavigateSuperAdmin}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'super-admin'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'bg-[#FFF2DF] text-[#50352F] border border-[#E8D2B5] hover:border-[#F58CB7]'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-[#D66795]" />
              <span>Platform Dashboard</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-dashboard"
              onClick={() => onSelectSellerSection('overview')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'overview'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Home className="w-3.5 h-3.5 shrink-0" />
              <span>Dashboard</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-my-store"
              onClick={() => onSelectSellerSection('my-store')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                isStorefrontScreen
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>My Store</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-products"
              onClick={() => onSelectSellerSection('products')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'products'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Package className="w-3.5 h-3.5 shrink-0" />
              <span>Products</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-orders"
              onClick={() => onSelectSellerSection('orders')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'orders'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span>Orders</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-store-design"
              onClick={() => onSelectSellerSection('appearance')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'appearance'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Palette className="w-3.5 h-3.5 shrink-0" />
              <span>Store Design</span>
            </button>

            <button
              type="button"
              data-testid="seller-nav-settings"
              onClick={() => onSelectSellerSection('settings')}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeScreen === 'owner-dashboard' && activeSellerTab === 'settings'
                  ? 'candy-btn-pink text-[#50352F]'
                  : 'text-[#50352F] hover:bg-[#FFF2DF]'
              }`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span>Settings</span>
            </button>
          </nav>
        )}

        {/* Right: Store Switcher (for Buyers browsing Storefronts) + Sign Out */}
        <div className="flex items-center gap-2 shrink-0">
          {effectiveRole === 'buyer' && storeList.length > 1 && (
            <select
              aria-label="Select Storefront"
              data-testid="buyer-storefront-switcher"
              value={activeStoreId}
              onChange={(e) => onSwitchStore(e.target.value)}
              className="px-3 py-1.5 rounded-full bg-[#FFF2DF] border border-[#E8D2B5] text-xs font-extrabold text-[#50352F] cursor-pointer min-h-[36px]"
            >
              {storeList.map((st) => (
                <option key={st.storeId} value={st.storeId}>
                  {st.storeName} ({st.currency})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            data-testid="role-nav-signout"
            onClick={onSignOut}
            className="px-3 py-1.5 rounded-full bg-[#FFF2DF] hover:bg-[#FFE7F1] border border-[#E8D2B5] text-xs font-extrabold text-[#50352F] flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[36px] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
