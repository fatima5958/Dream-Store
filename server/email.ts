interface OrderEmail {
  apiKey: string;
  from: string;
  recipient: string;
  subject: string;
  html: string;
  orderNumber: string;
}

export async function sendBuyerOrderEmail(input: OrderEmail, fetcher: typeof fetch = fetch): Promise<{
  deliveryProvider: 'resend_api' | 'secure_outbox';
  status: 'sent' | 'failed' | 'skipped';
  errorDetail?: string;
}> {
  if (!input.apiKey) return { deliveryProvider: 'secure_outbox', status: 'skipped',
    errorDetail: 'Email delivery is not configured. Access your order in your account.' };
  try {
    const response = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json', 'Idempotency-Key': `paid-email-${input.orderNumber}` },
      body: JSON.stringify({ from: input.from, to: [input.recipient], subject: input.subject, html: input.html }),
    });
    return response.ok ? { deliveryProvider: 'resend_api', status: 'sent' }
      : { deliveryProvider: 'resend_api', status: 'failed',
          errorDetail: `Email provider refused delivery (HTTP ${response.status}). Access your order in your account.` };
  } catch {
    return { deliveryProvider: 'resend_api', status: 'failed',
      errorDetail: 'Email delivery is temporarily unavailable. Access your order in your account.' };
  }
}
