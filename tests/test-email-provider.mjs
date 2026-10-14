import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENDPOINT_FILE = path.join(os.tmpdir(), '.dreamstore-provider-endpoint.txt');

export function createTestEmailProvider(port = 3888) {
  const inboxes = new Map(); // email -> Array<{ from, to, subject, html, text, headers, receivedAtMs }>
  let shouldFail = false;
  let failureStatusCode = 500;
  let failureErrorMessage = 'Mock Resend Internal Server Error';
  let server = null;

  return {
    async start() {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          if (req.method === 'POST' && req.url === '/emails') {
            let bodyStr = '';
            req.on('data', (chunk) => {
              bodyStr += chunk;
            });
            req.on('end', () => {
              if (shouldFail) {
                res.writeHead(failureStatusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: failureErrorMessage, statusCode: failureStatusCode }));
                return;
              }

              try {
                const payload = JSON.parse(bodyStr);
                const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
                for (const r of recipients) {
                  const clean = String(r || '').toLowerCase().trim();
                  if (!inboxes.has(clean)) {
                    inboxes.set(clean, []);
                  }
                  inboxes.get(clean).push({
                    from: payload.from,
                    to: r,
                    subject: payload.subject,
                    html: payload.html,
                    text: payload.text,
                    headers: req.headers,
                    receivedAtMs: Date.now(),
                  });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  id: `re_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  from: payload.from,
                  to: payload.to,
                  createdAt: new Date().toISOString(),
                }));
              } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
              }
            });
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        });

        server.listen(port, '127.0.0.1', () => {
          const endpointUrl = `http://127.0.0.1:${port}/emails`;
          fs.writeFileSync(ENDPOINT_FILE, endpointUrl, { encoding: 'utf8', mode: 0o600 });
          resolve(endpointUrl);
        });

        server.on('error', (err) => {
          reject(err);
        });
      });
    },

    stop() {
      return new Promise((resolve) => {
        try {
          if (fs.existsSync(ENDPOINT_FILE)) {
            fs.unlinkSync(ENDPOINT_FILE);
          }
        } catch {}

        if (server) {
          server.close(() => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    },

    getDeliveredEmails(recipientEmail) {
      const clean = String(recipientEmail || '').toLowerCase().trim();
      return inboxes.get(clean) || [];
    },

    getLatestEmail(recipientEmail) {
      const emails = this.getDeliveredEmails(recipientEmail);
      return emails.length > 0 ? emails[emails.length - 1] : null;
    },

    extractResetToken(emailRecord) {
      if (!emailRecord) return null;
      const content = `${emailRecord.html || ''} ${emailRecord.text || ''}`;
      // Search for token parameter in reset link: token=DS_PW_RESET...
      const match = content.match(/[?&]token=([^&"'<\s]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
      return null;
    },

    extractResetLink(emailRecord) {
      if (!emailRecord) return null;
      const content = `${emailRecord.html || ''} ${emailRecord.text || ''}`;
      const match = content.match(/https?:\/\/[^\s"'<]+[?&]token=[^\s"'<]+/);
      return match ? match[0] : null;
    },

    simulateFailure(enable = true, statusCode = 500, errorMsg = 'Mock Resend Internal Server Error') {
      shouldFail = enable;
      failureStatusCode = statusCode;
      failureErrorMessage = errorMsg;
    },

    clearInbox() {
      inboxes.clear();
    },
  };
}
