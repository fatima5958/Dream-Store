import React, { useState } from 'react';
import {
  Layout,
  Plus,
  Search,
  ShoppingBag,
  ArrowRight,
  Download,
  Sparkles,
  Heart,
  ShieldCheck,
  Upload,
  RefreshCw,
  Trash2,
  Eye,
  Check,
  Smartphone,
  Monitor,
  Palette,
  Type,
  ArrowLeft,
} from 'lucide-react';
import {
  CUSTOM_ACCENT_PRESETS,
  INITIAL_ASSETS,
  normalizeStoreThemeId,
  Product,
  resolveStoreTheme,
  ScreenId,
  STORE_THEMES,
  StoreConfig,
  StoreSection,
} from '../../types/dreamstore';
import { PastelImage } from '../EditableText';
import { CandyButton, ClayIcon, DreamStoreLogo } from '../ui/DreamUI';

interface VisualStoreEditorProps {
  config: StoreConfig;
  onUpdateConfig: (partial: Partial<StoreConfig>) => void;
  products: Product[];
  onNavigate: (screen: ScreenId, productId?: string) => void;
  isRestricted?: boolean;
  onOpenPayCommissionModal?: () => void;
}

const HEADER_IMAGE_PRESETS = [
  INITIAL_ASSETS.heroBanner,
  INITIAL_ASSETS.book30DayReset,
  INITIAL_ASSETS.bookProductivityPlanner,
  INITIAL_ASSETS.bookSelfCareToolkit,
];

const TYPOGRAPHY_PRESETS: Array<{
  id: 'editorial' | 'modern' | 'playful';
  name: string;
  sample: string;
  headingClass: string;
}> = [
  {
    id: 'editorial',
    name: 'Editorial Luxury',
    sample: 'Cormorant + Plus Jakarta',
    headingClass: 'font-serif-display',
  },
  {
    id: 'modern',
    name: 'Clean Modern',
    sample: 'Plus Jakarta Geometric',
    headingClass: 'font-wordmark font-extrabold',
  },
  {
    id: 'playful',
    name: 'Warm Creator',
    sample: 'Soft Rounded Serif',
    headingClass: 'font-serif-display italic',
  },
];

export const VisualStoreEditor: React.FC<VisualStoreEditorProps> = ({
  config,
  onUpdateConfig,
  products,
  onNavigate,
  isRestricted = false,
  onOpenPayCommissionModal,
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState<string>('sec-header');
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop');
  const [typographyPreset, setTypographyPreset] = useState<'editorial' | 'modern' | 'playful'>(
    'editorial'
  );

  // If seller is restricted due to an overdue 5% commission invoice, lock visual theme customization
  if (isRestricted) {
    return (
      <div
        data-testid="visual-editor-restricted-gate"
        className="min-h-screen bg-[#FFF2DF] flex items-center justify-center p-6 text-[#50352F]"
      >
        <div className="max-w-md w-full candy-card-white rounded-[32px] p-7 text-center space-y-4">
          <div className="flex justify-center">
            <ClayIcon tone="pink" size="lg">
              <Palette className="w-6 h-6" />
            </ClayIcon>
          </div>
          <span className="inline-block px-3.5 py-1 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[#9E3B66] text-xs font-extrabold uppercase tracking-wider">
            Theme Customization Paused
          </span>
          <h2 className="text-xl font-extrabold text-[#50352F]">
            Settle Overdue 5% Commission Invoice to Customize Theme
          </h2>
          <p className="text-xs text-[#6E4D45] leading-relaxed">
            Your existing published products and live storefront remain active for buyers, but visual theme customization is temporarily paused until your overdue 5% platform commission invoice is settled.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
            <CandyButton
              variant="cream"
              size="sm"
              onClick={() => onNavigate('owner-dashboard')}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Dashboard</span>
            </CandyButton>
            <CandyButton
              variant="pink"
              size="sm"
              onClick={() => {
                onNavigate('owner-dashboard');
                if (onOpenPayCommissionModal) onOpenPayCommissionModal();
              }}
            >
              <span>Pay 5% Commission Now</span>
            </CandyButton>
          </div>
        </div>
      </div>
    );
  }

  const activeCanonicalTheme = normalizeStoreThemeId(config.theme);
  const resolvedTheme = resolveStoreTheme(config.theme, config.customAccentColor);

  const combinedHeading = `${config.heroHeadingLine1} ${config.heroHeadingLine2}`.trim();

  const handleHeadingInput = (val: string) => {
    const words = val.split(' ');
    if (words.length <= 2) {
      onUpdateConfig({ heroHeadingLine1: val, heroHeadingLine2: '' });
    } else {
      const splitPoint = Math.ceil(words.length / 2);
      onUpdateConfig({
        heroHeadingLine1: words.slice(0, splitPoint).join(' '),
        heroHeadingLine2: words.slice(splitPoint).join(' '),
      });
    }
  };

  const cycleHeaderImage = () => {
    const currentIdx = HEADER_IMAGE_PRESETS.indexOf(config.heroImage);
    const nextIdx = (currentIdx + 1) % HEADER_IMAGE_PRESETS.length;
    onUpdateConfig({ heroImage: HEADER_IMAGE_PRESETS[nextIdx] });
    triggerToast('Cover banner updated');
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateConfig({ logoUrl: reader.result });
        triggerToast('Store logo uploaded & saved');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleHeroFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateConfig({ heroImage: reader.result });
        triggerToast('Cover banner uploaded & saved');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddSection = () => {
    const newSec: StoreSection = {
      id: `sec-${Date.now()}`,
      name: `Custom Section ${config.sections.length + 1}`,
      visible: true,
      type: 'about',
    };
    onUpdateConfig({ sections: [...config.sections, newSec] });
    setSelectedSectionId(newSec.id);
    triggerToast('Added new store section');
  };

  const triggerToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 2200);
  };

  const activeHeadingFontClass =
    TYPOGRAPHY_PRESETS.find((t) => t.id === typographyPreset)?.headingClass ||
    'font-serif-display';

  return (
    <div className="min-h-screen bg-[#FFF2DF] flex flex-col text-[#50352F]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-[#FFFDF8]/95 backdrop-blur-md border-b-2 border-[#E8D2B5] px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <DreamStoreLogo
            size="sm"
            brandName={config.landingBrand}
            onClick={() => onNavigate('landing')}
          />
          <button
            type="button"
            onClick={() => onNavigate('owner-dashboard')}
            className="candy-btn-cream inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </button>
        </div>

        {/* Viewport Toggle */}
        <div className="hidden md:flex items-center gap-1.5 bg-[#FFF2DF] border-2 border-[#E8D2B5] rounded-2xl p-1">
          <button
            type="button"
            onClick={() => setViewportMode('desktop')}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer ${
              viewportMode === 'desktop'
                ? 'candy-btn-pink'
                : 'text-[#7A5A52]'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Desktop</span>
          </button>
          <button
            type="button"
            onClick={() => setViewportMode('mobile')}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer ${
              viewportMode === 'mobile'
                ? 'candy-btn-pink'
                : 'text-[#7A5A52]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mobile</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {savedToast && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs font-extrabold text-[#236B56] bg-[#E6F8EC] px-3 py-1.5 rounded-xl border border-[#AFE0BE]">
              <Check className="w-3.5 h-3.5" /> {savedToast}
            </span>
          )}
          <CandyButton
            variant="cream"
            size="sm"
            onClick={() => onNavigate('storefront')}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Live Store</span>
          </CandyButton>
          <CandyButton
            variant="pink"
            size="sm"
            onClick={() => {
              triggerToast('Store theme & layout published!');
              setTimeout(() => onNavigate('storefront'), 500);
            }}
          >
            Publish Store
          </CandyButton>
        </div>
      </header>

      {/* Main 3-Pane Editor Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-4rem)]">
        {/* Left Pane: Sections List */}
        <aside className="lg:col-span-2 bg-[#FFFDF8] border-b-2 lg:border-b-0 lg:border-r-2 border-[#E8D2B5] p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#D66795] px-2 mb-3">
              Store Sections
            </h2>
            <div className="space-y-1.5">
              {config.sections.map((section) => {
                const isSelected = section.id === selectedSectionId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setSelectedSectionId(section.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
                      isSelected
                        ? 'candy-btn-pink'
                        : 'text-[#6E4D45] hover:bg-[#FFF2DF] hover:text-[#50352F]'
                    }`}
                  >
                    <Layout className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{section.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <CandyButton
              variant="lilac"
              size="sm"
              fullWidth
              onClick={handleAddSection}
            >
              <Plus className="w-4 h-4" />
              <span>Add Section</span>
            </CandyButton>
          </div>
        </aside>

        {/* Center Pane: Live Interactive Storefront Preview Canvas */}
        <main className="lg:col-span-7 bg-[#FFF2DF] p-4 sm:p-8 flex items-start justify-center overflow-y-auto">
          <div
            data-testid="visual-editor-canvas"
            data-theme={resolvedTheme.id}
            className={`rounded-[32px] border-2 shadow-[0_22px_50px_-15px_rgba(80,53,47,0.16)] overflow-hidden transition-all duration-300 ${resolvedTheme.pageClass} ${resolvedTheme.cardClass} ${
              viewportMode === 'mobile' ? 'w-[375px]' : 'w-full max-w-[820px]'
            }`}
          >
            {/* Top Announcement Banner */}
            <div className={`text-[11px] font-extrabold py-2 px-3 text-center border-b ${resolvedTheme.announcementClass}`}>
              {config.announcementText}
            </div>

            {/* Storefront Header inside Canvas */}
            <div className={`px-6 py-4 flex items-center justify-between border-b ${resolvedTheme.headerClass}`}>
              <div className="flex items-center gap-2.5">
                <img
                  src={config.logoUrl}
                  alt={config.storeName}
                  className="w-8 h-8 rounded-full object-cover border border-current/20"
                />
                <span className={`${activeHeadingFontClass} text-lg ${resolvedTheme.titleClass}`}>
                  {config.storeName}
                </span>
              </div>
              {viewportMode === 'desktop' && (
                <div className={`flex items-center gap-6 text-xs font-extrabold ${resolvedTheme.mutedTextClass}`}>
                  <span className={resolvedTheme.accentTextClass}>Home</span>
                  <span>Shop ({products.length})</span>
                  <span>Collection</span>
                  <span>Checkout</span>
                </div>
              )}
              <div className={`flex items-center gap-3 ${resolvedTheme.titleClass}`}>
                <span className={`text-[10px] font-extrabold ${resolvedTheme.accentTextClass}`}>{config.currency}</span>
                <Search className="w-4 h-4" />
                <ShoppingBag className={`w-4 h-4 ${resolvedTheme.accentTextClass}`} />
              </div>
            </div>

            {/* Live Hero Banner Section inside Canvas */}
            <div className="p-4 sm:p-5">
              <div className={`relative rounded-[24px] overflow-hidden border min-h-[280px] sm:min-h-[320px] flex items-center ${resolvedTheme.cardClass}`}>
                {config.heroImage && (
                  <PastelImage
                    src={config.heroImage}
                    alt="Store Hero Preview"
                    className="absolute inset-0 w-full h-full object-cover object-center"
                  />
                )}
                <div className={`absolute inset-0 ${resolvedTheme.heroOverlayClass} w-full sm:w-[70%]`} />

                <div className="relative z-10 p-6 sm:p-8 max-w-[390px] space-y-3">
                  <h1
                    className={`${activeHeadingFontClass} text-2xl sm:text-4xl leading-tight ${resolvedTheme.titleClass}`}
                  >
                    <span className="block">{config.heroHeadingLine1}</span>
                    <span className={`block ${resolvedTheme.accentTextClass}`}>{config.heroHeadingLine2}</span>
                  </h1>
                  <p className={`text-xs sm:text-sm leading-relaxed ${resolvedTheme.mutedTextClass}`}>
                    {config.heroSubheading}
                  </p>
                  <div className="pt-1">
                    <span className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-2xl text-xs font-extrabold ${resolvedTheme.buttonClass}`}>
                      {config.heroButtonText} <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </div>

              {/* 4-Column Trust Bar inside Canvas */}
              <div
                className={`mt-4 rounded-2xl border p-3.5 grid gap-3 ${resolvedTheme.cardClass} ${
                  viewportMode === 'mobile' ? 'grid-cols-2' : 'grid-cols-4'
                }`}
              >
                {[
                  { title: 'Digital Downloads', sub: 'Instant Access', icon: Download },
                  { title: 'Beautiful Resources', sub: 'Thoughtfully Designed', icon: Sparkles },
                  { title: 'Personal Growth', sub: 'One Step at a Time', icon: Heart },
                  { title: 'Secure Checkout', sub: 'Safe & Easy Payments', icon: ShieldCheck },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${resolvedTheme.accentBadgeClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-[10px] font-extrabold truncate ${resolvedTheme.titleClass}`}>
                          {item.title}
                        </div>
                        <div className={`text-[9px] truncate ${resolvedTheme.mutedTextClass}`}>{item.sub}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>

        {/* Right Pane: Theme Cards, Color Swatches, Typography Presets, Logo & Banner Inspector */}
        <aside className="lg:col-span-3 bg-[#FFFDF8] border-t-2 lg:border-t-0 lg:border-l-2 border-[#E8D2B5] p-6 space-y-6 overflow-y-auto">
          <div>
            <h2 className="text-base font-extrabold text-[#50352F]">Store Customization</h2>
            <p className="ds-helper mt-0.5">
              Personalize your theme palette, accent color, typography, logo, and hero banner in real time.
            </p>
          </div>

          {/* 6 Signature Theme Selector Cards */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
              <Palette className="w-3.5 h-3.5 text-[#D66795]" />
              <span>6 Storefront Themes</span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {STORE_THEMES.map((t) => {
                const isSelected = activeCanonicalTheme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`editor-theme-${t.id}`}
                    onClick={() => {
                      onUpdateConfig({ theme: t.id });
                      triggerToast(`Applied ${t.name} theme`);
                    }}
                    className={`p-3 rounded-[20px] border-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#F58CB7] bg-[#FFE7F1] shadow-2xs'
                        : 'border-[#F0DEC6] bg-[#FFFDF8] hover:border-[#F58CB7]'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-2">
                      {t.swatchClasses.map((swatchCls, i) => (
                        <span
                          key={i}
                          className={`w-3.5 h-3.5 rounded-full border ${swatchCls}`}
                        />
                      ))}
                    </div>
                    <div className="text-xs font-extrabold text-[#50352F]">{t.name}</div>
                    <div className="text-[10px] font-semibold text-[#7A5A52] truncate">{t.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Accent Color Swatches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
                Custom Accent Color
              </label>
              {config.customAccentColor && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateConfig({ customAccentColor: '' });
                    triggerToast('Reset to theme default accent');
                  }}
                  className="text-[11px] font-extrabold text-[#D66795] hover:underline cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CUSTOM_ACCENT_PRESETS.map((preset) => {
                const isSelected =
                  (config.customAccentColor || '').toUpperCase() === preset.hex.toUpperCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => {
                      onUpdateConfig({ customAccentColor: preset.hex });
                      triggerToast(`Accent updated to ${preset.name}`);
                    }}
                    title={preset.name}
                    className={`px-2.5 py-1.5 rounded-xl border-2 flex items-center gap-1.5 text-[11px] font-extrabold cursor-pointer ${
                      isSelected
                        ? 'border-[#50352F] bg-[#FFE7F1] text-[#50352F]'
                        : 'border-[#F0DEC6] bg-[#FFFDF8] text-[#6E4D45]'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full ${preset.swatchClass}`} />
                    <span>{preset.name.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Typography Presets */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
              <Type className="w-3.5 h-3.5 text-[#D66795]" />
              <span>Typography Preset</span>
            </label>
            <div className="space-y-1.5">
              {TYPOGRAPHY_PRESETS.map((preset) => {
                const isSelected = typographyPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setTypographyPreset(preset.id)}
                    className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-left flex items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#F58CB7] bg-[#FFE7F1] text-[#50352F] font-extrabold'
                        : 'border-[#F0DEC6] bg-[#FFFDF8] text-[#50352F] hover:bg-[#FFF2DF]'
                    }`}
                  >
                    <span className="text-xs">{preset.name}</span>
                    <span className="text-[11px] text-[#7A5A52]">{preset.sample}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Store Logo & Hero Banner Upload + Preview */}
          <div className="space-y-2.5">
            <label className="block text-xs font-extrabold uppercase tracking-wider text-[#50352F]">
              Logo &amp; Hero Banner
            </label>
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#FFF2DF]/65 border-2 border-[#F0DEC6]">
              <img
                src={config.logoUrl}
                alt="Store Logo"
                className="w-11 h-11 rounded-full object-cover border-2 border-[#F58CB7] shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold text-[#50352F] truncate">{config.storeName}</div>
                <label className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#D66795] hover:underline cursor-pointer mt-0.5">
                  <Upload className="w-3 h-3" />
                  <span>Upload Store Logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden border-2 border-[#F0DEC6] bg-[#FFF2DF] h-28">
              {config.heroImage ? (
                <PastelImage
                  src={config.heroImage}
                  alt="Header Thumbnail"
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-[#D66795] font-bold">
                  No banner image selected
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <label className="candy-btn-cream py-2 px-2.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer">
                <Upload className="w-3 h-3 text-[#D66795]" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleHeroFileUpload}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={cycleHeaderImage}
                className="candy-btn-cream py-2 px-2.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-[#7A5A52]" />
                <span>Preset</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateConfig({ heroImage: '' })}
                className="py-2 px-2.5 rounded-xl bg-[#FFE7F1] border border-[#F58CB7] text-[11px] font-extrabold text-[#9E3B66] flex items-center justify-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {/* Heading Input */}
          <div className="space-y-1.5">
            <label className="ds-label block">Hero Headline</label>
            <input
              type="text"
              value={combinedHeading}
              onChange={(e) => handleHeadingInput(e.target.value)}
              className="candy-input"
            />
          </div>

          {/* Subheading Textarea */}
          <div className="space-y-1.5">
            <label className="ds-label block">Subheading</label>
            <textarea
              rows={3}
              value={config.heroSubheading}
              onChange={(e) => onUpdateConfig({ heroSubheading: e.target.value })}
              className="candy-input"
            />
          </div>

          {/* Button Text Input */}
          <div className="space-y-1.5">
            <label className="ds-label block">Primary CTA Label</label>
            <input
              type="text"
              value={config.heroButtonText}
              onChange={(e) => onUpdateConfig({ heroButtonText: e.target.value })}
              className="candy-input"
            />
          </div>
        </aside>
      </div>
    </div>
  );
};
