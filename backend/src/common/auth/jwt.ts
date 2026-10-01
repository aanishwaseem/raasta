import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';
import { config } from '../../config/config';
import { AppError } from '../errors/app-error';
import { ROLES, type AuthUser, type Role } from './auth.types';

const secret = () => new TextEncoder().encode(config().JWT_ACCESS_SECRET);
const ISSUER = 'raasta-api';
const AUDIENCE = 'raasta-clients';

export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({ roles: user.roles, sid: user.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config().JWT_ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    const roles = (Array.isArray(payload.roles) ? payload.roles : []).filter((r): r is Role =>
      (ROLES as readonly string[]).includes(String(r)),
    );
    if (!payload.sub || typeof payload.sid !== 'string') throw AppError.unauthenticated();
    return { id: payload.sub, roles, sid: payload.sid };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw AppError.unauthenticated('Your session has expired', 'TOKEN_EXPIRED');
    if (err instanceof AppError) throw err;
    throw AppError.unauthenticated();
  }
}
