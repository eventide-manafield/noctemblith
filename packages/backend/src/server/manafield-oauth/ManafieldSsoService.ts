/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Manafield Account OAuth consumer. Disabled unless explicitly configured.
 * Never binds users by handle and never places native Noctemblith tokens in URLs.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DataSource } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import {
 createManafieldAuthorization,
 createManafieldTokenRequest,
 parseManafieldIdentity,
 readManafieldOAuthSettings,
 type ManafieldOAuthSettings,
} from './client.js';
import {
 createBrowserProof,
 isSameOriginMutation,
 safeRedirectTarget,
} from './flow.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const providerId = 'manafield-account';
const flowTTL = 5 * 60;
const loginTicketTTL = 60;
const stateCookieName = '__Host-noctemblith_manafield_state';
const ticketCookieName = '__Host-noctemblith_manafield_ticket';
const validOpaque = /^[A-Za-z0-9_-]{43}$/;

type OAuthMode = 'link' | 'login';
type FlowRecord = { mode: OAuthMode; verifier: string; proofHash: string; userId?: string };
type TicketRecord = { userId: string; proofHash: string };

const secret = () => randomBytes(32).toString('base64url');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const eq = (a: string, b: string) => a.length === b.length &&
 timingSafeEqual(Buffer.from(a), Buffer.from(b));

function noStore(reply: FastifyReply) {
 reply.header('Cache-Control', 'no-store, max-age=0');
 reply.header('Pragma', 'no-cache');
 reply.header('Referrer-Policy', 'no-referrer');
 reply.header('X-Content-Type-Options', 'nosniff');
}

function browserCookie(header: string | undefined, name: string): string | null {
 if (!header) return null;
 const found = header.split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
 if (found.length !== 1) return null;
 const value = found[0].slice(name.length + 1);
 return validOpaque.test(value) ? value : null;
}

function appendCookie(reply: FastifyReply, value: string) {
 const current = reply.getHeader('Set-Cookie');
 const existing = Array.isArray(current) ? current : typeof current === 'string' ? [current] : [];
 reply.header('Set-Cookie', [...existing, value]);
}

function setProofCookie(reply: FastifyReply, name: string, value: string, ttl: number) {
 appendCookie(reply, name + '=' + value +
  '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + ttl);
}

function removeProofCookie(reply: FastifyReply, name: string) {
 appendCookie(reply, name + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
}

async function boundedJson(response: Response): Promise<unknown> {
 if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
  throw new Error('OAuth provider response was not successful JSON');
 }
 if (Number(response.headers.get('content-length') ?? 0) > 16384) throw new Error('OAuth response too large');
 const reader = response.body?.getReader();
 if (!reader) throw new Error('OAuth provider returned empty stream');
 const parts: Uint8Array[] = [];
 let length = 0;
 try {
  for (;;) {
   const next = await reader.read();
   if (next.done) break;
   length += next.value.byteLength;
   if (length > 16384) throw new Error('OAuth response too large');
   parts.push(next.value);
  }
 } finally {
  reader.releaseLock();
 }
 const buffer = Buffer.concat(parts, length);
 return JSON.parse(buffer.toString('utf8')) as unknown;
}

@Injectable()
export class ManafieldSsoService {
 private readonly settings: ManafieldOAuthSettings | null;

 constructor(
  @Inject(DI.config) private config: Config,
  @Inject(DI.redis) private redis: Redis.Redis,
  @Inject(DI.db) private db: DataSource,
  @Inject(DI.usersRepository) private usersRepository: UsersRepository,
  private authenticateService: AuthenticateService,
 ) {
  this.settings = process.env.NOCTEMBLITH_MANAFIELD_SSO_ENABLED === 'true'
   ? readManafieldOAuthSettings(process.env, config.url)
   : null;
  if (process.env.NOCTEMBLITH_MANAFIELD_SSO_ENABLED === 'true' && !this.settings) {
   throw new Error('Manafield SSO enabled without a complete OAuth client registration');
  }
 }

 private async liveLocalUser(userId: string) {
  const user = await this.usersRepository.findOneBy({ id: userId });
  if (!user || user.host != null || user.isSuspended || user.isDeleted || !user.token) {
   return null;
  }
  return user;
 }

 private async authenticatedLocalUser(request: FastifyRequest) {
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
   ? header.slice(7) : '';
  // Existing-account linking deliberately requires a native login, not a
  // delegated access token with narrower or potentially unrelated scopes.
  if (token.length !== 16) return null;
  try {
   const [user, delegatedToken] = await this.authenticateService.authenticate(token);
   return user && delegatedToken == null ? this.liveLocalUser(user.id) : null;
  } catch {
   return null;
  }
 }

 private originAllowed(request: FastifyRequest): boolean {
  return isSameOriginMutation(request.headers.origin, request.headers['sec-fetch-site'], this.config.url);
 }

 private async startFlow(reply: FastifyReply, mode: OAuthMode, userId?: string): Promise<string> {
  if (!this.settings) throw new Error('Manafield SSO is disabled');
  const auth = createManafieldAuthorization(this.settings);
  const browserProof = createBrowserProof();
  const record: FlowRecord = { mode, verifier: auth.verifier, proofHash: digest(browserProof), ...(userId ? { userId } : {}) };
  const key = 'noctemblith:manafield:oauth-state:' + auth.state;
  const stored = await this.redis.set(key, JSON.stringify(record), 'EX', flowTTL, 'NX');
  if (stored !== 'OK') throw new Error('OAuth correlation unavailable');
  setProofCookie(reply, stateCookieName, browserProof, flowTTL);
  return auth.url;
 }

 private async userInfo(code: string, verifier: string) {
  if (!this.settings) throw new Error('SSO disabled');
  const exchange = createManafieldTokenRequest(this.settings, code, verifier);
  const tokenResponse = await fetch(exchange.url, {
   method: 'POST',
   headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
   body: exchange.body,
   redirect: 'error',
   cache: 'no-store',
   signal: AbortSignal.timeout(6000),
  });
  const data = await boundedJson(tokenResponse);
  if (data == null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid token response');
  const token = data as Record<string, unknown>;
  if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' ||
      !validOpaque.test(token.access_token) || token.expires_in !== 900) {
   throw new Error('Invalid OAuth token claims');
  }
  const res = await fetch(new URL('/account/oauth/userinfo', this.settings.accountOrigin), {
   method: 'GET',
   headers: { 'Authorization': 'Bearer ' + token.access_token, 'Accept': 'application/json' },
   redirect: 'error',
   cache: 'no-store',
   signal: AbortSignal.timeout(6000),
  });
  return parseManafieldIdentity(await boundedJson(res));
 }

 private async linkUser(userId: string, subjectUuid: string): Promise<'linked' | 'conflict'> {
  const current = await this.liveLocalUser(userId);
  if (!current) return 'conflict';

  // Insert is atomic. Both UNIQUE constraints prevent concurrent claiming
  // of either a subject or a local user. Existing identical links are safe.
  const inserted = await this.db.query(
   'INSERT INTO "manafield_identity_link" ("providerId", "subjectUuid", "userId") ' +
   'VALUES ($1, $2::uuid, $3) ON CONFLICT DO NOTHING RETURNING "userId"',
   [providerId, subjectUuid, userId],
  ) as Array<{ userId: string }>;
  if (inserted.length === 1) return 'linked';
  const currentLink = await this.db.query(
   'SELECT "subjectUuid"::text AS sub, "userId" FROM "manafield_identity_link" ' +
   'WHERE "providerId" = $1 AND ("subjectUuid" = $2::uuid OR "userId" = $3)',
   [providerId, subjectUuid, userId],
  ) as Array<{ sub: string; userId: string }>;
  return currentLink.length === 1 &&
   currentLink[0].sub === subjectUuid && currentLink[0].userId === userId ? 'linked' : 'conflict';
 }

 private async linkedUser(subjectUuid: string) {
  const links = await this.db.query(
   'SELECT "userId" FROM "manafield_identity_link" WHERE "providerId" = $1 AND "subjectUuid" = $2::uuid',
   [providerId, subjectUuid],
  ) as Array<{ userId: string }>;
  return links.length === 1 ? this.liveLocalUser(links[0].userId) : null;
 }

 public registerRoutes(fastify: FastifyInstance): void {
  fastify.get('/auth/manafield/status', async (_request, reply) => {
   noStore(reply);
   return { enabled: this.settings != null };
  });

  fastify.post('/auth/manafield/link/status', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   const user = await this.authenticatedLocalUser(request);
   if (!user) return reply.code(401).send({ error: 'local_login_required' });
   const rows = await this.db.query(
    'SELECT 1 FROM "manafield_identity_link" WHERE "providerId" = $1 AND "userId" = $2',
    [providerId, user.id],
   ) as unknown[];
   return { linked: rows.length !== 0 };
  });

  fastify.post('/auth/manafield/link/start', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   const user = await this.authenticatedLocalUser(request);
   if (!user) return reply.code(401).send({ error: 'local_login_required' });
   const url = await this.startFlow(reply, 'link', user.id);
   return { authorizationUrl: url };
  });

  fastify.get('/auth/manafield/login/start', async (_request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   const url = await this.startFlow(reply, 'login');
   return reply.code(303).header('Location', url).send();
  });

  fastify.get<{ Querystring: { code?: unknown; state?: unknown; error?: unknown } }>(
   '/auth/manafield/callback', async (request, reply) => {
    noStore(reply);
    const cookie = browserCookie(request.headers.cookie, stateCookieName);
    removeProofCookie(reply, stateCookieName);
    if (!this.settings || typeof request.query.state !== 'string' ||
        !validOpaque.test(request.query.state) || !cookie) {
     return reply.code(400).send('OAuth callback invalid');
    }
    const raw = await this.redis.getdel('noctemblith:manafield:oauth-state:' + request.query.state);
    if (!raw) return reply.code(400).send('OAuth callback expired or already used');
    let record: FlowRecord;
    try { record = JSON.parse(raw) as FlowRecord; } catch {
     return reply.code(400).send('OAuth correlation invalid');
    }
    if (!eq(record.proofHash, digest(cookie)) ||
        !validOpaque.test(record.verifier) ||
        !['link', 'login'].includes(record.mode)) {
     return reply.code(400).send('OAuth browser correlation failed');
    }
    if (request.query.error != null) {
     return reply.code(303).header('Location', safeRedirectTarget(record.mode, 'denied')).send();
    }
    if (typeof request.query.code !== 'string') {
     return reply.code(400).send('OAuth authorization code missing');
    }
    try {
     const verified = await this.userInfo(request.query.code, record.verifier);
     if (record.mode === 'link') {
      if (!record.userId) return reply.code(400).send('Local account missing');
      const linked = await this.linkUser(record.userId, verified.sub);
      return reply.code(303).header('Location', safeRedirectTarget('link', linked)).send();
     }
     const account = await this.linkedUser(verified.sub);
     if (!account) {
      return reply.code(303).header('Location', safeRedirectTarget('login', 'unlinked')).send();
     }
     const ticket = secret();
     const browserProof = createBrowserProof();
     const value: TicketRecord = { userId: account.id, proofHash: digest(browserProof) };
     const ok = await this.redis.set('noctemblith:manafield:login-ticket:' + ticket,
      JSON.stringify(value), 'EX', loginTicketTTL, 'NX');
     if (ok !== 'OK') throw new Error('One-time login ticket unavailable');
     setProofCookie(reply, ticketCookieName, browserProof, loginTicketTTL);
     return reply.code(303).header('Location', '/auth/manafield/finish?ticket=' + encodeURIComponent(ticket)).send();
    } catch {
     return reply.code(303).header('Location', safeRedirectTarget(record.mode, 'failed')).send();
    }
   },
  );

  fastify.post<{ Body: { ticket?: unknown } }>('/auth/manafield/login/finish', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   const proof = browserCookie(request.headers.cookie, ticketCookieName);
   removeProofCookie(reply, ticketCookieName);
   const ticket = request.body?.ticket;
   if (!proof || typeof ticket !== 'string' || !validOpaque.test(ticket)) {
    return reply.code(400).send({ error: 'invalid_ticket' });
   }
   const data = await this.redis.getdel('noctemblith:manafield:login-ticket:' + ticket);
   if (!data) return reply.code(400).send({ error: 'expired_ticket' });
   let record: TicketRecord;
   try { record = JSON.parse(data) as TicketRecord; } catch {
    return reply.code(400).send({ error: 'invalid_ticket' });
   }
   if (!eq(record.proofHash, digest(proof))) {
    return reply.code(403).send({ error: 'browser_mismatch' });
   }
   const local = await this.liveLocalUser(record.userId);
   if (!local) return reply.code(403).send({ error: 'account_unavailable' });
   // Deliberately return the same native token type as the existing Misskey
   // signin-flow, over a same-origin POST, never a redirect or query string.
   return { token: local.token };
  });
 }
}
