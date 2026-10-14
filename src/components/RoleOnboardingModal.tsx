import React, { useState, useEffect } from 'react';
import { ShoppingBag, Store, Sparkles, User, Mail, ArrowRight, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { ClayIcon } from './ui/DreamUI';

export type OnboardingUserRole = 'buyer' | 'seller';

export interface RoleOnboardingModalProps {
  isOpen: boolean;
  defaultName: string;
  defaultEmail: string;
  emailVerified?: boolean;
  onCompleteOnboarding: (payload: {
    role: OnboardingUserRole;
    displayName: string;
    email: string;
  }) => Promise<void>;
}

export const RoleOnboardingModal: React.FC<RoleOnboardingModalProps> = ({
  isOpen,
  defaultName,
  defaultEmail,
  emailVerified = true,
  onCompleteOnboarding,
}) => {
  const [selectedRole, setSelectedRole] = useState<OnboardingUserRole | null>(null);
  const [displayName, setDisplayName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDisplayName(defaultName || '');
      setEmail(defaultEmail || '');
      setSelectedRole(null);
      setIsSaving(false);
      setErrorMsg(null);
    }
  }, [isOpen, defaultName, defaultEmail]);

  if (!isOpen) return null;

  const resolveEffectiveName = () => {
    const clean = displayName.trim() || defaultName.trim();
    if (clean) return clean.slice(0, 120);
    const emailPrefix = (email || defaultEmail || '').split('@')[0]?.trim();
    return (emailPrefix || 'Creator').slice(0, 120);
  };

  const resolveEffectiveEmail = () => {
    const candidate = (email.trim() || defaultEmail.trim()).slice(0, 254);
    if (candidate && candidate.includes('@')) return candidate;
    return '';
  };

  const handleSelectSellerAndStartWizard = async () => {
    if (isSaving) return;
    setErrorMsg(null);
    setSelectedRole('seller');
    const finalName = resolveEffectiveName();
    const finalEmail = resolveEffectiveEmail();
    if (!finalEmail || !finalEmail.includes('@')) {
      setErrorMsg('An email address is required. Please finish account registration.');
      return;
    }
    setIsSaving(true);
    try {
      await onCompleteOnboarding({
        role: 'seller',
        displayName: finalName,
        email: finalEmail,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save your seller role. Please try again.');
      setIsSaving(false);
    }
  };

  const handleConfirmBuyer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMsg(null);
    const finalName = displayName.trim();
    const finalEmail = email.trim();
    if (finalName.length < 2) {
      setErrorMsg('Please enter your name (at least 2 characters).');
      return;
    }
    if (!finalEmail || !finalEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address for order delivery.');
      return;
    }
    setIsSaving(true);
    try {
      await onCompleteOnboarding({
        role: 'buyer',
        displayName: finalName.slice(0, 120),
        email: finalEmail.slice(0, 254),
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save your buyer profile. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="role-onboarding-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#50352F]/45 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-xl rounded-[32px] bg-[#FFFDF8] border-2 border-[#E8D2B5] shadow-[0_12px_0_#D8BE9E,0_28px_60px_rgba(80,53,47,0.28)] p-6 sm:p-8 my-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <ClayIcon tone="pink" size="md">
            <Sparkles className="w-5 h-5" />
          </ClayIcon>
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFF2DF] border border-[#E8D2B5] text-[11px] font-extrabold uppercase tracking-wider text-[#D66795]">
              Welcome to DreamStore
            </span>
            <h2
              id="role-onboarding-title"
              className="font-candy text-2xl sm:text-3xl font-bold text-[#50352F] mt-1"
            >
              How would you like to use DreamStore?
            </h2>
          </div>
        </div>

        <p className="text-sm font-bold text-[#7A5A52] leading-relaxed mb-6">
          Choose your path below. We’ll tailor your account experience and save your role securely.
        </p>
        {!emailVerified && (
          <div role="status" className="mb-5 rounded-2xl bg-[#FFF2DF] border-2 border-[#FFD47B] px-4 py-3 text-sm font-semibold text-[#50352F]">
            Check your email for a Firebase verification link. You can explore the platform now,
            but uploads and private seller tools require a verified email. After verifying, sign in again.
          </div>
        )}

        {/* Two Role Choice Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Option 1: I'm here to Shop (Buyer) */}
          <button
            type="button"
            data-testid="choose-role-buyer"
            disabled={isSaving}
            onClick={() => {
              setSelectedRole('buyer');
              setErrorMsg(null);
            }}
            className={`text-left rounded-[24px] p-5 border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[168px] ${
              selectedRole === 'buyer'
                ? 'bg-[#FFF5F9] border-[#D66795] shadow-[0_6px_0_#E389B5]'
                : 'bg-[#FFFDF8] border-[#E8D2B5] hover:border-[#F58CB7] shadow-[0_5px_0_#E8D2B5]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="w-11 h-11 rounded-2xl bg-[#FFE4EF] border-2 border-[#F58CB7]/40 flex items-center justify-center text-[#D66795]">
                  <ShoppingBag className="w-5 h-5" />
                </span>
                {selectedRole === 'buyer' && (
                  <span className="px-2.5 py-1 rounded-full bg-[#D66795] text-white text-[11px] font-extrabold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Selected
                  </span>
                )}
              </div>
              <p className="font-candy text-lg font-bold text-[#50352F]">
                I'm here to Shop
              </p>
              <p className="text-xs font-bold text-[#7A5A52] mt-1.5 leading-relaxed">
                Browse digital planners, guides, and templates. Collects only your name and email—no store setup needed.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-[#F0DEC6] flex items-center justify-between text-xs font-extrabold text-[#D66795]">
              <span>Buyer Account</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>

          {/* Option 2: I want to Sell (Seller) */}
          <button
            type="button"
            data-testid="choose-role-seller"
            disabled={isSaving}
            onClick={handleSelectSellerAndStartWizard}
            className={`text-left rounded-[24px] p-5 border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[168px] ${
              selectedRole === 'seller'
                ? 'bg-[#FFF2DF] border-[#D66795] shadow-[0_6px_0_#E389B5]'
                : 'bg-[#FFFDF8] border-[#E8D2B5] hover:border-[#F58CB7] shadow-[0_5px_0_#E8D2B5]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="w-11 h-11 rounded-2xl bg-[#FFF2DF] border-2 border-[#E8D2B5] flex items-center justify-center text-[#50352F]">
                  <Store className="w-5 h-5" />
                </span>
                <span className="px-2.5 py-1 rounded-full bg-[#FFF2DF] border border-[#E8D2B5] text-[#50352F] text-[11px] font-extrabold">
                  Creator Wizard
                </span>
              </div>
              <p className="font-candy text-lg font-bold text-[#50352F]">
                I want to Sell
              </p>
              <p className="text-xs font-bold text-[#7A5A52] mt-1.5 leading-relaxed">
                Launch your digital storefront right away. Immediately starts the Store Setup Wizard.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-[#F0DEC6] flex items-center justify-between text-xs font-extrabold text-[#50352F]">
              <span>{isSaving && selectedRole === 'seller' ? 'Starting Wizard...' : 'Start Store Setup'}</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>
        </div>

        {/* Buyer Step: Collect Only Name & Email (Prefilled from Google) */}
        {selectedRole === 'buyer' && (
          <form
            onSubmit={handleConfirmBuyer}
            data-testid="buyer-onboarding-form"
            className="rounded-[24px] bg-[#FFF2DF]/65 border-2 border-[#E8D2B5] p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-candy text-base font-bold text-[#50352F]">
                Confirm Your Shopper Details
              </p>
              <span className="text-[11px] font-extrabold text-[#3A7D56] bg-[#E3F9ED] px-2.5 py-1 rounded-full border border-[#8CE0B5]">
                Prefilled from Account
              </span>
            </div>

            <div>
              <label
                htmlFor="buyer-onboarding-name"
                className="block text-xs font-extrabold uppercase tracking-wider text-[#50352F] mb-1.5"
              >
                Full Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="buyer-onboarding-name"
                  data-testid="buyer-onboarding-name-input"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your full name"
                  className="candy-input w-full pl-10 pr-4 py-3 rounded-2xl text-sm font-bold text-[#50352F]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="buyer-onboarding-email"
                className="block text-xs font-extrabold uppercase tracking-wider text-[#50352F] mb-1.5"
              >
                Delivery Email *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="buyer-onboarding-email"
                  data-testid="buyer-onboarding-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="candy-input w-full pl-10 pr-4 py-3 rounded-2xl text-sm font-bold text-[#50352F]"
                />
              </div>
            </div>

            <button
              type="submit"
              data-testid="confirm-buyer-onboarding"
              disabled={isSaving}
              className="w-full candy-btn-pink py-3.5 px-6 rounded-2xl text-sm font-extrabold text-[#50352F] flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
            >
              <span>{isSaving ? 'Saving Buyer Profile...' : 'Continue to Shop'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 rounded-2xl bg-[#FFF0F3] border-2 border-[#F58CB7] p-3.5 flex items-start gap-2.5 text-xs font-extrabold text-[#9E2A5B]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-[#F0DEC6] flex items-center justify-between gap-2 text-[11px] font-bold text-[#7A5A52]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#3A7D56]" />
            Role saved securely to your verified account
          </span>
          <span>No store setup required for shoppers</span>
        </div>
      </div>
    </div>
  );
};
