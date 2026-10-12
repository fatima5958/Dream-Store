import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  X,
  Send,
  RotateCcw,
  Bot,
  User,
  Zap,
  ShieldCheck,
  MessageSquare,
} from 'lucide-react';

export type ChatRoleId = 'seller_coach' | 'buyer_concierge' | 'copywriter';
export type ChatModelTier = 'fast' | 'general' | 'complex';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

interface GeminiChatWidgetProps {
  storeName: string;
  storeSlug: string;
  currency: string;
  productCount: number;
  isSellerOrAdmin?: boolean;
}

const ROLE_LABELS: Record<ChatRoleId, { label: string; subtitle: string }> = {
  seller_coach: {
    label: 'Seller Growth & Store Coach',
    subtitle: 'Store setup, Express Verification & 5% ledger guidance',
  },
  buyer_concierge: {
    label: 'Buyer & Payment Concierge',
    subtitle: 'Product discovery, checkout references & downloads',
  },
  copywriter: {
    label: 'Soft-Luxury Copywriter',
    subtitle: 'High-converting titles, descriptions & launch hooks',
  },
};

const QUICK_PROMPTS: Record<ChatRoleId, string[]> = {
  seller_coach: [
    'How does Express Payment Verification work?',
    'Explain the 5% commission ledger',
  ],
  buyer_concierge: [
    'How do I unlock my paid digital download?',
    'Are free products instant download?',
  ],
  copywriter: [
    'Write a soft-luxury product description',
    'Draft an Instagram launch announcement',
  ],
};

export function GeminiChatWidget({
  storeName,
  storeSlug,
  currency,
  productCount,
  isSellerOrAdmin = false,
}: GeminiChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [roleId, setRoleId] = useState<ChatRoleId>(
    isSellerOrAdmin ? 'seller_coach' : 'buyer_concierge'
  );
  const [modelTier, setModelTier] = useState<ChatModelTier>('fast');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isSellerOrAdmin && roleId !== 'buyer_concierge') {
      setRoleId('buyer_concierge');
    }
  }, [isSellerOrAdmin, roleId]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      role: 'model',
      text: isSellerOrAdmin
        ? `Hi! I'm your **DreamStore Free Assistant** for **${storeName}**. Switch my role above or ask me anything about Express Payment Verification, storefront setup, or product copywriting!`
        : `Hi! I'm your **${storeName} Shopping & Order Concierge**. Ask me anything about digital products, checkout payment references, or downloading your files!`,
      timestamp: 'Just now',
      modelUsed: 'gemini-3.1-flash-lite-preview',
    },
  ]);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (customText?: string) => {
    const trimmed = (customText ?? input).trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    if (!customText) setInput('');
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedHistory.map((m) => ({ role: m.role, text: m.text })),
          roleId,
          modelTier,
          storeContext: {
            storeName,
            storeSlug,
            currency,
            productCount,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to reach DreamStore assistant.');
      }

      const modelMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: data.reply || 'I am ready to help with your DreamStore questions.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: data.modelUsed || 'gemini-3.1-flash-lite-preview',
      };

      setMessages((prev) => [...prev, modelMsg]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not complete request.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'model',
        text: `Conversation cleared! I'm acting as your **${ROLE_LABELS[roleId].label}** for **${storeName}**. How can I help you today?`,
        timestamp: 'Just now',
        modelUsed:
          modelTier === 'complex'
            ? 'gemini-3.1-pro-preview'
            : modelTier === 'general'
            ? 'gemini-3-flash-preview'
            : 'gemini-3.1-flash-lite-preview',
      },
    ]);
    setErrorMsg(null);
  };

  return (
    <div className="w-full px-4 py-3 bg-[#FFF2DF] border-t border-[#F2DEC4] flex flex-col items-end lg:w-auto lg:p-0 lg:bg-transparent lg:border-0 lg:fixed lg:bottom-4 lg:right-4 lg:z-20 lg:pointer-events-none font-sans">
      <AnimatePresence>

        {isOpen && (
          <motion.div
            data-testid="gemini-chat-panel"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto fixed bottom-16 right-3 sm:right-4 z-50 lg:static lg:mb-2.5 w-[350px] sm:w-[380px] max-w-[calc(100vw-1.5rem)] bg-[#FFFDF8] border-2 border-[#F2DEC4] rounded-3xl shadow-[0_24px_60px_-15px_rgba(80,53,47,0.22)] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="bg-[#50352F] text-[#FFFDF8] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[#F58CB7] flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-[#50352F]" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-sm tracking-tight text-[#FFFDF8] block truncate">
                    DreamStore Assistant
                  </span>
                  <p className="text-[11px] text-[#F2DEC4] truncate">
                    {ROLE_LABELS[roleId].subtitle}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  data-testid="gemini-chat-clear-btn"
                  onClick={handleReset}
                  title="Reset conversation"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-[#F2DEC4] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-testid="gemini-chat-close-btn"
                  onClick={() => setIsOpen(false)}
                  title="Close assistant"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-[#F2DEC4] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Role & Model Selectors (Seller/Admin only; Buyers use Shopping Concierge) */}
            {isSellerOrAdmin && (
              <div className="px-3.5 py-2.5 bg-[#FFF2DF] border-b border-[#F2DEC4] grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6E4F47] mb-1">
                    Assistant Role
                  </label>
                  <select
                    data-testid="gemini-role-select"
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value as ChatRoleId)}
                    className="w-full min-h-[38px] text-[13px] bg-[#FFFDF8] border border-[#F2DEC4] rounded-xl px-2.5 py-1.5 text-[#50352F] font-medium focus:outline-none focus:border-[#F58CB7]"
                  >
                    <option value="seller_coach">Seller Coach</option>
                    <option value="buyer_concierge">Buyer Concierge</option>
                    <option value="copywriter">Product Copywriter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6E4F47] mb-1">
                    Model (Free Tier)
                  </label>
                  <select
                    data-testid="gemini-model-select"
                    value={modelTier}
                    onChange={(e) => setModelTier(e.target.value as ChatModelTier)}
                    className="w-full min-h-[38px] text-[13px] bg-[#FFFDF8] border border-[#F2DEC4] rounded-xl px-2.5 py-1.5 text-[#50352F] font-medium focus:outline-none focus:border-[#F58CB7]"
                  >
                    <option value="fast">Fast (3.1 Flash-Lite)</option>
                    <option value="general">General (3 Flash)</option>
                    <option value="complex">Complex (3.1 Pro)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Scrollable Message Thread */}
            <div
              data-testid="gemini-chat-thread"
              className="h-[280px] overflow-y-auto px-4 py-3.5 space-y-3 bg-[#FFFDF8]"
            >
              {messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    data-testid={`gemini-chat-msg-${m.role}`}
                    className={`flex items-start gap-2.5 ${
                      isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isUser
                          ? 'bg-[#50352F] text-[#FFFDF8]'
                          : 'bg-[#FFF2DF] text-[#50352F] border border-[#F2DEC4]'
                      }`}
                    >
                      {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        isUser
                          ? 'bg-[#50352F] text-[#FFFDF8] rounded-tr-xs'
                          : 'bg-[#FFF2DF] text-[#50352F] border border-[#F2DEC4] rounded-tl-xs'
                      }`}
                    >
                      <div className="whitespace-pre-line">{m.text}</div>
                      <div
                        className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${
                          isUser ? 'text-white/70 justify-end' : 'text-[#6E4F47]'
                        }`}
                      >
                        <span>{m.timestamp}</span>
                        {!isUser && m.modelUsed && (
                          <>
                            <span>•</span>
                            <span className="inline-flex items-center gap-0.5 font-medium text-[#50352F]">
                              <Zap className="w-2.5 h-2.5" />
                              {m.modelUsed}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div
                  data-testid="gemini-chat-loading"
                  className="flex items-center gap-2 text-[13px] text-[#6E4F47] bg-[#FFF2DF] border border-[#F2DEC4] rounded-2xl px-3.5 py-2.5 w-fit"
                >
                  <span className="w-2 h-2 rounded-full bg-[#F58CB7] animate-ping" />
                  <span>Thinking...</span>
                </div>
              )}

              {errorMsg && (
                <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {errorMsg}
                </div>
              )}

              <div ref={threadEndRef} />
            </div>

            {/* Quick Prompts */}
            <div className="px-3.5 py-2 bg-[#FFF2DF] border-t border-[#F2DEC4] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {QUICK_PROMPTS[roleId].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  disabled={isLoading}
                  className="shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full bg-[#FFFDF8] border border-[#F2DEC4] text-[#50352F] hover:border-[#F58CB7] transition-colors cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="p-3 bg-[#FFFDF8] border-t border-[#F2DEC4] flex items-center gap-2"
            >
              <input
                type="text"
                data-testid="gemini-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask your store assistant..."
                className="flex-1 min-h-[42px] text-base sm:text-sm bg-[#FFF2DF] border border-[#F2DEC4] rounded-xl px-3.5 py-2 text-[#50352F] placeholder-[#8C6A60] focus:outline-none focus:border-[#F58CB7]"
              />
              <button
                type="submit"
                data-testid="gemini-chat-send-btn"
                disabled={!input.trim() || isLoading}
                className="min-h-[42px] px-4 py-2 rounded-xl candy-btn-pink text-[#50352F] text-sm font-bold disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact Non-Overlapping Launcher Button */}
      <motion.button
        type="button"
        data-testid="gemini-chat-toggle-btn"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setIsOpen((prev) => !prev)}
        className="pointer-events-auto group min-h-[40px] flex items-center gap-2 pl-2.5 pr-3.5 py-1.5 rounded-full candy-btn-white text-[#50352F] cursor-pointer"
      >
        <span className="w-6 h-6 rounded-full bg-[#F58CB7] border border-[#50352F]/15 flex items-center justify-center shrink-0">
          {isOpen ? (
            <X className="w-3.5 h-3.5 text-[#50352F]" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 text-[#50352F]" />
          )}
        </span>
        <span className="text-xs font-extrabold tracking-tight text-[#50352F]">
          Assistant
        </span>
      </motion.button>
    </div>
  );
}
