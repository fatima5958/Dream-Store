import React, { useState, useEffect } from 'react';
import { resolveStoreAssetUrl } from '../types/dreamstore';
import avatarFatimaBundled from '../assets/images/avatar_fatima_1791519592784.jpg';
import book30DayResetBundled from '../assets/images/book_30_day_reset_1791519551780.jpg';
import bookProductivityPlannerBundled from '../assets/images/book_productivity_planner_1791519565673.jpg';
import bookSelfCareToolkitBundled from '../assets/images/book_self_care_toolkit_1791519580325.jpg';
import heroBannerBundled from '../assets/images/fatima_hero_banner_1791519534532.jpg';

function resolveBundledAssetUrl(src?: string | null): string {
  const cleaned = resolveStoreAssetUrl(src);
  if (!cleaned) return '';
  if (cleaned.includes('avatar_fatima_1791519592784')) return avatarFatimaBundled;
  if (cleaned.includes('book_30_day_reset_1791519551780')) return book30DayResetBundled;
  if (cleaned.includes('book_productivity_planner_1791519565673')) return bookProductivityPlannerBundled;
  if (cleaned.includes('book_self_care_toolkit_1791519580325')) return bookSelfCareToolkitBundled;
  if (cleaned.includes('fatima_hero_banner_1791519534532')) return heroBannerBundled;
  return cleaned;
}

interface EditableTextProps {
  value: string;
  onChange: (newValue: string) => void;
  isEditMode: boolean;
  canEdit?: boolean;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';
  className?: string;
  multiline?: boolean;
}

export const EditableText: React.FC<EditableTextProps> = ({
  value,
  onChange,
  isEditMode,
  canEdit = false,
  as: Component = 'span',
  className = '',
  multiline = false,
}) => {
  const [isEditingLocal, setIsEditingLocal] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const effectiveCanEdit = Boolean(canEdit && isEditMode);

  if (!effectiveCanEdit && (!canEdit || !isEditingLocal)) {
    return (
      <Component
        onDoubleClick={canEdit ? () => setIsEditingLocal(true) : undefined}
        title={
          canEdit
            ? 'Double-click to edit text, or toggle Edit Mode in the bottom bar'
            : undefined
        }
        className={`${className} ${canEdit ? 'cursor-text' : ''} transition-colors`}
      >
        {value}
      </Component>
    );
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => setIsEditingLocal(false)}
        rows={2}
        className={`${className} w-full bg-[#FFFDFC]/90 border border-[#D48C9E] rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#B54B62]/40`}
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => setIsEditingLocal(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setIsEditingLocal(false);
      }}
      style={{ width: `${Math.max(draft.length + 2, 8)}ch`, maxWidth: '100%' }}
      className={`${className} inline-block bg-[#FFFDFC]/95 border border-[#D48C9E] rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-[#B54B62]/40`}
    />
  );
};

/**
 * Resilient Image component with soft pastel 3D Candyland fallback
 */
export const PastelImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className = '' }) => {
  const resolvedSrc = resolveBundledAssetUrl(src);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  const isCompactAvatar =
    /\b(w-7|w-8|w-9|w-10|w-11|w-12|w-13|w-14|h-7|h-8|h-9|h-10|h-11|h-12|h-13|h-14)\b/.test(
      className
    );
  const initialLetter = (alt || 'D').trim().charAt(0).toUpperCase() || 'D';

  if (!resolvedSrc || hasError) {
    return (
      <div
        role="img"
        aria-label={alt || 'DreamStore image'}
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#FFE7F1] via-[#FFF2DF] to-[#F0E9FE] border border-[#F2DEC4] text-[#50352F] select-none overflow-hidden ${
          isCompactAvatar ? 'p-1' : 'p-3'
        } text-center ${className}`}
      >
        {isCompactAvatar ? (
          <span className="font-candy text-xs font-extrabold text-[#D66795] leading-none">
            {initialLetter}
          </span>
        ) : (
          <>
            <span className="w-8 h-8 rounded-xl bg-[#FFFDF8] border border-[#F58CB7]/50 shadow-[0_2px_0_#D8BE9E] flex items-center justify-center mb-1.5 text-[#D66795] font-candy font-extrabold text-sm">
              ✦
            </span>
            <span className="font-candy text-xs font-bold text-[#50352F] line-clamp-2 px-1">
              {alt || 'Digital Product'}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
};


/**
 * Delicate Pastel Blossom Branch SVG Accent matching the DreamStore reference corners
 */
export const BlossomAccentSVG: React.FC<{ className?: string; flip?: boolean }> = ({
  className = '',
  flip = false,
}) => (
  <svg
    viewBox="0 0 220 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none ${flip ? '-scale-x-100' : ''} ${className}`}
  >
    {/* Soft branch stems */}
    <path
      d="M10 165C45 135 80 110 135 85M65 122C85 100 105 70 120 45M95 103C130 98 160 105 188 95"
      stroke="#A67B73"
      strokeWidth="2.2"
      strokeLinecap="round"
      opacity="0.55"
    />
    {/* Soft green leaves */}
    <path
      d="M52 132C40 122 36 108 46 102C56 108 58 122 52 132Z"
      fill="#A8B899"
      opacity="0.65"
    />
    <path
      d="M110 96C118 82 132 78 138 86C132 96 120 99 110 96Z"
      fill="#A8B899"
      opacity="0.65"
    />
    <path
      d="M84 115C74 102 75 88 85 84C92 92 92 106 84 115Z"
      fill="#B8C6A8"
      opacity="0.6"
    />
    {/* Cherry blossom flower 1 */}
    <g transform="translate(125, 48)">
      <circle cx="0" cy="-12" r="10" fill="#F9D5DF" />
      <circle cx="11" cy="-4" r="10" fill="#F7C6D4" />
      <circle cx="7" cy="9" r="10" fill="#F9D5DF" />
      <circle cx="-7" cy="9" r="10" fill="#F7C6D4" />
      <circle cx="-11" cy="-4" r="10" fill="#FCE2E9" />
      <circle cx="0" cy="0" r="5" fill="#E38A9E" />
    </g>
    {/* Cherry blossom flower 2 */}
    <g transform="translate(168, 92) scale(0.85)">
      <circle cx="0" cy="-12" r="10" fill="#FCE2E9" />
      <circle cx="11" cy="-4" r="10" fill="#F9D5DF" />
      <circle cx="7" cy="9" r="10" fill="#F7C6D4" />
      <circle cx="-7" cy="9" r="10" fill="#F9D5DF" />
      <circle cx="-11" cy="-4" r="10" fill="#F7C6D4" />
      <circle cx="0" cy="0" r="5" fill="#E38A9E" />
    </g>
    {/* Small buds & floating petals */}
    <circle cx="88" cy="65" r="7" fill="#F7C6D4" opacity="0.85" />
    <circle cx="152" cy="65" r="5" fill="#F9D5DF" opacity="0.8" />
    <ellipse cx="195" cy="70" rx="6" ry="3.5" transform="rotate(-25 195 70)" fill="#F7C6D4" opacity="0.7" />
    <ellipse cx="60" cy="82" rx="5" ry="3" transform="rotate(35 60 82)" fill="#F9D5DF" opacity="0.75" />
  </svg>
);

/**
 * Cute Candyland 3D Clay Gift Box Illustration for Empty States
 */
export const EmptyOrdersGiftBoxSVG: React.FC<{ className?: string }> = ({ className = 'w-32 h-32' }) => (
  <svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Soft warm cocoa shadow */}
    <ellipse cx="80" cy="118" rx="48" ry="10" fill="#EBD5B8" opacity="0.75" />
    {/* Floating Candyland sparkles */}
    <path d="M35 45L37 50L42 52L37 54L35 59L33 54L28 52L33 50L35 45Z" fill="#FFD47B" stroke="#50352F" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M128 38L129.5 42L133.5 43.5L129.5 45L128 49L126.5 45L122.5 43.5L126.5 42L128 38Z" fill="#BBA0EA" stroke="#50352F" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="115" cy="25" r="3.5" fill="#AFE0BE" stroke="#50352F" strokeWidth="1.2" />
    <circle cx="48" cy="30" r="3" fill="#F58CB7" stroke="#50352F" strokeWidth="1.2" />
    {/* Heart floating out of box */}
    <path
      d="M80 42C80 37 73 33 68 38C63 33 56 37 56 42C56 49 68 56 68 56C68 56 80 49 80 42Z"
      fill="#F58CB7"
      stroke="#50352F"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    {/* Box back interior */}
    <path d="M46 66L80 54L114 66L80 78L46 66Z" fill="#D66795" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Box left side */}
    <path d="M46 66L80 78V114L46 100V66Z" fill="#F58CB7" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Box right side */}
    <path d="M114 66L80 78V114L114 100V66Z" fill="#BBA0EA" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Left open flap */}
    <path d="M46 66L32 52L66 40L80 54L46 66Z" fill="#FFD47B" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Right open flap */}
    <path d="M114 66L128 52L94 40L80 54L114 66Z" fill="#AFE0BE" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Front left flap */}
    <path d="M46 66L36 80L70 92L80 78L46 66Z" fill="#FFFDF8" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
    {/* Front right flap */}
    <path d="M114 66L124 80L90 92L80 78L114 66Z" fill="#FFF2DF" stroke="#50352F" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

