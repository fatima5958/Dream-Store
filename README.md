# DreamStore 🌸✨

> The cutest digital creator storefront platform. Sell digital products, templates, ebooks, and presets with instant storefronts, customizable themes, manual payment verification, and secure private deliverables.

---

## 🚀 Overview

DreamStore empowers creators to launch their digital stores in seconds with:
- **Instant Storefronts**: 6 aesthetic themes (Blush Bloom, Lavender Cloud, Vanilla Studio, Midnight Muse, Peach Petal, Clean Canvas) with real-time visual customization.
- **Digital Deliverables**: Support for PDF, EPUB, ZIP, and image products with private server-authorized signed downloads.
- **Flexible Manual Payments**: Direct buyer-to-seller payments via JazzCash, Easypaisa, UPI, and Bank Transfer with seller verification before download unlocking.
- **Fair Platform Commission**: Server-enforced 5% platform commission tracking and invoice calculation.
- **Multi-Role Experience**: Seamless switching between Store Owner, Buyer, and Super Admin.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Framer Motion
- **Backend**: Express, Node.js (v20+), Firebase Admin SDK
- **Database & Storage**: Firestore Database, Supabase Private Storage / Firebase Storage
- **Testing**: Playwright browser E2E, Node.js test runner, emulator integration suites

---

## 💻 Local Development

### Prerequisites
- Node.js v20+
- npm or bun

### Quickstart

1. **Clone repository & install dependencies:**
   ```bash
   npm install --legacy-peer-deps
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.

---

## 🧪 Test Suite

Run the full verification suite:
```bash
npm run test:server          # Server authentication and security regressions
npm run test:client          # Browser checkout and download contracts
npm run test:contracts       # Storage and safety contract checks
npm run test:v2:unit         # Backend V2 unit and repo tests
```

---

## 📄 License

Proprietary — DreamStore Team. All rights reserved.
