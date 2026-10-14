import React, { useState } from 'react';
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  ShieldCheck,
  Lock,
  Download,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ArrowLeft,
  CreditCard,
  Smartphone,
  Building2,
  Sparkles,
  LogIn,
  Copy,
  Check,
  User,
  Store,
  FileText,
} from 'lucide-react';
import {
  calculateCommissionMinor,
  CartItem,
  convertPriceToCurrency,
  CURRENCY_META,
  CurrencyCode,
  formatCurrency,
  formatMinorToMajor,
  GatewayServerStatus,
  getConfiguredSellerPaymentMethods,
  OrderItem,
  PaymentMethodId,
  ScreenId,
  SellerPaymentSettings,
  StoreConfig,
} from '../../types/dreamstore';
import { PastelImage } from '../EditableText';
import { CandyButton, ClayIcon, DreamStoreLogo } from '../ui/DreamUI';
import { BuyerNavSection } from '../RoleNavigationBar';

interface CheckoutAndOrdersPageProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  cart: CartItem[];
  onUpdateCartQuantity: (productId: string, delta: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onClearCart: () => void;
  orders: OrderItem[];
  currentUserUid: string | null;
  currentUserName?: string | null;
  currentUserEmail: string | null;
  onSignInGoogle: () => Promise<void>;
  gatewayStatus: GatewayServerStatus;
  sellerPaymentSettings: SellerPaymentSettings;
  onPlaceOrder: (params: {
    customerName: string;
    customerEmail: string;
    currency: CurrencyCode;
    paymentMethod: PaymentMethodId;
    paymentReference: string;
    buyerUid?: string;
  }) => Promise<OrderItem | null>;
  onDownloadOrderFile: (order: OrderItem) => Promise<{ ok: boolean; message: string }>;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  activeBuyerSection?: BuyerNavSection;
  onSelectBuyerSection?: (section: BuyerNavSection) => void;
  onUpdateBuyerProfile?: (displayName: string, email: string) => Promise<void>;
  allStores?: Record<string, StoreConfig>;
  onSwitchStore?: (storeId: string) => void;
}

export const CheckoutAndOrdersPage: React.FC<CheckoutAndOrdersPageProps> = ({
  config,
  onUpdateConfig,
  cart,
  onUpdateCartQuantity,
  onRemoveFromCart,
  orders,
  currentUserUid,
  currentUserName,
  currentUserEmail,
  onSignInGoogle,
  gatewayStatus,
  sellerPaymentSettings,
  onPlaceOrder,
  onDownloadOrderFile,
  onNavigate,
  activeBuyerSection = 'cart',
  onSelectBuyerSection,
  onUpdateBuyerProfile,
  allStores = {},
  onSwitchStore,
}) => {
  const [customerName, setCustomerName] = useState(
    currentUserName || (currentUserEmail ? currentUserEmail.split('@')[0] : '')
  );
  const [customerEmail, setCustomerEmail] = useState(currentUserEmail || '');
  const [profileSavedToast, setProfileSavedToast] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  React.useEffect(() => {
    if (currentUserName) {
      setCustomerName((prev) => prev.trim() || currentUserName);
    } else if (currentUserEmail) {
      setCustomerName((prev) => prev.trim() || currentUserEmail.split('@')[0]);
    }
    if (currentUserEmail) {
      setCustomerEmail(currentUserEmail);
    }
  }, [currentUserName, currentUserEmail]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethodId>(() => {
      if (
        sellerPaymentSettings?.storeId &&
        config.storeId &&
        sellerPaymentSettings.storeId !== config.storeId
      ) {
        return 'jazzcash';
      }
      const initialMethods = getConfiguredSellerPaymentMethods(
        sellerPaymentSettings,
        gatewayStatus
      );
      return initialMethods[0] || 'jazzcash';
    });
  const [paymentReference, setPaymentReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<OrderItem | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [copyToastMessage, setCopyToastMessage] = useState<string | null>(null);
  const urlBuyerUid = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('buyerUid') || '';
    } catch {
      return '';
    }
  }, []);

  const [sandboxBuyerEnabled, setSandboxBuyerEnabled] = useState(() => import.meta.env.DEV && Boolean(urlBuyerUid));
  const [downloadFeedback, setDownloadFeedback] = useState<{
    orderId: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const effectiveBuyerUid =
    currentUserUid ||
    (import.meta.env.DEV ? (urlBuyerUid || (sandboxBuyerEnabled ? 'sandbox-test-buyer-uid' : null)) : null);

  // Real-time synchronized view of the buyer's most recently placed order
  const liveCompletedOrder = completedOrder
    ? orders.find(
        (o) => o.id === completedOrder.id || o.orderNumber === completedOrder.orderNumber
      ) || completedOrder
    : null;

  const cleanWhatsappPhone = (sellerPaymentSettings.whatsappNotificationNumber || '').replace(
    /[^0-9]/g,
    ''
  );
  const whatsappLinkEnabled =
    (sellerPaymentSettings.whatsappNotificationsEnabled ?? true) &&
    cleanWhatsappPhone.length >= 7;

  const buildSafeWhatsappHref = (ord: OrderItem) => {
    const safeText = `Hi ${config.storeName || 'Seller'}, I submitted Order #${ord.orderNumber} (${ord.amount} ${ord.currency} via ${ord.paymentMethod.toUpperCase()}) with Transaction Ref: ${ord.paymentReference}. Please review in your DreamStore Seller Dashboard.`;
    return `https://wa.me/${cleanWhatsappPhone}?text=${encodeURIComponent(safeText)}`;
  };

  React.useEffect(() => {
    if (currentUserEmail && customerEmail !== currentUserEmail) {
      setCustomerEmail(currentUserEmail);
    }
  }, [currentUserEmail, customerEmail]);

  const currency = config.currency;
  const rate = config.exchangeRatePkr || 278;

  // Calculate unified cart total in selected currency (never mixing currencies)
  const cartTotal = cart.reduce((sum, item) => {
    const unitPrice = convertPriceToCurrency(item.product, currency, rate);
    return sum + unitPrice * item.quantity;
  }, 0);
  const cartTotalFormatted =
    cartTotal === 0
      ? 'Free ($0.00)'
      : formatMinorToMajor(Math.round(cartTotal * 100), currency);
  const commissionPreview = calculateCommissionMinor(
    cartTotal,
    currency,
    gatewayStatus.platformCommissionBps || 500,
    selectedPaymentMethod
  );

  const isFreeCart = cart.length > 0 && cartTotal === 0;

  // Enforce strict store isolation: never use payment settings belonging to another storeId
  const isolatedStorePaymentSettings = React.useMemo<Partial<SellerPaymentSettings> | null>(() => {
    if (!sellerPaymentSettings) return null;
    if (
      sellerPaymentSettings.storeId &&
      config.storeId &&
      sellerPaymentSettings.storeId !== config.storeId
    ) {
      return null;
    }
    return sellerPaymentSettings;
  }, [sellerPaymentSettings, config.storeId]);

  const configuredPaymentMethods = React.useMemo(
    () => getConfiguredSellerPaymentMethods(isolatedStorePaymentSettings, gatewayStatus),
    [isolatedStorePaymentSettings, gatewayStatus]
  );

  const isPaidCheckoutGloballyEnabled = gatewayStatus.paidCheckoutEnabled === true;
  const isPaidCheckoutConfigured = isPaidCheckoutGloballyEnabled && configuredPaymentMethods.length > 0;

  React.useEffect(() => {
    if (isFreeCart) {
      setSelectedPaymentMethod('free_instant');
    } else if (configuredPaymentMethods.length > 0) {
      if (!configuredPaymentMethods.includes(selectedPaymentMethod)) {
        setSelectedPaymentMethod(configuredPaymentMethods[0]);
      }
    }
  }, [isFreeCart, configuredPaymentMethods, selectedPaymentMethod]);

  const handleCopyAccount = async (text: string) => {
    const cleanText = (text || '').trim();
    if (!cleanText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cleanText);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      try {
        const tempInput = document.createElement('textarea');
        tempInput.value = cleanText;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      } catch {
        // Ignore clipboard fallback error
      }
    }
    setCopiedAccount(true);
    setCopyToastMessage('Payment details copied to clipboard!');
    setTimeout(() => {
      setCopiedAccount(false);
      setCopyToastMessage(null);
    }, 3000);
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);

    if (!effectiveBuyerUid) {
      setCheckoutError('Please sign in to save your digital order and access your downloads.');
      return;
    }

    if (cart.length === 0) {
      setCheckoutError('Your shopping bag is empty.');
      return;
    }

    if (!isFreeCart && !isPaidCheckoutGloballyEnabled) {
      setCheckoutError('Paid checkout is not yet available during DreamStore beta testing. Please do not transfer money for this order.');
      return;
    }
    if (!isFreeCart && !isPaidCheckoutConfigured) {
      setCheckoutError('Seller payment setup is incomplete. Paid checkout is unavailable for this store.');
      return;
    }

    if (!customerName.trim() || !customerEmail.trim()) {
      setCheckoutError('Please enter your name and email address for order confirmation.');
      return;
    }

    if (!isFreeCart && !paymentReference.trim()) {
      setCheckoutError(
        'Please enter your payment transaction reference / wallet mobile number for verification.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await onPlaceOrder({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        currency,
        paymentMethod: isFreeCart ? 'free_instant' : selectedPaymentMethod,
        paymentReference: isFreeCart
          ? 'FREE-INSTANT-VERIFIED'
          : paymentReference.trim(),
        buyerUid: effectiveBuyerUid,
      });
      if (created) {
        setCompletedOrder(created);
        setPaymentReference('');
      }
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : 'Checkout failed. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTriggerDownload = async (order: OrderItem) => {
    setDownloadFeedback(null);
    const result = await onDownloadOrderFile(order);
    setDownloadFeedback({
      orderId: order.id,
      ok: result.ok,
      message: result.message,
    });
  };

  const customerOrders = orders.filter(
    (o) =>
      (currentUserUid && o.buyerId === currentUserUid) ||
      (completedOrder && o.orderNumber === completedOrder.orderNumber)
  );
  const unlockedDownloads = customerOrders.filter((o) => o.paymentStatus === 'Paid');

  const handleSaveBuyerProfileForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerEmail.trim()) return;
    setIsSavingProfile(true);
    setProfileSavedToast(null);
    try {
      await onUpdateBuyerProfile?.(customerName.trim(), customerEmail.trim());
      setProfileSavedToast('Buyer profile saved!');
      setTimeout(() => setProfileSavedToast(null), 3000);
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF2DF] py-6 sm:py-10 px-4 sm:px-8 text-[#50352F]">
      {/* Top Bar */}
      <div className="max-w-[1220px] mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 candy-card-white rounded-[28px] px-5 py-3.5">
        <div className="flex items-center gap-4">
          <DreamStoreLogo
            size="sm"
            brandName={config.storeName || config.landingBrand}
            onClick={() => onNavigate('storefront')}
          />
          <button
            onClick={() => onNavigate('shop')}
            className="candy-btn-cream inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer min-h-[40px]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Continue Shopping</span>
          </button>
        </div>

        {/* Currency Switcher & Security Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#FFF2DF] border-2 border-[#E8D2B5] rounded-2xl p-1">
            {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onUpdateConfig({ currency: code })}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer min-h-[34px] ${
                  currency === code
                    ? 'candy-btn-pink'
                    : 'text-[#7A5A52] hover:text-[#50352F]'
                }`}
              >
                {code} ({CURRENCY_META[code].symbol.trim()})
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E6F8EC] border-2 border-[#AFE0BE] text-[#236B56] text-xs font-extrabold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Direct Creator Checkout</span>
          </div>
        </div>
      </div>

      {/* Buyer Profile Section (shown when Profile is selected in Buyer Navigation) */}
      {activeBuyerSection === 'profile' && (
        <div
          data-testid="buyer-profile-section"
          className="max-w-[1220px] mx-auto mb-8 candy-card-white rounded-[32px] p-6 sm:p-8 border-2 border-[#F58CB7]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3.5">
              <ClayIcon tone="pink" size="md">
                <User className="w-5 h-5" />
              </ClayIcon>
              <div>
                <h2 className="ds-section-title font-extrabold text-[#50352F]">
                  Buyer Profile &amp; Delivery Preferences
                </h2>
                <p className="ds-helper">
                  Your name and email are prefilled automatically at checkout for instant digital delivery.
                </p>
              </div>
            </div>
            <span className="px-3.5 py-1.5 rounded-full bg-[#FFE7F1] border-2 border-[#F58CB7] text-xs font-extrabold text-[#9E3B66]">
              Verified Role: Buyer
            </span>
          </div>

          <form onSubmit={handleSaveBuyerProfileForm} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="ds-label block mb-1.5 text-sm font-extrabold text-[#50352F]">
                Your Full Name
              </label>
              <input
                type="text"
                required
                data-testid="buyer-profile-name-input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 rounded-2xl candy-input text-sm font-bold text-[#50352F] min-h-[48px]"
              />
            </div>
            <div>
              <label className="ds-label block mb-1.5 text-sm font-extrabold text-[#50352F]">
                Delivery Email Address
              </label>
              <input
                type="email"
                required
                data-testid="buyer-profile-email-input"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-2xl candy-input text-sm font-bold text-[#50352F] min-h-[48px]"
              />
            </div>
            <div className="flex items-center gap-3">
              <CandyButton
                type="submit"
                variant="pink"
                size="md"
                loading={isSavingProfile}
                data-testid="buyer-profile-save-btn"
                className="w-full min-h-[48px]"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Buyer Profile</span>
              </CandyButton>
            </div>
          </form>

          {profileSavedToast && (
            <div
              data-testid="buyer-profile-saved-toast"
              className="mt-4 p-3.5 rounded-2xl bg-[#E6F8EC] border-2 border-[#AFE0BE] text-xs font-extrabold text-[#236B56] flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{profileSavedToast}</span>
            </div>
          )}

          <div className="mt-6 pt-5 border-t-2 border-[#F3E2CB] grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-[#FFF2DF]/70 border border-[#E8D2B5]">
              <div className="text-xs font-bold text-[#7A5A52]">Items in Bag</div>
              <div className="text-xl font-extrabold text-[#50352F] mt-0.5 tabular-nums">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FFF2DF]/70 border border-[#E8D2B5]">
              <div className="text-xs font-bold text-[#7A5A52]">Total Orders Placed</div>
              <div className="text-xl font-extrabold text-[#50352F] mt-0.5 tabular-nums">
                {customerOrders.length}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#E6F8EC]/80 border border-[#AFE0BE]">
              <div className="text-xs font-bold text-[#236B56]">Unlocked Digital Downloads</div>
              <div className="text-xl font-extrabold text-[#236B56] mt-0.5 tabular-nums">
                {unlockedDownloads.length}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="max-w-[1220px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        {/* LEFT COLUMN: Cart + Payment Checkout Form */}
        <div data-testid="buyer-cart-section" className="lg:col-span-7 space-y-6">
          {/* Shopping Bag Card */}
          <div className="candy-card-white rounded-[32px] p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3.5">
                <ClayIcon tone="pink" size="md">
                  <ShoppingBag className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="ds-section-title font-extrabold text-[#50352F]">
                    Your Digital Bag
                  </h2>
                  <p className="ds-helper">
                    All prices calculated in {CURRENCY_META[currency].name} ({currency})
                  </p>
                </div>
              </div>
              <span className="px-3.5 py-1.5 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-xs font-extrabold text-[#9E3B66]">
                {cart.reduce((sum, i) => sum + i.quantity, 0)} Items
              </span>
            </div>

            {cart.length === 0 ? (
              <div className="py-10 text-center rounded-[24px] bg-[#FFF2DF]/65 border-2 border-dashed border-[#E8D2B5]">
                <div className="flex justify-center mb-3">
                  <ClayIcon tone="lilac" size="lg">
                    <ShoppingBag className="w-6 h-6" />
                  </ClayIcon>
                </div>
                <p className="text-base font-extrabold text-[#50352F] mb-1">
                  Your shopping bag is currently empty
                </p>
                <p className="ds-helper mb-5">
                  Browse our digital ebooks, workbooks, and templates to get started.
                </p>
                <CandyButton
                  variant="pink"
                  size="sm"
                  onClick={() => onNavigate('shop')}
                >
                  <span>Browse Digital Catalog</span>
                </CandyButton>
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map((item) => {
                  const unitPrice = convertPriceToCurrency(item.product, currency, rate);
                  const lineTotal = unitPrice * item.quantity;
                  return (
                    <div
                      key={item.product.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-20 rounded-2xl overflow-hidden bg-[#FFFDF8] border-2 border-[#F0DEC6] shrink-0">
                          <PastelImage
                            src={item.product.image}
                            alt={item.product.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-[#FFFDF8] border border-[#E8D2B5] text-[10px] font-extrabold text-[#D66795] mb-1">
                            {item.product.category}
                          </span>
                          <h4 className="font-extrabold text-[#50352F] text-sm sm:text-base">
                            {item.product.title}
                          </h4>
                          <p className="text-xs text-[#7A5A52] font-semibold">
                            Digital File: {item.product.fileName || 'Verified PDF Download'} (
                            {item.product.fileSizeLabel || '4.2 MB'})
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#F0DEC6]">
                        <div className="flex items-center gap-1.5 bg-[#FFFDF8] rounded-xl border-2 border-[#E8D2B5] px-2 py-1">
                          <button
                            type="button"
                            onClick={() => onUpdateCartQuantity(item.product.id, -1)}
                            className="w-7 h-7 rounded-lg hover:bg-[#FFE7F1] flex items-center justify-center text-[#50352F] cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-extrabold w-5 text-center text-[#50352F]">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateCartQuantity(item.product.id, 1)}
                            className="w-7 h-7 rounded-lg hover:bg-[#FFE7F1] flex items-center justify-center text-[#50352F] cursor-pointer"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="text-right min-w-[90px]">
                          <div className="font-extrabold text-[#50352F] text-sm tabular-nums">
                            {lineTotal === 0
                              ? 'Free'
                              : formatMinorToMajor(Math.round(lineTotal * 100), currency)}
                          </div>
                          {item.quantity > 1 && lineTotal > 0 && (
                            <div className="text-[10px] font-bold text-[#7A5A52]">
                              {formatMinorToMajor(Math.round(unitPrice * 100), currency)} each
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => onRemoveFromCart(item.product.id)}
                          className="p-2 rounded-xl text-[#9E3B66] hover:bg-[#FFE7F1] transition-colors cursor-pointer"
                          title="Remove from bag"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Checkout & Payment Section (Candyland Theme) */}
          <form
            onSubmit={handleCheckoutSubmit}
            className="candy-card-white rounded-[32px] p-6 sm:p-8 lg:p-9 space-y-6 relative"
          >
            {/* Floating / Inline Success Toast for Copy Payment Details */}
            {copyToastMessage && (
              <div
                data-testid="copy-payment-toast"
                role="status"
                aria-live="polite"
                className="p-3.5 px-4 rounded-2xl bg-[#E6F8EC] border-2 border-[#AFE0BE] text-[#1E563B] text-sm font-extrabold flex items-center justify-between gap-3 shadow-md animate-ds-reveal"
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#236B56] shrink-0" />
                  <span>{copyToastMessage}</span>
                </div>
                <span className="text-xs font-bold text-[#236B56]">Ready to paste</span>
              </div>
            )}

            {/* Section Header */}
            <div className="flex items-start sm:items-center justify-between gap-4 border-b-2 border-[#F3E2CB] pb-5">
              <div className="flex items-center gap-3.5">
                <ClayIcon tone="pink" size="md">
                  <CreditCard className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="font-candy text-xl sm:text-2xl font-bold text-[#50352F]">
                    Checkout &amp; Payment Verification
                  </h2>
                  <p className="ds-body text-[#7A5A52] text-sm mt-0.5">
                    Send payment directly to the creator and enter your transaction reference below.
                  </p>
                </div>
              </div>
              <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-2xl bg-[#FFF2DF] border-2 border-[#F0DEC6] shrink-0">
                <Lock className="w-4 h-4 text-[#D66795]" />
              </div>
            </div>

            {/* Sign-In or Sandbox Buyer Notice */}
            {!effectiveBuyerUid && (
              <div className="p-4 sm:p-5 rounded-[24px] bg-[#FFE7F1]/80 border-2 border-[#F58CB7] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-sm text-[#50352F] leading-relaxed">
                  <strong className="block text-[#9E3B66] font-extrabold mb-0.5">
                    Sign In Required for Digital Delivery
                  </strong>
                  Sign in to keep your orders and secure download links in your account.
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      data-testid="enable-sandbox-buyer-btn"
                      onClick={() => {
                        setSandboxBuyerEnabled(true);
                        if (!customerName) setCustomerName('Test Buyer');
                        if (!customerEmail) setCustomerEmail('buyer@example.test');
                      }}
                      className="candy-btn-cream px-4 py-2.5 rounded-2xl text-xs font-extrabold cursor-pointer min-h-[42px]"
                    >
                      Developer Sandbox Buyer
                    </button>
                  )}
                  <CandyButton
                    type="button"
                    variant="pink"
                    size="sm"
                    onClick={onSignInGoogle}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Sign In with Google</span>
                  </CandyButton>
                </div>
              </div>
            )}

            {/* Step 1: Soft Cream Buyer Delivery Details Card */}
            <div className="p-5 sm:p-6 rounded-[26px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] space-y-4">
              <div>
                <h3 className="font-candy text-base sm:text-lg font-bold text-[#50352F]">
                  1. Buyer Delivery Details
                </h3>
                <p className="ds-helper mt-0.5">
                  Where should we send your order confirmation and verified download link?
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="w-full min-w-0">
                  <label htmlFor="checkout-customer-name" className="ds-label block mb-1.5">
                    Full Name <span className="text-[#D66795]">*</span>
                  </label>
                  <input
                    id="checkout-customer-name"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full block min-w-0 px-4 py-3 rounded-2xl candy-input text-base min-h-[50px]"
                  />
                </div>
                <div className="w-full min-w-0">
                  <label htmlFor="checkout-customer-email" className="ds-label block mb-1.5">
                    Delivery Email <span className="text-[#D66795]">*</span>
                  </label>
                  <input
                    id="checkout-customer-email"
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    readOnly={Boolean(currentUserEmail)}
                    aria-describedby={currentUserEmail ? 'checkout-verified-email-help' : undefined}
                    placeholder="you@email.com"
                    className="w-full block min-w-0 px-4 py-3 rounded-2xl candy-input text-base min-h-[50px]"
                  />
                  {currentUserEmail && (
                    <p id="checkout-verified-email-help" className="ds-helper mt-1">
                      Downloads are tied to your signed-in account email.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Payment Method Selector */}
            <div className="space-y-3">
              <div>
                <h3 className="font-candy text-base sm:text-lg font-bold text-[#50352F]">
                  2. Choose Payment Method ({currency})
                </h3>
                <p className="ds-helper mt-0.5">
                  Select a receiving wallet or bank account configured by {config.storeName}.
                </p>
              </div>

              {isFreeCart ? (
                <div className="p-4 sm:p-5 rounded-[24px] bg-[#E6F8EC] border-2 border-[#AFE0BE] text-[#236B56] text-sm font-extrabold flex items-center gap-3">
                  <Sparkles className="w-5 h-5 shrink-0" />
                  <span>
                    100% Free Digital Product ($0.00) — Instant Verified Download Enabled!
                  </span>
                </div>
              ) : !isPaidCheckoutGloballyEnabled ? (
                <div
                  data-testid="checkout-beta-payments-disabled"
                  className="p-5 sm:p-6 rounded-[26px] bg-[#FFF6DA] border-2 border-[#FFD47B] text-[#50352F] space-y-2.5"
                >
                  <div className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-[#8A5A19]">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#D66795]" />
                    <span>Paid Orders Coming Soon — Beta Testing</span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-[#6E4D45] leading-relaxed">
                    Please do not send a payment yet. DreamStore is testing secure order verification.
                    Free downloads and browsing remain available.
                  </p>
                </div>
              ) : !isPaidCheckoutConfigured ? (
                <div
                  data-testid="checkout-payment-setup-required"
                  className="p-5 sm:p-6 rounded-[26px] bg-[#FFF6DA] border-2 border-[#FFD47B] text-[#50352F] space-y-2.5"
                >
                  <div className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-[#8A5A19]">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#D66795]" />
                    <span>Paid Checkout Disabled — Seller Payment Setup Required</span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-[#6E4D45] leading-relaxed">
                    {isolatedStorePaymentSettings?.setupMessage ||
                      'Paid checkout is disabled for this store until the seller configures valid payment receiving details (JazzCash, Easypaisa, UPI, or Bank Transfer) in Seller Dashboard → Payment Settings.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* JazzCash — only rendered if configured by this store's seller */}
                  {configuredPaymentMethods.includes('jazzcash') && (
                    <button
                      type="button"
                      data-testid="payment-method-jazzcash"
                      onClick={() => setSelectedPaymentMethod('jazzcash')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'jazzcash'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-[#D66795] shrink-0" />
                          <span>JazzCash Wallet</span>
                        </span>
                        <span className="text-xs font-bold text-[#8A5A19]">
                          Manual Verification
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Send PKR to Seller JazzCash &amp; enter TID reference
                      </p>
                    </button>
                  )}

                  {/* Easypaisa — only rendered if configured by this store's seller */}
                  {configuredPaymentMethods.includes('easypaisa') && (
                    <button
                      type="button"
                      data-testid="payment-method-easypaisa"
                      onClick={() => setSelectedPaymentMethod('easypaisa')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'easypaisa'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-[#236B56] shrink-0" />
                          <span>Easypaisa Wallet</span>
                        </span>
                        <span className="text-xs font-bold text-[#8A5A19]">
                          Manual Verification
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Send PKR to Seller Easypaisa &amp; enter TID reference
                      </p>
                    </button>
                  )}

                  {/* India UPI — only rendered if configured by this store's seller */}
                  {configuredPaymentMethods.includes('upi_india') && (
                    <button
                      type="button"
                      data-testid="payment-method-upi"
                      onClick={() => setSelectedPaymentMethod('upi_india')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'upi_india'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-[#6B4EA2] shrink-0" />
                          <span>India UPI (GPay / PhonePe)</span>
                        </span>
                        <span className="text-xs font-bold text-[#8A5A19]">
                          Manual UTR
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Pay Seller UPI ID &amp; enter 12-digit UTR number
                      </p>
                    </button>
                  )}

                  {/* Bank Transfer — only rendered if configured by this store's seller */}
                  {configuredPaymentMethods.includes('manual_bank') && (
                    <button
                      type="button"
                      data-testid="payment-method-bank"
                      onClick={() => setSelectedPaymentMethod('manual_bank')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'manual_bank'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-[#D66795] shrink-0" />
                          <span>Bank Transfer / IBAN</span>
                        </span>
                        <span className="text-xs font-bold text-[#8A5A19]">
                          Manual Verification
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Direct bank transfer · Seller verifies before unlock
                      </p>
                    </button>
                  )}

                  {/* Payoneer Global Payment Service / Request-a-Payment */}
                  {configuredPaymentMethods.includes('payoneer') && (
                    <button
                      type="button"
                      data-testid="payment-method-payoneer"
                      onClick={() => setSelectedPaymentMethod('payoneer')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'payoneer'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-[#D66795] shrink-0" />
                          <span>Payoneer Global</span>
                        </span>
                        <span className="text-xs font-bold text-[#8A5A19]">
                          Manual Verification
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Payoneer Request Link or Global Receiving Account (USD/EUR/GBP)
                      </p>
                    </button>
                  )}

                  {/* Stripe Card — ONLY shown as selectable when live keys & seller account exist */}
                  {configuredPaymentMethods.includes('stripe_card') && (
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMethod('stripe_card')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'stripe_card'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-[#D66795] shrink-0" />
                          <span>International Card (Stripe)</span>
                        </span>
                        <span className="text-xs font-bold text-[#236B56]">
                          Webhook
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Visa / Mastercard · Unlocks on signed webhook
                      </p>
                    </button>
                  )}

                  {/* Razorpay India — ONLY shown when live keys & seller link exist */}
                  {configuredPaymentMethods.includes('razorpay_inr') && (
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMethod('razorpay_inr')}
                      className={`w-full p-4 sm:p-5 rounded-[24px] border-2 text-left transition-all cursor-pointer ${
                        selectedPaymentMethod === 'razorpay_inr'
                          ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_10px_22px_-6px_rgba(245,140,183,0.38)]'
                          : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-base text-[#50352F] flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-[#6B4EA2] shrink-0" />
                          <span>Razorpay India Gateway</span>
                        </span>
                        <span className="text-xs font-bold text-[#236B56]">
                          Webhook
                        </span>
                      </div>
                      <p className="ds-helper text-xs sm:text-sm">
                        Automated India Cards &amp; NetBanking
                      </p>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Step 3: Soft Cream Seller Payment Account Card & Full-Width Transaction Reference Input */}
            {!isFreeCart && isPaidCheckoutConfigured && isolatedStorePaymentSettings && (
              <div
                data-testid="checkout-seller-payment-box"
                className="p-5 sm:p-6 rounded-[28px] bg-[#FFF2DF]/80 border-2 border-[#F0DEC6] space-y-5"
              >
                {/* Header + Raised Pink Copy Payment Details Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-candy text-base sm:text-lg font-bold text-[#50352F]">
                      3. Send <span className="text-[#D66795] tabular-nums">{cartTotalFormatted}</span> to Seller Account
                    </h3>
                    <p className="ds-helper mt-0.5">
                      Copy the payment details below and transfer the exact order amount.
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid="copy-payment-details-btn"
                    onClick={() => {
                      const targetText =
                        selectedPaymentMethod === 'jazzcash'
                          ? isolatedStorePaymentSettings.jazzCashMerchantId || ''
                          : selectedPaymentMethod === 'easypaisa'
                          ? isolatedStorePaymentSettings.easypaisaStoreId || ''
                          : selectedPaymentMethod === 'upi_india'
                          ? isolatedStorePaymentSettings.upiId || ''
                          : selectedPaymentMethod === 'payoneer'
                          ? isolatedStorePaymentSettings.payoneerReceivingEmail ||
                            isolatedStorePaymentSettings.payoneerReceivingAccountDetails ||
                            ''
                          : isolatedStorePaymentSettings.bankTransferInstructions || '';
                      handleCopyAccount(targetText);
                    }}
                    className="candy-btn-pink inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold text-[#50352F] cursor-pointer min-h-[44px] shrink-0"
                  >
                    {copiedAccount ? (
                      <>
                        <Check className="w-4 h-4 text-[#50352F]" />
                        <span>Copied Payment Details ✓</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-[#50352F]" />
                        <span>Copy Payment Details</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Soft Cream Account Display Box */}
                <div
                  data-testid="checkout-seller-payment-instructions-text"
                  className="w-full text-sm sm:text-base font-extrabold text-[#50352F] bg-[#FFFDF8] p-4 sm:p-5 rounded-2xl border-2 border-[#E8D2B5] font-mono break-words shadow-inner"
                >
                  {selectedPaymentMethod === 'jazzcash' &&
                    `JazzCash Account: ${isolatedStorePaymentSettings.jazzCashMerchantId}`}
                  {selectedPaymentMethod === 'easypaisa' &&
                    `Easypaisa Account: ${isolatedStorePaymentSettings.easypaisaStoreId}`}
                  {selectedPaymentMethod === 'upi_india' &&
                    `UPI ID (GPay / PhonePe / Paytm): ${isolatedStorePaymentSettings.upiId}`}
                  {selectedPaymentMethod === 'manual_bank' &&
                    isolatedStorePaymentSettings.bankTransferInstructions}
                  {selectedPaymentMethod === 'payoneer' && (
                    <div className="space-y-1.5 font-sans">
                      {isolatedStorePaymentSettings.payoneerReceivingEmail && (
                        <div className="font-mono font-extrabold text-[#50352F]">
                          Payoneer Email: {isolatedStorePaymentSettings.payoneerReceivingEmail}
                        </div>
                      )}
                      {isolatedStorePaymentSettings.payoneerReceivingAccountDetails && (
                        <div className="text-xs sm:text-sm text-[#6E4D45]">
                          {isolatedStorePaymentSettings.payoneerReceivingAccountDetails}
                        </div>
                      )}
                      {isolatedStorePaymentSettings.payoneerRequestLink && (
                        <div className="pt-1">
                          <a
                            href={isolatedStorePaymentSettings.payoneerRequestLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs sm:text-sm font-extrabold text-[#D66795] underline"
                          >
                            Open Seller Payoneer Payment Request Link ↗
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  {(selectedPaymentMethod === 'stripe_card' ||
                    selectedPaymentMethod === 'razorpay_inr') &&
                    'Enter your gateway payment session / transaction reference below.'}
                </div>

                {/* Full-Width Responsive Transaction Reference Input */}
                <div className="w-full min-w-0 space-y-2.5 pt-1">
                  <label
                    htmlFor="checkout-payment-ref-input"
                    className="ds-label block text-sm sm:text-base font-extrabold text-[#50352F]"
                  >
                    Transaction Reference / TID / UTR / Sender Mobile Number <span className="text-[#D66795]">*</span>
                  </label>
                  <input
                    id="checkout-payment-ref-input"
                    type="text"
                    required
                    data-testid="checkout-payment-ref-input"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder={
                      selectedPaymentMethod === 'upi_india'
                        ? 'Enter 12-digit UPI UTR reference number'
                        : selectedPaymentMethod === 'payoneer'
                        ? 'Enter Payoneer Transaction ID or Sender Email'
                        : 'Enter Transaction Reference ID (TID) or Sender Mobile Number'
                    }
                    className="w-full block min-w-0 px-4 py-3.5 rounded-2xl candy-input font-mono text-base text-[#50352F] min-h-[52px]"
                  />

                  {/* Clear Pending Verification Explanation Box */}
                  <div
                    data-testid="checkout-pending-verification-notice"
                    className="p-4 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] flex items-start gap-3"
                  >
                    <Clock className="w-5 h-5 text-[#D66795] shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs sm:text-sm text-[#50352F] leading-relaxed">
                      <p className="font-extrabold text-[#50352F]">
                        Your order stays pending until the seller confirms receiving payment.
                      </p>
                      <p className="text-[#7A5A52] font-medium">
                        Once the seller verifies your transaction reference in their wallet or bank statement, your digital download unlocks immediately and a confirmation email is sent to your delivery address.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {checkoutError && (
              <div className="p-4 rounded-2xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-sm font-extrabold text-[#9E3B66] flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0 text-[#D66795]" />
                <span>{checkoutError}</span>
              </div>
            )}

            {/* Order Total & Raised Pink Submit Button */}
            <div className="pt-4 border-t-2 border-[#F3E2CB] space-y-4">
              <div className="p-4 sm:p-5 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs sm:text-sm text-[#7A5A52] font-bold">
                    Total Amount Due ({currency})
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-[#50352F] tabular-nums mt-0.5">
                    {cartTotalFormatted}
                  </div>
                </div>

                <CandyButton
                  type="submit"
                  data-testid="submit-checkout-order-btn"
                  variant="pink"
                  size="lg"
                  loading={isSubmitting}
                  disabled={cart.length === 0 || (!isFreeCart && !isPaidCheckoutConfigured)}
                  className="w-full sm:w-auto min-h-[52px] px-6"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {isFreeCart
                      ? 'Complete Free Verified Order'
                      : !isPaidCheckoutConfigured
                      ? 'Paid Checkout Unavailable — Setup Required'
                      : 'Submit Order & Payment Reference'}
                  </span>
                </CandyButton>
              </div>

              {/* Transparent 5% Platform Commission Split Preview */}
              {!isFreeCart && cart.length > 0 && (
                <div
                  data-testid="checkout-commission-breakdown"
                  className="p-3.5 px-4 rounded-[20px] bg-[#FFFDF8] border-2 border-[#F0DEC6] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E4D45]"
                >
                  <span className="font-semibold">
                    Direct-to-Creator Settlement ({selectedPaymentMethod !== 'stripe_card' && selectedPaymentMethod !== 'razorpay_inr' ? '100% Direct to Seller Wallet' : 'Automated Split'}):
                  </span>
                  <div className="flex items-center gap-3 font-mono font-bold tabular-nums">
                    <span className="text-[#236B56]">
                      Seller Net (95%):{' '}
                      <strong>
                        {formatMinorToMajor(commissionPreview.sellerNetEarningsMinor, currency)}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#D66795]">
                      Platform Fee (5%):{' '}
                      <strong>
                        {formatMinorToMajor(commissionPreview.platformCommissionMinor, currency)}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* RIGHT COLUMN: Order Confirmation & Secure Downloads */}
        <div className="lg:col-span-5 space-y-6">
          {liveCompletedOrder && (
            <div
              data-testid="buyer-completed-order-banner"
              className={`rounded-[32px] border-2 p-6 shadow-sm transition-colors ${
                liveCompletedOrder.paymentStatus === 'Paid'
                  ? 'bg-[#E6F8EC] border-[#AFE0BE] text-[#1E563B]'
                  : liveCompletedOrder.paymentStatus === 'Failed'
                  ? 'bg-[#FFE7F1] border-[#F58CB7] text-[#9E3B66]'
                  : 'bg-[#FFF6DA] border-[#FFD47B] text-[#6E470B]'
              }`}
            >
              <div className="flex items-start gap-3">
                {liveCompletedOrder.paymentStatus === 'Paid' ? (
                  <CheckCircle2 className="w-6 h-6 text-[#236B56] shrink-0 mt-0.5" />
                ) : liveCompletedOrder.paymentStatus === 'Failed' ? (
                  <XCircle className="w-6 h-6 text-[#9E3B66] shrink-0 mt-0.5" />
                ) : (
                  <Clock className="w-6 h-6 text-[#8A5A19] shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-extrabold text-base">
                      Order #{liveCompletedOrder.orderNumber}{' '}
                      {liveCompletedOrder.paymentStatus === 'Paid'
                        ? '— Verified & Ready'
                        : liveCompletedOrder.paymentStatus === 'Failed'
                        ? '— Payment Rejected'
                        : '— Awaiting Seller Verification'}
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <span
                        data-testid="buyer-order-status-pill"
                        className="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase bg-white/90 border border-current/20"
                      >
                        {liveCompletedOrder.paymentStatus}
                      </span>
                      <span
                        data-testid="buyer-order-verification-badge"
                        className="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase bg-white/85 border border-current/15"
                      >
                        {liveCompletedOrder.paymentStatus === 'Paid'
                          ? liveCompletedOrder.totalAmount === 0
                            ? 'Instant Free Verified'
                            : 'Seller Verified (Not Bank Verified)'
                          : liveCompletedOrder.paymentStatus === 'Failed'
                          ? 'Verification Rejected'
                          : 'Unverified Reference'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs mt-1 leading-relaxed">
                    {liveCompletedOrder.paymentStatus === 'Paid'
                      ? `Your payment has been verified! A secure confirmation & download email has been sent to ${liveCompletedOrder.buyerEmailNotification?.recipientEmail || liveCompletedOrder.customerEmail}, and you can download your product below.`
                      : liveCompletedOrder.paymentStatus === 'Failed'
                      ? 'The seller could not verify this transaction reference in their account statement. Please contact the store owner or submit a valid reference.'
                      : `Reference "${liveCompletedOrder.paymentReference}" submitted. Downloads remain locked until the seller confirms receipt in their wallet or bank statement.`}
                  </p>

                  {liveCompletedOrder.paymentStatus === 'Paid' && (
                    <div className="mt-3 pt-3 border-t border-[#AFE0BE]">
                      <button
                        type="button"
                        data-testid="buyer-unlocked-download-btn"
                        onClick={() => handleTriggerDownload(liveCompletedOrder)}
                        className="candy-btn-mint w-full py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer min-h-[42px]"
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          Download Digital Product ({liveCompletedOrder.downloadCount}/
                          {liveCompletedOrder.maxDownloads})
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Optional Manual WhatsApp Click-to-Chat Link for Faster Seller Review */}
                  {liveCompletedOrder.paymentStatus === 'Pending' && whatsappLinkEnabled && (
                    <div className="mt-3 pt-3 border-t border-[#E6C57E] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold text-[#6E470B]">
                        Want faster manual verification? Send your Order # &amp; Ref to the seller on WhatsApp:
                      </span>
                      <a
                        href={buildSafeWhatsappHref(liveCompletedOrder)}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="whatsapp-notify-seller-link"
                        className="candy-btn-mint inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold shrink-0"
                      >
                        <span>Notify Seller on WhatsApp ↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            data-testid="buyer-orders-downloads-section"
            className="candy-card-white rounded-[32px] p-6 sm:p-8"
          >
            <div className="flex items-center gap-3.5 mb-2">
              <ClayIcon tone="mint" size="md">
                <Download className="w-5 h-5" />
              </ClayIcon>
              <div>
                <h3 className="ds-section-title font-extrabold text-[#50352F]">
                  My Orders &amp; Downloads
                </h3>
                <p className="ds-helper">
                  Signed download URLs are generated on-demand and expire after 10 minutes.
                </p>
              </div>
            </div>

            {downloadFeedback && (
              <div
                className={`mb-4 mt-4 p-3.5 rounded-2xl border-2 text-xs font-extrabold flex items-center gap-2 ${
                  downloadFeedback.ok
                    ? 'bg-[#E6F8EC] border-[#AFE0BE] text-[#236B56]'
                    : 'bg-[#FFE7F1] border-[#F58CB7] text-[#9E3B66]'
                }`}
              >
                {downloadFeedback.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <Lock className="w-4 h-4 shrink-0" />
                )}
                <span>{downloadFeedback.message}</span>
              </div>
            )}

            {customerOrders.length === 0 ? (
              <div className="py-10 mt-4 text-center rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
                <Lock className="w-8 h-8 text-[#D66795] mx-auto mb-2" />
                <p className="text-sm font-extrabold text-[#50352F]">No orders found yet</p>
                <p className="ds-helper mt-1 px-4">
                  Complete checkout on the left to see your order verification status and download button here.
                </p>
              </div>
            ) : (
              <div className="space-y-4 mt-4">
                {customerOrders.map((ord) => {
                  const isPaid = ord.paymentStatus === 'Paid';
                  const isPending = ord.paymentStatus === 'Pending';
                  const isFailed = ord.paymentStatus === 'Failed';

                  return (
                    <div
                      key={ord.id}
                      data-testid={`buyer-order-card-${ord.orderNumber}`}
                      className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-extrabold text-[#D66795]">
                              #{ord.orderNumber}
                            </span>
                            <span className="text-[11px] font-semibold text-[#7A5A52]">{ord.date}</span>
                          </div>
                          <h4 className="font-extrabold text-sm text-[#50352F] mt-0.5">
                            {ord.productTitle}
                          </h4>
                        </div>

                        {/* Status Badge */}
                        <div className="flex flex-col items-end gap-1">
                          {isPaid && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#E6F8EC] text-[#236B56] border border-[#AFE0BE] text-[11px] font-extrabold">
                              <CheckCircle2 className="w-3 h-3" /> Paid
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#FFF6DA] text-[#8A5A19] border border-[#FFD47B] text-[11px] font-extrabold">
                              <Clock className="w-3 h-3" /> Pending Review
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#FFE7F1] text-[#9E3B66] border border-[#F58CB7] text-[11px] font-extrabold">
                              <XCircle className="w-3 h-3" /> Failed
                            </span>
                          )}
                          <span
                            data-testid={`buyer-order-verification-badge-${ord.orderNumber}`}
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg ${
                              ord.verificationMode === 'Gateway Verified' || ord.verificationMode === 'Instant Free'
                                ? 'bg-[#E6F8EC] text-[#236B56]'
                                : ord.verificationMode === 'Manually Verified by Seller'
                                ? 'bg-[#FFF6DA] text-[#8A5A19]'
                                : 'bg-[#FFFDF8] text-[#7A5A52]'
                            }`}
                          >
                            {ord.verificationMode || 'Unverified Reference'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-[#6E4D45] pt-2 border-t border-[#F0DEC6]">
                        <span>
                          Amount: <strong className="text-[#50352F]">{ord.amount}</strong> (
                          {ord.currency})
                        </span>
                        <span className="font-mono text-[11px] font-bold">
                          Ref: {ord.paymentReference || 'N/A'}
                        </span>
                      </div>

                      {/* Download Gate */}
                      <div className="pt-1 space-y-2">
                        {isPaid ? (
                          <button
                            type="button"
                            data-testid={`buyer-download-btn-${ord.orderNumber}`}
                            onClick={() => handleTriggerDownload(ord)}
                            className="candy-btn-mint w-full py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer min-h-[42px]"
                          >
                            <Download className="w-4 h-4" />
                            <span>Download Verified File</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-testid={`buyer-download-locked-${ord.orderNumber}`}
                              onClick={() => handleTriggerDownload(ord)}
                              className="w-full py-2.5 px-4 rounded-xl bg-[#FFFDF8] border-2 border-[#E8D2B5] text-[#7A5A52] text-xs font-extrabold flex items-center justify-center gap-2 cursor-not-allowed min-h-[42px]"
                            >
                              <Lock className="w-3.5 h-3.5 text-[#D66795]" />
                              <span>
                                {isPending
                                  ? 'Download Locked — Awaiting Seller Verification'
                                  : 'Download Locked — Payment Failed'}
                              </span>
                            </button>
                            {isPending && whatsappLinkEnabled && (
                              <a
                                href={buildSafeWhatsappHref(ord)}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`buyer-whatsapp-link-${ord.orderNumber}`}
                                className="w-full py-2 px-3 rounded-xl bg-[#E6F8EC] hover:bg-[#AFE0BE]/40 border border-[#AFE0BE] text-[#236B56] text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                              >
                                <span>Optional: Send Order # to Seller on WhatsApp ↗</span>
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
