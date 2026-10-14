import React, { useState } from 'react';
import {
  Store,
  Home,
  Package,
  ShoppingBag,
  Palette,
  Settings,
  ExternalLink,
  Plus,
  Trash2,
  Edit3,
  Upload,
  CheckCircle2,
  Clock,
  XCircle,
  Copy,
  Check,
  Search,
  LogIn,
  LogOut,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Coins,
  AlertCircle,
  Sparkles,
  Lock,
  Crown,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import {
  buildPublicStoreUrl,
  calculateCommissionMinor,
  CommissionInvoice,
  CommissionStatus,
  CURRENCY_META,
  CurrencyCode,
  CUSTOM_ACCENT_PRESETS,
  formatMinorToMajor,
  GatewayServerStatus,
  INITIAL_ASSETS,
  LedgerAuditEntry,
  normalizeStoreThemeId,
  OrderItem,
  OrderPaymentStatus,
  Product,
  resolveStoreTheme,
  ScreenId,
  SellerCommissionStatusSummary,
  SellerPaymentSettings,
  STORE_THEMES,
  StoreConfig,
  StoreThemeId,
} from '../../types/dreamstore';
import { auth, getAuthHeaders, storage } from '../../lib/firebase';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { EditableText, EmptyOrdersGiftBoxSVG, PastelImage } from '../EditableText';
import {
  CandyButton,
  CandylandSummaryCard,
  CandyTone,
  ClayIcon,
  DreamButton,
  DreamDashboardModule,
  DreamStoreLogo,
} from '../ui/DreamUI';

interface StoreOwnerDashboardProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  products: Product[];
  onAddProduct: (product: Product) => Promise<void>;
  onUpdateProduct: (productId: string, partial: Partial<Product>) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  orders: OrderItem[];
  auditLogs?: LedgerAuditEntry[];
  onUpdateOrderStatus: (orderId: string, newStatus: OrderPaymentStatus) => Promise<void>;
  onUpdateCommissionStatus?: (
    orderNumber: string,
    newStatus: CommissionStatus
  ) => Promise<void>;
  sellerPaymentSettings: SellerPaymentSettings;
  onSavePaymentSettings: (settings: SellerPaymentSettings) => Promise<void>;
  gatewayStatus: GatewayServerStatus;
  currentUserUid: string | null;
  currentUserEmail: string | null;
  onSignInGoogle: () => Promise<void>;
  onSignOutGoogle: () => Promise<void>;
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isEditMode: boolean;
  activeOwnerTab?: OwnerTab;
  onSelectOwnerTab?: (tab: OwnerTab) => void;
}

export type OwnerTab = 'overview' | 'products' | 'orders' | 'appearance' | 'settings';

export const StoreOwnerDashboard: React.FC<StoreOwnerDashboardProps> = ({
  config,
  onUpdateConfig,
  products,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  orders,
  auditLogs = [],
  onUpdateOrderStatus,
  onUpdateCommissionStatus,
  sellerPaymentSettings,
  onSavePaymentSettings,
  gatewayStatus,
  currentUserUid,
  currentUserEmail,
  onSignInGoogle,
  onSignOutGoogle,
  onNavigate,
  isEditMode,
  activeOwnerTab,
  onSelectOwnerTab,
}) => {
  const [internalTab, setInternalTab] = useState<OwnerTab>(activeOwnerTab || 'overview');
  const activeTab = activeOwnerTab || internalTab;
  const setActiveTab = (nextTab: OwnerTab) => {
    setInternalTab(nextTab);
    onSelectOwnerTab?.(nextTab);
  };
  const [ordersSubTab, setOrdersSubTab] = useState<'orders' | 'commission'>('orders');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewThemeId, setPreviewThemeId] = useState<StoreThemeId | null>(null);

  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [imageUploadStatus, setImageUploadStatus] = useState<string | null>(null);
  const [fileUploadStatus, setFileUploadStatus] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUploadingDigitalFile, setIsUploadingDigitalFile] = useState(false);
  const [draftProductId, setDraftProductId] = useState(() => `prod-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const [statementCheckedByOrder, setStatementCheckedByOrder] = useState<Record<string, boolean>>(
    {}
  );

  // Track orders whose status transitions from 'Processing' to 'Completed' for smooth fade-in & slide-down animation
  const [recentlyCompletedOrderIds, setRecentlyCompletedOrderIds] = useState<
    Record<string, boolean>
  >({});
  const prevOrderStatusMapRef = React.useRef<
    Record<string, { status: OrderItem['status']; paymentStatus: OrderPaymentStatus }>
  >({});

  const markOrderTransitionedToCompleted = React.useCallback((orderId: string) => {
    setRecentlyCompletedOrderIds((prev) => ({ ...prev, [orderId]: true }));
  }, []);

  React.useEffect(() => {
    const prevMap = prevOrderStatusMapRef.current;
    const newlyCompletedIds: string[] = [];

    for (const ord of orders) {
      const effectiveStatus: OrderItem['status'] =
        ord.status === 'Completed' || ord.paymentStatus === 'Paid' ? 'Completed' : 'Processing';
      const prevEntry = prevMap[ord.id];
      if (
        prevEntry &&
        (prevEntry.status === 'Processing' || prevEntry.paymentStatus === 'Pending') &&
        effectiveStatus === 'Completed'
      ) {
        newlyCompletedIds.push(ord.id);
      }
      prevMap[ord.id] = {
        status: effectiveStatus,
        paymentStatus: ord.paymentStatus,
      };
    }

    if (newlyCompletedIds.length > 0) {
      setRecentlyCompletedOrderIds((prev) => {
        const next = { ...prev };
        for (const id of newlyCompletedIds) {
          next[id] = true;
        }
        return next;
      });
    }
  }, [orders]);

  // Express Payment Verification Modal & 3-Step Checklist State
  const [reviewingOrder, setReviewingOrder] = useState<OrderItem | null>(null);
  const [checkAppOpened, setCheckAppOpened] = useState(false);
  const [checkRefMatched, setCheckRefMatched] = useState(false);
  const [checkAmountMatched, setCheckAmountMatched] = useState(false);
  const [isVerifyingExpress, setIsVerifyingExpress] = useState(false);
  const [expressVerifyError, setExpressVerifyError] = useState<string | null>(null);
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);

  const openExpressReviewModal = (ord: OrderItem) => {
    setReviewingOrder(ord);
    setCheckAppOpened(false);
    setCheckRefMatched(false);
    setCheckAmountMatched(false);
    setExpressVerifyError(null);
  };

  const pendingOrders = orders.filter((o) => o.paymentStatus === 'Pending');
  const publishedProductsCount = products.filter((p) => p.published).length;

  // Product Form State
  const [prodTitle, setProdTitle] = useState('');
  const [prodCategory, setProdCategory] = useState<Product['category']>('Ebooks');
  const [prodSubtitle, setProdSubtitle] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodIsFree, setProdIsFree] = useState(false);
  const [prodPriceUsd, setProdPriceUsd] = useState<number>(29);
  const [prodPricePkr, setProdPricePkr] = useState<number>(8050);
  const [prodPublished, setProdPublished] = useState(true);
  const [prodImage, setProdImage] = useState<string>(products[0]?.image || config.heroImage);
  const [prodFileName, setProdFileName] = useState('');
  const [prodFileType, setProdFileType] = useState('');
  const [prodFileSize, setProdFileSize] = useState('');
  const [prodFileDataUrl, setProdFileDataUrl] = useState('');

  // Orders Filter State
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'All' | OrderPaymentStatus>('All');

  // Payment Settings Form State
  const [paymentDraft, setPaymentDraft] = useState<SellerPaymentSettings>(sellerPaymentSettings);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  React.useEffect(() => {
    setPaymentDraft(sellerPaymentSettings);
  }, [sellerPaymentSettings]);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 2800);
  };

  // Real calculated metrics from actual state / Firestore records
  const paidOrders = orders.filter((o) => o.paymentStatus === 'Paid');
  const totalRevenueUsd = paidOrders.reduce((sum, o) => {
    if (o.currency === 'USD') return sum + o.totalAmount;
    const rate = CURRENCY_META[o.currency]?.rateFromUsd || (config.exchangeRatePkr || 278);
    return sum + Math.round((o.totalAmount / rate) * 100) / 100;
  }, 0);
  const totalRevenuePkr = paidOrders.reduce((sum, o) => {
    if (o.currency === 'PKR') return sum + o.totalAmount;
    return sum + Math.round(o.totalAmount * (config.exchangeRatePkr || 278));
  }, 0);
  const commissionRateBps = gatewayStatus.platformCommissionBps || 500;
  const pkrCommissionSummary = calculateCommissionMinor(
    totalRevenuePkr,
    'PKR',
    commissionRateBps,
    'jazzcash'
  );

  // Currency-aware sales and pending orders totals for the active store currency
  const storeCurrency = config.currency || 'PKR';
  const totalRevenueInStoreCurrency = paidOrders.reduce((sum, o) => {
    if (o.currency === storeCurrency) return sum + o.totalAmount;
    const orderRateFromUsd = CURRENCY_META[o.currency]?.rateFromUsd || (config.exchangeRatePkr || 278);
    const usdAmount = o.currency === 'USD' ? o.totalAmount : o.totalAmount / orderRateFromUsd;
    const targetRateFromUsd =
      storeCurrency === 'USD'
        ? 1
        : CURRENCY_META[storeCurrency]?.rateFromUsd || (config.exchangeRatePkr || 278);
    return sum + Math.round(usdAmount * targetRateFromUsd * 100) / 100;
  }, 0);
  const storeCommissionSummary = calculateCommissionMinor(
    totalRevenueInStoreCurrency,
    storeCurrency,
    commissionRateBps,
    'jazzcash'
  );
  const totalPendingInStoreCurrency = pendingOrders.reduce((sum, o) => {
    if (o.currency === storeCurrency) return sum + o.totalAmount;
    const orderRateFromUsd = CURRENCY_META[o.currency]?.rateFromUsd || (config.exchangeRatePkr || 278);
    const usdAmount = o.currency === 'USD' ? o.totalAmount : o.totalAmount / orderRateFromUsd;
    const targetRateFromUsd =
      storeCurrency === 'USD'
        ? 1
        : CURRENCY_META[storeCurrency]?.rateFromUsd || (config.exchangeRatePkr || 278);
    return sum + Math.round(usdAmount * targetRateFromUsd * 100) / 100;
  }, 0);
  const pendingCommissionSummary = calculateCommissionMinor(
    totalPendingInStoreCurrency,
    storeCurrency,
    commissionRateBps,
    'jazzcash'
  );

  // Smart 5% Commission Management System State
  const [commissionSummary, setCommissionSummary] = useState<SellerCommissionStatusSummary | null>(
    null
  );
  const [payingInvoice, setPayingInvoice] = useState<CommissionInvoice | null>(null);
  const [commPayMethod, setCommPayMethod] = useState('jazzcash');
  const [commPayRef, setCommPayRef] = useState('');
  const [commPayProof, setCommPayProof] = useState('');
  const [commPaySubmitting, setCommPaySubmitting] = useState(false);
  const [commPayError, setCommPayError] = useState<string | null>(null);
  const [publishSparkleBanner, setPublishSparkleBanner] = useState<string | null>(null);

  const effectiveSellerId = currentUserUid || config.ownerId || 'seller-pk-fatima';

  const fetchCommissionStatus = React.useCallback(async () => {
    if (!currentUserUid) return;
    try {
      const authHeaders = await getAuthHeaders();
      const resp = await fetch(
        `/api/commission/status?sellerId=${encodeURIComponent(currentUserUid)}`,
        { headers: authHeaders }
      );
      if (resp.ok) {
        const data = (await resp.json()) as SellerCommissionStatusSummary;
        setCommissionSummary(data);
      }
    } catch {
      // Ignore transient network errors
    }
  }, [currentUserUid]);

  React.useEffect(() => {
    fetchCommissionStatus();
  }, [fetchCommissionStatus, orders.length, paidOrders.length]);

  const handleOpenPayCommissionModal = (inv?: CommissionInvoice) => {
    const target =
      inv ||
      commissionSummary?.invoices.find(
        (i) => i.remainingBalanceMinor > 0 && i.status !== 'paid' && i.status !== 'voided'
      ) ||
      null;
    if (!target) {
      setActiveTab('orders');
      setOrdersSubTab('commission');
      return;
    }
    setPayingInvoice(target);
    setCommPayMethod('jazzcash');
    setCommPayRef('');
    setCommPayProof('');
    setCommPayError(null);
  };

  const handleSubmitCommissionPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingInvoice) return;
    if (commPayRef.trim().length < 3) {
      setCommPayError('Please enter a valid payment transaction reference (at least 3 characters).');
      return;
    }
    setCommPaySubmitting(true);
    setCommPayError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const resp = await fetch('/api/commission/submit-payment', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          invoiceId: payingInvoice.invoiceId,
          amountMinor: payingInvoice.remainingBalanceMinor,
          paymentMethod: commPayMethod,
          paymentReference: commPayRef.trim(),
          proofNote:
            commPayProof.trim() ||
            `Commission payment submitted via ${commPayMethod.toUpperCase()}`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setCommPayError(data.error || 'Could not submit commission payment.');
        return;
      }
      if (data.commissionSummary) {
        setCommissionSummary(data.commissionSummary);
      } else {
        await fetchCommissionStatus();
      }
      setPayingInvoice(null);
      showToast(
        `Commission payment proof submitted for ${payingInvoice.invoiceNumber}! Awaiting Super Admin verification.`
      );
    } catch (err) {
      setCommPayError(err instanceof Error ? err.message : 'Network error submitting payment.');
    } finally {
      setCommPaySubmitting(false);
    }
  };

  const openCreateProductModal = () => {
    if (commissionSummary?.isRestricted) {
      showToast(
        'Adding new products is paused due to an overdue 5% commission invoice. Settle your commission to unlock.'
      );
      handleOpenPayCommissionModal();
      return;
    }
    setEditingProductId(null);
    setDraftProductId(`prod-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    setProductFormError(null);
    setImageUploadStatus(null);
    setFileUploadStatus(null);
    setProdTitle('');
    setProdCategory('Ebooks');
    setProdSubtitle('');
    setProdDescription('');
    setProdIsFree(false);
    setProdPriceUsd(29);
    setProdPricePkr(8050);
    setProdPublished(true);
    setProdImage(products[0]?.image || config.heroImage);
    setProdFileName('');
    setProdFileType('');
    setProdFileSize('');
    setProdFileDataUrl('');
    setShowProductModal(true);
  };

  const openEditProductModal = (prod: Product) => {
    setEditingProductId(prod.id);
    setProductFormError(null);
    setImageUploadStatus(null);
    setFileUploadStatus(null);
    setProdTitle(prod.title);
    setProdCategory(prod.category);
    setProdSubtitle(prod.subtitle);
    setProdDescription(prod.description);
    setProdIsFree(prod.isFree);
    setProdPriceUsd(prod.priceUsd);
    setProdPricePkr(prod.pricePkr);
    setProdPublished(prod.published);
    setProdImage(prod.image);
    setProdFileName(prod.fileName);
    setProdFileType(prod.fileType);
    setProdFileSize(prod.fileSizeLabel);
    setProdFileDataUrl(prod.fileDataUrl || '');
    setShowProductModal(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploadStatus('Uploading cover image...');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProdImage(reader.result);
        setImageUploadStatus(`Cover ready: ${file.name}`);
      }
    };
    reader.onerror = () => {
      setImageUploadStatus('Could not read cover image file. Please try another PNG or JPG.');
    };
    reader.readAsDataURL(file);
  };

  const handleDigitalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProdFileDataUrl('');
    setProductFormError(null);
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    const supportedTypes: Record<string, string> = {
      pdf: 'application/pdf',
      zip: 'application/zip',
      epub: 'application/epub+zip',
      txt: 'text/plain',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const contentType = supportedTypes[extension];
    if (!contentType || file.size < 1 || file.size > MAX_FILE_BYTES) {
      const message = !contentType
        ? 'Choose a PDF, EPUB, ZIP, TXT, DOC or DOCX file.'
        : file.size < 1
        ? 'The file is empty. Please choose a valid file.'
        : 'Maximum file size is 5 MB. Choose a smaller original file.';
      setFileUploadStatus(message);
      setProductFormError(message);
      return;
    }
    if (!currentUserUid) {
      setProductFormError('Sign in with a verified seller account before uploading.');
      setFileUploadStatus('Sign in to upload.');
      return;
    }

    setIsUploadingDigitalFile(true);
    setFileUploadStatus('Uploading original file (0%)...');
    const productId = editingProductId || draftProductId;
    try {
      let privateReference = '';
      const sdkUid = auth.currentUser?.uid;
      if (sdkUid === currentUserUid && auth.currentUser?.emailVerified) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
        const objectPath = `deliverables/${sdkUid}/${productId}/${Date.now()}-${safeName}`;
        const task = uploadBytesResumable(storageRef(storage, objectPath), file, { contentType });
        await new Promise<void>((resolve, reject) => {
          task.on(
            'state_changed',
            (snapshot) => {
              const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setFileUploadStatus(`Uploading original file (${pct}%)...`);
            },
            reject,
            resolve
          );
        });
        privateReference = `storage://${objectPath}`;
      } else {
        // Server-email accounts do not have a Firebase browser SDK session.
        // Upload the original bytes through a verified seller-only backend route.
        const headers = await getAuthHeaders();
        const upload = await fetch('/api/uploads/product', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'X-Product-ID': productId,
            'X-Store-ID': config.storeId,
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Type': contentType,
          },
          body: file,
        });
        const result = await upload.json().catch(() => ({}));
        if (!upload.ok || !String(result.fileReference || '').startsWith('storage://')) {
          throw new Error(result.error || 'The original file could not be uploaded.');
        }
        privateReference = result.fileReference;
      }
      const sizeLabel = file.size >= 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.ceil(file.size / 1024)} KB`;
      setProdFileName(file.name);
      setProdFileType(contentType);
      setProdFileSize(sizeLabel);
      setProdFileDataUrl(privateReference);
      setFileUploadStatus(`Original file securely uploaded: ${file.name} (${sizeLabel})`);
    } catch {
      setProdFileDataUrl('');
      setProdFileName('');
      setProdFileType('');
      setProdFileSize('');
      setProductFormError('Upload failed. Your product has not been published. Check Firebase Storage access.');
      setFileUploadStatus('Secure file upload failed. Please try again.');
    } finally {
      setIsUploadingDigitalFile(false);
    }
  };

  const handleSaveProductForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductFormError(null);
    if (isUploadingDigitalFile) {
      setProductFormError('Wait until the original file finishes uploading.');
      return;
    }
    if (prodPublished && !editingProductId && !prodFileDataUrl.startsWith('storage://') && !prodFileDataUrl.startsWith('data:')) {
      setProductFormError('Upload a real digital file before publishing this product. Demo files are never substituted.');
      return;
    }
    if (!prodTitle.trim() || prodTitle.trim().length < 2) {
      setProductFormError('Please enter a product title (at least 2 characters).');
      return;
    }

    setIsSavingProduct(true);
    try {
      const finalUsd = prodIsFree ? 0 : Math.max(1, Number(prodPriceUsd) || 29);
      const finalPkr = prodIsFree
        ? 0
        : Math.max(
            100,
            Number(prodPricePkr) || Math.round(finalUsd * (config.exchangeRatePkr || 278))
          );

      const payload: Product = {
        id: editingProductId || draftProductId,
        storeId: config.storeId,
        ownerId: currentUserUid || config.ownerId,
        title: prodTitle.trim(),
        category: prodCategory,
        subtitle:
          prodSubtitle.trim() ||
          prodDescription.trim().slice(0, 120) ||
          'A gentle digital guide for mindful daily growth.',
        description:
          prodDescription.trim() ||
          'Thoughtfully crafted digital resource with step-by-step exercises and printable templates.',
        whatsIncluded: [
          `Complete ${prodFileName} (${prodFileSize})`,
          'Printable & Tablet-Friendly Worksheets',
          'Lifetime Instant Digital Access',
        ],
        details: [
          { label: 'Format', value: prodFileType },
          { label: 'File Size', value: prodFileSize },
          { label: 'Delivery', value: 'Instant Verified Download' },
        ],
        price: finalUsd,
        priceUsd: finalUsd,
        pricePkr: finalPkr,
        isFree: prodIsFree,
        published: prodPublished,
        status: prodPublished ? 'Available' : 'Draft',
        image: prodImage,
        gallery: [prodImage, config.heroImage],
        features: products[0]?.features || [
          { title: 'PDF Format', subtitle: 'Instant Download', icon: 'pdf' },
          { title: 'Easy to Follow', subtitle: 'Step-by-Step Guide', icon: 'guide' },
          { title: 'Full of Practical Tools', subtitle: 'Worksheets & Templates', icon: 'tools' },
        ],
        fileName: prodFileName,
        fileType: prodFileType,
        fileSizeLabel: prodFileSize,
        fileDataUrl: prodFileDataUrl,
      };

      if (editingProductId) {
        await onUpdateProduct(editingProductId, payload);
        showToast('Product updated successfully');
      } else {
        await onAddProduct(payload);
        showToast('Product published to your store');
        setPublishSparkleBanner(payload.title);
        setTimeout(() => setPublishSparkleBanner(null), 6000);
      }
      setShowProductModal(false);
    } catch (err) {
      setProductFormError(err instanceof Error ? err.message : 'Product could not be saved. Please retry.');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const filteredOrders = orders.filter((ord) => {
    const matchesStatus =
      orderStatusFilter === 'All' || ord.paymentStatus === orderStatusFilter;
    const matchesSearch =
      ord.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
      ord.customerEmail.toLowerCase().includes(orderSearch.toLowerCase()) ||
      ord.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
      ord.itemTitlesSummary.toLowerCase().includes(orderSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const storefrontUrl = buildPublicStoreUrl(config.storeSlug || 'fatima.tech');

  // SELLER NAVIGATION: Dashboard · My Store · Products · Orders · Store Design · Settings
  const navItems: Array<{
    id: OwnerTab | 'my-store';
    label: string;
    badge?: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Dashboard', icon: Home },
    { id: 'my-store', label: 'My Store', icon: Store },
    { id: 'products', label: 'Products', badge: products.length, icon: Package },
    {
      id: 'orders',
      label: 'Orders',
      badge: pendingOrders.length > 0 ? pendingOrders.length : orders.length,
      icon: ShoppingBag,
    },
    { id: 'appearance', label: 'Store Design', icon: Palette },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleSellerNavClick = (id: OwnerTab | 'my-store') => {
    if (id === 'my-store') {
      onNavigate('storefront');
    } else {
      setActiveTab(id);
    }
  };

  // Setup Checklist state for new sellers
  const hasCustomName = Boolean(config.storeName && config.storeName.trim().length >= 2);
  const hasPublishedProducts = publishedProductsCount > 0;
  const hasPaymentAccountConfigured = Boolean(
    paymentDraft.jazzCashMerchantId ||
      paymentDraft.easypaisaStoreId ||
      paymentDraft.upiId ||
      paymentDraft.bankTransferInstructions
  );

  return (
    <div className="min-h-screen bg-[#FFF2DF] flex flex-col lg:flex-row text-[#50352F] overflow-x-hidden">
      {/* SELLER NAVIGATION: 6 ITEMS (Desktop Sidebar + Mobile Tab Bar) */}
      <aside
        className={`w-full ${
          sidebarCollapsed ? 'lg:w-[88px]' : 'lg:w-[268px]'
        } bg-[#FFFDF8] border-b-2 lg:border-b-0 lg:border-r-2 border-[#F3E2CB] p-4 sm:p-5 flex flex-col justify-between shrink-0 transition-all duration-200`}
      >
        <div>
          {/* Top Brand Header + Collapse Toggle */}
          <div className="flex items-center justify-between gap-2 pb-4 border-b-2 border-[#F3E2CB]">
            {!sidebarCollapsed ? (
              <DreamStoreLogo
                brandText="DreamStore"
                showTagline={false}
                size="sm"
                onClick={() => onNavigate('landing')}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="w-11 h-11 rounded-2xl candy-btn-pink flex items-center justify-center text-[#50352F] mx-auto cursor-pointer"
                title="Expand Sidebar"
              >
                <Store className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex w-9 h-9 rounded-xl candy-btn-white items-center justify-center text-[#50352F] transition-colors cursor-pointer shrink-0"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Active Seller Store Summary */}
          {!sidebarCollapsed && (
            <div className="mt-4 mb-4 p-3 rounded-[22px] bg-[#FFF2DF] border-2 border-[#F0DEC6] flex items-center gap-3">
              <PastelImage
                src={config.logoUrl}
                alt={config.storeName}
                className="w-10 h-10 rounded-xl object-cover border-2 border-[#F58CB7] shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[14px] font-candy font-bold text-[#50352F] truncate">
                  <EditableText
                    value={config.storeName}
                    onChange={(val) => onUpdateConfig({ storeName: val })}
                    isEditMode={isEditMode}
                  />
                </div>
                <div className="ds-helper truncate">
                  {config.currency} · {config.sellerCountry || 'Creator Store'}
                </div>
              </div>
            </div>
          )}

          {/* Desktop 6-Item Sidebar Navigation */}
          <nav aria-label="Seller Dashboard Navigation" className="hidden lg:block space-y-2 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id !== 'my-store' && activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSellerNavClick(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`w-full flex items-center ${
                    sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                  } py-2.5 rounded-2xl text-[15px] font-bold transition-all cursor-pointer min-h-[46px] ${
                    isActive
                      ? 'candy-btn-pink text-[#50352F]'
                      : 'text-[#7A5A52] hover:bg-[#FFF2DF] hover:text-[#50352F]'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!sidebarCollapsed && item.badge !== undefined && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FFFDF8] border border-[#50352F]/15 text-xs font-extrabold text-[#50352F] tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Mobile 6-Item Navigation Bar */}
          <nav
            aria-label="Mobile Seller Navigation"
            className="lg:hidden flex items-center gap-2 overflow-x-auto pt-3 pb-1"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id !== 'my-store' && activeTab === item.id;
              const navTestId = `dashboard-nav-${
                item.id === 'appearance' ? 'store-design' : item.id
              }`;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={navTestId}
                  onClick={() => handleSellerNavClick(item.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-[14px] font-extrabold whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[44px] ${
                    isActive
                      ? 'candy-btn-pink text-[#50352F]'
                      : 'candy-btn-white text-[#50352F]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className="opacity-85 tabular-nums">({item.badge})</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom View My Store Link (Desktop) */}
        <div className="hidden lg:block pt-4 border-t-2 border-[#F3E2CB] mt-6">
          <button
            type="button"
            onClick={() => onNavigate('storefront')}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'justify-between px-4'
            } py-2.5 rounded-full candy-btn-butter text-[14px] font-extrabold text-[#50352F] transition-colors cursor-pointer min-h-[44px]`}
          >
            {!sidebarCollapsed && <span>View My Store</span>}
            <ExternalLink className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA: Clean One-Column Stack for Mobile Devices (< 768px) */}
      <main className="flex-1 p-4 md:p-7 lg:p-10 max-w-[1140px] min-w-0 flex flex-col space-y-6">
        {/* TOP HEADER: Welcome + Primary Action ("Add Product") + Secondary Action ("View My Store") */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b-2 border-[#F3E2CB]">
          <div>
            <p className="ds-helper font-extrabold uppercase tracking-wider text-[#D66795]">
              Seller Dashboard · {config.storeName}
            </p>
            <h1 className="ds-page-title font-candy font-bold text-[#50352F] mt-0.5">
              Welcome back, {config.ownerName}!
            </h1>
          </div>

          <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-2.5">
            {statusToast && (
              <span className="px-4 py-2.5 rounded-full candy-btn-mint text-[#50352F] text-[14px] font-extrabold flex items-center justify-center gap-1.5 min-h-[44px] animate-ds-reveal">
                <Check className="w-4 h-4" /> {statusToast}
              </span>
            )}

            {/* Primary Action: Add Product */}
            <CandyButton
              data-testid="overview-add-product-btn"
              variant="primary"
              size="md"
              onClick={openCreateProductModal}
              icon={<Plus className="w-4 h-4" />}
              className="w-full md:w-auto px-5 py-3 min-h-[44px]"
            >
              <span>Add Product</span>
            </CandyButton>

            {/* Secondary Action: View My Store */}
            <CandyButton
              data-testid="overview-view-store-btn"
              variant="secondary"
              size="md"
              onClick={() => onNavigate('storefront')}
              icon={<ExternalLink className="w-4 h-4 text-[#D66795]" />}
              className="w-full md:w-auto px-5 py-3 min-h-[44px]"
            >
              <span>View My Store</span>
            </CandyButton>

            {!currentUserUid ? (
              <CandyButton
                variant="lavender"
                size="md"
                onClick={onSignInGoogle}
                icon={<LogIn className="w-4 h-4" />}
                className="w-full md:w-auto px-5 py-3 min-h-[44px]"
              >
                <span>Sign In</span>
              </CandyButton>
            ) : (
              <button
                type="button"
                onClick={onSignOutGoogle}
                title="Sign out"
                className="w-full md:w-auto px-4 py-2.5 rounded-full candy-btn-white text-[14px] font-bold text-[#50352F] flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>

        {/* PRODUCT PUBLISH SPARKLE CELEBRATION BANNER */}
        {publishSparkleBanner && (
          <div
            data-testid="product-publish-sparkle-banner"
            className="animate-ds-sparkle-once candy-card-mint rounded-[26px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <ClayIcon tone="butter" size="sm">
                <Sparkles className="w-4 h-4" />
              </ClayIcon>
              <div>
                <h3 className="text-sm font-candy font-bold text-[#50352F]">
                  ✨ &ldquo;{publishSparkleBanner}&rdquo; is live on your store!
                </h3>
                <p className="text-xs font-semibold text-[#50352F]/80">
                  Share your store link so buyers can discover and download it immediately.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('storefront')}
                className="min-h-[40px] px-4 py-2 rounded-full candy-btn-pink text-xs font-extrabold cursor-pointer"
              >
                View Live Store
              </button>
              <button
                type="button"
                onClick={() => setPublishSparkleBanner(null)}
                className="min-h-[40px] px-3.5 py-2 rounded-full candy-btn-white text-xs font-bold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* CALM, MINIMAL 5% COMMISSION REMINDER OR OVERDUE RESTRICTION BANNER */}
        {commissionSummary &&
          (commissionSummary.isRestricted ||
            commissionSummary.invoices.some(
              (i) => i.remainingBalanceMinor > 0 && i.status !== 'paid' && i.status !== 'voided'
            )) && (
            <div
              data-testid={
                commissionSummary.isRestricted
                  ? 'commission-overdue-restriction-banner'
                  : 'commission-open-invoice-banner'
              }
              className={`rounded-[26px] p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                commissionSummary.isRestricted ? 'candy-card-pink' : 'candy-card-butter'
              }`}
            >
              <div className="candy-inner-bed rounded-[20px] p-4 flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#D66795]">
                    {commissionSummary.isRestricted ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>7-Day Commission Deadline Passed — Seller Features Paused</span>
                      </>
                    ) : (
                      <>
                        <Coins className="w-3.5 h-3.5" />
                        <span>
                          5% Commission Invoice Due ({commissionSummary.daysUntilDeadline ?? 7} days
                          remaining)
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm font-bold text-[#50352F]">
                    {commissionSummary.isRestricted
                      ? commissionSummary.restrictionReason
                      : `You have an open 5% commission balance of ${formatMinorToMajor(
                          commissionSummary.invoicedOutstandingMinor,
                          commissionSummary.currency
                        )}. You have 7 days from invoice creation to submit payment proof.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="banner-pay-commission-btn"
                    onClick={() => handleOpenPayCommissionModal()}
                    className="min-h-[44px] px-4 py-2.5 rounded-full candy-btn-pink text-xs sm:text-sm font-extrabold cursor-pointer"
                  >
                    Pay Commission
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('orders');
                      setOrdersSubTab('commission');
                    }}
                    className="min-h-[44px] px-4 py-2.5 rounded-full candy-btn-white text-xs sm:text-sm font-bold cursor-pointer"
                  >
                    View Invoices
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* PROMINENT EXPRESS PAYMENT VERIFICATION NOTIFICATION BANNER (REAL-TIME PENDING ORDERS) */}
        {pendingOrders.length > 0 && (
          <div
            data-testid="payment-awaiting-review-banner"
            className="candy-card-pink rounded-[30px] p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-1">
              <div className="flex items-start gap-3">
                <ClayIcon tone="butter" size="md">
                  <Clock className="w-5 h-5" />
                </ClayIcon>
                <div className="space-y-0.5">
                  <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FFFDF8]" />
                    <span>Payment Awaiting Review ({pendingOrders.length})</span>
                  </div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    Action Required: Confirm Customer Payment
                  </h2>
                  <p className="text-sm text-[#50352F]/90 font-medium">
                    Check your wallet or bank statement for the reference below to mark as{' '}
                    <strong>Seller Verified</strong> and unlock the buyer&apos;s download.
                  </p>
                </div>
              </div>
              <div className="text-xs font-extrabold text-[#50352F] bg-[#FFFDF8] px-3.5 py-2 rounded-full border-2 border-[#50352F]/15 shrink-0">
                Label: <strong className="text-[#D66795]">Seller Verified</strong> (Not Bank Verified)
              </div>
            </div>

            <div className="space-y-3">
              {pendingOrders.map((ord) => (
                <div
                  key={ord.id}
                  data-testid={`pending-order-alert-${ord.orderNumber}`}
                  className="candy-inner-bed p-4 rounded-[22px] flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[14px]">
                      <span className="font-extrabold text-[#50352F] tabular-nums">
                        Order #{ord.orderNumber}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-bold text-[#B86B19]">
                        Payment Awaiting Review
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        data-testid="pending-order-amount-currency"
                        className="font-extrabold text-[#D66795] tabular-nums"
                      >
                        {ord.amount} ({ord.currency})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        data-testid="pending-order-method"
                        className="font-extrabold text-[#6D28D9] uppercase"
                      >
                        {ord.paymentMethod.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="text-[14px] text-[#50352F] font-semibold">
                      {ord.itemTitlesSummary} · Buyer: {ord.customerName}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="ds-helper font-semibold">Transaction Reference:</span>
                      <code
                        data-testid="pending-order-reference"
                        className="px-2.5 py-1 rounded-xl bg-[#FFF2DF] border-2 border-[#F0DEC6] text-[14px] font-extrabold text-[#D66795] font-mono"
                      >
                        {ord.paymentReference}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(ord.paymentReference);
                          setCopiedRefId(ord.id);
                          setTimeout(() => setCopiedRefId(null), 1800);
                        }}
                        className="px-3 py-1.5 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1 cursor-pointer min-h-[36px]"
                      >
                        {copiedRefId === ord.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#236B56]" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy Ref
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      data-testid="express-review-payment-btn"
                      onClick={() => openExpressReviewModal(ord)}
                      className="w-full md:w-auto px-5 py-3 rounded-full candy-btn-pink text-[15px] font-extrabold text-[#50352F] flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Review Payment</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW — Consolidated Single 'At-a-Glance' Card in Candyland 3D Style */}
        {activeTab === 'overview' && (() => {
          const completedStepsCount = [
            hasCustomName,
            hasPublishedProducts,
            hasPaymentAccountConfigured,
            copiedUrl,
          ].filter(Boolean).length;
          const progressWidthClass =
            completedStepsCount === 4
              ? 'w-full'
              : completedStepsCount === 3
              ? 'w-3/4'
              : completedStepsCount === 2
              ? 'w-1/2'
              : completedStepsCount === 1
              ? 'w-1/4'
              : 'w-[8%]';

          return (
            <div
              data-testid="dashboard-overview-tab"
              className="grid grid-cols-1 gap-4"
            >
              {/* CANDYLAND SUMMARY CARD (3D Claymorphic Total Sales & Pending Orders) */}
              <CandylandSummaryCard
                totalSalesAmount={formatMinorToMajor(
                  storeCommissionSummary.sellerNetEarningsMinor,
                  storeCurrency
                )}
                grossSalesAmount={formatMinorToMajor(
                  storeCommissionSummary.grossAmountMinor,
                  storeCurrency
                )}
                paidOrdersCount={paidOrders.length}
                pendingOrdersCount={pendingOrders.length}
                pendingOrdersAmount={formatMinorToMajor(
                  pendingCommissionSummary.grossAmountMinor,
                  storeCurrency
                )}
                currency={storeCurrency}
                storeName={config.storeName}
                onReviewPendingOrders={
                  pendingOrders[0]
                    ? () => openExpressReviewModal(pendingOrders[0])
                    : undefined
                }
                onViewAllOrders={() => {
                  setActiveTab('orders');
                  setOrdersSubTab('orders');
                }}
              />

              {/* SINGLE CONSOLIDATED 'AT-A-GLANCE' CARD */}
              <section
                data-testid="seller-at-a-glance-card"
                className="candy-card-white rounded-[30px] p-5 md:p-7 flex flex-col space-y-6"
              >
                {/* 1. Card Header + Primary Sales Summary Strip */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b-2 border-[#F3E2CB]">
                  <div className="flex items-center gap-3 min-w-0">
                    <ClayIcon tone="mint" size="md">
                      <Store className="w-5 h-5" />
                    </ClayIcon>
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                        <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                          At-a-Glance Overview
                        </h2>
                      </div>
                      <p className="ds-helper truncate" title={storefrontUrl}>
                        Live Storefront · {storefrontUrl}
                      </p>
                    </div>
                  </div>

                  {/* Actual Sales Summary Pill & Copy Link Action */}
                  <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5 shrink-0">
                    <div
                      data-testid="at-a-glance-sales-summary"
                      className="px-4 py-2.5 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] flex items-center justify-between md:justify-start gap-2.5 min-h-[44px]"
                    >
                      <span className="ds-helper font-bold text-[#7A5A52]">
                        Verified Sales (95% Net):
                      </span>
                      <span className="text-[15px] font-extrabold text-[#50352F] tabular-nums">
                        {formatMinorToMajor(
                          pkrCommissionSummary.sellerNetEarningsMinor,
                          'PKR'
                        )}
                      </span>
                      <span className="ds-helper text-[#D66795] font-extrabold tabular-nums">
                        ({paidOrders.length} paid)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(storefrontUrl);
                        setCopiedUrl(true);
                        showToast('Store link copied to clipboard');
                        setTimeout(() => setCopiedUrl(false), 2000);
                      }}
                      className="w-full md:w-auto px-4 py-2.5 rounded-full candy-btn-butter text-[14px] font-extrabold text-[#50352F] inline-flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
                    >
                      {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedUrl ? 'Copied Link' : 'Copy Store Link'}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Clean Secondary Metrics Grid with Raised ClayIcon Tiles */}
                <div
                  data-testid="at-a-glance-stats"
                  className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  {/* Secondary Metric 1: Store Status */}
                  <div className="p-4 rounded-[24px] bg-[#FFF2DF]/80 border-2 border-[#F0DEC6] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ClayIcon tone="mint" size="sm">
                        <Sparkles className="w-4 h-4" />
                      </ClayIcon>
                      <div className="min-w-0">
                        <span className="ds-helper font-bold text-[#7A5A52] block">
                          Store Status
                        </span>
                        <div className="text-[16px] font-candy font-bold text-[#50352F] mt-0.5 truncate">
                          Published &amp; Live
                        </div>
                        <p className="ds-helper mt-0.5 truncate">
                          {config.currency} · {resolveStoreTheme(config.theme).name}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('storefront')}
                      className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1 shrink-0 cursor-pointer min-h-[42px]"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-3.5 h-3.5 text-[#D66795]" />
                    </button>
                  </div>

                  {/* Secondary Metric 2: Total Products */}
                  <div className="p-4 rounded-[24px] bg-[#FFF2DF]/80 border-2 border-[#F0DEC6] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ClayIcon tone="lilac" size="sm">
                        <Package className="w-4 h-4" />
                      </ClayIcon>
                      <div className="min-w-0">
                        <span className="ds-helper font-bold text-[#7A5A52] block">
                          Total Products
                        </span>
                        <div className="text-[16px] font-candy font-bold text-[#50352F] mt-0.5 tabular-nums">
                          {products.length} {products.length === 1 ? 'Product' : 'Products'}
                        </div>
                        <p className="ds-helper mt-0.5">
                          {publishedProductsCount} live · {Math.max(0, products.length - publishedProductsCount)} draft
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('products')}
                      className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#D66795] shrink-0 cursor-pointer min-h-[42px]"
                    >
                      Manage
                    </button>
                  </div>

                  {/* Secondary Metric 3: Orders Needing Attention */}
                  <div className="p-4 rounded-[24px] bg-[#FFF2DF]/80 border-2 border-[#F0DEC6] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ClayIcon tone="butter" size="sm">
                        <ShoppingBag className="w-4 h-4" />
                      </ClayIcon>
                      <div className="min-w-0">
                        <span className="ds-helper font-bold text-[#7A5A52] block">
                          Orders &amp; Reviews
                        </span>
                        <div className="text-[16px] font-candy font-bold text-[#50352F] mt-0.5 tabular-nums">
                          {pendingOrders.length > 0
                            ? `${pendingOrders.length} Need Review`
                            : `${orders.length} Total Orders`}
                        </div>
                        <p className="ds-helper mt-0.5">
                          {pendingOrders.length > 0
                            ? 'Confirm reference to unlock'
                            : paidOrders.length > 0
                            ? `${paidOrders.length} verified paid`
                            : 'No pending reviews'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('orders');
                        setOrdersSubTab('orders');
                      }}
                      className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#D66795] shrink-0 cursor-pointer min-h-[42px]"
                    >
                      Orders ({orders.length})
                    </button>
                  </div>
                </div>

                {/* 3. Consolidated Onboarding Checklist (Inside the Same At-a-Glance Card) */}
                <div
                  data-testid="seller-setup-checklist"
                  className="pt-5 border-t-2 border-[#F3E2CB] flex flex-col space-y-3.5"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div className="flex items-center justify-between md:justify-start gap-3">
                      <h3 className="font-candy text-base font-bold text-[#50352F]">
                        Store Setup Checklist
                      </h3>
                      <span className="px-3 py-1 rounded-full bg-[#FFF2DF] border border-[#F0DEC6] text-xs font-extrabold text-[#D66795] tabular-nums">
                        {completedStepsCount} of 4 completed
                      </span>
                    </div>
                    <div className="w-full md:w-48 h-3 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] p-0.5 overflow-hidden">
                      <div
                        className={`h-full bg-[#F58CB7] rounded-full transition-all duration-300 ${progressWidthClass}`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      {
                        step: '1. Name store & claim link',
                        done: hasCustomName,
                        desc: `${config.storeName} (/?store=${config.storeSlug})`,
                        actionLabel: 'Store Info',
                        onClick: () => setActiveTab('settings'),
                      },
                      {
                        step: '2. Add digital products',
                        done: hasPublishedProducts,
                        desc: `${publishedProductsCount} published ${
                          publishedProductsCount === 1 ? 'product' : 'products'
                        } live`,
                        actionLabel: 'Add Product',
                        onClick: openCreateProductModal,
                      },
                      {
                        step: '3. Configure manual payments',
                        done: hasPaymentAccountConfigured,
                        desc: 'JazzCash, Easypaisa, UPI, or Bank Transfer',
                        actionLabel: 'Payments',
                        onClick: () => setActiveTab('settings'),
                      },
                      {
                        step: '4. Share your store link',
                        done: copiedUrl,
                        desc: 'Add your link to Instagram, TikTok, or WhatsApp',
                        actionLabel: copiedUrl ? 'Copied ✓' : 'Copy Link',
                        onClick: () => {
                          navigator.clipboard?.writeText(storefrontUrl);
                          setCopiedUrl(true);
                          showToast('Store link copied to clipboard');
                          setTimeout(() => setCopiedUrl(false), 2000);
                        },
                      },
                    ].map((item) => (
                      <div
                        key={item.step}
                        className="p-3.5 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col md:flex-row md:items-center justify-between gap-2.5"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <CheckCircle2
                            className={`w-5 h-5 mt-0.5 shrink-0 ${
                              item.done ? 'text-[#236B56] animate-candy-check' : 'text-[#BBA0EA]'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-[14px] font-bold text-[#50352F] leading-snug">
                              {item.step}
                            </div>
                            <p className="ds-helper truncate mt-0.5">{item.desc}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={item.onClick}
                          className="w-full md:w-auto px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] shrink-0 cursor-pointer min-h-[40px] text-center"
                        >
                          {item.actionLabel}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. SMART 5% COMMISSION PROGRESS STRIP */}
                <div
                  data-testid="overview-commission-progress"
                  className="pt-5 border-t-2 border-[#F3E2CB] flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center justify-between md:justify-start gap-3">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-[#D66795] flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5" />
                        5% Commission Cycle
                      </span>
                      <span
                        data-testid="commission-sales-progress-label"
                        className="text-xs font-extrabold text-[#50352F] tabular-nums"
                      >
                        Sales progress: {commissionSummary?.salesTowardNextInvoice ?? 0} of{' '}
                        {commissionSummary?.invoiceThreshold ?? 5} sales
                      </span>
                    </div>
                    <div className="w-full max-w-md h-2.5 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] overflow-hidden">
                      <div
                        className="h-full bg-[#F58CB7] rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              6,
                              ((commissionSummary?.salesTowardNextInvoice ?? 0) /
                                (commissionSummary?.invoiceThreshold ?? 5)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="ds-helper">
                      Invoices generate automatically after every 5 verified paid sales with a 7-day
                      payment window.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="px-3.5 py-2 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] text-xs font-bold text-[#50352F]">
                      Outstanding:{' '}
                      <strong className="text-[#D66795] tabular-nums">
                        {formatMinorToMajor(
                          commissionSummary?.totalOutstandingCommissionMinor ?? 0,
                          commissionSummary?.currency || config.currency
                        )}
                      </strong>
                    </div>
                    <button
                      type="button"
                      data-testid="overview-pay-commission-btn"
                      onClick={() => handleOpenPayCommissionModal()}
                      className="min-h-[42px] px-4 py-2 rounded-full candy-btn-pink text-xs font-extrabold text-[#50352F] cursor-pointer"
                    >
                      Pay Commission
                    </button>
                  </div>
                </div>
              </section>
            </div>
          );
        })()}

        {/* TAB 2: PRODUCTS */}
        {activeTab === 'products' && (
          <DreamDashboardModule className="candy-card-white rounded-[30px] p-5 md:p-7 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ClayIcon tone="pink" size="md">
                  <Package className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    My Products ({products.length})
                  </h2>
                  <p className="ds-body text-[#7A5A52] mt-0.5">
                    Upload PDFs, eBooks, planners, or templates and manage pricing.
                  </p>
                </div>
              </div>
              <CandyButton
                variant="primary"
                size="md"
                onClick={openCreateProductModal}
                icon={<Plus className="w-4 h-4" />}
                className="w-full md:w-auto px-5 py-3 min-h-[44px]"
              >
                <span>Add Product</span>
              </CandyButton>
            </div>

            {products.length === 0 ? (
              <div
                data-testid="products-empty-state"
                className="py-12 px-6 rounded-[28px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col items-center text-center space-y-4"
              >
                <EmptyOrdersGiftBoxSVG className="w-32 h-28" />
                <div className="space-y-1.5 max-w-md">
                  <h3 className="ds-card-title font-candy font-bold text-[#50352F]">
                    Welcome to Your Product Catalog!
                  </h3>
                  <p className="ds-body text-[#7A5A52]">
                    You haven&apos;t uploaded any digital products yet. Click below to add your first PDF guide, eBook, Notion template, or workbook in seconds.
                  </p>
                </div>
                <CandyButton
                  variant="primary"
                  size="md"
                  onClick={openCreateProductModal}
                  icon={<Plus className="w-4 h-4" />}
                  className="px-6 py-3 min-h-[46px]"
                >
                  <span>Add Your First Digital Product</span>
                </CandyButton>
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {products.map((prod) => (
                <div
                  key={prod.id}
                  className="p-4 rounded-[26px] border-2 border-[#F0DEC6] bg-[#FFF2DF]/60 flex flex-col justify-between space-y-4 ds-card-interactive"
                >
                  <div>
                    <div className="relative rounded-[20px] overflow-hidden h-44 mb-3 bg-[#FFFDF8] border-2 border-[#F0DEC6]">
                      <PastelImage
                        src={prod.image}
                        alt={prod.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex items-center justify-between ds-helper font-extrabold">
                      <span className="text-[#D66795]">{prod.category}</span>
                      <span className={prod.published ? 'text-[#236B56]' : 'text-[#7A5A52]'}>
                        {prod.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <h3 className="ds-card-title font-candy font-bold text-[#50352F] mt-1">
                      {prod.title}
                    </h3>
                    <p className="text-[14px] text-[#7A5A52] mt-1 line-clamp-2">
                      {prod.subtitle}
                    </p>
                    <div className="mt-2.5 ds-helper flex items-center gap-1.5 font-semibold">
                      <FileText className="w-4 h-4 text-[#D66795] shrink-0" />
                      <span className="truncate">
                        {prod.fileName} ({prod.fileSizeLabel})
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t-2 border-[#F0DEC6] space-y-3">
                    <div className="flex items-center justify-between text-[15px] font-extrabold">
                      <span className="text-[#50352F] tabular-nums">
                        {prod.isFree
                          ? 'Free ($0 / Rs 0)'
                          : `$${prod.priceUsd} · Rs ${prod.pricePkr.toLocaleString()}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!prod.published && commissionSummary?.isRestricted) {
                            showToast(
                              'Publishing products is paused until your overdue 5% commission invoice is settled.'
                            );
                            handleOpenPayCommissionModal();
                            return;
                          }
                          onUpdateProduct(prod.id, {
                            published: !prod.published,
                            status: !prod.published ? 'Available' : 'Draft',
                          });
                        }}
                        className="px-3.5 py-2 rounded-full candy-btn-white text-xs font-extrabold text-[#50352F] cursor-pointer min-h-[40px]"
                      >
                        {prod.published ? 'Unpublish' : 'Publish'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditProductModal(prod)}
                        className="flex-1 py-2.5 rounded-full candy-btn-white text-[#50352F] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                      >
                        <Edit3 className="w-4 h-4 text-[#D66795]" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('product-detail', prod.id)}
                        className="px-4 py-2.5 rounded-full candy-btn-butter text-[#50352F] text-xs font-extrabold cursor-pointer min-h-[42px]"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProduct(prod.id)}
                        title="Delete product"
                        aria-label={`Delete ${prod.title}`}
                        className="w-11 h-11 rounded-full candy-btn-white text-[#7A5A52] hover:text-[#C93B5B] flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )}
          </DreamDashboardModule>
        )}

        {/* TAB 3: ORDERS (Includes Customer Orders + Progressive Disclosure for 5% Commission Ledger) */}
        {activeTab === 'orders' && (
          <DreamDashboardModule className="space-y-5">
            {/* CANDYLAND SUMMARY CARD (Also visible in Orders & Earnings tab for real-time sales & pending order tracking) */}
            <CandylandSummaryCard
              totalSalesAmount={formatMinorToMajor(
                storeCommissionSummary.sellerNetEarningsMinor,
                storeCurrency
              )}
              grossSalesAmount={formatMinorToMajor(
                storeCommissionSummary.grossAmountMinor,
                storeCurrency
              )}
              paidOrdersCount={paidOrders.length}
              pendingOrdersCount={pendingOrders.length}
              pendingOrdersAmount={formatMinorToMajor(
                pendingCommissionSummary.grossAmountMinor,
                storeCurrency
              )}
              currency={storeCurrency}
              storeName={config.storeName}
              onReviewPendingOrders={
                pendingOrders[0]
                  ? () => openExpressReviewModal(pendingOrders[0])
                  : undefined
              }
            />

            {/* Sub-navigation between Customer Orders and Commission & Earnings Ledger */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 candy-card-white p-5 md:p-6 rounded-[28px]">
              <div className="flex items-center gap-3">
                <ClayIcon tone="butter" size="md">
                  <ShoppingBag className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="ds-section-title font-candy font-bold text-[#50352F]">
                    Orders &amp; Earnings
                  </h2>
                  <p className="ds-helper mt-0.5">
                    Verify customer payment references or review your 95% seller earnings ledger.
                  </p>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-stretch md:items-center p-1.5 rounded-full bg-[#FFF2DF] border-2 border-[#F0DEC6] gap-1.5">
                <button
                  type="button"
                  onClick={() => setOrdersSubTab('orders')}
                  className={`px-4 py-2 rounded-full text-xs sm:text-sm font-extrabold transition-all cursor-pointer min-h-[42px] ${
                    ordersSubTab === 'orders'
                      ? 'candy-btn-pink text-[#50352F]'
                      : 'text-[#7A5A52] hover:text-[#50352F]'
                  }`}
                >
                  Customer Orders ({orders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOrdersSubTab('commission')}
                  className={`px-4 py-2 rounded-full text-xs sm:text-sm font-extrabold transition-all cursor-pointer min-h-[42px] inline-flex items-center justify-center gap-1.5 ${
                    ordersSubTab === 'commission'
                      ? 'candy-btn-pink text-[#50352F]'
                      : 'text-[#7A5A52] hover:text-[#50352F]'
                  }`}
                >
                  <Coins className="w-4 h-4" />
                  <span>5% Commission Ledger</span>
                </button>
              </div>
            </div>

            {ordersSubTab === 'orders' ? (
              <div className="candy-card-white rounded-[30px] p-5 md:p-7 space-y-6">
                {/* Search & Status Filters */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-7 relative">
                    <Search className="w-4 h-4 text-[#7A5A52] absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Search by order #, buyer name, email, or product..."
                      className="w-full pl-10 pr-4 py-2.5 rounded-2xl candy-input text-base min-h-[46px]"
                    />
                  </div>
                  <div className="md:col-span-5 flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                    {(['All', 'Pending', 'Paid', 'Failed', 'Refunded'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setOrderStatusFilter(st)}
                        className={`px-3.5 py-2 rounded-full text-xs sm:text-sm font-extrabold whitespace-nowrap cursor-pointer min-h-[42px] ${
                          orderStatusFilter === st
                            ? 'candy-btn-pink text-[#50352F]'
                            : 'candy-btn-white text-[#50352F]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="py-10 flex flex-col items-center text-center">
                    <EmptyOrdersGiftBoxSVG className="w-32 h-28 mb-2" />
                    <h3 className="ds-card-title font-candy font-bold text-[#50352F]">
                      No orders found
                    </h3>
                    <p className="ds-helper mt-1 max-w-xs">
                      When buyers place orders on your storefront, they will appear here automatically.
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="orders-table"
                    role="region"
                    aria-label="Customer Orders Table"
                    className="space-y-4"
                  >
                    {filteredOrders.map((ord) => {
                      const statementConfirmed = statementCheckedByOrder[ord.id] ?? true;
                      const effectiveOrderStatus: OrderItem['status'] =
                        ord.status === 'Completed' || ord.paymentStatus === 'Paid'
                          ? 'Completed'
                          : 'Processing';
                      const isRecentlyCompleted =
                        Boolean(recentlyCompletedOrderIds[ord.id]) &&
                        effectiveOrderStatus === 'Completed';
                      const commStatus =
                        ord.commissionStatus ||
                        (ord.totalAmount === 0
                          ? 'not_applicable'
                          : ord.paymentStatus === 'Refunded'
                          ? 'reversed'
                          : 'outstanding');
                      const verifLabel =
                        ord.verificationMode ||
                        (ord.totalAmount === 0
                          ? 'Instant Free'
                          : ord.paymentStatus === 'Paid'
                          ? 'Manually Verified by Seller'
                          : 'Unverified');

                      return (
                        <div
                          key={ord.id}
                          data-testid={`order-row-${ord.orderNumber}`}
                          data-order-status={effectiveOrderStatus}
                          className={`p-4 sm:p-5 rounded-[24px] border-2 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all duration-500 ease-out ${
                            isRecentlyCompleted
                              ? 'animate-order-completed-slide-down bg-[#E6F8EC]/70 border-[#AFE0BE]'
                              : 'bg-[#FFF2DF]/65 border-[#F0DEC6]'
                          }`}
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[15px]">
                              <span className="font-extrabold text-[#50352F] tabular-nums">
                                #{ord.orderNumber}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-extrabold text-[#D66795] tabular-nums">
                                {ord.amount}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`inline-flex items-center gap-1 font-extrabold transition-colors duration-300 ${
                                  ord.paymentStatus === 'Paid'
                                    ? 'text-[#236B56]'
                                    : ord.paymentStatus === 'Pending'
                                    ? 'text-[#B86B19]'
                                    : 'text-[#C93B5B]'
                                }`}
                              >
                                {ord.paymentStatus === 'Paid' && (
                                  <CheckCircle2 className="w-4 h-4" />
                                )}
                                {ord.paymentStatus === 'Pending' && <Clock className="w-4 h-4" />}
                                {(ord.paymentStatus === 'Failed' ||
                                  ord.paymentStatus === 'Refunded') && (
                                  <XCircle className="w-4 h-4" />
                                )}
                                {ord.paymentStatus}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                data-testid={`order-fulfillment-status-${ord.orderNumber}`}
                                className={`inline-flex items-center gap-1 font-extrabold transition-all duration-300 ease-out ${
                                  effectiveOrderStatus === 'Completed'
                                    ? 'text-[#236B56] animate-order-completed-slide-down'
                                    : 'text-[#B86B19]'
                                }`}
                              >
                                {effectiveOrderStatus}
                              </span>
                            </div>

                            <div className="text-[15px] font-bold text-[#50352F]">
                              {ord.itemTitlesSummary}
                            </div>

                            <div className="ds-helper flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>
                                Buyer: <strong>{ord.customerName}</strong> ({ord.customerEmail})
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Method: <strong>{ord.paymentMethod.toUpperCase()}</strong>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Ref: <code className="font-mono font-extrabold text-[#D66795]">{ord.paymentReference}</code>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Downloads: {ord.downloadCount}/{ord.maxDownloads}
                              </span>
                            </div>

                            <div className="ds-helper pt-0.5">
                              {verifLabel === 'Manually Verified by Seller' ? (
                                <span
                                  data-testid="seller-verified-badge"
                                  className="text-[#B86B19] font-extrabold"
                                >
                                  ● Seller Verified (Not Bank Verified)
                                </span>
                              ) : (
                                <span>● {verifLabel}</span>
                              )}
                              {ord.paymentStatus === 'Paid' && ord.customerEmail && (
                                <span
                                  data-testid={`buyer-email-sent-badge-${ord.orderNumber}`}
                                  className="ml-2 text-[#236B56] font-extrabold"
                                >
                                  · ✉ Secure Email Sent to {ord.buyerEmailNotification?.recipientEmail || ord.customerEmail}
                                </span>
                              )}
                              {ord.commissionBreakdown && ord.totalAmount > 0 && (
                                <span className="ml-2 text-[#7A5A52]">
                                  · 5% Fee:{' '}
                                  {formatMinorToMajor(
                                    ord.commissionBreakdown.platformCommissionMinor,
                                    ord.currency
                                  )}{' '}
                                  ({commStatus})
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Order Action Controls */}
                          <div className="flex flex-col md:flex-row lg:flex-col items-stretch md:items-center lg:items-end gap-2 shrink-0">
                            {ord.paymentStatus === 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  data-testid={`review-payment-row-btn-${ord.orderNumber}`}
                                  onClick={() => openExpressReviewModal(ord)}
                                  className="px-4 py-2.5 rounded-full candy-btn-pink text-[14px] font-extrabold text-[#50352F] cursor-pointer min-h-[44px]"
                                >
                                  Review Payment (Checklist)
                                </button>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#50352F] cursor-pointer min-h-[44px]">
                                    <input
                                      type="checkbox"
                                      checked={statementConfirmed}
                                      onChange={(e) =>
                                        setStatementCheckedByOrder((prev) => ({
                                          ...prev,
                                          [ord.id]: e.target.checked,
                                        }))
                                      }
                                      className="w-4 h-4 accent-[#236B56]"
                                    />
                                    <span>Verified in statement</span>
                                  </label>
                                  <button
                                    type="button"
                                    disabled={!statementConfirmed}
                                    onClick={async () => {
                                      try {
                                        await onUpdateOrderStatus(ord.id, 'Paid');
                                        markOrderTransitionedToCompleted(ord.id);
                                        showToast(`Order #${ord.orderNumber} payment verified; download unlocked.`);
                                      } catch (err) {
                                        showToast(err instanceof Error ? err.message : 'Payment verification failed.');
                                      }
                                    }}
                                    className="px-3.5 py-2 rounded-full candy-btn-mint disabled:opacity-40 text-[13px] font-extrabold text-[#50352F] cursor-pointer min-h-[42px]"
                                  >
                                    Confirm &amp; Unlock
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await onUpdateOrderStatus(ord.id, 'Failed');
                                        showToast(`Order #${ord.orderNumber} marked Failed`);
                                      } catch (err) {
                                        showToast(err instanceof Error ? err.message : 'Payment rejection failed.');
                                      }
                                    }}
                                    className="px-3.5 py-2 rounded-full candy-btn-white text-[#C93B5B] text-[13px] font-extrabold cursor-pointer min-h-[42px]"
                                  >
                                    Reject
                                  </button>
                                </div>
                              </>
                            )}

                            {ord.paymentStatus === 'Paid' && (
                              <div className="flex flex-wrap items-center gap-2 animate-order-completed-slide-down transition-all duration-300 ease-out">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await onUpdateOrderStatus(ord.id, 'Refunded');
                                      showToast(`Order #${ord.orderNumber} marked Refunded; commission reversed.`);
                                    } catch (err) {
                                      showToast(err instanceof Error ? err.message : 'Refund update failed.');
                                    }
                                  }}
                                  className="px-3.5 py-2 rounded-full candy-btn-white text-[13px] font-bold text-[#7A5A52] hover:text-[#C93B5B] cursor-pointer min-h-[42px]"
                                >
                                  Issue Refund (Reverse 5%)
                                </button>
                                {ord.totalAmount > 0 &&
                                  commStatus === 'outstanding' &&
                                  onUpdateCommissionStatus && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await onUpdateCommissionStatus(
                                          ord.orderNumber,
                                          'disputed'
                                        );
                                        showToast(
                                          `Order #${ord.orderNumber} commission flagged as disputed`
                                        );
                                      }}
                                      className="px-3.5 py-2 rounded-full candy-btn-butter text-[13px] font-extrabold text-[#50352F] cursor-pointer min-h-[42px]"
                                    >
                                      Flag Dispute
                                    </button>
                                  )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* PROGRESSIVE DISCLOSURE: SMART 5% COMMISSION MANAGEMENT & LEDGER */
              <div
                data-testid="commission-management-section"
                className="candy-card-white rounded-[30px] p-5 md:p-7 space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="ds-section-title font-candy font-bold text-[#50352F]">
                      Smart 5% Commission Management
                    </h3>
                    <p className="ds-body text-[#7A5A52] mt-1">
                      You keep 95% of every verified sale. After every 5 verified paid sales, an
                      invoice is generated automatically with 7 days to settle.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="pay-commission-primary-btn"
                    onClick={() => handleOpenPayCommissionModal()}
                    disabled={
                      !commissionSummary?.invoices.some(
                        (i) =>
                          i.remainingBalanceMinor > 0 &&
                          i.status !== 'paid' &&
                          i.status !== 'voided'
                      )
                    }
                    className="min-h-[44px] px-5 py-2.5 rounded-full candy-btn-pink disabled:opacity-45 text-[#50352F] text-sm font-extrabold cursor-pointer shrink-0"
                  >
                    Pay Commission
                  </button>
                </div>

                {/* Sales Progress Toward Next Invoice + Deadline + Balances */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-5 rounded-[24px] bg-[#FFF2DF]/80 border-2 border-[#F0DEC6]">
                    <div className="flex items-center justify-between text-xs font-extrabold text-[#50352F] mb-1.5">
                      <span>Sales Progress</span>
                      <span data-testid="commission-progress-fraction" className="text-[#D66795]">
                        {commissionSummary?.salesTowardNextInvoice ?? 0} of{' '}
                        {commissionSummary?.invoiceThreshold ?? 5} sales
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-[#FFFDF8] border-2 border-[#F0DEC6] overflow-hidden mb-2">
                      <div
                        className="h-full bg-[#F58CB7] rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            ((commissionSummary?.salesTowardNextInvoice ?? 0) /
                              (commissionSummary?.invoiceThreshold ?? 5)) *
                              100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="ds-helper">
                      Unbilled 5% accrual:{' '}
                      <strong>
                        {formatMinorToMajor(
                          commissionSummary?.unbilledCommissionMinor ?? 0,
                          commissionSummary?.currency || config.currency
                        )}
                      </strong>
                    </div>
                  </div>

                  <div className="p-5 rounded-[24px] bg-[#BBA0EA]/20 border-2 border-[#BBA0EA]">
                    <div className="ds-helper font-bold text-[#50352F]">
                      Outstanding Commission
                    </div>
                    <div
                      data-testid="commission-outstanding-amount"
                      className="text-2xl font-candy font-bold text-[#D66795] mt-1 tabular-nums"
                    >
                      {formatMinorToMajor(
                        commissionSummary?.invoicedOutstandingMinor ?? 0,
                        commissionSummary?.currency || config.currency
                      )}
                    </div>
                    <div className="ds-helper mt-1">
                      Settled to date:{' '}
                      {formatMinorToMajor(
                        commissionSummary?.totalPaidCommissionMinor ?? 0,
                        commissionSummary?.currency || config.currency
                      )}
                    </div>
                  </div>

                  <div className="p-5 rounded-[24px] bg-[#FFD47B]/30 border-2 border-[#FFD47B]">
                    <div className="ds-helper font-bold text-[#50352F]">Payment Deadline</div>
                    <div
                      data-testid="commission-deadline-display"
                      className="text-lg font-candy font-bold text-[#50352F] mt-1"
                    >
                      {commissionSummary?.nextPaymentDeadlineIso
                        ? commissionSummary.isRestricted
                          ? `Overdue (${commissionSummary.nextPaymentDeadlineIso.slice(0, 10)})`
                          : `${commissionSummary.daysUntilDeadline ?? 7} days left (${commissionSummary.nextPaymentDeadlineIso.slice(
                              0,
                              10
                            )})`
                        : 'No invoice due'}
                    </div>
                    <div className="ds-helper mt-1">
                      {commissionSummary?.isRestricted
                        ? 'Seller management features paused until paid'
                        : 'All seller features unlocked & active'}
                    </div>
                  </div>
                </div>

                {/* Commission Invoice History */}
                <div className="space-y-3 pt-2 border-t-2 border-[#F3E2CB]">
                  <h4 className="text-sm font-candy font-bold text-[#50352F]">
                    Commission Invoice History ({commissionSummary?.invoices.length ?? 0})
                  </h4>
                  {!commissionSummary || commissionSummary.invoices.length === 0 ? (
                    <p className="ds-helper py-4 text-center bg-[#FFF2DF]/60 rounded-2xl border-2 border-[#F0DEC6]">
                      No commission invoices generated yet. Your first invoice is automatically
                      created after 5 verified paid sales.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {commissionSummary.invoices.map((inv) => (
                        <div
                          key={inv.invoiceId}
                          data-testid={`commission-invoice-row-${inv.invoiceNumber}`}
                          className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-extrabold text-[#50352F]">{inv.invoiceNumber}</span>
                              <span>·</span>
                              <span className="font-extrabold text-[#D66795] tabular-nums">
                                {formatMinorToMajor(inv.remainingBalanceMinor, inv.currency)} due
                              </span>
                              <span>·</span>
                              <span className="text-xs font-extrabold uppercase text-[#7A5A52]">
                                {inv.status.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="ds-helper">
                              Orders: {inv.orderNumbers.join(', ')} · Due:{' '}
                              {inv.dueAtIso.slice(0, 10)}
                              {inv.adjustedAmountMinor > 0 &&
                                ` · Adjusted: -${formatMinorToMajor(
                                  inv.adjustedAmountMinor,
                                  inv.currency
                                )}`}
                            </p>
                          </div>

                          {inv.remainingBalanceMinor > 0 && inv.status !== 'paid' && (
                            <button
                              type="button"
                              data-testid={`pay-invoice-btn-${inv.invoiceNumber}`}
                              onClick={() => handleOpenPayCommissionModal(inv)}
                              className="min-h-[40px] px-4 py-2 rounded-full candy-btn-pink text-xs font-extrabold text-[#50352F] cursor-pointer shrink-0"
                            >
                              {inv.status === 'payment_submitted'
                                ? 'Update Payment Proof'
                                : 'Submit Payment Proof'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Responsive Commission Breakdown List */}
                <div className="space-y-3 pt-2 border-t-2 border-[#F3E2CB]">
                  <h4 className="text-sm font-candy font-bold text-[#50352F]">
                    Per-Order 5% Commission Ledger ({orders.length})
                  </h4>
                  {orders.length === 0 ? (
                    <p className="ds-helper py-6 text-center">
                      No orders recorded yet. Place a free or paid order on your storefront to see real-time 5% commission accounting.
                    </p>
                  ) : (
                    orders.map((ord) => {
                      const cb =
                        ord.commissionBreakdown ||
                        calculateCommissionMinor(
                          ord.totalAmount,
                          ord.currency,
                          commissionRateBps,
                          ord.paymentMethod
                        );
                      return (
                        <div
                          key={ord.id}
                          className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] flex flex-col md:flex-row md:items-center justify-between gap-3 text-[14px]"
                        >
                          <div>
                            <span className="font-extrabold text-[#50352F] tabular-nums">
                              #{ord.orderNumber}
                            </span>{' '}
                            <span className="text-[#7A5A52]">· {ord.itemTitlesSummary}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 tabular-nums">
                            <span>
                              Gross: <strong>{formatMinorToMajor(cb.grossAmountMinor, ord.currency)}</strong>
                            </span>
                            <span className="text-[#D66795]">
                              5% Fee: <strong>{formatMinorToMajor(cb.platformCommissionMinor, ord.currency)}</strong>
                            </span>
                            <span className="text-[#236B56]">
                              95% Yours: <strong>{formatMinorToMajor(cb.sellerNetEarningsMinor, ord.currency)}</strong>
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Collapsible Audit Trail */}
                {auditLogs.length > 0 && (
                  <details className="pt-3 border-t-2 border-[#F3E2CB]">
                    <summary className="ds-label cursor-pointer text-[#D66795]">
                      View Verification Audit Trail ({auditLogs.length})
                    </summary>
                    <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                      {auditLogs.slice(0, 8).map((log) => (
                        <div
                          key={log.auditId}
                          className="p-3 rounded-2xl bg-[#FFF2DF]/65 border border-[#F0DEC6] ds-helper flex flex-col md:flex-row md:items-center justify-between gap-2"
                        >
                          <div>
                            <strong className="text-[#50352F]">[{log.action}]</strong> #{log.orderNumber} · {log.detail}
                          </div>
                          <span className="font-mono shrink-0">
                            {log.previousStatus} → {log.newStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </DreamDashboardModule>
        )}

        {/* TAB 4: STORE DESIGN (6 Themes, Live Preview, Accent Color, Logo/Banner & Save/Publish) */}
        {activeTab === 'appearance' && (() => {
          const activeCanonicalTheme = normalizeStoreThemeId(config.theme);
          const effectivePreviewThemeId = previewThemeId || activeCanonicalTheme;
          const previewTheme = resolveStoreTheme(
            effectivePreviewThemeId,
            config.customAccentColor
          );

          const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                onUpdateConfig({ logoUrl: reader.result });
                showToast('Store logo uploaded & saved');
              }
            };
            reader.readAsDataURL(file);
          };

          const handleBannerFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                onUpdateConfig({ heroImage: reader.result });
                showToast('Store cover banner uploaded & saved');
              }
            };
            reader.readAsDataURL(file);
          };

          return (
            <DreamDashboardModule className="candy-card-white rounded-[32px] p-5 md:p-7 space-y-7">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <ClayIcon tone="lilac" size="md">
                    <Palette className="w-5 h-5" />
                  </ClayIcon>
                  <div>
                    <h2 className="ds-section-title font-extrabold text-[#50352F]">
                      Store Design &amp; Themes
                    </h2>
                    <p className="ds-body text-[#6E4D45] mt-0.5">
                      Choose from 6 signature storefront themes, customize your accent color, and upload your brand assets.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
                  <CandyButton
                    variant="cream"
                    size="md"
                    onClick={() => {
                      if (commissionSummary?.isRestricted) {
                        showToast(
                          'Visual Store Builder is paused until your overdue 5% commission invoice is settled.'
                        );
                        handleOpenPayCommissionModal();
                        return;
                      }
                      onNavigate('visual-editor');
                    }}
                    className="w-full md:w-auto px-4 py-2.5 min-h-[44px]"
                  >
                    <span>Visual Store Builder</span>
                  </CandyButton>
                  <CandyButton
                    variant="pink"
                    size="md"
                    data-testid="publish-design-changes-btn"
                    onClick={() => {
                      if (commissionSummary?.isRestricted) {
                        showToast(
                          'Theme customization is paused until your overdue 5% commission invoice is settled.'
                        );
                        handleOpenPayCommissionModal();
                        return;
                      }
                      if (previewThemeId && previewThemeId !== activeCanonicalTheme) {
                        onUpdateConfig({ theme: previewThemeId });
                      }
                      setPreviewThemeId(null);
                      showToast('Store design published to your live storefront!');
                    }}
                    className="w-full md:w-auto px-5 py-2.5 min-h-[44px]"
                  >
                    <span>Publish Store Design</span>
                  </CandyButton>
                </div>
              </div>

              {/* 6 SIGNATURE STOREFRONT THEMES */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="ds-label block">
                    1. Storefront Theme ({STORE_THEMES.length} Signature Palettes — 3 Free Starter · 3 Pro)
                  </label>
                  <span className="ds-helper text-[#D66795] font-extrabold">
                    Active: {resolveStoreTheme(config.theme).name}
                  </span>
                </div>
                <div
                  data-testid="store-themes-grid"
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                  {STORE_THEMES.map((t) => {
                    const isApplied = activeCanonicalTheme === t.id;
                    const isPreviewing = effectivePreviewThemeId === t.id;
                    return (
                      <div
                        key={t.id}
                        data-testid={`theme-card-${t.id}`}
                        onClick={() => {
                          if (commissionSummary?.isRestricted) {
                            showToast(
                              'Theme customization is paused until your overdue 5% commission invoice is settled.'
                            );
                            handleOpenPayCommissionModal();
                            return;
                          }
                          setPreviewThemeId(t.id);
                          onUpdateConfig({ theme: t.id });
                          showToast(`Applied "${t.name}" theme to your store`);
                        }}
                        className={`p-4 rounded-[24px] border-2 flex flex-col justify-between gap-3 transition-all cursor-pointer ${
                          isApplied
                            ? 'bg-[#FFE7F1] border-[#F58CB7] shadow-[0_8px_20px_-6px_rgba(245,140,183,0.3)]'
                            : isPreviewing
                            ? 'bg-[#F0E9FE]/65 border-[#BBA0EA]'
                            : 'bg-[#FFFDF8] border-[#F0DEC6] hover:border-[#F58CB7]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[15px] font-extrabold text-[#50352F]">
                                {t.name}
                              </span>
                              {t.tier === 'pro' ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-[#50352F] text-[#FFD47B] text-[10px] font-extrabold">
                                  <Crown className="w-2.5 h-2.5" /> PRO
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-[#E6F8EC] text-[#236B56] border border-[#AFE0BE] text-[10px] font-extrabold">
                                  FREE
                                </span>
                              )}
                              {isApplied && (
                                <span className="px-2 py-0.5 rounded-lg bg-[#F58CB7] text-[#50352F] text-[11px] font-extrabold inline-flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Applied
                                </span>
                              )}
                            </div>
                            <p className="ds-helper mt-0.5">{t.subtitle}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {t.swatchClasses.map((swatchCls, idx) => (
                              <span
                                key={idx}
                                className={`w-4 h-4 rounded-full border ${swatchCls}`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#F0DEC6]">
                          <button
                            type="button"
                            data-testid={`preview-theme-btn-${t.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewThemeId(t.id);
                              showToast(`Previewing "${t.name}" below`);
                            }}
                            className="candy-btn-cream px-3 py-1.5 rounded-xl text-[13px] font-extrabold cursor-pointer min-h-[36px]"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            data-testid={`apply-theme-btn-${t.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (commissionSummary?.isRestricted) {
                                showToast(
                                  'Theme customization is paused until your overdue 5% commission invoice is settled.'
                                );
                                handleOpenPayCommissionModal();
                                return;
                              }
                              setPreviewThemeId(t.id);
                              onUpdateConfig({ theme: t.id });
                              showToast(`Applied "${t.name}" theme to your store`);
                            }}
                            className={`px-3.5 py-1.5 rounded-xl text-[13px] font-extrabold cursor-pointer min-h-[36px] ${
                              isApplied
                                ? 'candy-btn-cocoa'
                                : 'candy-btn-pink'
                            }`}
                          >
                            {isApplied ? 'Active Theme' : 'Apply Theme'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* LIVE COORDINATED THEME PREVIEW */}
              <div
                data-testid="dashboard-theme-preview"
                data-preview-theme={previewTheme.id}
                className={`rounded-[24px] border-2 p-4 sm:p-5 transition-colors duration-300 ${previewTheme.pageClass} ${previewTheme.cardClass}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-current/10">
                  <div className="flex items-center gap-2">
                    <PastelImage
                      src={config.logoUrl}
                      alt={config.storeName}
                      className="w-8 h-8 rounded-xl object-cover border border-current/15"
                    />
                    <span className={`font-wordmark font-extrabold text-base ${previewTheme.titleClass}`}>
                      {config.storeName}
                    </span>
                    <span className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold ${previewTheme.accentBadgeClass}`}>
                      Live Preview · {previewTheme.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('storefront')}
                    className={`px-3.5 py-1.5 rounded-xl text-[13px] font-extrabold cursor-pointer ${previewTheme.buttonClass}`}
                  >
                    Open Live Storefront
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-7 space-y-2">
                    <div className={`text-[12px] font-extrabold uppercase tracking-wider ${previewTheme.accentTextClass}`}>
                      {config.announcementText}
                    </div>
                    <h4 className={`text-xl sm:text-2xl font-wordmark leading-tight ${previewTheme.titleClass}`}>
                      {config.heroHeadingLine1}{' '}
                      <span className={`italic ${previewTheme.accentTextClass}`}>
                        {config.heroHeadingLine2}
                      </span>
                    </h4>
                    <p className={`text-[14px] ${previewTheme.mutedTextClass}`}>
                      {config.heroSubheading}
                    </p>
                  </div>
                  <div className="md:col-span-5">
                    <div className={`p-3 rounded-2xl border ${previewTheme.cardClass} flex items-center gap-3`}>
                      <PastelImage
                        src={config.heroImage}
                        alt="Cover banner preview"
                        className="w-14 h-14 rounded-xl object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[14px] font-extrabold truncate ${previewTheme.titleClass}`}>
                          {products[0]?.title || 'Sample Digital Guide'}
                        </div>
                        <div className={`text-[12px] font-bold ${previewTheme.accentTextClass}`}>
                          Instant Digital Download
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. CUSTOM ACCENT COLOR */}
              <div className="space-y-3 pt-3 border-t-2 border-[#F3E2CB]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="ds-label block">2. Accent Color Customization</label>
                    <p className="ds-helper">
                      Personalize buttons, badges, and highlights while maintaining accessible contrast.
                    </p>
                  </div>
                  {config.customAccentColor && (
                    <button
                      type="button"
                      data-testid="accent-reset-btn"
                      onClick={() => {
                        onUpdateConfig({ customAccentColor: '' });
                        showToast('Reset to theme default accent color');
                      }}
                      className="text-[13px] font-extrabold text-[#D66795] hover:underline cursor-pointer"
                    >
                      Reset to Theme Default
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {CUSTOM_ACCENT_PRESETS.map((preset) => {
                    const isSelected =
                      (config.customAccentColor || '').toUpperCase() === preset.hex.toUpperCase();
                    return (
                      <button
                        key={preset.hex}
                        type="button"
                        data-testid={`accent-swatch-${preset.hex}`}
                        onClick={() => {
                          onUpdateConfig({ customAccentColor: preset.hex });
                          showToast(`Accent color updated to ${preset.name}`);
                        }}
                        className={`px-3.5 py-2 rounded-2xl border-2 flex items-center gap-2 text-[13px] font-extrabold transition-all cursor-pointer min-h-[42px] ${
                          isSelected
                            ? 'bg-[#FFE7F1] border-[#50352F] text-[#50352F] shadow-2xs'
                            : 'bg-[#FFFDF8] border-[#F0DEC6] text-[#6E4D45] hover:border-[#F58CB7]'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full ${preset.swatchClass}`} />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. LOGO & COVER BANNER UPLOAD */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t-2 border-[#F3E2CB]">
                <div className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3">
                  <label className="ds-label block">3. Store Logo / Avatar</label>
                  <div className="flex items-center gap-3.5">
                    <PastelImage
                      src={config.logoUrl}
                      alt="Store logo"
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-[#F0DEC6] bg-[#FFFDF8] shrink-0"
                    />
                    <div className="space-y-1.5 flex-1">
                      <label className="candy-btn-cream inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-extrabold cursor-pointer min-h-[40px]">
                        <Upload className="w-4 h-4 text-[#D66795]" />
                        <span>Upload Logo Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          data-testid="upload-store-logo-input"
                          onChange={handleLogoFileUpload}
                          className="hidden"
                        />
                      </label>
                      <p className="ds-helper">Recommended: Square PNG or JPG (min 200×200px)</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3">
                  <label className="ds-label block">4. Storefront Cover Banner</label>
                  <div className="flex items-center gap-3.5">
                    <PastelImage
                      src={config.heroImage}
                      alt="Store cover banner"
                      className="w-20 h-14 rounded-xl object-cover border-2 border-[#F0DEC6] bg-[#FFFDF8] shrink-0"
                    />
                    <div className="space-y-1.5 flex-1">
                      <label className="candy-btn-cream inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-extrabold cursor-pointer min-h-[40px]">
                        <Upload className="w-4 h-4 text-[#D66795]" />
                        <span>Upload Cover Banner</span>
                        <input
                          type="file"
                          accept="image/*"
                          data-testid="upload-store-banner-input"
                          onChange={handleBannerFileUpload}
                          className="hidden"
                        />
                      </label>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {[
                          INITIAL_ASSETS.heroBanner,
                          INITIAL_ASSETS.book30DayReset,
                          INITIAL_ASSETS.bookProductivityPlanner,
                        ].map((presetImg, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              onUpdateConfig({ heroImage: presetImg });
                              showToast('Cover banner updated');
                            }}
                            className="w-7 h-7 rounded-lg overflow-hidden border-2 border-[#F0DEC6] hover:border-[#F58CB7] cursor-pointer"
                            title={`Use preset banner ${i + 1}`}
                          >
                            <PastelImage src={presetImg} alt={`Banner ${i + 1}`} className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. STOREFRONT HEADLINES */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t-2 border-[#F3E2CB]">
                <div>
                  <label className="ds-label block mb-1.5">Storefront Heading Line 1</label>
                  <input
                    type="text"
                    value={config.heroHeadingLine1}
                    onChange={(e) => onUpdateConfig({ heroHeadingLine1: e.target.value })}
                    className="candy-input"
                  />
                </div>
                <div>
                  <label className="ds-label block mb-1.5">Storefront Heading Line 2 (Accent)</label>
                  <input
                    type="text"
                    value={config.heroHeadingLine2}
                    onChange={(e) => onUpdateConfig({ heroHeadingLine2: e.target.value })}
                    className="candy-input text-[#D66795]"
                  />
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-end gap-3 pt-4 border-t-2 border-[#F3E2CB]">
                <button
                  type="button"
                  data-testid="save-design-changes-btn"
                  onClick={() => {
                    if (previewThemeId && previewThemeId !== activeCanonicalTheme) {
                      onUpdateConfig({ theme: previewThemeId });
                    }
                    showToast('Design changes saved!');
                  }}
                  className="candy-btn-cream w-full md:w-auto px-5 py-2.5 rounded-2xl text-[14px] font-extrabold cursor-pointer min-h-[44px]"
                >
                  Save Changes
                </button>
                <CandyButton
                  variant="pink"
                  size="md"
                  onClick={() => {
                    if (previewThemeId && previewThemeId !== activeCanonicalTheme) {
                      onUpdateConfig({ theme: previewThemeId });
                    }
                    setPreviewThemeId(null);
                    showToast('Store design published to your live storefront!');
                  }}
                  className="w-full md:w-auto px-5 py-2.5 min-h-[44px]"
                >
                  <span>Publish Changes</span>
                </CandyButton>
              </div>
            </DreamDashboardModule>
          );
        })()}

        {/* TAB 5: SETTINGS (Store Profile + Manual Payment Accounts & WhatsApp Notification Link) */}
        {activeTab === 'settings' && (
          <DreamDashboardModule className="space-y-5">
            {/* Store Profile & Currency Card */}
            <div className="candy-card-white rounded-[32px] p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-3.5">
                <ClayIcon tone="pink" size="md">
                  <Store className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="ds-section-title font-extrabold text-[#50352F]">
                    Store Profile &amp; Currency
                  </h2>
                  <p className="ds-body text-[#6E4D45] mt-0.5">
                    Update your store display name, public link, and default currency.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
                <div>
                  <label className="ds-label block mb-1.5">Store Name</label>
                  <input
                    type="text"
                    value={config.storeName}
                    onChange={(e) => onUpdateConfig({ storeName: e.target.value })}
                    className="candy-input"
                  />
                </div>
                <div>
                  <label className="ds-label block mb-1.5">Custom Store Slug</label>
                  <input
                    type="text"
                    value={config.storeSlug}
                    onChange={(e) =>
                      onUpdateConfig({
                        storeSlug: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''),
                      })
                    }
                    className="candy-input"
                  />
                </div>
                <div>
                  <label className="ds-label block mb-1.5">Store Currency</label>
                  <select
                    value={config.currency}
                    onChange={(e) =>
                      onUpdateConfig({ currency: e.target.value as CurrencyCode })
                    }
                    className="candy-input"
                  >
                    {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
                      <option key={code} value={code}>
                        {code} ({CURRENCY_META[code].symbol.trim()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Manual Payment Accounts & WhatsApp Notification Link Card */}
            <div className="candy-card-white rounded-[32px] p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-3.5">
                <ClayIcon tone="butter" size="md">
                  <CreditCard className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h2 className="ds-section-title font-extrabold text-[#50352F]">
                    Payment Receiving Accounts
                  </h2>
                  <p className="ds-body text-[#6E4D45] mt-0.5">
                    Enter the wallet or bank details where buyers should send payments. No API keys required.
                  </p>
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onSavePaymentSettings(paymentDraft);
                  showToast('Payment settings saved');
                }}
                className="space-y-5 max-w-2xl"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="ds-label block mb-1.5">
                      JazzCash Number &amp; Name (Pakistan)
                    </label>
                    <input
                      type="text"
                      value={paymentDraft.jazzCashMerchantId}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          jazzCashMerchantId: e.target.value,
                          jazzCashEnabled: e.target.value.trim().length >= 3,
                        })
                      }
                      placeholder="Enter your JazzCash number & account title"
                      className="candy-input"
                    />
                  </div>
                  <div>
                    <label className="ds-label block mb-1.5">
                      Easypaisa Number &amp; Name (Pakistan)
                    </label>
                    <input
                      type="text"
                      value={paymentDraft.easypaisaStoreId}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          easypaisaStoreId: e.target.value,
                          easypaisaEnabled: e.target.value.trim().length >= 3,
                        })
                      }
                      placeholder="Enter your Easypaisa number & account title"
                      className="candy-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="ds-label block mb-1.5">
                      India UPI ID (GPay / PhonePe / Paytm)
                    </label>
                    <input
                      type="text"
                      value={paymentDraft.upiId || ''}
                      onChange={(e) =>
                        setPaymentDraft({ ...paymentDraft, upiId: e.target.value })
                      }
                      placeholder="Enter your UPI ID (e.g. yourname@upi)"
                      className="candy-input"
                    />
                  </div>
                  <div>
                    <label className="ds-label block mb-1.5">
                      Optional Payment Link URL
                    </label>
                    <input
                      type="text"
                      value={paymentDraft.paymentLinkUrl || ''}
                      onChange={(e) =>
                        setPaymentDraft({ ...paymentDraft, paymentLinkUrl: e.target.value })
                      }
                      placeholder="https://..."
                      className="candy-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="ds-label block mb-1.5">
                    Bank Transfer / IBAN Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={paymentDraft.bankTransferInstructions}
                    onChange={(e) =>
                      setPaymentDraft({
                        ...paymentDraft,
                        bankTransferInstructions: e.target.value,
                      })
                    }
                    className="candy-input"
                  />
                </div>

                {/* Payoneer Readiness & Global Receiving Account Section */}
                <div
                  data-testid="seller-payoneer-settings-card"
                  className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-[#50352F]">
                          Payoneer Global Receiving Account &amp; Request-a-Payment
                        </span>
                        <span
                          data-testid="payoneer-readiness-badge"
                          className={`px-2.5 py-0.5 rounded-xl text-[11px] font-extrabold border ${
                            gatewayStatus?.payoneerConfigured
                              ? 'bg-[#E6F8EC] text-[#236B56] border-[#AFE0BE]'
                              : 'bg-[#FFFDF8] text-[#7A5A52] border-[#E8D2B5]'
                          }`}
                        >
                          {gatewayStatus?.payoneerConfigured
                            ? 'Live API Connected'
                            : 'API Disabled (Optional) · Manual Verification Active'}
                        </span>
                      </div>
                      <p className="ds-helper mt-0.5">
                        Payoneer API credentials are optional and disabled by default (no dummy keys required). Buyers can pay via your Payoneer Request-a-Payment link or Global Payment Service receiving account, and orders stay pending until you verify receipt manually.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#50352F] cursor-pointer shrink-0 min-h-[44px]">
                      <input
                        type="checkbox"
                        data-testid="payoneer-enabled-toggle"
                        checked={Boolean(paymentDraft.payoneerEnabled ?? true)}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            payoneerEnabled: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-[#F58CB7]"
                      />
                      <span>Enable Payoneer</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div>
                      <label className="ds-label block mb-1">Payoneer Receiving Email</label>
                      <input
                        type="email"
                        data-testid="payoneer-email-input"
                        value={paymentDraft.payoneerReceivingEmail || ''}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            payoneerReceivingEmail: e.target.value,
                          })
                        }
                        placeholder="billing@yourstore.com"
                        className="candy-input"
                      />
                    </div>
                    <div>
                      <label className="ds-label block mb-1">
                        Payoneer Request-a-Payment URL (Optional)
                      </label>
                      <input
                        type="text"
                        data-testid="payoneer-link-input"
                        value={paymentDraft.payoneerRequestLink || ''}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            payoneerRequestLink: e.target.value,
                          })
                        }
                        placeholder="https://payoneer.com/request/..."
                        className="candy-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="ds-label block mb-1">
                      Payoneer Receiving Account / Buyer Instructions
                    </label>
                    <input
                      type="text"
                      data-testid="payoneer-instructions-input"
                      value={paymentDraft.payoneerReceivingAccountDetails || ''}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          payoneerReceivingAccountDetails: e.target.value,
                        })
                      }
                      placeholder="Payoneer Global Payment Service (USD/GBP/EUR) — Include Order # in memo"
                      className="candy-input"
                    />
                  </div>
                </div>

                {/* Optional Seller-Configured WhatsApp Notification Link Settings */}
                <div className="p-4 rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div>
                      <label className="ds-label block">
                        Optional WhatsApp Notification Number (Manual Click-to-Chat Link)
                      </label>
                      <p className="ds-helper mt-0.5">
                        Shows buyers an optional button to open WhatsApp with their Order # and Payment Reference after checkout. Does not send automatic background messages and never exposes private buyer data.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#50352F] cursor-pointer shrink-0 min-h-[44px]">
                      <input
                        type="checkbox"
                        data-testid="whatsapp-notifications-toggle"
                        checked={Boolean(paymentDraft.whatsappNotificationsEnabled ?? true)}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            whatsappNotificationsEnabled: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-[#F58CB7]"
                      />
                      <span>Enable WhatsApp Link</span>
                    </label>
                  </div>
                  <input
                    type="text"
                    data-testid="whatsapp-number-input"
                    value={paymentDraft.whatsappNotificationNumber || ''}
                    onChange={(e) =>
                      setPaymentDraft({
                        ...paymentDraft,
                        whatsappNotificationNumber: e.target.value
                          .replace(/[^0-9+-\s]/g, '')
                          .slice(0, 30),
                      })
                    }
                    placeholder="e.g. +923001234567"
                    className="candy-input"
                  />
                </div>

                <CandyButton
                  type="submit"
                  variant="pink"
                  size="md"
                  data-testid="save-payment-settings-btn"
                  className="w-full md:w-auto px-5 py-3 min-h-[44px]"
                >
                  <span>Save Payment Settings</span>
                </CandyButton>
              </form>
            </div>
          </DreamDashboardModule>
        )}
      </main>

      {/* Mobile-First Express Payment Verification Modal with 3-Item Seller Checklist */}
      {reviewingOrder && (
        <div
          data-testid="express-verification-modal"
          className="fixed inset-0 z-50 bg-[#50352F]/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        >
          <div className="candy-card-white rounded-t-[32px] sm:rounded-[32px] max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-7 space-y-5 my-0 sm:my-8">
            <div className="flex items-start justify-between gap-3 border-b-2 border-[#F3E2CB] pb-4">
              <div className="flex items-center gap-3">
                <ClayIcon tone="mint" size="md">
                  <ShieldCheck className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <span className="ds-helper font-extrabold text-[#D66795] uppercase block">
                    Express Payment Review
                  </span>
                  <h3 className="ds-section-title font-extrabold text-[#50352F] mt-0.5">
                    Verify Order #{reviewingOrder.orderNumber}
                  </h3>
                  <p className="ds-helper mt-0.5">
                    Confirm receipt in your wallet or bank statement before unlocking download access.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewingOrder(null)}
                className="candy-btn-cream px-3.5 py-2 rounded-xl text-[14px] font-extrabold cursor-pointer min-h-[44px]"
              >
                Close
              </button>
            </div>

            {/* Order & Payment Reference Summary Card */}
            <div className="p-4 rounded-[22px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] space-y-2.5 text-[14px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#7A5A52] font-bold">Order Amount &amp; Currency:</span>
                <span className="text-base font-extrabold text-[#D66795] tabular-nums">
                  {reviewingOrder.amount} ({reviewingOrder.currency})
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#7A5A52] font-bold">Payment Method:</span>
                <span className="font-extrabold text-[#50352F] uppercase">
                  {reviewingOrder.paymentMethod.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#7A5A52] font-bold">Transaction Reference:</span>
                <code className="px-2.5 py-1 rounded-lg bg-[#FFFDF8] border border-[#F58CB7] text-[#D66795] font-extrabold font-mono">
                  {reviewingOrder.paymentReference}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F0DEC6]">
                <span className="text-[#7A5A52] font-bold">Verification Label:</span>
                <span className="font-extrabold text-[#8A5A19]">
                  Seller Verified (Not Bank Verified)
                </span>
              </div>
            </div>

            {/* Mandatory 3-Item Seller Statement Verification Checklist */}
            <div className="space-y-3">
              <div className="ds-label">
                Seller Statement Verification Checklist
              </div>

              <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] text-[14px] text-[#50352F] cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checklist-item-1"
                  checked={checkAppOpened}
                  onChange={(e) => setCheckAppOpened(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[#236B56] shrink-0"
                />
                <span>
                  <strong>1. Official Wallet / Bank Statement Opened:</strong> I opened my actual{' '}
                  {reviewingOrder.paymentMethod.toUpperCase()} app or bank statement (not relying only on a screenshot, transaction ID, or unverified SMS).
                </span>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] text-[14px] text-[#50352F] cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checklist-item-2"
                  checked={checkRefMatched}
                  onChange={(e) => setCheckRefMatched(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[#236B56] shrink-0"
                />
                <span>
                  <strong>2. Transaction Reference Matched:</strong> I verified that reference{' '}
                  <code className="font-mono font-extrabold text-[#D66795]">
                    {reviewingOrder.paymentReference}
                  </code>{' '}
                  matches a settled incoming payment in my receiving account.
                </span>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#FFFDF8] border-2 border-[#F0DEC6] text-[14px] text-[#50352F] cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checklist-item-3"
                  checked={checkAmountMatched}
                  onChange={(e) => setCheckAmountMatched(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[#236B56] shrink-0"
                />
                <span>
                  <strong>3. Exact Amount Confirmed:</strong> I confirmed the amount received is{' '}
                  <strong>
                    {reviewingOrder.amount} ({reviewingOrder.currency})
                  </strong>{' '}
                  and authorize unlocking the buyer&apos;s download as{' '}
                  <strong>Seller Verified</strong>.
                </span>
              </label>
            </div>

            {expressVerifyError && (
              <div className="p-3.5 rounded-2xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-[14px] font-bold text-[#9E3B66]">
                {expressVerifyError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2">
              <button
                type="button"
                data-testid="reject-express-payment-btn"
                disabled={isVerifyingExpress}
                onClick={async () => {
                  setIsVerifyingExpress(true);
                  setExpressVerifyError(null);
                  try {
                    await onUpdateOrderStatus(reviewingOrder.id, 'Failed');
                    showToast(`Order #${reviewingOrder.orderNumber} marked Failed (Rejected)`);
                    setReviewingOrder(null);
                  } catch (err) {
                    setExpressVerifyError(
                      err instanceof Error ? err.message : 'Failed to reject order.'
                    );
                  } finally {
                    setIsVerifyingExpress(false);
                  }
                }}
                className="px-4 py-3 rounded-2xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-[#9E3B66] text-[15px] font-extrabold cursor-pointer min-h-[44px]"
              >
                Reject Reference
              </button>

              <button
                type="button"
                data-testid="confirm-express-payment-btn"
                disabled={
                  !checkAppOpened || !checkRefMatched || !checkAmountMatched || isVerifyingExpress
                }
                onClick={async () => {
                  setIsVerifyingExpress(true);
                  setExpressVerifyError(null);
                  try {
                    await onUpdateOrderStatus(reviewingOrder.id, 'Paid');
                    markOrderTransitionedToCompleted(reviewingOrder.id);
                    showToast(
                      `Order #${reviewingOrder.orderNumber} Seller Verified & buyer download unlocked!`
                    );
                    setReviewingOrder(null);
                  } catch (err) {
                    setExpressVerifyError(
                      err instanceof Error ? err.message : 'Verification failed.'
                    );
                  } finally {
                    setIsVerifyingExpress(false);
                  }
                }}
                className="candy-btn-mint px-6 py-3 rounded-2xl disabled:opacity-40 text-[15px] font-extrabold cursor-pointer min-h-[44px] flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {isVerifyingExpress
                    ? 'Verifying...'
                    : 'Confirm Receipt & Unlock Download (Seller Verified)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 7: CLEAN PRODUCT UPLOAD EXPERIENCE MODAL */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 bg-[#50352F]/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProductForm}
            className="candy-card-white rounded-[32px] max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-7 space-y-5 my-4 sm:my-8"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#F3E2CB] pb-4">
              <div className="flex items-center gap-3">
                <ClayIcon tone="pink" size="md">
                  <Package className="w-5 h-5" />
                </ClayIcon>
                <div>
                  <h3 className="ds-section-title font-extrabold text-[#50352F]">
                    {editingProductId ? 'Edit Product' : 'Add Digital Product'}
                  </h3>
                  <p className="ds-helper mt-0.5">
                    Fields marked with * are required to publish your product.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="candy-btn-cream px-3.5 py-2 rounded-xl text-[14px] font-extrabold cursor-pointer min-h-[44px]"
              >
                Close
              </button>
            </div>

            {productFormError && (
              <div className="p-3.5 rounded-2xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-[14px] font-bold text-[#9E3B66] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#D66795]" />
                <span>{productFormError}</span>
              </div>
            )}

            {/* 1. Product Title */}
            <div>
              <label className="ds-label block mb-1.5">
                Product Title <span className="text-[#D66795]">*</span>
              </label>
              <input
                type="text"
                required
                data-testid="product-title-input"
                value={prodTitle}
                onChange={(e) => setProdTitle(e.target.value)}
                placeholder="e.g. The 30-Day Life Reset Guide"
                className="candy-input"
              />
            </div>

            {/* 2. Description */}
            <div>
              <label className="ds-label block mb-1.5">
                Description <span className="text-[#D66795]">*</span>
              </label>
              <textarea
                rows={3}
                required
                data-testid="product-description-input"
                value={prodDescription}
                onChange={(e) => setProdDescription(e.target.value)}
                placeholder="Explain what buyers will learn or receive in this digital download..."
                className="candy-input"
              />
            </div>

            {/* 3. Price */}
            <div className="p-4 rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="ds-label">
                  Price <span className="text-[#D66795]">*</span>
                </span>
                <label className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#50352F] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prodIsFree}
                    onChange={(e) => setProdIsFree(e.target.checked)}
                    className="w-4 h-4 accent-[#F58CB7]"
                  />
                  <span>Make this a Free Download ($0)</span>
                </label>
              </div>

              {!prodIsFree && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="ds-helper font-extrabold text-[#50352F] block mb-1">
                      Price in PKR (Rs)
                    </label>
                    <input
                      type="number"
                      min={100}
                      value={prodPricePkr}
                      onChange={(e) => {
                        const pkr = Number(e.target.value) || 100;
                        setProdPricePkr(pkr);
                        setProdPriceUsd(
                          Math.max(1, Math.round(pkr / (config.exchangeRatePkr || 278)))
                        );
                      }}
                      className="candy-input"
                    />
                  </div>
                  <div>
                    <label className="ds-helper font-extrabold text-[#50352F] block mb-1">
                      Price in USD ($)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={prodPriceUsd}
                      onChange={(e) => {
                        const usd = Number(e.target.value) || 1;
                        setProdPriceUsd(usd);
                        setProdPricePkr(Math.round(usd * (config.exchangeRatePkr || 278)));
                      }}
                      className="candy-input"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 4. Cover Image & 5. Digital File */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <label className="p-4 rounded-[22px] border-2 border-dashed border-[#F58CB7] bg-[#FFE7F1]/55 hover:bg-[#FFE7F1] transition-colors cursor-pointer flex flex-col items-center text-center min-h-[88px] justify-center">
                <Upload className="w-5 h-5 text-[#D66795] mb-1.5" />
                <span className="text-[14px] font-extrabold text-[#50352F]">Cover Image</span>
                <span className="ds-helper truncate max-w-full mt-0.5">
                  {imageUploadStatus || 'Upload PNG, JPG or WebP'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>

              <label className="p-4 rounded-[22px] border-2 border-dashed border-[#BBA0EA] bg-[#F0E9FE]/55 hover:bg-[#F0E9FE] transition-colors cursor-pointer flex flex-col items-center text-center min-h-[88px] justify-center">
                <FileText className="w-5 h-5 text-[#6B4EA2] mb-1.5" />
                <span className="text-[14px] font-extrabold text-[#50352F]">Digital File</span>
                <span className="ds-helper text-[#6B4EA2] font-bold truncate max-w-full mt-0.5">
                  {fileUploadStatus || (prodFileName ? `${prodFileName} (${prodFileSize})` : 'Choose PDF, EPUB, ZIP or document (max 5 MB)')}
                </span>
                <input
                  type="file"
                  accept=".pdf,.epub,.zip,.txt,.doc,.docx"
                  onChange={handleDigitalFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Collapsible Advanced Settings */}
            <details className="rounded-[22px] bg-[#FFF2DF]/65 border-2 border-[#F0DEC6] p-4">
              <summary
                data-testid="toggle-advanced-product-settings"
                className="ds-label cursor-pointer flex items-center justify-between min-h-[44px]"
              >
                <span>Advanced Settings (Optional)</span>
                <ChevronDown className="w-4 h-4 text-[#7A5A52]" />
              </summary>
              <div className="mt-4 space-y-3.5 pt-3 border-t border-[#F0DEC6]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="ds-label block mb-1">Product Category</label>
                    <select
                      value={prodCategory}
                      onChange={(e) => setProdCategory(e.target.value as Product['category'])}
                      className="candy-input"
                    >
                      <option value="Ebooks">Ebooks</option>
                      <option value="Workbooks">Workbooks</option>
                      <option value="Planners">Planners</option>
                      <option value="Templates">Templates</option>
                      <option value="Bundles">Bundles</option>
                    </select>
                  </div>
                  <div>
                    <label className="ds-label block mb-1">Short Subtitle</label>
                    <input
                      type="text"
                      value={prodSubtitle}
                      onChange={(e) => setProdSubtitle(e.target.value)}
                      placeholder="Optional short summary"
                      className="candy-input"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#50352F] cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={prodPublished}
                    onChange={(e) => setProdPublished(e.target.checked)}
                    className="w-4 h-4 accent-[#F58CB7]"
                  />
                  <span>Publish immediately on storefront</span>
                </label>
              </div>
            </details>

            {/* 6. Publish Button */}
            <div className="flex flex-col-reverse md:flex-row items-stretch md:items-center justify-end gap-3 pt-2">
              <CandyButton
                type="button"
                variant="cream"
                size="md"
                onClick={() => setShowProductModal(false)}
                className="w-full md:w-auto px-5 py-3 min-h-[44px]"
              >
                <span>Cancel</span>
              </CandyButton>
              <CandyButton
                type="submit"
                data-testid="publish-product-btn"
                variant="pink"
                size="md"
                loading={isSavingProduct || isUploadingDigitalFile}
                className="w-full md:w-auto px-5 py-3 min-h-[44px]"
              >
                <span>{editingProductId ? 'Update Product' : 'Publish Product'}</span>
              </CandyButton>
            </div>
          </form>
        </div>
      )}

      {/* SMART 5% COMMISSION PAYMENT SUBMISSION MODAL */}
      {payingInvoice && (
        <div
          data-testid="pay-commission-modal"
          className="fixed inset-0 z-50 bg-[#50352F]/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleSubmitCommissionPayment}
            className="candy-card-white rounded-[32px] max-w-md w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 my-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b-2 border-[#F3E2CB] pb-3">
              <div className="flex items-center gap-3">
                <ClayIcon tone="butter" size="sm">
                  <Sparkles className="w-4 h-4" />
                </ClayIcon>
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#D66795]">
                    Settle 5% Commission Invoice
                  </span>
                  <h3 className="text-lg font-extrabold text-[#50352F] mt-0.5">
                    {payingInvoice.invoiceNumber}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayingInvoice(null)}
                className="candy-btn-cream min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-3.5 rounded-[20px] bg-[#FFF2DF]/70 border-2 border-[#F0DEC6] text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#7A5A52] font-bold">Verified Sales Billed:</span>
                <span className="font-extrabold text-[#50352F]">
                  {payingInvoice.verifiedSalesCount} orders ({payingInvoice.orderNumbers.join(', ')})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A5A52] font-bold">Outstanding 5% Commission:</span>
                <span className="font-extrabold text-[#D66795] text-sm">
                  {formatMinorToMajor(payingInvoice.remainingBalanceMinor, payingInvoice.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A5A52] font-bold">7-Day Payment Deadline:</span>
                <span className="font-extrabold text-[#50352F]">
                  {payingInvoice.dueAtIso.slice(0, 10)}
                </span>
              </div>
            </div>

            <div>
              <label className="ds-label block mb-1">Payment Method Used</label>
              <select
                value={commPayMethod}
                onChange={(e) => setCommPayMethod(e.target.value)}
                data-testid="commission-payment-method-select"
                className="candy-input"
              >
                <option value="jazzcash">JazzCash (DreamStore Settlement)</option>
                <option value="easypaisa">Easypaisa (DreamStore Settlement)</option>
                <option value="upi_india">UPI Transfer (India Settlement)</option>
                <option value="manual_bank">Bank Transfer / IBAN</option>
              </select>
            </div>

            <div>
              <label className="ds-label block mb-1">
                Transaction Reference ID <span className="text-[#D66795]">*</span>
              </label>
              <input
                type="text"
                required
                value={commPayRef}
                onChange={(e) => setCommPayRef(e.target.value)}
                placeholder="e.g. JC-COMM-998877"
                data-testid="commission-payment-ref-input"
                className="candy-input font-mono"
              />
            </div>

            <div>
              <label className="ds-label block mb-1">Payment Proof / Receipt Note</label>
              <textarea
                rows={2}
                value={commPayProof}
                onChange={(e) => setCommPayProof(e.target.value)}
                placeholder="Optional sender wallet number or receipt details..."
                data-testid="commission-payment-proof-input"
                className="candy-input"
              />
            </div>

            {commPayError && (
              <div className="p-3 rounded-xl bg-[#FFE7F1] border-2 border-[#F58CB7] text-xs font-extrabold text-[#9E3B66]">
                {commPayError}
              </div>
            )}

            <button
              type="submit"
              disabled={commPaySubmitting}
              data-testid="submit-commission-payment-btn"
              className="candy-btn-pink w-full min-h-[46px] px-5 py-3 rounded-2xl font-extrabold text-sm cursor-pointer"
            >
              {commPaySubmitting ? 'Submitting Proof...' : 'Submit Commission Payment Proof'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

