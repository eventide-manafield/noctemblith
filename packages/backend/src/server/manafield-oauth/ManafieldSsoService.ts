/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Manafield Account OAuth consumer. Disabled unless explicitly configured.
 * Binds by verified UUID AND matching immutable handle; never places native tokens in URLs.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DataSource, IsNull } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { RoleService } from '@/core/RoleService.js';
import { SigninService } from '@/server/api/SigninService.js';
import { ManafieldSessionService, isManafieldBrowserSessionToken } from './ManafieldSessionService.js';
import { SignupService } from '@/core/SignupService.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import {
 createManafieldAuthorization,
 createManafieldTokenRequest,
 parseManafieldIdentity,
 parseManafieldProfileHandle,
 readManafieldOAuthSettings,
 matchesManafieldHandle,
 type ManafieldVerifiedIdentity,
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
const provisionCookieName = '__Host-noctemblith_manafield_provision';
const validOpaque = /^[A-Za-z0-9_-]{43}$/;

type OAuthMode = 'link' | 'login';
type FlowRecord = { mode: OAuthMode; verifier: string; proofHash: string; userId?: string };
type TicketRecord = { userId: string; subjectUuid: string; canonicalHandle: string; accessToken: string; centralGuard: string; proofHash: string };
type PendingProvision = { subjectUuid: string; canonicalHandle: string; accessToken: string; centralGuard: string };

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
  private roleService: RoleService,
  private signinService: SigninService,
  private signupService: SignupService,
  private sessionService: ManafieldSessionService,
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
   const user = await this.authenticateService.authenticateNativeForLink(token);
   return user ? this.liveLocalUser(user.id) : null;
  } catch {
   return null;
  }
 }

 private originAllowed(request: FastifyRequest): boolean {
  return isSameOriginMutation(request.headers.origin, request.headers['sec-fetch-site'], this.config.url);
 }

 // Limit unauthenticated redirects and per-browser link attempts in shared
 // Redis rather than process memory, including multi-worker deployments.
 private async startRateAllowed(request: FastifyRequest): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60000);
  const key = 'noctemblith:manafield:start-limit:' + digest(request.ip).slice(0, 32) + ':' + minute;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, 70);
  return count <= 10;
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
  const identity = await this.revalidateIdentity(token.access_token);
  return { identity, accessToken: token.access_token };
 }

 /** Revalidate account state immediately before public actor provisioning. */
 private async revalidateIdentity(accessToken: string): Promise<ManafieldVerifiedIdentity> {
  if (!this.settings || !validOpaque.test(accessToken)) throw new Error('Invalid central proof');
  const res = await fetch(new URL('/account/oauth/userinfo', this.settings.accountOrigin), {
   method: 'GET',
   headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' },
   redirect: 'error',
   cache: 'no-store',
   signal: AbortSignal.timeout(6000),
  });
  const identity = parseManafieldIdentity(await boundedJson(res));
  // A separate, authenticated OAuth endpoint queries Profile through the
  // Core↔Profile trusted service channel. Never derive an actor from login ID.
  const profileRes = await fetch(new URL('/account/oauth/profile-handle', this.settings.accountOrigin), {
   method: 'GET',
   headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' },
   redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(6000),
  });
  const handle = parseManafieldProfileHandle(await boundedJson(profileRes), identity.sub);
  return { ...identity, publicHandle: handle };
 }

 /**
  * Ask Account Core to bind this OAuth login to the original central browser
  * session. Unlike a 15-minute OAuth access token, this read-only guard lasts
  * only as long as the original Core browser session.
  */
 private async issueCentralSessionGuard(accessToken: string): Promise<string> {
  if (!this.settings || !validOpaque.test(accessToken)) throw new Error('Invalid OAuth proof');
  const response = await fetch(new URL('/account/oauth/session-guard', this.settings.accountOrigin), {
   method: 'POST',
   headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' },
   redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(6000),
  });
  const body = await boundedJson(response) as { session_guard?: unknown };
  if (typeof body.session_guard !== 'string' || !validOpaque.test(body.session_guard)) {
   throw new Error('Invalid central session guard');
  }
  return body.session_guard;
 }

 private provisionKey(proof: string): string {
  // The browser receives only an HttpOnly cookie; no central bearer or UUID in URLs.
  return 'noctemblith:manafield:provision:' + digest(proof);
 }

 private async stageProvision(reply: FastifyReply, identity: ManafieldVerifiedIdentity, accessToken: string, centralGuard: string): Promise<void> {
  const browserProof = createBrowserProof();
  if (identity.publicHandle == null) throw new Error('Public Profile handle required');
  const payload: PendingProvision = {
   subjectUuid: identity.sub, canonicalHandle: identity.publicHandle, accessToken, centralGuard,
  };
  const result = await this.redis.set(this.provisionKey(browserProof), JSON.stringify(payload), 'EX', flowTTL, 'NX');
  if (result !== 'OK') throw new Error('Provisioning session unavailable');
  setProofCookie(reply, provisionCookieName, browserProof, flowTTL);
 }

 private async issueLoginTicket(reply: FastifyReply, account: MiLocalUser, identity: ManafieldVerifiedIdentity, accessToken: string, centralGuard: string): Promise<string> {
  const ticket = secret();
  const browserProof = createBrowserProof();
  if (identity.publicHandle == null) throw new Error('Public Profile handle required');
  const value: TicketRecord = { userId: account.id, subjectUuid: identity.sub, canonicalHandle: identity.publicHandle, accessToken, centralGuard, proofHash: digest(browserProof) };
  const ok = await this.redis.set('noctemblith:manafield:login-ticket:' + ticket,
   JSON.stringify(value), 'EX', loginTicketTTL, 'NX');
  if (ok !== 'OK') throw new Error('One-time login ticket unavailable');
  setProofCookie(reply, ticketCookieName, browserProof, loginTicketTTL);
  return ticket;
 }

 private async linkUser(userId: string, verified: ManafieldVerifiedIdentity): Promise<'linked' | 'conflict'> {
  const current = await this.liveLocalUser(userId);
  // Never claim an existing native actor merely because the UUID is verified.
  if (!current || verified.publicHandle == null || !matchesManafieldHandle(verified.publicHandle, current.username)) return 'conflict';
  const subjectUuid = verified.sub;

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

 private async linkedUser(verified: ManafieldVerifiedIdentity) {
  const links = await this.db.query(
   'SELECT "userId" FROM "manafield_identity_link" WHERE "providerId" = $1 AND "subjectUuid" = $2::uuid',
   [providerId, verified.sub],
  ) as Array<{ userId: string }>;
  if (links.length === 0) return null;
  if (links.length !== 1) throw new Error('Ambiguous Manafield identity mapping');
  const user = await this.liveLocalUser(links[0].userId);
  if (!user || verified.publicHandle == null || !matchesManafieldHandle(verified.publicHandle, user.username)) {
   throw new Error('Linked Noctemblith handle conflicts with Manafield identity');
  }
  return user;
 }

 public registerRoutes(fastify: FastifyInstance): void {
  fastify.get('/auth/manafield/status', async (_request, reply) => {
   noStore(reply);
   return { enabled: this.settings != null };
  });

  // Logout only this browser's Noctemblith session; never end Account Core's session.
  fastify.post('/auth/manafield/session/logout', async (request, reply) => {
   noStore(reply);
   if (!this.settings || !this.sessionService.enabled) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   const authorization = request.headers.authorization;
   const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7) : '';
   if (!isManafieldBrowserSessionToken(token)) return reply.code(401).send({ error: 'session_required' });
   // Do not trust a caller-supplied user ID: session ownership comes only from Redis.
   // A second logout of the same session is intentionally unauthorized.
   const revoked = await this.sessionService.revoke(token);
   if (!revoked) return reply.code(401).send({ error: 'session_expired' });
   return reply.code(204).send();
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
   if (!await this.startRateAllowed(request)) return reply.code(429).send({ error: 'too_many_attempts' });
   const url = await this.startFlow(reply, 'link', user.id);
   return { authorizationUrl: url };
  });

  fastify.get('/auth/manafield/login/start', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!await this.startRateAllowed(request)) return reply.code(429).send({ error: 'too_many_attempts' });
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
     const { identity: verified, accessToken } = await this.userInfo(request.query.code, record.verifier);
     if (verified.publicHandle == null) {
      return reply.code(303).header('Location', safeRedirectTarget(record.mode, 'handle-required')).send();
     }
     if (record.mode === 'link') {
      if (!record.userId) return reply.code(400).send('Local account missing');
      const linked = await this.linkUser(record.userId, verified);
      return reply.code(303).header('Location', safeRedirectTarget('link', linked)).send();
     }
     const centralGuard = await this.issueCentralSessionGuard(accessToken);
     const account = await this.linkedUser(verified);
     if (!account) {
      // Same handle may already belong to an existing, unlinked local actor.
      // Do not claim it without independent proof of its native ownership.
      const occupied = await this.usersRepository.findOneBy({
       usernameLower: verified.publicHandle, host: IsNull(),
      });
      if (occupied) return reply.code(303).header('Location', safeRedirectTarget('login', 'unlinked')).send();
      await this.stageProvision(reply, verified, accessToken, centralGuard);
      return reply.code(303).header('Location', safeRedirectTarget('login', 'signup')).send();
     }
     const ticket = await this.issueLoginTicket(reply, account as MiLocalUser, verified, accessToken, centralGuard);
     return reply.code(303).header('Location', '/auth/manafield/finish?ticket=' + encodeURIComponent(ticket)).send();
    } catch {
     return reply.code(303).header('Location', safeRedirectTarget(record.mode, 'failed')).send();
    }
   },
  );

  // The consent and provisioning capability exists only for opted-in instances.
  fastify.post('/auth/manafield/provision/status', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   const proof = browserCookie(request.headers.cookie, provisionCookieName);
   if (!proof) return reply.code(401).send({ error: 'provision_session_required' });
   const raw = await this.redis.get(this.provisionKey(proof));
   if (!raw) return reply.code(401).send({ error: 'provision_session_expired' });
   let pending: PendingProvision;
   try { pending = JSON.parse(raw) as PendingProvision; } catch {
    return reply.code(403).send({ error: 'provision_session_invalid' });
   }
   if (!pending || !matchesManafieldHandle(pending.canonicalHandle, pending.canonicalHandle)) {
    return reply.code(403).send({ error: 'provision_session_invalid' });
   }
   return { handle: pending.canonicalHandle, actor: '@' + pending.canonicalHandle + '@' + new URL(this.config.url).hostname };
  });

  fastify.post<{ Body: { consent?: unknown } }>('/auth/manafield/provision/confirm', async (request, reply) => {
   noStore(reply);
   if (!this.settings) return reply.code(503).send({ error: 'not_configured' });
   if (!this.originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
   if (request.body?.consent !== true) return reply.code(400).send({ error: 'explicit_consent_required' });
   const proof = browserCookie(request.headers.cookie, provisionCookieName);
   removeProofCookie(reply, provisionCookieName);
   if (!proof) return reply.code(401).send({ error: 'provision_session_required' });
   // Consume consent context atomically, including on failures; reauthentication
   // is required for every retry and no unverified browser-supplied identity is trusted.
   const raw = await this.redis.getdel(this.provisionKey(proof));
   if (!raw) return reply.code(401).send({ error: 'provision_session_expired' });
   let pending: PendingProvision;
   try { pending = JSON.parse(raw) as PendingProvision; } catch {
    return reply.code(403).send({ error: 'provision_session_invalid' });
   }
   if (!pending || !validOpaque.test(pending.accessToken) || !validOpaque.test(pending.centralGuard) ||
       !matchesManafieldHandle(pending.canonicalHandle, pending.canonicalHandle)) {
    return reply.code(403).send({ error: 'provision_session_invalid' });
   }
   try {
    // Account Core is the authority at the moment of account creation.
    const verified = await this.revalidateIdentity(pending.accessToken);
    const publicHandle = verified.publicHandle;
    if (publicHandle === null || verified.sub !== pending.subjectUuid ||
        !matchesManafieldHandle(publicHandle, pending.canonicalHandle)) {
     return reply.code(403).send({ error: 'central_identity_changed' });
    }
    const root = await this.db.query('SELECT "rootUserId" FROM "meta" LIMIT 1') as Array<{ rootUserId: string | null }>;
    if (root.length !== 1 || !root[0].rootUserId) {
     return reply.code(503).send({ error: 'instance_initial_setup_required' });
    }
    if (await this.linkedUser(verified)) return reply.code(409).send({ error: 'already_linked' });
    if (await this.usersRepository.findOneBy({ usernameLower: publicHandle, host: IsNull() })) {
     return reply.code(409).send({ error: 'handle_occupied' });
    }
    // Normal SignupService owns keys, password hashing and all Misskey actor
    // invariants. The UUID link is added INSIDE the same DB transaction to
    // avoid orphaned public actors if a concurrent signup claims the handle.
    const { account } = await this.signupService.signup({
     username: publicHandle,
     password: secret(), // Unknown, high-entropy native password; login via Manafield.
     onCreatedInTransaction: async (manager, user) => {
      const linked = await manager.query(
       'INSERT INTO "manafield_identity_link" ("providerId", "subjectUuid", "userId") ' +
       'VALUES ($1, $2::uuid, $3) ON CONFLICT DO NOTHING RETURNING "userId"',
       [providerId, verified.sub, user.id],
      ) as Array<{ userId: string }>;
      if (linked.length !== 1) throw new Error('Identity link collision; roll back actor');
     },
    });
    const ticket = await this.issueLoginTicket(reply, account as MiLocalUser, verified, pending.accessToken, pending.centralGuard);
    return { ticket };
   } catch {
    // Fail closed. OAuth needs restarting after a rejected/expired attempt.
    return reply.code(409).send({ error: 'provision_failed_reauthenticate' });
   }
  });

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
   if (!record || typeof record !== 'object') return reply.code(400).send({ error: 'invalid_ticket' });
   if (typeof record.proofHash !== 'string' || !eq(record.proofHash, digest(proof))) {
    return reply.code(403).send({ error: 'browser_mismatch' });
   }
   // Recheck the link and canonical handle at the moment the local session is issued.
   // A changed username or an unlinked/reassigned actor must never use a prior ticket.
   let local: Awaited<ReturnType<ManafieldSsoService['linkedUser']>>;
   try {
    if (typeof record.subjectUuid !== 'string' || typeof record.canonicalHandle !== 'string') {
     return reply.code(403).send({ error: 'identity_conflict' });
    }
    if (typeof record.accessToken !== 'string' || !validOpaque.test(record.accessToken) ||
        !validOpaque.test(record.centralGuard)) {
     return reply.code(403).send({ error: 'identity_conflict' });
    }
    const verified = await this.revalidateIdentity(record.accessToken);
    if (verified.sub !== record.subjectUuid || verified.publicHandle !== record.canonicalHandle) {
     return reply.code(403).send({ error: 'identity_conflict' });
    }
    local = await this.linkedUser(verified);
   } catch {
    return reply.code(403).send({ error: 'identity_conflict' });
   }
   if (!local || local.id !== record.userId) {
    return reply.code(403).send({ error: 'identity_conflict' });
   }
   // The central account currently has no independent MFA step-up policy.
   // Never silently bypass local MFA for Noctemblith admin/moderator accounts.
   if (await this.roleService.isModerator(local)) {
    return reply.code(403).send({ error: 'privileged_account_requires_local_login' });
   }
   // Use the existing sign-in path for login history and notifications.
   // The native token is returned in the same-origin POST response, never URL.
   return this.signinService.signin(request, reply, local as MiLocalUser, record.centralGuard);
  });
 }
}
