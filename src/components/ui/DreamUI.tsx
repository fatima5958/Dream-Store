import React from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  CurrencyCode,
  formatCurrency,
  Product,
  resolveStoreTheme,
  StoreThemeId,
} from '../../types/dreamstore';
import { EditableText, PastelImage } from '../EditableText';

export const DREAM_SPRING = {
  type: 'tween' as const,
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export const DREAM_SOFT_SPRING = {
  type: 'tween' as const,
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export function createFadeSlideUpVariants(
  shouldReduceMotion: boolean | null,
  options?: { y?: number; duration?: number }
): Variants {
  const yOffset = options?.y ?? 10;
  const duration = Math.min(options?.duration ?? 0.24, 0.26);

  if (shouldReduceMotion) {
    return {
      hidden: { opacity: 1, y: 0 },
      visible: { opacity: 1, y: 0 },
    };
  }

  return {
    hidden: { opacity: 0, y: yOffset },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };
}

export function createStaggerContainerVariants(
  shouldReduceMotion: boolean | null,
  staggerChildren = 0.04,
  delayChildren = 0.02
): Variants {
  if (shouldReduceMotion) {
    return {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
    };
  }

  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren,
        delayChildren,
      },
    },
  };
}

/**
 * Soft 3D Raised Clay Icon Badge (Candyland Palette)
 */
export type CandyTone = 'pink' | 'lavender' | 'lilac' | 'peach' | 'butter' | 'mint' | 'white' | 'cocoa';

interface Dream3DIconBadgeProps {
  children: React.ReactNode;
  tone?: CandyTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Dream3DIconBadge: React.FC<Dream3DIconBadgeProps> = ({
  children,
  tone = 'pink',
  size = 'md',
  className = '',
}) => {
  const toneClass =
    tone === 'lavender' || tone === 'lilac'
      ? 'clay-icon-lilac text-[#50352F]'
      : tone === 'peach' || tone === 'butter'
      ? 'clay-icon-butter text-[#50352F]'
      : tone === 'mint'
      ? 'clay-icon-mint text-[#50352F]'
      : tone === 'white'
      ? 'candy-btn-white text-[#50352F]'
      : 'clay-icon-pink text-[#50352F]';

  const sizeClass =
    size === 'sm'
      ? 'w-10 h-10 rounded-2xl'
      : size === 'lg'
      ? 'w-14 h-14 rounded-[20px]'
      : 'w-12 h-12 rounded-[18px]';

  return (
    <div
      className={`relative ${sizeClass} ${toneClass} flex items-center justify-center shrink-0 ${className}`}
    >
      {/* Subtle 3D clay specular highlight dot */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1.5 left-2 w-2 h-1 rounded-full bg-white/70 rotate-[-18deg]"
      />
      {children}
    </div>
  );
};

export const ClayIcon = Dream3DIconBadge;

/**
 * Decorative 3D Clay Star / Sparkle Ornament
 */
export const CandySparkleStar: React.FC<{
  color?: string;
  size?: number;
  className?: string;
}> = ({ color = '#FFD47B', size = 24, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
  >
    <path
      d="M18 2.5C19.6 10.4 25.6 16.4 33.5 18C25.6 19.6 19.6 25.6 18 33.5C16.4 25.6 10.4 19.6 2.5 18C10.4 16.4 16.4 10.4 18 2.5Z"
      fill={color}
      stroke="#50352F"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <ellipse
      cx="14.5"
      cy="13.5"
      rx="2.6"
      ry="1.4"
      transform="rotate(-30 14.5 13.5)"
      fill="#FFFDF8"
      fillOpacity="0.85"
    />
  </svg>
);

/**
 * Reusable Sculpted 3D Claymorphic Feature Card
 */
export interface CandyFeatureCardProps {
  tone?: 'pink' | 'lilac' | 'mint' | 'butter' | 'white';
  badgeText?: string;
  icon?: React.ReactNode;
  title: string;
  description: string;
  footer?: React.ReactNode;
  className?: string;
}

export const CandyFeatureCard: React.FC<CandyFeatureCardProps> = ({
  tone = 'pink',
  badgeText,
  icon,
  title,
  description,
  footer,
  className = '',
}) => {
  const outerCardClass =
    tone === 'pink'
      ? 'candy-card-pink'
      : tone === 'lilac'
      ? 'candy-card-lilac'
      : tone === 'mint'
      ? 'candy-card-mint'
      : tone === 'butter'
      ? 'candy-card-butter'
      : 'candy-card-white';

  const iconTone: CandyTone =
    tone === 'pink'
      ? 'butter'
      : tone === 'lilac'
      ? 'pink'
      : tone === 'mint'
      ? 'butter'
      : tone === 'butter'
      ? 'mint'
      : 'pink';

  return (
    <div
      className={`${outerCardClass} ds-card-interactive rounded-[30px] p-4 sm:p-5 flex flex-col justify-between text-[#50352F] ${className}`}
    >
      {/* Top Bar inside Pastel Clay Shell */}
      <div className="flex items-center justify-between gap-3 px-1.5 pb-3.5">
        {icon && (
          <ClayIcon tone={iconTone} size="md">
            {icon}
          </ClayIcon>
        )}
        {badgeText && (
          <span className="px-3.5 py-1.5 rounded-full bg-[#FFFDF8] border-2 border-[#50352F]/15 text-xs font-extrabold tracking-wide text-[#50352F] shadow-[0_3px_0_rgba(80,53,47,0.12)]">
            {badgeText}
          </span>
        )}
      </div>

      {/* Warm White Sculpted Inner Bed for Maximum Readability */}
      <div className="candy-inner-bed rounded-[22px] p-5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="ds-card-title text-[#50352F] mb-2">{title}</h3>
          <p className="text-sm text-[#6E4F47] font-medium leading-relaxed">{description}</p>
        </div>
        {footer && <div className="mt-4 pt-3 border-t border-[#F3E2CB]">{footer}</div>}
      </div>
    </div>
  );
};

/**
 * Candyland Summary Card for the Seller Dashboard
 * Built on the CandyFeatureCard 3D claymorphic structure (outer pastel clay shell,
 * top bar with raised ClayIcon & status badge, and warm white sculpted inner bed)
 * to visually display Total Sales and Pending Orders.
 */
export interface CandylandSummaryCardProps {
  totalSalesAmount: string;
  grossSalesAmount?: string;
  paidOrdersCount: number;
  pendingOrdersCount: number;
  pendingOrdersAmount?: string;
  currency: CurrencyCode;
  storeName?: string;
  onReviewPendingOrders?: () => void;
  onViewAllOrders?: () => void;
  className?: string;
}

export const CandylandSummaryCard: React.FC<CandylandSummaryCardProps> = ({
  totalSalesAmount,
  grossSalesAmount,
  paidOrdersCount,
  pendingOrdersCount,
  pendingOrdersAmount,
  currency,
  storeName,
  onReviewPendingOrders,
  onViewAllOrders,
  className = '',
}) => {
  const hasPending = pendingOrdersCount > 0;

  return (
    <div
      data-testid="candyland-summary-card"
      className={`candy-card-pink ds-card-interactive rounded-[30px] p-4 sm:p-5 flex flex-col justify-between text-[#50352F] ${className}`}
    >
      {/* Top Bar inside Pastel Clay Shell (matches CandyFeatureCard structure) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 pb-3.5">
        <div className="flex items-center gap-3">
          <ClayIcon tone="butter" size="md">
            <Sparkles className="w-5 h-5 text-[#50352F]" />
          </ClayIcon>
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#50352F]/80 block">
              Candyland Store Pulse {storeName ? `· ${storeName}` : ''}
            </span>
            <h2 className="font-candy text-lg sm:text-xl font-bold text-[#50352F] leading-tight">
              Candyland Summary Card
            </h2>
          </div>
        </div>

        <span
          data-testid="candyland-summary-badge"
          className="px-3.5 py-1.5 rounded-full bg-[#FFFDF8] border-2 border-[#50352F]/15 text-xs font-extrabold tracking-wide text-[#50352F] shadow-[0_3px_0_rgba(80,53,47,0.12)] inline-flex items-center gap-1.5"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              hasPending ? 'bg-[#F58CB7]' : 'bg-[#68C7B6]'
            }`}
          />
          {hasPending
            ? `${pendingOrdersCount} Pending Review`
            : 'All Payments Verified'}
        </span>
      </div>

      {/* Warm White Sculpted Inner Bed (matches CandyFeatureCard structure) */}
      <div className="candy-inner-bed rounded-[22px] p-5 flex-1 flex flex-col justify-between">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Metric Tile 1: Total Sales (Mint & Butter 3D Claymorphic Accent) */}
          <div
            data-testid="candyland-summary-total-sales"
            className="rounded-[20px] bg-[#FFF2DF] border-2 border-[#F0DEC6] p-4 flex items-center justify-between gap-3 shadow-[0_4px_0_#E6CFAF,inset_0_2px_0_rgba(255,255,255,0.85)]"
          >
            <div className="space-y-1 min-w-0">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#7A5A52] block">
                Total Verified Sales (95% Net)
              </span>
              <div className="font-candy text-2xl sm:text-3xl font-bold text-[#50352F] tabular-nums truncate">
                {totalSalesAmount}
              </div>
              <p className="text-xs font-bold text-[#236B56]">
                {paidOrdersCount} {paidOrdersCount === 1 ? 'order' : 'orders'} Seller Verified
                {grossSalesAmount ? ` · Gross ${grossSalesAmount}` : ` · ${currency}`}
              </p>
            </div>
            <ClayIcon tone="mint" size="lg">
              <span className="font-candy text-sm font-extrabold text-[#50352F]">
                {currency}
              </span>
            </ClayIcon>
          </div>

          {/* Metric Tile 2: Pending Orders (Lilac & Butter 3D Claymorphic Accent) */}
          <div
            data-testid="candyland-summary-pending-orders"
            className="rounded-[20px] bg-[#FFF2DF] border-2 border-[#F0DEC6] p-4 flex items-center justify-between gap-3 shadow-[0_4px_0_#E6CFAF,inset_0_2px_0_rgba(255,255,255,0.85)]"
          >
            <div className="space-y-1 min-w-0">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#7A5A52] block">
                Pending Orders
              </span>
              <div className="font-candy text-2xl sm:text-3xl font-bold text-[#50352F] tabular-nums">
                {pendingOrdersCount}{' '}
                <span className="text-base font-sans-body font-extrabold text-[#D66795]">
                  {pendingOrdersCount === 1 ? 'Order' : 'Orders'}
                </span>
              </div>
              <p className="text-xs font-bold text-[#6E4F47]">
                {hasPending
                  ? `${pendingOrdersAmount ? `${pendingOrdersAmount} awaiting` : 'Awaiting'} seller statement confirmation`
                  : 'Zero pending references in queue'}
              </p>
            </div>
            <ClayIcon tone={hasPending ? 'butter' : 'lilac'} size="lg">
              <span className="font-candy text-base font-extrabold text-[#50352F] tabular-nums">
                {pendingOrdersCount}
              </span>
            </ClayIcon>
          </div>
        </div>

        {/* Footer inside Inner Bed (matches CandyFeatureCard footer slot) */}
        <div className="mt-4 pt-3 border-t border-[#F3E2CB] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <p className="text-xs font-bold text-[#6E4F47]">
            Sellers keep 95% of every verified sale · 5% DreamStore platform commission
          </p>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {hasPending && onReviewPendingOrders && (
              <button
                type="button"
                data-testid="candyland-summary-review-btn"
                onClick={onReviewPendingOrders}
                className="px-4 py-2 rounded-full candy-btn-pink text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer min-h-[38px]"
              >
                <span>Review Pending ({pendingOrdersCount})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {onViewAllOrders && (
              <button
                type="button"
                data-testid="candyland-summary-orders-btn"
                onClick={onViewAllOrders}
                className="px-4 py-2 rounded-full candy-btn-butter text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer min-h-[38px]"
              >
                <span>Open Orders Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * DreamStore Brand Identity Logo (Sculpted 3D Candy Bag + Bold Wordmark)
 */
interface DreamStoreLogoProps {
  brandName?: string;
  brandText?: string;
  tagline?: string;
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg';
  isEditMode?: boolean;
  onChangeBrand?: (val: string) => void;
  onClick?: () => void;
}

export const DreamStoreLogo: React.FC<DreamStoreLogoProps> = ({
  brandName,
  brandText,
  tagline = 'Dreamy 3D Creator World',
  showTagline = false,
  size = 'md',
  isEditMode = false,
  onChangeBrand,
  onClick,
}) => {
  const resolvedBrand = brandName || brandText || 'DreamStore';
  const iconSizeClasses =
    size === 'sm'
      ? 'w-9 h-9 rounded-xl'
      : size === 'lg'
      ? 'w-11 h-11 rounded-2xl'
      : 'w-10 h-10 rounded-2xl';

  const wordmarkClasses =
    size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-2xl sm:text-[28px]' : 'text-xl sm:text-2xl';

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 select-none group ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <div
        className={`relative ${iconSizeClasses} candy-btn-pink flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-[1.04]`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1.5 w-2 h-1 rounded-full bg-white/75 rotate-[-20deg]"
        />
        <Sparkles className="w-4 h-4 text-[#50352F]" />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span
            className={`font-wordmark tracking-tight text-[#50352F] leading-none ${wordmarkClasses}`}
          >
            {onChangeBrand ? (
              <EditableText
                value={resolvedBrand}
                onChange={onChangeBrand}
                isEditMode={isEditMode}
              />
            ) : (
              resolvedBrand
            )}
          </span>
        </div>
        {showTagline && (
          <span className="text-[11px] font-bold tracking-wider uppercase text-[#7A5A52] mt-0.5">
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
};

interface DreamFadeInProps {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}

export const DreamFadeIn: React.FC<DreamFadeInProps> = ({
  children,
  delay = 0,
  y = 8,
  className = '',
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.22,
        delay: shouldReduceMotion ? 0 : Math.min(delay, 0.12),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export const DreamDashboardModule: React.FC<DreamFadeInProps> = ({
  children,
  delay = 0,
  y = 8,
  className = '',
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-24px' }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.22,
        delay: shouldReduceMotion ? 0 : Math.min(delay, 0.1),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

interface DreamStaggerGridProps {
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
}

export const DreamStaggerGrid: React.FC<DreamStaggerGridProps> = ({
  children,
  className = '',
  staggerDelay = 0.04,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const variants = createStaggerContainerVariants(shouldReduceMotion, staggerDelay, 0.02);

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-20px' }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Tactile Soft 3D Clay Button (Primary Candy Pink, Secondary Warm White, Lilac, Butter, Mint)
 */
interface DreamButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary'
    | 'pink'
    | 'secondary'
    | 'cream'
    | 'white'
    | 'lavender'
    | 'lilac'
    | 'butter'
    | 'mint'
    | 'outline'
    | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const DreamButton: React.FC<DreamButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const sizeStyles =
    size === 'sm'
      ? 'px-4 py-2 text-xs sm:text-sm rounded-full gap-1.5 min-h-[42px]'
      : size === 'lg'
      ? 'px-7 py-3.5 text-base rounded-full gap-2.5 min-h-[52px]'
      : 'px-5 py-2.5 text-sm rounded-full gap-2 min-h-[44px]';

  const variantStyles =
    variant === 'primary' || variant === 'pink'
      ? 'candy-btn-pink font-extrabold text-[#50352F]'
      : variant === 'butter'
      ? 'candy-btn-butter font-extrabold text-[#50352F]'
      : variant === 'mint'
      ? 'candy-btn-mint font-extrabold text-[#50352F]'
      : variant === 'lavender' || variant === 'lilac'
      ? 'ds-btn-interactive bg-[#BBA0EA] hover:bg-[#C6AFE8] text-[#50352F] font-bold border-2 border-[#DFD2F8] shadow-[0_4px_0_#9677CC]'
      : variant === 'secondary' || variant === 'outline' || variant === 'cream' || variant === 'white'
      ? 'candy-btn-white font-bold text-[#50352F]'
      : 'text-[#7A5A52] hover:text-[#50352F] hover:bg-[#FFFDF8] font-semibold';

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`font-sans-body inline-flex items-center justify-center cursor-pointer select-none disabled:opacity-50 disabled:pointer-events-none ${
        fullWidth ? 'w-full' : ''
      } ${sizeStyles} ${variantStyles} ${className}`}
      {...rest}
    >
      {children}
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
    </button>
  );
};

export const CandyButton = DreamButton;

/**
 * DreamProductCard with Soft 3D elevation & Theme Awareness
 */
interface DreamProductCardProps {
  product: Product;
  sellerName?: string;
  currency: CurrencyCode;
  exchangeRatePkr?: number;
  theme?: StoreThemeId;
  customAccentColor?: string;
  isEditMode?: boolean;
  onSelect: (productId: string) => void;
  onAddToCart?: (product: Product) => void;
  onBuyNow?: (product: Product) => void;
  onUpdateProduct?: (productId: string, partial: Partial<Product>) => void;
  onUpdateTitle?: (val: string) => void;
  index?: number;
}

export const DreamProductCard: React.FC<DreamProductCardProps> = ({
  product,
  sellerName,
  currency,
  exchangeRatePkr = 278,
  theme = 'blush-bloom',
  customAccentColor,
  isEditMode = false,
  onSelect,
  onAddToCart,
  onBuyNow,
  onUpdateProduct,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [addedFeedback, setAddedFeedback] = React.useState(false);
  const cardVariants = createFadeSlideUpVariants(shouldReduceMotion, { y: 10, duration: 0.22 });
  const resolvedTheme = resolveStoreTheme(theme, customAccentColor);

  const formattedPrice = formatCurrency(product, currency, exchangeRatePkr);

  return (
    <motion.div
      variants={cardVariants}
      onClick={() => onSelect(product.id)}
      className={`ds-card-interactive group relative rounded-[24px] p-4 border cursor-pointer flex flex-col justify-between ${
        resolvedTheme.isDark ? resolvedTheme.cardClass : `${resolvedTheme.cardClass} ds-card-3d`
      }`}
    >
      <div>
        <div
          className={`relative aspect-[4/3] rounded-[18px] overflow-hidden mb-3.5 border ${resolvedTheme.mutedSurfaceClass}`}
        >
          <PastelImage
            src={product.image}
            alt={product.title}
            className="w-full h-full object-cover object-center transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />

          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md border ${resolvedTheme.accentBadgeClass}`}
            >
              {product.category}
            </span>
          </div>

          <div className="absolute top-3 right-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold shadow-xs ${
                product.isFree
                  ? 'bg-[#EFF9F6] text-[#236B56] border border-[#D7E9E4]'
                  : resolvedTheme.buttonClass
              }`}
            >
              {formattedPrice}
            </span>
          </div>
        </div>

        <div className="px-1">
          {sellerName && (
            <div
              className={`text-xs font-semibold uppercase tracking-wider mb-1 ${resolvedTheme.mutedTextClass}`}
            >
              {sellerName}
            </div>
          )}

          <h3
            className={`font-sans-body text-base sm:text-lg font-bold leading-snug transition-colors line-clamp-1 ${resolvedTheme.titleClass}`}
          >
            {onUpdateProduct ? (
              <EditableText
                value={product.title}
                onChange={(val) => onUpdateProduct(product.id, { title: val })}
                isEditMode={isEditMode}
                canEdit={Boolean(onUpdateProduct)}
              />
            ) : (
              product.title
            )}
          </h3>

          <p className={`text-sm mt-1 line-clamp-2 leading-relaxed ${resolvedTheme.mutedTextClass}`}>
            {onUpdateProduct ? (
              <EditableText
                value={product.subtitle}
                onChange={(val) => onUpdateProduct(product.id, { subtitle: val })}
                isEditMode={isEditMode}
                canEdit={Boolean(onUpdateProduct)}
              />
            ) : (
              product.subtitle
            )}
          </p>
        </div>
      </div>

      <div
        className={`mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2 px-1 ${resolvedTheme.dividerClass}`}
      >
        <div className={`text-xs font-medium ${resolvedTheme.mutedTextClass}`}>
          {product.fileType} · {product.fileSizeLabel}
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {onAddToCart && (
            <button
              type="button"
              data-testid={`add-to-cart-${product.id}`}
              onClick={() => {
                onAddToCart(product);
                setAddedFeedback(true);
                setTimeout(() => setAddedFeedback(false), 1600);
              }}
              className={`ds-btn-interactive px-3 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1 cursor-pointer min-h-[38px] ${resolvedTheme.secondaryButtonClass}`}
            >
              <span>{addedFeedback ? 'Added ✓' : 'Add to Cart'}</span>
            </button>
          )}
          {onBuyNow || onAddToCart ? (
            <button
              type="button"
              data-testid={`buy-now-${product.id}`}
              onClick={() => {
                if (onBuyNow) {
                  onBuyNow(product);
                } else if (onAddToCart) {
                  onAddToCart(product);
                }
              }}
              className={`ds-btn-interactive px-3.5 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1 cursor-pointer min-h-[38px] ${resolvedTheme.buttonClass}`}
            >
              <span>{product.isFree ? 'Get Free' : 'Buy Now'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(product.id)}
              className={`ds-btn-interactive px-4 py-2 rounded-full text-xs sm:text-sm font-semibold inline-flex items-center gap-1 cursor-pointer min-h-[40px] ${resolvedTheme.secondaryButtonClass}`}
            >
              <span>View Details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

