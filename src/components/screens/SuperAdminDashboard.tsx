import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Store,
  Users,
  ShoppingCart,
  CreditCard,
  Settings,
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  Search,
  Lock,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Eye,
  Zap,
  ExternalLink,
  Sliders,
  Crown,
  Edit3,
} from 'lucide-react';
import {
  CommissionInvoice,
  CommissionStatus,
  CurrencyCode,
  formatMinorToMajor,
  GatewayServerStatus,
  LedgerAuditEntry,
  OrderItem,
  OrderPaymentStatus,
  PlatformStore,
  Product,
  ScreenId,
  StoreConfig,
} from '../../types/dreamstore';
import { CandyButton, CandyTone, ClayIcon, DreamStoreLogo } from '../ui/DreamUI';
import { getAuthHeaders } from '../../lib/firebase';

interface AdminPlatformSettings {
  platformCommissionBps: number;
  maintenanceMode: boolean;
  allowNewSellerRegistrations: boolean;
  updatedAtIso: string;
}

interface AdminStoreRecord {
  storeId: string;
  storeName: string;
  storeSlug: string;
  ownerId?: string;
  ownerName: string;
  ownerEmail: string;
  country: string;
  currency: CurrencyCode;
  theme?: string;
  planId: 'free' | 'pro';
  productCount: number;
  status: 'active' | 'suspended' | 'pending_review';
  visitsCount?: number;
  checkoutViewsCount?: number;
  lastVisitedAtIso?: string;
  ordersCount?: number;
  paidOrdersCount?: number;
  pendingOrdersCount?: number;
  paymentConfigured?: boolean;
  configuredMethods?: string[];
}

type AdminToastVariant = 'active' | 'suspended' | 'config' | 'error';

interface SuperAdminToastItem {
  id: string;
  title: string;
  message: string;
  variant: AdminToastVariant;
  storeId?: string;
  timestampLabel: string;
}

interface SuperAdminDashboardProps {
  config?: StoreConfig;
  platformStores?: PlatformStore[];
  products?: Product[];
  orders: OrderItem[];
  auditLogs: LedgerAuditEntry[];
  gatewayStatus: GatewayServerStatus;
  currentUserUid: string | null;
  currentUserEmail: string | null;
  isSuperAdmin?: boolean;
  isSuperAdminVerified?: boolean;
  onSignInGoogle?: () => void;
  onAddPlatformStore?: (store: PlatformStore) => void;
  onToggleStoreStatus?: (id: string) => void;
  onUpdateProduct?: (id: string, partial: Partial<Product>) => void;
  onUpdateOrderStatus?: (orderId: string, newStatus: OrderPaymentStatus) => Promise<void> | void;
  onAdminUpdateOrderStatus?: (
    orderId: string,
    newStatus: 'Paid' | 'Pending' | 'Failed',
    reason: string
  ) => Promise<void>;
  onUpdateCommissionStatus?: (orderNumber: string, status: CommissionStatus) => Promise<void> | void;
  onAdminControlStore?: (
    targetStoreId: string,
    targetScreen?: ScreenId,
    storeOverrides?: Partial<StoreConfig>
  ) => void;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isEditMode?: boolean;
}

type AdminTab =
  | 'overview'
  | 'stores'
  | 'orders'
  | 'payments'
  | 'commissions'
  | 'settings';

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  config,
  platformStores = [],
  products = [],
  currentUserUid,
  currentUserEmail,
  isSuperAdmin,
  isSuperAdminVerified,
  orders,
  auditLogs,
  gatewayStatus,
  onUpdateOrderStatus,
  onAdminUpdateOrderStatus,
  onAdminControlStore,
  onNavigate,
}) => {
  const verifiedSuperAdmin = Boolean(isSuperAdminVerified ?? isSuperAdmin);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stores, setStores] = useState<AdminStoreRecord[]>(() =>
    platformStores.map((ps) => ({
      storeId: ps.id,
      storeName: ps.storeName,
      storeSlug: ps.storeSlug || ps.id,
      ownerName: ps.storeName,
      ownerEmail: ps.ownerEmail,
      country: ps.country || 'PK',
      currency: ps.currency || 'PKR',
      planId: ps.plan === 'Pro' ? 'pro' : 'free',
      productCount: products.filter((p) => p.storeId === ps.id).length,
      status: ps.status === 'Active' ? 'active' : 'pending_review',
      visitsCount: 0,
      checkoutViewsCount: 0,
      ordersCount: orders.filter((o) => o.storeId === ps.id).length,
      paidOrdersCount: orders.filter((o) => o.storeId === ps.id && o.paymentStatus === 'Paid').length,
      pendingOrdersCount: orders.filter((o) => o.storeId === ps.id && o.paymentStatus === 'Pending').length,
      paymentConfigured: false,
    }))
  );
  const [totalPlatformVisits, setTotalPlatformVisits] = useState<number>(0);
  const [totalCheckoutViews, setTotalCheckoutViews] = useState<number>(0);
  const [editingStore, setEditingStore] = useState<AdminStoreRecord | null>(null);
  const [platformSettings, setPlatformSettings] = useState<AdminPlatformSettings>({
    platformCommissionBps: gatewayStatus.platformCommissionBps ?? 500,
    maintenanceMode: false,
    allowNewSellerRegistrations: true,
    updatedAtIso: new Date().toISOString(),
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [toastQueue, setToastQueue] = useState<SuperAdminToastItem[]>([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [commissionInvoices, setCommissionInvoices] = useState<CommissionInvoice[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<Array<{
    paymentId: string; invoiceId: string; status: 'submitted' | 'verified' | 'rejected';
  }>>([]);

  const dismissToast = (id: string) => {
    setToastQueue((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        setActionToast(null);
      }
      return next;
    });
  };

  const showToast = (
    msg: string,
    options?: {
      title?: string;
      variant?: AdminToastVariant;
      storeId?: string;
    }
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inferredVariant: AdminToastVariant =
      options?.variant ||
      (msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error')
        ? 'error'
        : msg.toLowerCase().includes('suspend')
        ? 'suspended'
        : msg.toLowerCase().includes('active') || msg.toLowerCase().includes('activated')
        ? 'active'
        : 'config');
    const inferredTitle =
      options?.title ||
      (inferredVariant === 'active'
        ? 'Store Status: Active'
        : inferredVariant === 'suspended'
        ? 'Store Status: Suspended'
        : inferredVariant === 'error'
        ? 'Action Failed'
        : 'Store Configuration Updated');
    const nowLabel = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const newItem: SuperAdminToastItem = {
      id,
      title: inferredTitle,
      message: msg,
      variant: inferredVariant,
      storeId: options?.storeId,
      timestampLabel: nowLabel,
    };

    setActionToast(msg);
    setToastQueue((prev) => [newItem, ...prev].slice(0, 4));

    window.setTimeout(() => {
      setToastQueue((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          setActionToast((curr) => (curr === msg ? null : curr));
        }
        return next;
      });
    }, 4200);
  };

  const fetchAdminData = async () => {
    if (!verifiedSuperAdmin || !currentUserUid) return;
    setIsLoadingAdmin(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/commission/admin/overview', {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.stores)) {
          setStores(data.stores);
        }
        if (typeof data.totalPlatformVisits === 'number') {
          setTotalPlatformVisits(data.totalPlatformVisits);
        }
        if (typeof data.totalCheckoutViews === 'number') {
          setTotalCheckoutViews(data.totalCheckoutViews);
        }
        if (data.settings) setPlatformSettings(data.settings);
        if (Array.isArray(data.invoices)) {
          setCommissionInvoices(data.invoices);
        }
        if (Array.isArray(data.payments)) {
          setCommissionPayments(data.payments);
        }
      }
    } catch {
      // Fallback safely
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [verifiedSuperAdmin, currentUserUid]);

  // STRICT RBAC ENFORCEMENT: Block non-super-admin users immediately
  if (!verifiedSuperAdmin) {
    return (
      <div
        data-testid="super-admin-403-gate"
        className="min-h-screen bg-[#FFF2DF] flex items-center justify-center p-6 text-[#50352F]"
      >
        <div className="max-w-md w-full candy-card-white rounded-[32px] p-8 text-center">
          <div className="flex justify-center mb-4">
            <ClayIcon tone="pink" size="lg">
              <Lock className="w-7 h-7" />
            </ClayIcon>
          </div>
          <span className="inline-block px-3.5 py-1 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66] text-xs font-extrabold uppercase tracking-wider mb-2">
            HTTP 403 · Access Denied
          </span>
          <h1 className="text-2xl font-extrabold font-wordmark text-[#50352F] mb-2">
            Super Admin Restricted Area
          </h1>
          <p className="text-xs text-[#6E4D45] leading-relaxed mb-6">
            This control center is strictly locked to the platform Super Admin account. Store Owners and Customers cannot view platform-wide stores, cross-store orders, or commission settings.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <CandyButton
              variant="cream"
              size="sm"
              onClick={() => onNavigate('storefront')}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Storefront</span>
            </CandyButton>
            <CandyButton
              variant="pink"
              size="sm"
              onClick={() => onNavigate('checkout')}
            >
              <span>My Orders &amp; Downloads</span>
            </CandyButton>
          </div>
        </div>
      </div>
    );
  }

  const handleToggleStoreStatus = async (
    storeId: string,
    newStatus: 'active' | 'suspended' | 'pending_review'
  ) => {
    const displayStoreName = stores.find((s) => s.storeId === storeId)?.storeName || storeId;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/stores/status', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ storeId, status: newStatus === 'active' ? 'Active' : newStatus === 'suspended' ? 'Suspended' : 'Pending' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'Store status was not saved.');
      setStores((prev) => prev.map((s) =>
        s.storeId === storeId ? { ...s, status: newStatus } : s
      ));
      showToast(`Store "${displayStoreName}" status was saved as ${newStatus.replace('_', ' ')}.`, {
        title: 'Store Status Saved',
        variant: newStatus === 'active' ? 'active' : 'suspended',
        storeId,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save store status.', {
        title: 'Status Update Failed', variant: 'error', storeId,
      });
    }
  };

  const handleToggleStorePlan = async (store: AdminStoreRecord) => {
    const nextPlanId: 'pro' | 'free' = store.planId === 'pro' ? 'free' : 'pro';
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/commission/admin/grant-pro', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          storeId: store.storeId,
          targetSellerId: store.ownerId,
          grantPro: nextPlanId === 'pro',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'Plan change was not saved.');
      setStores((prev) => prev.map((s) =>
        s.storeId === store.storeId ? { ...s, planId: nextPlanId } : s
      ));
      showToast(`Store "${store.storeName}" plan changed to ${nextPlanId.toUpperCase()}.`, {
        title: 'Store Plan Saved', variant: 'config', storeId: store.storeId,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save plan.', {
        title: 'Plan Update Failed', variant: 'error', storeId: store.storeId,
      });
    }
  };

  // Bulk approval is intentionally absent: payment references are not proof of cleared funds.
  const handleInstantControlCommand = async (
    action: 'update_store',
    storeId?: string,
    updates?: Partial<AdminStoreRecord>
  ) => {
    if (action !== 'update_store' || !storeId || !updates) return;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/stores/control', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action,
          storeId,
          updates: {
            storeName: updates.storeName,
            currency: updates.currency,
            theme: updates.theme,
            plan: updates.planId === 'pro' ? 'Pro' : updates.planId === 'free' ? 'Free' : undefined,
            status: updates.status === 'pending_review' ? 'pending' : updates.status,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true || !data.store) {
        throw new Error(data.error || 'Store changes were not saved.');
      }
      setStores((prev) => prev.map((s) =>
        s.storeId === storeId ? { ...s, ...data.store } : s
      ));
      setEditingStore(null);
      if (onAdminControlStore) {
        onAdminControlStore(storeId, 'super-admin', {
          storeName: data.store.storeName,
          currency: data.store.currency,
          theme: data.store.theme,
        });
      }
      showToast(`Changes to "${data.store.storeName}" saved successfully.`, {
        title: 'Store Changes Saved', variant: 'config', storeId,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save store changes.', {
        title: 'Store Save Failed', variant: 'error', storeId,
      });
    }
  };

  const handleControlTargetStore = (
    st: AdminStoreRecord,
    targetScreen: ScreenId = 'owner-dashboard'
  ) => {
    showToast(
      `Switched active Super Admin control to "${st.storeName}" (/${st.storeSlug}).`,
      {
        title: 'Controlling Store Configuration',
        variant: 'config',
        storeId: st.storeId,
      }
    );
    if (onAdminControlStore) {
      onAdminControlStore(st.storeId, targetScreen, {
        storeId: st.storeId,
        ownerId: st.ownerId,
        storeName: st.storeName,
        storeSlug: st.storeSlug,
        ownerName: st.ownerName,
        currency: st.currency,
        sellerCountry: st.country,
      });
    } else {
      onNavigate(targetScreen);
    }
  };

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/commission-config', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          newCommissionBps: platformSettings.platformCommissionBps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'Commission rate was not saved. Please retry.');
      setPlatformSettings(current => ({ ...current, platformCommissionBps: data.platformCommissionBps }));
      showToast('Platform commission rate saved');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save commission rate', {
        title: 'Settings Save Failed', variant: 'error',
      });
    }
  };

  const handleReviewCommissionInvoice = async (
    invoiceId: string,
    decision: 'approve' | 'reject' | 'waive'
  ) => {
    if (decision === 'waive') {
      showToast('Waiving commission requires a separate audited adjustment process.', {
        variant: 'error', title: 'Commission Waiver Unavailable',
      });
      return;
    }
    const submitted = commissionPayments.find((payment) =>
      payment.invoiceId === invoiceId && payment.status === 'submitted'
    );
    if (!submitted) {
      showToast('A seller must submit a payment reference before this invoice can be reviewed.', {
        variant: 'error', title: 'No Payment Proof',
      });
      return;
    }
    const fundsConfirmed = decision !== 'approve' || window.confirm(
      'Have you independently confirmed that these funds CLEARED in your real wallet or bank statement? Do not approve based only on a transaction reference.'
    );
    if (!fundsConfirmed) return;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/commission/verify-payment', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          invoiceId, paymentId: submitted.paymentId, decision,
          fundsConfirmed: decision === 'approve' ? true : false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true || !data.invoice) {
        throw new Error(data.error || 'Commission verification was not saved.');
      }
      setCommissionInvoices((prev) =>
        prev.map((inv) => inv.invoiceId === invoiceId ? data.invoice : inv)
      );
      setCommissionPayments(prev => prev.map(payment =>
        payment.paymentId === submitted.paymentId ? { ...payment, status: data.payment.status } : payment
      ));
      showToast(`Payment proof ${decision === 'approve' ? 'verified' : 'rejected'} after a durable save.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not review payment.', {
        title: 'Verification Failed', variant: 'error',
      });
    }
  };

  const triggerOrderUpdate = async (
    orderId: string,
    newStatus: 'Paid' | 'Pending' | 'Failed',
    reason: string
  ) => {
    if (onAdminUpdateOrderStatus) {
      await onAdminUpdateOrderStatus(orderId, newStatus, reason);
    } else {
      throw new Error('Secure admin order verification is unavailable. No order was changed.');
    }
  };

  // Compute platform-wide metrics by currency (never summing PKR + USD + INR together)
  const paidOrders = orders.filter((o) => o.paymentStatus === 'Paid');
  const pendingOrders = orders.filter((o) => o.paymentStatus === 'Pending');
  const failedOrders = orders.filter((o) => o.paymentStatus === 'Failed');

  const gmvByCurrency: Record<string, number> = { PKR: 0, USD: 0, INR: 0 };
  const commissionByCurrency: Record<string, number> = {
    PKR: 0,
    USD: 0,
    INR: 0,
  };
  const netSellerByCurrency: Record<string, number> = {
    PKR: 0,
    USD: 0,
    INR: 0,
  };

  paidOrders.forEach((o) => {
    const cur = o.currency || 'PKR';
    if (o.commissionBreakdown) {
      gmvByCurrency[cur] = (gmvByCurrency[cur] || 0) + o.commissionBreakdown.grossAmountMinor;
      commissionByCurrency[cur] =
        (commissionByCurrency[cur] || 0) + o.commissionBreakdown.platformCommissionMinor;
      netSellerByCurrency[cur] =
        (netSellerByCurrency[cur] || 0) + o.commissionBreakdown.sellerNetEarningsMinor;
    }
  });

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.customerEmail.toLowerCase().includes(q) ||
      o.productTitle.toLowerCase().includes(q) ||
      (o.paymentReference || '').toLowerCase().includes(q)
    );
  });

  const adminNavItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: CandyTone;
  }> = [
    { id: 'overview', label: 'Platform Overview', icon: Sparkles, tone: 'pink' },
    { id: 'stores', label: 'Stores & Sellers', icon: Store, tone: 'lilac' },
    { id: 'orders', label: 'All Orders', icon: ShoppingCart, tone: 'mint' },
    { id: 'payments', label: 'Payment Verification', icon: CreditCard, tone: 'butter' },
    { id: 'commissions', label: '5% Commissions', icon: Users, tone: 'pink' },
    { id: 'settings', label: 'Platform Settings', icon: Settings, tone: 'lilac' },
  ];

  return (
    <div className="min-h-screen bg-[#FFF2DF] flex flex-col lg:flex-row text-[#50352F]">
      {/* Left Sidebar */}
      <aside className="w-full lg:w-68 bg-[#FFFDF8] border-b-2 lg:border-b-0 lg:border-r-2 border-[#E8D2B5] p-5 flex flex-col justify-between shrink-0 shadow-[4px_0_24px_-12px_rgba(80,53,47,0.08)]">
        <div>
          <div className="flex items-center justify-between mb-6 pb-4 border-b-2 border-[#F3E2CB]">
            <DreamStoreLogo
              size="sm"
              brandName="DreamStore Admin"
              onClick={() => onNavigate('landing')}
            />
            <span className="px-2.5 py-1 rounded-xl bg-[#50352F] text-[#FFD47B] text-[10px] font-extrabold uppercase tracking-wider">
              Super Admin
            </span>
          </div>

          <nav className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0">
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? 'candy-btn-pink'
                      : 'text-[#6E4D45] hover:bg-[#FFF2DF] hover:text-[#50352F]'
                  }`}
                >
                  <ClayIcon tone={item.tone} size="sm" className="w-8 h-8 rounded-xl">
                    <Icon className="w-4 h-4" />
                  </ClayIcon>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block pt-6 border-t-2 border-[#F3E2CB] space-y-3">
          <div className="p-3.5 rounded-2xl bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] text-xs">
            <div className="font-extrabold text-[#50352F] truncate">
              {currentUserEmail || 'Platform Super Admin'}
            </div>
            <div className="text-[11px] text-[#D66795] font-extrabold mt-0.5">
              Role: SUPER_ADMIN (Full Access)
            </div>
          </div>
          <button
            onClick={() => onNavigate('owner-dashboard')}
            className="candy-btn-cream w-full px-3.5 py-2.5 rounded-xl text-xs font-extrabold cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Store className="w-3.5 h-3.5" />
            <span>Switch to Seller View</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-5 sm:p-8 max-w-[1360px] w-full mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 candy-card-white rounded-[28px] p-5">
          <div className="flex items-center gap-3.5">
            <ClayIcon tone="pink" size="md">
              <ShieldAlert className="w-5 h-5" />
            </ClayIcon>
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#D66795]">
                DreamStore Multi-Store Control Center
              </span>
              <h1 className="text-xl sm:text-2xl font-extrabold font-wordmark text-[#50352F]">
                Super Admin Governance &amp; 5% Commission Ledger
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAdminData}
              className="candy-btn-cream inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer min-h-[40px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAdmin ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <CandyButton
              variant="cream"
              size="sm"
              onClick={() => onNavigate('storefront')}
            >
              <span>View Live Storefront</span>
            </CandyButton>
          </div>
        </div>

        {/* Floating Instant Toast Notification System */}
        {toastQueue.length > 0 && (
          <div
            data-testid="superadmin-toast-container"
            role="status"
            aria-live="polite"
            className="fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-[calc(100vw-2.5rem)] pointer-events-none"
          >
            {toastQueue.map((item) => {
              const isSuspended = item.variant === 'suspended';
              const isError = item.variant === 'error';
              const isActive = item.variant === 'active';
              return (
                <div
                  key={item.id}
                  data-testid={`superadmin-toast-${item.variant}`}
                  className={`pointer-events-auto rounded-2xl p-4 border-2 shadow-[0_14px_30px_-8px_rgba(80,53,47,0.22)] transition-all duration-200 flex items-start justify-between gap-3 ${
                    isActive
                      ? 'bg-[#E6F8EC] border-[#52B788] text-[#1B4332]'
                      : isSuspended || isError
                      ? 'bg-[#FFE7F1] border-[#F58CB7] text-[#50352F]'
                      : 'bg-[#FFFDF8] border-[#D66795] text-[#50352F]'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isActive
                          ? 'bg-[#236B56] text-white'
                          : isSuspended || isError
                          ? 'bg-[#9E3B66] text-white'
                          : 'bg-[#D66795] text-white'
                      }`}
                    >
                      {isActive ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : isSuspended || isError ? (
                        <Ban className="w-4 h-4" />
                      ) : (
                        <Sliders className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold tracking-tight">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-mono opacity-75">
                          · {item.timestampLabel}
                        </span>
                      </div>
                      <p className="text-xs font-bold leading-snug mt-0.5 break-words">
                        {item.message}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={() => dismissToast(item.id)}
                    className="p-1 rounded-lg hover:bg-black/5 text-current opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {actionToast && (
          <div
            data-testid="superadmin-inline-toast"
            role="alert"
            className="p-3.5 rounded-2xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-[#50352F] text-xs font-extrabold flex items-center justify-between shadow-md"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#D66795]" />
              <span>{actionToast}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setActionToast(null);
                setToastQueue([]);
              }}
              className="text-[11px] font-extrabold text-[#9E3B66] hover:underline cursor-pointer px-2 py-0.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* KPI Strip (Includes Store Visits & Important Metrics) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div
            data-testid="superadmin-kpi-stores"
            className="candy-card-white rounded-[26px] p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#7A5A52]">Registered Stores</span>
              <ClayIcon tone="pink" size="sm">
                <Store className="w-4 h-4" />
              </ClayIcon>
            </div>
            <div className="text-2xl font-extrabold text-[#50352F] tabular-nums">{stores.length}</div>
            <div className="text-[11px] text-[#236B56] font-extrabold mt-1">
              {stores.filter((s) => s.status === 'active').length} Active ·{' '}
              {stores.filter((s) => s.status !== 'active').length} Suspended/Pending
            </div>
          </div>

          <div
            data-testid="superadmin-kpi-visits"
            className="candy-card-white rounded-[26px] p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#7A5A52]">Total Store Visits</span>
              <ClayIcon tone="butter" size="sm">
                <Eye className="w-4 h-4" />
              </ClayIcon>
            </div>
            <div className="text-2xl font-extrabold text-[#50352F] tabular-nums">
              {totalPlatformVisits ||
                stores.reduce((sum, s) => sum + (s.visitsCount || 0), 0)}
            </div>
            <div className="text-[11px] text-[#8A5A19] font-extrabold mt-1">
              {totalCheckoutViews ||
                stores.reduce((sum, s) => sum + (s.checkoutViewsCount || 0), 0)}{' '}
              Checkout Sessions
            </div>
          </div>

          <div className="candy-card-white rounded-[26px] p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#7A5A52]">Total Orders</span>
              <ClayIcon tone="lilac" size="sm">
                <ShoppingCart className="w-4 h-4" />
              </ClayIcon>
            </div>
            <div className="text-2xl font-extrabold text-[#50352F] tabular-nums">{orders.length}</div>
            <div className="text-[11px] font-bold text-[#6E4D45] mt-1">
              <span className="text-[#236B56] font-extrabold">{paidOrders.length} Paid</span> ·{' '}
              <span className="text-[#8A5A19] font-extrabold">{pendingOrders.length} Pending</span> ·{' '}
              <span className="text-[#9E3B66] font-extrabold">{failedOrders.length} Failed</span>
            </div>
          </div>

          <div className="candy-card-white rounded-[26px] p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#7A5A52]">
                Verified GMV (By Currency)
              </span>
              <ClayIcon tone="mint" size="sm">
                <CheckCircle2 className="w-4 h-4" />
              </ClayIcon>
            </div>
            <div className="space-y-1 text-xs font-mono font-extrabold text-[#50352F]">
              <div>PKR: {formatMinorToMajor(gmvByCurrency.PKR || 0, 'PKR')}</div>
              <div>USD: {formatMinorToMajor(gmvByCurrency.USD || 0, 'USD')}</div>
              <div>INR: {formatMinorToMajor(gmvByCurrency.INR || 0, 'INR')}</div>
            </div>
          </div>

          <div className="candy-card-white rounded-[26px] p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#7A5A52]">
                5% Platform Commission
              </span>
              <ClayIcon tone="butter" size="sm">
                <Sparkles className="w-4 h-4" />
              </ClayIcon>
            </div>
            <div className="space-y-1 text-xs font-mono font-extrabold text-[#D66795]">
              <div>PKR: {formatMinorToMajor(commissionByCurrency.PKR || 0, 'PKR')}</div>
              <div>USD: {formatMinorToMajor(commissionByCurrency.USD || 0, 'USD')}</div>
              <div>INR: {formatMinorToMajor(commissionByCurrency.INR || 0, 'INR')}</div>
            </div>
          </div>
        </div>

        {/* Instant Command Center: Take Action Instantly */}
        <div
          data-testid="superadmin-instant-command-bar"
          className="candy-card-white rounded-[28px] p-5 border-2 border-[#F58CB7]/60 bg-gradient-to-r from-[#FFFDF8] via-[#FFF6FA] to-[#FFF2DF]"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[#D66795]">
                <Zap className="w-3.5 h-3.5" />
                <span>Super Admin Store Controls</span>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold font-wordmark text-[#50352F]">
                Review Stores, Traffic &amp; Payments
              </h2>
              <p className="text-xs text-[#6E4D45]">
                Currently controlling store:{' '}
                <strong className="text-[#50352F]">
                  {config?.storeName || stores[0]?.storeName || 'DreamStore'}
                </strong>{' '}
                (/{config?.storeSlug || stores[0]?.storeSlug || 'main'}) ·{' '}
                <span className="text-[#8A5A19] font-extrabold">
                  {pendingOrders.length} orders awaiting verification
                </span>{' '}
                ·{' '}
                <span className="text-[#236B56] font-extrabold">
                  {stores.filter((s) => s.status === 'active').length}/{stores.length} stores active
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-xs text-[#8A5A19] max-w-sm leading-relaxed">
                Bulk payment approvals and mass store activation are disabled for beta safety.
                Verify received funds and review stores individually.
              </p>

              <button
                type="button"
                onClick={() => setActiveTab('stores')}
                className="candy-btn-pink px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Manage All Stores</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Edit Store Modal */}
        {editingStore && (
          <div className="candy-card-white rounded-[28px] p-6 border-2 border-[#D66795] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#D66795]">
                  Super Admin Override
                </span>
                <h3 className="text-base font-extrabold font-wordmark text-[#50352F]">
                  Edit Store: {editingStore.storeName} ({editingStore.storeId})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingStore(null)}
                className="candy-btn-cream px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="ds-label block mb-1">Store Name</label>
                <input
                  type="text"
                  data-testid="edit-store-name-input"
                  value={editingStore.storeName}
                  onChange={(e) =>
                    setEditingStore({ ...editingStore, storeName: e.target.value })
                  }
                  className="candy-input"
                />
              </div>
              <div>
                <label className="ds-label block mb-1">Store Slug (read-only)</label>
                <input
                  type="text"
                  data-testid="edit-store-slug-input"
                  value={editingStore.storeSlug}
                  readOnly
                  title="Store URL changes require dedicated slug verification."
                  className="candy-input bg-[#FFF9FC] opacity-75"
                />
              </div>
              <div>
                <label className="ds-label block mb-1">Currency</label>
                <select
                  data-testid="edit-store-currency-select"
                  value={editingStore.currency}
                  onChange={(e) =>
                    setEditingStore({
                      ...editingStore,
                      currency: e.target.value as CurrencyCode,
                    })
                  }
                  className="candy-input"
                >
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                  <option value="INR">INR</option>
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="ds-label block mb-1">Plan Tier</label>
                <select
                  data-testid="edit-store-plan-select"
                  value={editingStore.planId}
                  onChange={(e) =>
                    setEditingStore({
                      ...editingStore,
                      planId: e.target.value as 'free' | 'pro',
                    })
                  }
                  className="candy-input"
                >
                  <option value="pro">Pro Unlimited</option>
                  <option value="free">Free Starter</option>
                </select>
              </div>
              <div>
                <label className="ds-label block mb-1">Store Status</label>
                <select
                  data-testid="edit-store-status-select"
                  value={editingStore.status}
                  onChange={(e) =>
                    setEditingStore({
                      ...editingStore,
                      status: e.target.value as 'active' | 'suspended' | 'pending_review',
                    })
                  }
                  className="candy-input"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="pending_review">Pending Review</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="save-store-config-btn"
                onClick={() =>
                  handleInstantControlCommand('update_store', editingStore.storeId, {
                    storeName: editingStore.storeName,
                    currency: editingStore.currency,
                    planId: editingStore.planId,
                    status: editingStore.status,
                  })
                }
                className="candy-btn-pink px-4 py-2 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Save Store Changes
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW, STORE VISITS & AUDIT LOGS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Live Store Visits & Instant Store Control Matrix */}
            <div className="candy-card-white rounded-[32px] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold font-wordmark text-[#50352F]">
                    All Stores Traffic Visits, Important Health &amp; Instant Controls
                  </h3>
                  <p className="ds-helper">
                    Real-time storefront visits, checkout sessions, order volume, and 1-click Super Admin takeover for every store.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {stores.map((st) => (
                  <div
                    key={st.storeId}
                    data-testid={`overview-store-card-${st.storeId}`}
                    className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-extrabold text-sm text-[#50352F]">
                            {st.storeName}
                          </div>
                          <div className="text-[11px] font-mono text-[#D66795] font-bold">
                            /{st.storeSlug} · {st.country} ({st.currency})
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-xl text-[10px] font-extrabold uppercase ${
                            st.status === 'active'
                              ? 'bg-[#E6F8EC] text-[#236B56] border border-[#AFE0BE]'
                              : 'bg-[#FFE7F1] text-[#9E3B66] border border-[#F58CB7]'
                          }`}
                        >
                          {st.status === 'active' ? 'Active' : 'Suspended'}
                        </span>
                      </div>

                      {/* Store Visits & Key Metrics Strip */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <div className="p-2.5 rounded-xl bg-[#FFFDF8] border border-[#E8D2B5]">
                          <div className="text-[10px] font-bold text-[#7A5A52] flex items-center gap-1">
                            <Eye className="w-3 h-3 text-[#D66795]" /> Visits
                          </div>
                          <div
                            data-testid={`store-visits-count-${st.storeId}`}
                            className="text-sm font-extrabold text-[#50352F] tabular-nums"
                          >
                            {st.visitsCount ?? 24}
                          </div>
                          <div className="text-[10px] text-[#7A5A52]">
                            {st.checkoutViewsCount ?? 6} checkouts
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-[#FFFDF8] border border-[#E8D2B5]">
                          <div className="text-[10px] font-bold text-[#7A5A52]">Products</div>
                          <div className="text-sm font-extrabold text-[#50352F] tabular-nums">
                            {st.productCount}
                          </div>
                          <div className="text-[10px] text-[#236B56] font-bold">
                            {st.planId === 'pro' ? 'Pro Plan' : 'Free Plan'}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-[#FFFDF8] border border-[#E8D2B5]">
                          <div className="text-[10px] font-bold text-[#7A5A52]">Orders</div>
                          <div className="text-sm font-extrabold text-[#50352F] tabular-nums">
                            {st.ordersCount ?? 0}
                          </div>
                          <div className="text-[10px] text-[#8A5A19] font-bold">
                            {st.pendingOrdersCount ?? 0} pending
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Instant 1-Click Store Controls */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#F0DEC6]">
                      <button
                        type="button"
                        data-testid={`control-store-btn-${st.storeId}`}
                        onClick={() => handleControlTargetStore(st, 'owner-dashboard')}
                        className="candy-btn-pink px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>Control Store</span>
                      </button>

                      <button
                        type="button"
                        data-testid={`edit-store-config-btn-${st.storeId}`}
                        onClick={() => setEditingStore(st)}
                        className="candy-btn-cream px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit Config</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleControlTargetStore(st, 'visual-editor')}
                        className="candy-btn-cream px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Builder</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleControlTargetStore(st, 'storefront')}
                        className="candy-btn-cream px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Visit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStorePlan(st)}
                        className="candy-btn-butter px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Crown className="w-3 h-3" />
                        <span>{st.planId === 'pro' ? 'Set Free' : 'Grant Pro'}</span>
                      </button>

                      <button
                        type="button"
                        data-testid={`toggle-store-status-btn-${st.storeId}`}
                        onClick={() =>
                          handleToggleStoreStatus(
                            st.storeId,
                            st.status === 'active' ? 'suspended' : 'active'
                          )
                        }
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1 ${
                          st.status === 'active'
                            ? 'bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66]'
                            : 'candy-btn-mint'
                        }`}
                      >
                        {st.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 candy-card-white rounded-[32px] p-6 space-y-4">
                <h3 className="text-base font-extrabold font-wordmark text-[#50352F]">
                  Gateway &amp; Security Configuration Status
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
                    <div className="font-extrabold text-[#50352F] mb-1">
                      Manual Seller Wallets (JazzCash / Easypaisa / UPI / Bank)
                    </div>
                    <span className="inline-block px-2.5 py-0.5 rounded-lg bg-[#FFF6DA] border border-[#FFD47B] text-[#8A5A19] text-[10px] font-extrabold">
                      Active · Manual Verification Required
                    </span>
                    <p className="ds-helper mt-1.5">
                      Orders start as Pending and unlock downloads only after Seller or Super Admin verification.
                    </p>
                  </div>

                  <div className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
                    <div className="font-extrabold text-[#50352F] mb-1">
                      Payoneer Global Receiving Account
                    </div>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold ${
                        gatewayStatus.payoneerConfigured
                          ? 'bg-[#E6F8EC] text-[#236B56]'
                          : 'bg-[#FFFDF8] border border-[#E8D2B5] text-[#7A5A52]'
                      }`}
                    >
                      {gatewayStatus.payoneerConfigured
                        ? 'Live API Connected'
                        : 'API Optional (Disabled) · Manual Verification Active'}
                    </span>
                    <p className="ds-helper mt-1.5">
                      Sellers can receive international USD/EUR/GBP payments via Payoneer link or receiving details without API keys.
                    </p>
                  </div>

                  <div className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
                    <div className="font-extrabold text-[#50352F] mb-1">
                      Automated Webhooks (Stripe / Razorpay)
                    </div>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold ${
                        gatewayStatus.stripeConfigured || gatewayStatus.razorpayConfigured
                          ? 'bg-[#E6F8EC] text-[#236B56]'
                          : 'bg-[#FFFDF8] border border-[#E8D2B5] text-[#7A5A52]'
                      }`}
                    >
                      {gatewayStatus.stripeConfigured || gatewayStatus.razorpayConfigured
                        ? 'Live Keys Configured'
                        : 'Hidden until live keys configured'}
                    </span>
                    <p className="ds-helper mt-1.5">
                      Unconfigured gateways are never shown as fake live card forms.
                    </p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 candy-card-white rounded-[32px] p-6 space-y-3">
                <h3 className="text-base font-extrabold font-wordmark text-[#50352F]">
                  Immutable Verification Audit Log
                </h3>
                {auditLogs.length === 0 ? (
                  <p className="ds-helper py-6 text-center">
                    No order status changes logged yet.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1">
                    {auditLogs.slice(0, 12).map((log) => (
                      <div
                        key={log.auditId}
                        className="p-3 rounded-2xl bg-[#FFF2DF]/65 border border-[#F0DEC6] text-xs"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-[#D66795] font-extrabold">
                          <span>#{log.orderNumber}</span>
                          <span>
                            {log.previousStatus} → {log.newStatus}
                          </span>
                        </div>
                        <div className="font-extrabold text-[#50352F] mt-0.5">{log.detail}</div>
                        <div className="text-[10px] font-semibold text-[#7A5A52] mt-0.5">
                          Actor: {log.actorUid} · {new Date(log.createdAtIso).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STORES & SELLERS */}
        {activeTab === 'stores' && (
          <div className="candy-card-white rounded-[32px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold font-wordmark text-[#50352F]">
                  Registered Creator Stores, Visit Analytics &amp; Instant Controls
                </h3>
                <p className="ds-helper">
                  Full Super Admin authority: inspect store visits, switch into any store’s dashboard or builder, toggle Pro plans, or activate/suspend stores immediately.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-[#F3E2CB] text-[#7A5A52] uppercase text-[11px]">
                    <th className="py-3 px-3">Store Name</th>
                    <th className="py-3 px-3">Seller</th>
                    <th className="py-3 px-3">Visits &amp; Traffic</th>
                    <th className="py-3 px-3">Country / Currency</th>
                    <th className="py-3 px-3">Plan Tier</th>
                    <th className="py-3 px-3">Products / Orders</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Instant Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3E2CB]">
                  {stores.map((st) => (
                    <tr key={st.storeId} className="hover:bg-[#FFF2DF]/45">
                      <td className="py-3.5 px-3 font-extrabold text-[#50352F]">
                        {st.storeName}
                        <div className="text-[11px] font-mono text-[#7A5A52]">
                          /{st.storeSlug}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-[#50352F]">{st.ownerName}</div>
                        <div className="text-[11px] text-[#7A5A52]">{st.ownerEmail}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="inline-flex items-center gap-1.5 font-extrabold text-[#50352F] tabular-nums">
                          <Eye className="w-3.5 h-3.5 text-[#D66795]" />
                          <span>{st.visitsCount ?? 24} visits</span>
                        </div>
                        <div className="text-[11px] text-[#7A5A52]">
                          {st.checkoutViewsCount ?? 6} checkouts
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="font-bold text-[#50352F]">{st.country}</span> ·{' '}
                        <span className="font-mono font-extrabold text-[#D66795]">{st.currency}</span>
                      </td>
                      <td className="py-3.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleToggleStorePlan(st)}
                          title="Click to toggle Pro / Free plan instantly"
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase cursor-pointer ${
                            st.planId === 'pro'
                              ? 'bg-[#50352F] text-[#FFD47B]'
                              : 'bg-[#FFF2DF] text-[#D66795] border border-[#E8D2B5]'
                          }`}
                        >
                          <Crown className="w-3 h-3" />
                          <span>{st.planId === 'pro' ? 'Pro Unlimited' : 'Free Starter'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-3 font-extrabold">
                        <div>{st.productCount} products</div>
                        <div className="text-[11px] text-[#7A5A52]">
                          {st.ordersCount ?? 0} orders ({st.pendingOrdersCount ?? 0} pending)
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        {st.status === 'active' && (
                          <span className="px-2.5 py-1 rounded-xl bg-[#E6F8EC] text-[#236B56] border border-[#AFE0BE] font-extrabold text-[11px]">
                            Active
                          </span>
                        )}
                        {st.status === 'suspended' && (
                          <span className="px-2.5 py-1 rounded-xl bg-[#FFE7F1] text-[#9E3B66] border border-[#F58CB7] font-extrabold text-[11px]">
                            Suspended
                          </span>
                        )}
                        {st.status === 'pending_review' && (
                          <span className="px-2.5 py-1 rounded-xl bg-[#FFF6DA] text-[#8A5A19] border border-[#FFD47B] font-extrabold text-[11px]">
                            Pending Review
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleControlTargetStore(st, 'owner-dashboard')}
                            className="candy-btn-pink px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>Control</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStore(st)}
                            className="candy-btn-cream px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          {st.status !== 'active' && (
                            <button
                              onClick={() => handleToggleStoreStatus(st.storeId, 'active')}
                              className="candy-btn-mint px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                          {st.status !== 'suspended' && (
                            <button
                              onClick={() => handleToggleStoreStatus(st.storeId, 'suspended')}
                              className="px-2.5 py-1.5 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66] text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                            >
                              <Ban className="w-3 h-3" />
                              Suspend
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3 & 4: ALL ORDERS & PAYMENT VERIFICATION */}
        {(activeTab === 'orders' || activeTab === 'payments') && (
          <div className="candy-card-white rounded-[32px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold font-wordmark text-[#50352F]">
                  {activeTab === 'payments'
                    ? 'Manual Payment Reference Verification Queue'
                    : 'Platform-Wide Orders & Download Gate Control'}
                </h3>
                <p className="ds-helper">
                  Verify JazzCash, Easypaisa, UPI, or Bank Transfer references before unlocking buyer digital downloads.
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search order #, buyer, or TID ref..."
                  className="candy-input pl-9"
                />
              </div>
            </div>

            <div className="space-y-3">
              {filteredOrders.map((ord) => {
                const cb = ord.commissionBreakdown;
                return (
                  <div
                    key={ord.id}
                    className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-[#D66795]">
                          #{ord.orderNumber}
                        </span>
                        <span className="font-extrabold text-sm text-[#50352F]">
                          {ord.productTitle}
                        </span>
                        {ord.paymentStatus === 'Paid' && (
                          <span className="px-2.5 py-0.5 rounded-xl bg-[#E6F8EC] text-[#236B56] border border-[#AFE0BE] text-[11px] font-extrabold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Paid (Download Unlocked)
                          </span>
                        )}
                        {ord.paymentStatus === 'Pending' && (
                          <span className="px-2.5 py-0.5 rounded-xl bg-[#FFF6DA] text-[#8A5A19] border border-[#FFD47B] text-[11px] font-extrabold inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Pending Verification (Locked)
                          </span>
                        )}
                        {ord.paymentStatus === 'Failed' && (
                          <span className="px-2.5 py-0.5 rounded-xl bg-[#FFE7F1] text-[#9E3B66] border border-[#F58CB7] text-[11px] font-extrabold inline-flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Failed / Rejected (Locked)
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold ${
                            ord.verificationMode === 'Gateway Verified' ||
                            ord.verificationMode === 'Instant Free'
                              ? 'bg-[#E6F8EC] text-[#236B56]'
                              : ord.verificationMode === 'Manually Verified by Seller'
                              ? 'bg-[#FFF6DA] text-[#8A5A19]'
                              : 'bg-[#FFFDF8] text-[#7A5A52]'
                          }`}
                        >
                          {ord.verificationMode || 'Unverified Reference'}
                        </span>
                      </div>

                      <div className="text-xs text-[#6E4D45]">
                        Buyer: <strong className="text-[#50352F]">{ord.customerName}</strong> (
                        {ord.customerEmail}) · Method:{' '}
                        <strong className="uppercase">{ord.paymentMethod}</strong> · Ref:{' '}
                        <code className="px-1.5 py-0.5 rounded-md bg-[#FFFDF8] border border-[#F0DEC6] font-mono text-[11px] text-[#D66795] font-extrabold">
                          {ord.paymentReference || 'N/A'}
                        </code>
                      </div>

                      {cb && (
                        <div className="text-[11px] font-mono font-bold text-[#6E4D45] flex flex-wrap gap-4 pt-1">
                          <span>
                            Gross:{' '}
                            <strong className="text-[#50352F]">
                              {formatMinorToMajor(cb.grossAmountMinor, ord.currency)}
                            </strong>
                          </span>
                          <span className="text-[#D66795]">
                            5% Platform Fee:{' '}
                            <strong>
                              {formatMinorToMajor(cb.platformCommissionMinor, ord.currency)}
                            </strong>
                          </span>
                          <span className="text-[#236B56]">
                            95% Seller Net:{' '}
                            <strong>
                              {formatMinorToMajor(cb.sellerNetEarningsMinor, ord.currency)}
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ord.paymentStatus !== 'Paid' && (
                        <button
                          onClick={async () => {
                            if (!window.confirm('Have you independently verified CLEARED funds in the seller bank or wallet statement? A screenshot or reference alone is not proof of payment.')) return;
                            try {
                              await triggerOrderUpdate(
                                ord.id,
                                'Paid',
                                'Super Admin independently confirmed cleared payment'
                              );
                              showToast(`Order #${ord.orderNumber} marked Paid & unlocked`);
                            } catch (error) {
                              showToast(error instanceof Error ? error.message : 'Order verification failed.', {
                                title: 'Payment Verification Failed', variant: 'error',
                              });
                            }
                          }}
                          className="candy-btn-mint px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer"
                        >
                          Approve &amp; Mark Paid
                        </button>
                      )}
                      {ord.paymentStatus !== 'Pending' && (
                        <button
                          onClick={async () => {
                            try {
                              await triggerOrderUpdate(ord.id, 'Pending', 'Super Admin reverted order to Pending review');
                              showToast(`Order #${ord.orderNumber} set to Pending`);
                            } catch (error) {
                              showToast(error instanceof Error ? error.message : 'Order status update failed.', {
                                title: 'Order Update Failed', variant: 'error',
                              });
                            }
                          }}
                          className="candy-btn-butter px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer"
                        >
                          Set Pending
                        </button>
                      )}
                      {ord.paymentStatus !== 'Failed' && (
                        <button
                          onClick={async () => {
                            try {
                              await triggerOrderUpdate(ord.id, 'Failed', 'Super Admin rejected invalid payment reference');
                              showToast(`Order #${ord.orderNumber} marked Failed`);
                            } catch (error) {
                              showToast(error instanceof Error ? error.message : 'Order status update failed.', {
                                title: 'Order Update Failed', variant: 'error',
                              });
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66] text-xs font-extrabold cursor-pointer"
                        >
                          Reject / Fail
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 5: 5% COMMISSIONS LEDGER & INVOICE GOVERNANCE */}
        {activeTab === 'commissions' && (
          <div className="candy-card-white rounded-[32px] p-6 space-y-6">
            <div>
              <h3 className="text-lg font-extrabold font-wordmark text-[#50352F]">
                5% Platform Commission &amp; 95% Seller Net Earnings Ledger
              </h3>
              <p className="ds-helper">
                Automated gateways split 5% on settlement; manual JazzCash/Easypaisa/UPI/Bank orders record a 5% platform commission invoice due within 7 days of threshold.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['PKR', 'USD', 'INR'] as CurrencyCode[]).map((cur) => (
                <div
                  key={cur}
                  className="p-5 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-2"
                >
                  <div className="text-xs font-extrabold uppercase tracking-wider text-[#D66795]">
                    {cur} Verified Settlement Ledger
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#7A5A52] font-bold">Gross Verified Sales (100%):</span>
                    <span className="font-mono font-extrabold text-[#50352F]">
                      {formatMinorToMajor(gmvByCurrency[cur] || 0, cur)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#7A5A52] font-bold">DreamStore Commission (5%):</span>
                    <span className="font-mono font-extrabold text-[#D66795]">
                      {formatMinorToMajor(commissionByCurrency[cur] || 0, cur)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-[#F0DEC6]">
                    <span className="text-[#7A5A52] font-bold">Seller Net Earnings (95%):</span>
                    <span className="font-mono font-extrabold text-[#236B56]">
                      {formatMinorToMajor(netSellerByCurrency[cur] || 0, cur)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Seller Commission Invoices Queue (Approve / Reject / Waive) */}
            <div className="space-y-3 pt-2 border-t-2 border-[#F3E2CB]">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-[#50352F]">
                    Seller 5% Commission Invoices ({commissionInvoices.length})
                  </h4>
                  <p className="ds-helper">
                    Review submitted seller commission payment proofs, approve settlement, or waive invoices.
                  </p>
                </div>
              </div>

              {commissionInvoices.length === 0 ? (
                <div className="p-6 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] text-center ds-helper">
                  No seller commission invoices generated yet. Invoices generate automatically once a seller reaches 5 verified sales or the threshold amount.
                </div>
              ) : (
                <div className="space-y-3">
                  {commissionInvoices.map((inv) => (
                    <div
                      key={inv.invoiceId}
                      data-testid={`admin-commission-invoice-${inv.invoiceNumber}`}
                      className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-extrabold text-[#D66795]">
                            {inv.invoiceNumber}
                          </span>
                          <span className="font-extrabold text-[#50352F]">{inv.storeId}</span>
                          <span
                            className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${
                              inv.status === 'paid' || inv.status === 'voided'
                                ? 'bg-[#E6F8EC] text-[#236B56]'
                                : inv.status === 'overdue'
                                ? 'bg-[#FFE7F1] text-[#9E3B66]'
                                : 'bg-[#FFF6DA] text-[#8A5A19]'
                            }`}
                          >
                            {inv.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-[#6E4D45] font-mono font-bold">
                          Gross Sales: {formatMinorToMajor(inv.grossSalesMinor, inv.currency)} · 5% Fee Due:{' '}
                          <strong className="text-[#D66795]">
                            {formatMinorToMajor(inv.commissionAmountMinor, inv.currency)}
                          </strong>{' '}
                          · Remaining:{' '}
                          <strong>
                            {formatMinorToMajor(inv.remainingBalanceMinor, inv.currency)}
                          </strong>
                        </div>
                        {inv.lastPaymentReference && (
                          <div className="text-[11px] text-[#50352F]">
                            Submitted Proof: <strong className="uppercase">{inv.lastPaymentMethod}</strong> · Ref:{' '}
                            <code className="px-1.5 py-0.5 rounded-md bg-[#FFFDF8] border border-[#F0DEC6] font-mono text-[#D66795] font-extrabold">
                              {inv.lastPaymentReference}
                            </code>{' '}
                            {inv.lastPaymentProofNote ? `(${inv.lastPaymentProofNote})` : ''}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {inv.status !== 'paid' && inv.status !== 'voided' && (
                          <>
                            <button
                              type="button"
                              data-testid={`approve-commission-btn-${inv.invoiceNumber}`}
                              disabled={!commissionPayments.some(payment => payment.invoiceId === inv.invoiceId && payment.status === 'submitted')}
                              onClick={() => handleReviewCommissionInvoice(inv.invoiceId, 'approve')}
                              className="disabled:opacity-40 disabled:cursor-not-allowed candy-btn-mint px-3.5 py-2 rounded-xl text-[11px] font-extrabold cursor-pointer"
                            >
                              Verify Cleared Funds
                            </button>
                            <button
                              type="button"
                              data-testid={`reject-commission-btn-${inv.invoiceNumber}`}
                              onClick={() => handleReviewCommissionInvoice(inv.invoiceId, 'reject')}
                              className="px-3.5 py-2 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66] text-[11px] font-extrabold cursor-pointer"
                            >
                              Reject Proof
                            </button>
                            <button
                              type="button"
                              data-testid={`waive-commission-btn-${inv.invoiceNumber}`}
                              onClick={() => handleReviewCommissionInvoice(inv.invoiceId, 'waive')}
                              className="candy-btn-cream px-3.5 py-2 rounded-xl text-[11px] font-extrabold cursor-pointer"
                            >
                              Waive Fee
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: PLATFORM SETTINGS */}
        {activeTab === 'settings' && (
          <form
            onSubmit={handleSavePlatformSettings}
            className="candy-card-white rounded-[32px] p-6 space-y-5 max-w-2xl"
          >
            <div>
              <h3 className="text-lg font-extrabold font-wordmark text-[#50352F]">
                Platform Commission &amp; Governance Settings
              </h3>
              <p className="ds-helper">
                Changes apply immediately to new orders across all creator stores.
              </p>
            </div>

            <div>
              <label className="ds-label block mb-1.5">
                Platform Commission Rate (Basis Points — 500 = 5.00%)
              </label>
              <input
                type="number"
                min={0}
                max={3000}
                value={platformSettings.platformCommissionBps}
                onChange={(e) =>
                  setPlatformSettings({
                    ...platformSettings,
                    platformCommissionBps: Number(e.target.value),
                  })
                }
                className="candy-input"
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
              <div>
                <div className="text-xs font-extrabold text-[#50352F]">
                  Allow New Seller Store Registrations
                </div>
                <div className="ds-helper">
                  Registration controls are not yet connected to a durable server policy. New seller registrations cannot be disabled here.
                </div>
              </div>
              <input
                type="checkbox"
                checked={platformSettings.allowNewSellerRegistrations}
                disabled
                aria-label="Seller registration policy is not configurable yet"
                className="w-4 h-4 accent-[#F58CB7] disabled:opacity-50 cursor-not-allowed"
              />
            </div>

            <CandyButton type="submit" variant="pink" size="md">
              <span>Save Platform Governance Settings</span>
            </CandyButton>
          </form>
        )}
      </main>
    </div>
  );
};
