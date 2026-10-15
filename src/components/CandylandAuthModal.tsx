import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Sparkles,
  X,
  Mail,
  Lock,
  User,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  signUpWithEmailAccount,
  signInWithEmailAccount,
  resetEmailAccountPassword,
  FIREBASE_PROJECT_ID,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_API_KEY,
  isPreviewIframeEnvironment,
} from '../lib/firebase';
import { ClayIcon, CandySparkleStar } from './ui/DreamUI';

export type AuthModalMode = 'signin' | 'signup';

export interface CandylandAuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  onClose: () => void;
  onSuccess?: () => void;
  brandName?: string;
}

interface FriendlyAuthNotice {
  title: string;
  message: string;
  offerRedirectFallback?: boolean;
  offerFullPageLink?: boolean;
}

function getFriendlyAuthNotice(
  err: unknown,
  mode: AuthModalMode
): FriendlyAuthNotice {
  const rawCode = ((err as { code?: string })?.code || '').toLowerCase();
  const rawMessage = (
    err instanceof Error ? err.message : String(err || '')
  ).toLowerCase();

  if (rawCode.includes('embedded-preview')) {
    return {
      title: 'Open DreamStore in a Browser Tab',
      message: 'Google sign-in cannot reliably finish inside the AI Studio preview. Open the published DreamStore website in a new tab and sign in there.',
      offerFullPageLink: true,
    };
  }
  if (
    rawCode.includes('popup-closed-by-user') ||
    rawCode.includes('cancelled-popup-request') ||
    rawCode.includes('user-cancelled')
  ) {
    return {
      title: 'Google Sign-In Didn’t Finish',
      message:
        'The sign-in window closed before completing. Please try again, use redirect sign-in, or continue with your email below.',
      offerRedirectFallback: true,
    };
  }

  if (
    rawCode.includes('invalid-api-key') ||
    rawCode.includes('configuration-not-found') ||
    rawCode.includes('invalid-app-credential') ||
    rawCode.includes('requests-from-referer-blocked')
  ) {
    return {
      title: 'Firebase Sign-In Configuration Needed',
      message: 'The live Firebase API key or Authentication provider configuration is invalid or unavailable. The DreamStore operator needs to fix this in Firebase Console.',
    };
  }
  if (rawCode.includes('unauthorized-domain') || rawMessage.includes('unauthorized-domain')) {
    return { title: 'Sign-In Setup Required', message: 'Sign-in is not enabled for this website address. Please contact the store operator.' };
  }
  if (rawCode.includes('operation-not-allowed')) {
    return { title: 'Sign-In Method Unavailable', message: 'This sign-in method is not enabled. Please try another available method or contact the store operator.' };
  }
  if (rawCode.includes('too-many-requests')) {
    return { title: 'Please Wait Before Retrying', message: 'Too many sign-in attempts. Wait a few minutes, then try again.' };
  }

  if (
    rawCode.includes('popup-blocked') ||
    rawCode.includes('operation-not-supported') ||
    rawCode.includes('web-storage-unsupported') ||
    rawCode.includes('unauthorized-domain') ||
    rawMessage.includes('unauthorized-domain')
  ) {
    return {
      title: 'Popup Sign-In Unavailable Here',
      message:
        'Your browser restricted the popup window. Use redirect sign-in below or continue with your email and password.',
      offerRedirectFallback: true,
    };
  }

  if (
    rawCode.includes('invalid-credential') ||
    rawCode.includes('wrong-password') ||
    rawCode.includes('user-not-found')
  ) {
    return {
      title: 'Incorrect Email or Password',
      message:
        mode === 'signin'
          ? 'We couldn’t find an account matching that email and password. Please try again or switch to Sign Up Free.'
          : 'Please double-check your email and password and try again.',
    };
  }

  if (rawCode.includes('email-already-in-use')) {
    return {
      title: 'Account Already Exists',
      message:
        'An account with this email already exists. Switch to Sign In to access your account.',
    };
  }

  if (rawCode.includes('weak-password')) {
    return {
      title: 'Password Too Short',
      message: 'Please choose a password with at least 6 characters.',
    };
  }

  if (rawCode.includes('invalid-email')) {
    return {
      title: 'Check Your Email Address',
      message: 'Please enter a valid email address (for example, name@example.com).',
    };
  }

  if (rawCode.includes('network-request-failed')) {
    return {
      title: 'Connection Interrupted',
      message: 'Please check your internet connection and try again.',
    };
  }

  return {
    title: mode === 'signin' ? 'Couldn’t Sign In' : 'Couldn’t Create Account',
    message:
      'Something went wrong while signing in. Please try again or continue with your email below.',
    offerRedirectFallback: true,
  };
}

export const CandylandAuthModal: React.FC<CandylandAuthModalProps> = ({
  isOpen,
  initialMode = 'signin',
  onClose,
  onSuccess,
  brandName = 'DreamStore',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingRedirect, setIsLoadingRedirect] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [notice, setNotice] = useState<FriendlyAuthNotice | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const insidePreview = isPreviewIframeEnvironment();
  const publishedDreamStoreUrl = 'https://dreamstore.ai.studio/';

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setNotice(null);
      setSuccessBanner(null);
      setIsLoadingGoogle(false);
      setIsLoadingRedirect(false);
      setIsLoadingEmail(false);
    }
  }, [isOpen, initialMode]);

  // A static frontend can display the app but cannot save creator accounts
  // or stores. Surface missing server/Firebase setup instead of silent fetches.
  useEffect(() => {
    if (!isOpen || isPreviewIframeEnvironment()) return;
    let mounted = true;
    const checkSetup = async () => {
      try {
        const response = await fetch(
          `/api/auth/oauth-diagnostics?hostname=${encodeURIComponent(currentHostname)}`,
          { cache: 'no-store', signal: AbortSignal.timeout(8000) }
        );
        if (!response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('Backend returned a webpage, not the auth API.');
        }
        if (!response.ok) throw new Error('Auth diagnostics unavailable.');
        const status = await response.json();
        if (!mounted) return;
        if (status.identityToolkitReachable === true && status.isHostnameAuthorized === false) {
          setNotice({
            title: 'This Domain Is Not Authorized for Sign-In',
            message: `DreamStore operator: add ${currentHostname} to Firebase Authentication > Settings > Authorized domains, and register the Google OAuth redirect URI.`,
          });
        }
      } catch {
        if (mounted) {
          setNotice((existing) => existing || {
            title: 'DreamStore Backend Not Verified',
            message: 'This preview may not have the Node server required for creator accounts. Open the published website and confirm /api/ready before inviting creators.',
          });
        }
      }
    };
    void checkSetup();
    return () => { mounted = false; };
  }, [isOpen, currentHostname]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSwitchMode = (nextMode: AuthModalMode) => {
    setMode(nextMode);
    setNotice(null);
    setSuccessBanner(null);
  };

  const handleContinueWithGoogle = async () => {
    if (isLoadingGoogle || isLoadingRedirect || isLoadingEmail) return;
    setNotice(null);
    setSuccessBanner(null);

    if (insidePreview) {
      setNotice(getFriendlyAuthNotice({ code: 'auth/embedded-preview' }, mode));
      return;
    }

    if (!FIREBASE_AUTH_DOMAIN || !FIREBASE_PROJECT_ID) {
      setNotice({
        title: 'Google Sign-In Unavailable',
        message: 'Please continue with your email and password below.',
      });
      return;
    }

    setIsLoadingGoogle(true);
    try {
      const method = await signInWithGooglePopup();
      if (method === 'redirect') {
        setSuccessBanner('Redirecting to Google Sign-In...');
        return;
      }
      setSuccessBanner('Signed in with Google! Redirecting...');
      if (onSuccess) {
        onSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 220);
    } catch (err) {
      setNotice(getFriendlyAuthNotice(err, mode));
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleGoogleRedirectFallback = async () => {
    if (isLoadingRedirect || isLoadingGoogle || isLoadingEmail) return;
    setNotice(null);
    if (insidePreview) {
      setNotice(getFriendlyAuthNotice({ code: 'auth/embedded-preview' }, mode));
      return;
    }
    setSuccessBanner('Connecting securely to Google Sign-In...');
    setIsLoadingRedirect(true);
    try {
      await signInWithGoogleRedirect();
      setSuccessBanner('Signed in with Google! Redirecting...');
      if (onSuccess) {
        onSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 220);
    } catch (err) {
      setSuccessBanner(null);
      setNotice(getFriendlyAuthNotice(err, mode));
    } finally {
      setIsLoadingRedirect(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoadingEmail || isLoadingGoogle || isLoadingRedirect) return;
    setNotice(null);
    setSuccessBanner(null);

    const trimmedEmail = email.trim();
    const trimmedName = fullName.trim();

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setNotice({
        title: 'Check Your Email Address',
        message: 'Please enter a valid email address to continue.',
      });
      return;
    }

    if (password.length < 6) {
      setNotice({
        title: 'Password Too Short',
        message: 'Please enter a password with at least 6 characters.',
      });
      return;
    }

    if (mode === 'signup' && trimmedName.length < 2) {
      setNotice({
        title: 'Add Your Name',
        message: 'Please enter your name or studio name (at least 2 characters).',
      });
      return;
    }

    setIsLoadingEmail(true);
    try {
      if (mode === 'signup') {
        const created = await signUpWithEmailAccount(trimmedEmail, password, trimmedName);
        setSuccessBanner(created.emailVerified
          ? `Welcome to ${brandName}, ${trimmedName}!`
          : 'Account created! Check your inbox for an email verification link before starting your store.');
      } else {
        await signInWithEmailAccount(trimmedEmail, password);
        setSuccessBanner('Welcome back! Signed in successfully.');
      }

      if (onSuccess) {
        onSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 220);
    } catch (err) {
      setNotice(getFriendlyAuthNotice(err, mode));
    } finally {
      setIsLoadingEmail(false);
    }
  };

  const handlePasswordReset = async () => {
    const trimmedEmail = email.trim();
    setNotice(null);
    setSuccessBanner(null);
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setNotice({
        title: 'Enter Your Email First',
        message:
          'Enter your email address in the field above, then tap "Reset password?".',
      });
      emailInputRef.current?.focus();
      return;
    }
    try {
      await resetEmailAccountPassword(trimmedEmail);
      setSuccessBanner(`Password reset instructions sent to ${trimmedEmail}.`);
    } catch (err) {
      setNotice(getFriendlyAuthNotice(err, 'signin'));
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          data-testid="candyland-auth-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="candyland-auth-modal-title"
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain touch-pan-y bg-[#50352F]/45 backdrop-blur-md"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <div
            className="min-h-full w-full flex items-center justify-center p-2.5 sm:p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                onClose();
              }
            }}
          >
            <motion.div
              data-testid="candyland-auth-modal"
              initial={
                prefersReducedMotion
                  ? { opacity: 1, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.94, y: 16 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.95, y: 10 }
              }
              transition={{
                duration: prefersReducedMotion ? 0 : 0.24,
                ease: [0.22, 1, 0.36, 1],
              }}
              className={`relative w-full max-w-[460px] my-2 sm:my-auto max-h-[calc(100dvh-1.25rem)] sm:max-h-[calc(100dvh-2.5rem)] flex flex-col rounded-[30px] sm:rounded-[34px] p-3 sm:p-4 text-[#50352F] shadow-[0_26px_60px_-12px_rgba(80,53,47,0.38)] transition-colors duration-300 ${
                mode === 'signin' ? 'candy-card-pink' : 'candy-card-lilac'
              }`}
            >
              {/* Decorative Candyland 3D Sparkle Ornaments */}
              <CandySparkleStar
                color="#FFD47B"
                size={24}
                className="pointer-events-none absolute -top-2.5 left-7 hidden sm:block"
              />
              <CandySparkleStar
                color={mode === 'signin' ? '#BBA0EA' : '#F58CB7'}
                size={20}
                className="pointer-events-none absolute -bottom-2 right-9 hidden sm:block"
              />

              {/* Top Bar inside Pastel Clay Shell */}
              <div className="flex items-center justify-between gap-3 px-1.5 sm:px-2 pb-2.5 sm:pb-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ClayIcon tone={mode === 'signin' ? 'butter' : 'pink'} size="sm">
                    <Sparkles className="w-4 h-4 text-[#50352F]" />
                  </ClayIcon>
                  <div className="min-w-0">
                    <span className="block font-wordmark text-base sm:text-lg font-extrabold text-[#50352F] leading-tight truncate">
                      {brandName}
                    </span>
                    <span className="block text-[11px] font-bold text-[#50352F]/80 truncate">
                      {mode === 'signin'
                        ? 'Welcome back to your sweet creator world'
                        : 'Launch your digital storefront or shopper account'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="candyland-auth-close-btn"
                  onClick={onClose}
                  aria-label="Close authentication modal"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl candy-btn-white flex items-center justify-center text-[#50352F] cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Warm White Sculpted Inner Bed (Scrolls smoothly on mobile & desktop) */}
              <div
                data-testid="candyland-auth-scroll-body"
                className="candy-inner-bed rounded-[22px] sm:rounded-[26px] p-3.5 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto overscroll-contain touch-pan-y flex-1 min-h-0"
              >
                {/* Mode Switcher Tabs: Sign In vs Sign Up */}
                <div
                  role="tablist"
                  aria-label="Authentication Mode"
                  className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-[#FFF2DF] border-2 border-[#F0DEC6]"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signin'}
                    data-testid="auth-tab-signin"
                    onClick={() => handleSwitchMode('signin')}
                    className={`min-h-[40px] sm:min-h-[42px] px-3 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                      mode === 'signin'
                        ? 'candy-btn-pink text-[#50352F]'
                        : 'text-[#6E4F47] hover:text-[#50352F]'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signup'}
                    data-testid="auth-tab-signup"
                    onClick={() => handleSwitchMode('signup')}
                    className={`min-h-[40px] sm:min-h-[42px] px-3 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                      mode === 'signup'
                        ? 'candy-btn-butter text-[#50352F]'
                        : 'text-[#6E4F47] hover:text-[#50352F]'
                    }`}
                  >
                    Sign Up Free
                  </button>
                </div>

                {/* Animated Heading & Subtitle */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={mode}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                    className="text-center space-y-1"
                  >
                    <h2
                      id="candyland-auth-modal-title"
                      data-testid="candyland-auth-heading"
                      className="font-wordmark text-xl sm:text-[26px] font-extrabold text-[#50352F] leading-tight"
                    >
                      {mode === 'signin'
                        ? 'Sign In to DreamStore'
                        : 'Create Your Free Account'}
                    </h2>
                    <p className="text-xs sm:text-sm font-medium text-[#6E4F47]">
                      {mode === 'signin'
                        ? 'Access your orders, instant downloads, or creator storefront.'
                        : 'Join with Google or email in seconds — zero monthly fees.'}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {/* Primary Raised 3D "Continue with Google" Button */}
                <div className="space-y-2">
                  {insidePreview && (
                    <div data-testid="auth-embedded-preview-guidance"
                      className="rounded-2xl bg-[#FFF1F7] border border-[#F58CB7] p-3 text-xs text-[#50352F]">
                      Google sign-in works in a full browser tab, not inside the embedded AI Studio preview.
                      <a href={publishedDreamStoreUrl} target="_blank" rel="noopener noreferrer"
                        className="block mt-2 font-extrabold underline">
                        Open DreamStore to Sign In ↗
                      </a>
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="auth-continue-with-google-btn"
                    disabled={isLoadingGoogle || isLoadingRedirect || isLoadingEmail}
                    onClick={handleContinueWithGoogle}
                    className="w-full min-h-[48px] sm:min-h-[50px] px-5 py-2.5 sm:py-3 rounded-2xl candy-btn-white text-sm sm:text-[15px] font-extrabold text-[#50352F] flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60"
                  >
                    {isLoadingGoogle || isLoadingRedirect ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#D66795] shrink-0" />
                    ) : (
                      <svg
                        className="w-5 h-5 shrink-0"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          fill="#4285F4"
                          d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
                        />
                      </svg>
                    )}
                    <span className="whitespace-nowrap">
                      {isLoadingRedirect
                        ? 'Redirecting to Google...'
                        : isLoadingGoogle
                        ? 'Opening Google Sign-In...'
                        : 'Continue with Google'}
                    </span>
                  </button>
                </div>

                {/* Short, Friendly Notice Banner (No Technical Error Codes) */}
                <AnimatePresence>
                  {notice && (
                    <motion.div
                      data-testid="auth-error-banner"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="rounded-2xl bg-[#FFF2DF] border-2 border-[#F58CB7] p-3 text-left space-y-2"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-[#D66795] shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-xs font-extrabold text-[#50352F]">
                            {notice.title}
                          </p>
                          <p className="text-xs font-medium text-[#6E4F47] leading-relaxed">
                            {notice.message}
                          </p>
                        </div>
                      </div>

                      {notice.offerFullPageLink && (
                        <a
                          href={publishedDreamStoreUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex rounded-xl candy-btn-white px-3 py-2 text-xs font-extrabold text-[#50352F]"
                        >
                          Open DreamStore in New Tab ↗
                        </a>
                      )}
                      {notice.offerRedirectFallback && !insidePreview && (
                        <div className="pt-1 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid="auth-google-redirect-fallback-btn"
                            onClick={handleGoogleRedirectFallback}
                            disabled={isLoadingRedirect}
                            className="px-3 py-1.5 rounded-xl candy-btn-white text-xs font-extrabold text-[#50352F] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>Use Redirect Sign-In</span>
                            <ArrowRight className="w-3.5 h-3.5 text-[#D66795]" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Success Feedback Banner */}
                <AnimatePresence>
                  {successBanner && (
                    <motion.div
                      data-testid="auth-success-banner"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="rounded-2xl bg-[#E6F8EC] border-2 border-[#82BF96] p-3 flex items-center gap-2.5 text-[#236B56]"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <p className="text-xs font-extrabold">{successBanner}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Divider */}
                <div className="relative flex items-center justify-center">
                  <div className="w-full border-t border-[#F0DEC6]" />
                  <span className="px-3 bg-[#FFFDF8] text-[11px] font-bold uppercase tracking-wider text-[#7A5A52] whitespace-nowrap">
                    or continue with email
                  </span>
                  <div className="w-full border-t border-[#F0DEC6]" />
                </div>

                {/* Email & Password Form */}
                <form onSubmit={handleEmailSubmit} className="space-y-3" noValidate>
                  {mode === 'signup' && (
                    <div>
                      <label
                        htmlFor="candyland-auth-name"
                        className="block text-xs font-extrabold text-[#50352F] mb-1"
                      >
                        Your Name or Creator Studio
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          ref={nameInputRef}
                          id="candyland-auth-name"
                          data-testid="auth-name-input"
                          type="text"
                          autoComplete="name"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="e.g. Fatima Zahra or Zara Studio"
                          className="w-full pl-10 pr-4 py-2.5 rounded-2xl candy-input text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="candyland-auth-email"
                      className="block text-xs font-extrabold text-[#50352F] mb-1"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={emailInputRef}
                        id="candyland-auth-email"
                        data-testid="auth-email-input"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-2xl candy-input text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="candyland-auth-password"
                        className="block text-xs font-extrabold text-[#50352F]"
                      >
                        Password
                      </label>
                      {mode === 'signin' && (
                        <button
                          type="button"
                          data-testid="auth-forgot-password-btn"
                          onClick={handlePasswordReset}
                          className="text-[11px] font-bold text-[#D66795] hover:underline cursor-pointer"
                        >
                          Reset password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#7A5A52] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="candyland-auth-password"
                        data-testid="auth-password-input"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={
                          mode === 'signup' ? 'new-password' : 'current-password'
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          mode === 'signup'
                            ? 'At least 6 characters'
                            : 'Enter your password'
                        }
                        className="w-full pl-10 pr-10 py-2.5 rounded-2xl candy-input text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A5A52] hover:text-[#50352F] cursor-pointer p-1"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    data-testid="auth-submit-email-btn"
                    disabled={isLoadingEmail || isLoadingGoogle || isLoadingRedirect}
                    className={`w-full min-h-[46px] sm:min-h-[48px] px-5 py-2.5 sm:py-3 rounded-2xl text-sm sm:text-[15px] font-extrabold text-[#50352F] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${
                      mode === 'signin' ? 'candy-btn-pink' : 'candy-btn-butter'
                    }`}
                  >
                    {isLoadingEmail ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>
                          {mode === 'signin' ? 'Signing In...' : 'Creating Account...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          {mode === 'signin'
                            ? 'Sign In with Email'
                            : 'Create Free Account'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                {/* Reassuring Footer Note */}
                <div className="pt-2 border-t border-[#F3E2CB] flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#7A5A52]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#236B56] shrink-0" />
                  <span>Protected by Google &amp; Firebase Authentication</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};
