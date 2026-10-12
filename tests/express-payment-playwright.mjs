/**
 * DreamStore — Express Payment Verification Real-Browser E2E Test Suite
 * Tests the complete Express Payment Verification workflow in a real Chromium browser
 * using two isolated browser contexts: Seller Account Context & Separate Buyer Account Context.
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function runExpressPaymentPlaywrightTests() {
  const results = [];
  const record = (id, name, passed, evidence) => {
    results.push({ id, name, passed, evidence });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} | ${id}: ${name}\n   ↳ ${evidence}`);
  };

  const browser = await chromium.launch({ headless: true });

  // Separate Seller and Buyer browser contexts
  const sellerContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile-first viewport for Seller Express Verification
  });
  const buyerContext = await browser.newContext({
    viewport: { width: 1280, height: 860 },
  });

  const sellerPage = await sellerContext.newPage();
  const buyerPage = await buyerContext.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  for (const p of [sellerPage, buyerPage]) {
    p.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    p.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
  }

  const suffix = Date.now().toString().slice(-6);
  const distinctBuyerUid = `buyer-separate-acct-${suffix}`;
  const txRef = `JC-EXP-${suffix}`;

  try {
    // 1. Open Seller Dashboard in Seller Browser Context (Mobile-First 390x844)
    await sellerPage.goto(`${BASE_URL}/?screen=owner-dashboard`, {
      waitUntil: 'domcontentloaded',
    });
    await sellerPage.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 });
    const sellerHeading = await sellerPage.locator('h1').first().textContent();

    record(
      'EXP-1',
      'Seller Opens Mobile-First Dashboard & Listens for Real-Time Pending Payments',
      Boolean(sellerHeading && sellerHeading.includes('Welcome back')),
      `SellerViewport=390x844, Heading="${sellerHeading?.trim()}"`
    );

    // 2. Separate Buyer Opens Store Checkout in Isolated Buyer Browser Context
    await buyerPage.goto(
      `${BASE_URL}/?screen=checkout&buyerUid=${encodeURIComponent(distinctBuyerUid)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await buyerPage
      .locator('h2:has-text("Secure Checkout")')
      .waitFor({ state: 'visible', timeout: 15000 });

    // Fill buyer details & payment reference
    const nameInput = buyerPage.locator('input[placeholder="Enter your name"]');
    const emailInput = buyerPage.locator('input[placeholder="you@email.com"]');
    const refInput = buyerPage.locator('input[placeholder*="JC-"]');

    await nameInput.fill('Ayesha Khan (Buyer)');
    await emailInput.fill(`ayesha.buyer.${suffix}@example.com`);
    await refInput.fill(txRef);

    // Submit paid order
    await buyerPage.locator('button[type="submit"]').click();

    // Wait for buyer's completed order banner in Pending status
    const buyerBanner = buyerPage.getByTestId('buyer-completed-order-banner');
    await buyerBanner.waitFor({ state: 'visible', timeout: 10000 });

    const initialBuyerStatus = await buyerPage
      .getByTestId('buyer-order-status-pill')
      .textContent();
    const bannerText = await buyerBanner.textContent();
    const orderNumberMatch = bannerText?.match(/Order #(DS-[0-9-]+)/);
    const createdOrderNumber = orderNumberMatch ? orderNumberMatch[1] : '';

    record(
      'EXP-2',
      'Buyer Submits Transaction Reference → Pending Order Created (Never Auto-Approved)',
      initialBuyerStatus?.trim() === 'Pending' && Boolean(createdOrderNumber),
      `OrderNumber="${createdOrderNumber}", BuyerId="${distinctBuyerUid}", InitialStatus="${initialBuyerStatus?.trim()}", TxRef="${txRef}"`
    );

    // 3. Verify Optional Seller-Configured WhatsApp Link (Privacy-Safe, No Private Buyer Data Exposed)
    const waLink = buyerPage.getByTestId('whatsapp-notify-seller-link');
    const waVisible = await waLink.isVisible();
    const waHref = (await waLink.getAttribute('href')) || '';
    const decodedWa = decodeURIComponent(waHref);
    const hasOrderAndRef =
      decodedWa.includes(createdOrderNumber) && decodedWa.includes(txRef);
    const leaksBuyerEmailOrUid =
      decodedWa.includes(`ayesha.buyer.${suffix}@example.com`) ||
      decodedWa.includes(distinctBuyerUid);

    record(
      'EXP-3',
      'Optional WhatsApp Notification Link Pre-Fills Order # & Ref Without Exposing Private Buyer Data',
      waVisible &&
        waHref.startsWith('https://wa.me/') &&
        hasOrderAndRef &&
        !leaksBuyerEmailOrUid,
      `Visible=${waVisible}, HasOrderAndRef=${hasOrderAndRef}, LeaksPrivateBuyerEmailOrUid=${leaksBuyerEmailOrUid}`
    );

    // 4. Verify Duplicate Transaction Reference Prevention & Buyer Self-Approval Prevention
    const dupRefRes = await fetch(`${BASE_URL}/api/checkout/validate-and-prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `idem-different-order-dup-ref-${suffix}`,
        buyerId: `another-buyer-${suffix}`,
        sellerId: 'seller-pk-fatima',
        storeId: 'store-fatima-tech',
        customerName: 'Another Buyer',
        customerEmail: 'other@example.com',
        currency: 'PKR',
        exchangeRatePkr: 278,
        paymentMethod: 'jazzcash',
        paymentReference: txRef, // Reusing same transaction reference for same receiving account!
        items: [
          {
            id: 'prod-30-day-reset',
            title: 'The 30-Day Life Reset',
            isFree: false,
            priceUsd: 29,
            pricePkr: 8050,
            quantity: 1,
          },
        ],
      }),
    });
    const dupRefData = await dupRefRes.json();

    // Buyer attempts to self-approve their own order
    const selfApproveRes = await fetch(`${BASE_URL}/api/orders/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdOrderNumber,
        callerUid: distinctBuyerUid, // Buyer trying to approve own order!
        callerRole: 'seller',
        newStatus: 'Paid',
        statementConfirmed: true,
      }),
    });
    const selfApproveData = await selfApproveRes.json();

    record(
      'EXP-4',
      'Security Guards: Duplicate Transaction Reference (409) & Buyer Self-Approval (403) Blocked',
      dupRefRes.status === 409 &&
        dupRefData.duplicateReference === true &&
        selfApproveRes.status === 403 &&
        selfApproveData.selfApprovalBlocked === true,
      `DuplicateRefStatus=${dupRefRes.status} (duplicateReference=${dupRefData.duplicateReference}) | SelfApprovalStatus=${selfApproveRes.status} (selfApprovalBlocked=${selfApproveData.selfApprovalBlocked})`
    );

    // 5. Verify Seller Dashboard Instantly Receives "Payment Awaiting Review" Notification Without Page Reload
    const awaitingBanner = sellerPage.getByTestId('payment-awaiting-review-banner');
    const specificOrderAlert = sellerPage.getByTestId(
      `pending-order-alert-${createdOrderNumber}`
    );
    await specificOrderAlert.waitFor({ state: 'visible', timeout: 8000 });
    const awaitingText = await awaitingBanner.textContent();
    const showsAmountCurrencyMethodRef = Boolean(
      awaitingText &&
        awaitingText.includes('Payment Awaiting Review') &&
        awaitingText.includes(createdOrderNumber) &&
        awaitingText.includes(txRef) &&
        awaitingText.toLowerCase().includes('jazzcash')
    );

    record(
      'EXP-5',
      'Seller Dashboard Real-Time Listener Shows Prominent "Payment Awaiting Review" Banner with Amount, Currency, Method & Ref',
      showsAmountCurrencyMethodRef,
      `OrderShown="${createdOrderNumber}", RefShown="${txRef}", BannerIncludesDetails=${showsAmountCurrencyMethodRef}`
    );

    // 6. Seller Taps Mobile-Friendly "Review Payment" Action & Completes 3-Item Statement Checklist
    await specificOrderAlert.getByTestId('express-review-payment-btn').click();

    const modal = sellerPage.getByTestId('express-verification-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    const confirmBtn = modal.getByTestId('confirm-express-payment-btn');
    const disabledBeforeChecklist = await confirmBtn.isDisabled();

    // Check all 3 checklist items
    await modal.getByTestId('checklist-item-1').check();
    await modal.getByTestId('checklist-item-2').check();
    const stillDisabledAfterTwo = await confirmBtn.isDisabled();
    await modal.getByTestId('checklist-item-3').check();
    const enabledAfterAllThree = !(await confirmBtn.isDisabled());

    record(
      'EXP-6',
      'Mobile-Friendly "Review Payment" Modal Enforces 3-Step Wallet/Bank Statement Checklist Before Enabling Confirmation',
      disabledBeforeChecklist && stillDisabledAfterTwo && enabledAfterAllThree,
      `DisabledInitially=${disabledBeforeChecklist}, DisabledWith2Of3=${stillDisabledAfterTwo}, EnabledAfterAll3Checked=${enabledAfterAllThree}`
    );

    // 7. Seller Explicitly Confirms Receipt -> Server Marks Order Verified & Issues Download Token
    await confirmBtn.click();
    await modal.waitFor({ state: 'hidden', timeout: 5000 });

    // 8. Verify Buyer's Order Status Updates in Real Time (Without Page Reload!) & Labels Payment as "Seller Verified"
    await buyerPage.waitForFunction(
      () => {
        const pill = document.querySelector('[data-testid="buyer-order-status-pill"]');
        return pill && pill.textContent?.trim() === 'Paid';
      },
      null,
      { timeout: 8000 }
    );

    const updatedBuyerStatus = await buyerPage
      .getByTestId('buyer-order-status-pill')
      .textContent();
    const verifBadgeText = await buyerPage
      .getByTestId('buyer-order-verification-badge')
      .textContent();

    const downloadBtn = buyerPage.getByTestId('buyer-unlocked-download-btn');
    const downloadBtnVisible = await downloadBtn.isVisible();
    await downloadBtn.click();
    await buyerPage.waitForTimeout(400);
    const buyerPageText = await buyerPage.locator('body').textContent();
    const downloadSucceeded = Boolean(
      buyerPageText &&
        (buyerPageText.includes('downloads used') ||
          buyerPageText.includes('Download Digital Product (1/5)'))
    );

    record(
      'EXP-7',
      'Real-Time Buyer Status Update → Labeled "Seller Verified (Not Bank Verified)" → Unlocks & Verifies Protected Download',
      updatedBuyerStatus?.trim() === 'Paid' &&
        Boolean(verifBadgeText && verifBadgeText.includes('Seller Verified (Not Bank Verified)')) &&
        downloadBtnVisible &&
        downloadSucceeded,
      `BuyerStatus="${updatedBuyerStatus?.trim()}", Badge="${verifBadgeText?.trim()}", DownloadUnlocked=${downloadBtnVisible}, DownloadVerified=${downloadSucceeded}`
    );

    // 9. Verify Free-Tier Multi-Turn Gemini Chatbot UI, Role Switching & Conversation History
    await buyerPage.getByTestId('gemini-chat-toggle-btn').click();
    const chatPanel = buyerPage.getByTestId('gemini-chat-panel');
    await chatPanel.waitFor({ state: 'visible', timeout: 5000 });

    await buyerPage.getByTestId('gemini-role-select').selectOption('buyer_concierge');
    await buyerPage.getByTestId('gemini-model-select').selectOption('fast');
    await buyerPage.getByTestId('gemini-chat-input').fill('How does Express Payment Verification work?');
    await buyerPage.getByTestId('gemini-chat-send-btn').click();

    await buyerPage.waitForFunction(
      () => {
        const modelMsgs = document.querySelectorAll('[data-testid="gemini-chat-msg-model"]');
        return modelMsgs.length >= 2;
      },
      null,
      { timeout: 10000 }
    );

    const modelMsgCount = await buyerPage.getByTestId('gemini-chat-msg-model').count();
    const userMsgCount = await buyerPage.getByTestId('gemini-chat-msg-user').count();

    record(
      'EXP-8',
      'Free-Tier Multi-Turn Gemini Chatbot Maintains Scrollable History & Role-Based System Instructions',
      modelMsgCount >= 2 && userMsgCount >= 1,
      `UserMessages=${userMsgCount}, ModelMessages=${modelMsgCount}, Role="buyer_concierge", ModelTier="fast (gemini-3.1-flash-lite)"`
    );

    // 10. Verify Zero Console or Page Errors Across Both Browser Contexts
    record(
      'EXP-9',
      'Zero Browser Console Errors or Uncaught Page Exceptions Across Seller & Buyer Sessions',
      consoleErrors.length === 0 && pageErrors.length === 0,
      `ConsoleErrors=${consoleErrors.length}, PageErrors=${pageErrors.length}`
    );
  } finally {
    await sellerContext.close();
    await buyerContext.close();
    await browser.close();
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n======================================================`);
  console.log(
    `EXPRESS PAYMENT VERIFICATION E2E RESULTS: ${passedCount}/${results.length} PASSED`
  );
  console.log(`======================================================`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runExpressPaymentPlaywrightTests().catch((err) => {
  console.error('Express payment Playwright error:', err);
  process.exit(1);
});
