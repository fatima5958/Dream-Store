import type { Request } from 'express';
import type { Auth } from 'firebase-admin/auth';
import { ApiError } from '../errors.ts';
import type { Principal, AuthVerifier, V2Dependencies } from '../contracts.ts';

const INVALID_USER_TOKEN_CODES = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/argument-error',
  'auth/user-disabled',
]);

export function createFirebaseVerifier(auth: Pick<Auth, 'verifyIdToken'>, options: { checkRevoked?: boolean } = {}): AuthVerifier {
  return {
    async verifyBearer(token) {
      try {
        // Only the Firebase Admin signature verifier proves identity. The normal
        // configuration also checks revocation. The limited public beta uses
        // signature verification only because it has no production Firebase
        // service-account permissions to query revoked user sessions.
        const claims = await auth.verifyIdToken(token, options.checkRevoked !== false);
        if (typeof claims.uid !== 'string' || !claims.uid || claims.uid.length > 128 ||
            /[\s/\x00-\x1f\x7f]/.test(claims.uid)) {
          throw new ApiError(401, 'auth/session-invalid', 'Please sign in again.');
        }
        return {
          uid: claims.uid,
          email: String(claims.email || ''),
          emailVerified: claims.email_verified === true,
          displayName: String(claims.name || ''),
          roleClaim: typeof claims.role === 'string' ? claims.role : undefined,
          superAdminClaim: claims.superAdmin === true,
        };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && INVALID_USER_TOKEN_CODES.has(code)) {
          throw new ApiError(401, 'auth/session-invalid', 'Your session is invalid or expired. Please sign in again.');
        }
        // An unavailable/unauthorized Firebase Admin service is NOT a
        // user sign-out event. Fail closed without blaming the user's session.
        throw new ApiError(503, 'auth/backend-unavailable', 'Account verification is temporarily unavailable.');
      }
    },
  };
}

export async function authenticatedPrincipal(req: Request, deps: V2Dependencies): Promise<Principal> {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    throw new ApiError(401, 'auth/session-invalid', 'A verified sign-in is required.');
  }
  const bearer = authorization.slice(7);
  if (!bearer || bearer.length > 10000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(bearer) ||
      (bearer.endsWith('.') && deps.allowUnsignedEmulatorTokens !== true)) {
    throw new ApiError(401, 'auth/session-invalid', 'A verified sign-in is required.');
  }
  const principal = await deps.auth.verifyBearer(bearer);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const claimedUids = [body.uid, body.userId, body.ownerId, body.buyerId, body.callerUid,
    req.query.callerUid, req.query.callerId, req.headers['x-caller-uid'], req.headers['x-dreamstore-uid']];
  if (claimedUids.some(value => value != null && String(value).trim() !== '' &&
    String(value).trim() !== principal.uid)) {
    throw new ApiError(403, 'auth/identity-mismatch', 'Cannot access another user account.');
  }
  if (body.selfAssignedAdmin === true || body.superAdmin === true ||
      body.role === 'super_admin' || body.callerRole === 'super_admin' ||
      req.headers['x-dreamstore-role'] === 'super_admin') {
    throw new ApiError(403, 'auth/role-forbidden', 'Admin privileges cannot be self-assigned.');
  }
  return principal;
}

export function isVerifiedSuperAdmin(principal: Principal, configuredUid: string): boolean {
  return Boolean(configuredUid && principal.uid === configuredUid &&
    principal.emailVerified && principal.roleClaim === 'super_admin' &&
    principal.superAdminClaim === true);
}
