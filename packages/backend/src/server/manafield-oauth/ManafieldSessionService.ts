/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Separate, revocable browser sessions for opt-in Manafield installations.
 * Noctemblith's historical per-user native token and third-party app tokens
 * remain untouched. Standalone installations never use this session store.
 */

import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import { ManafieldLocalAdminPolicyService } from './ManafieldLocalAdminPolicyService.js';
import type { MiLocalUser } from '@/models/User.js';

const tokenPattern = /^(?:mfs1|nla1)_[A-Za-z0-9_-]{43}$/;
const lifetimeSeconds = 60 * 60 * 24 * 30;
const keyPrefix = 'noctemblith:manafield:browser-session:';
const guardIndexPrefix = 'noctemblith:manafield:guard-sessions:';
const revokedGuardPrefix = 'noctemblith:manafield:revoked-guard:';
const guardHashPattern = /^[a-f0-9]{64}$/;

function guardHash(guard: string): string {
 return createHash('sha256').update(guard).digest('hex');
}

export function isManafieldBrowserSessionToken(value: unknown): boolean {
 return typeof value === 'string' && tokenPattern.test(value);
}

function sessionKey(token: string): string {
 return keyPrefix + createHash('sha256').update(token).digest('hex');
}

interface BrowserSession {
 userId: string;
 createdAt: string;
 centralGuard?: string;
 kind?: 'local-admin';
 credentialVersion?: string;
}

@Injectable()
export class ManafieldSessionService {
 readonly enabled: boolean;

 constructor(
  @Inject(DI.redis) private redis: Redis.Redis,
  @Inject(DI.usersRepository) private usersRepository: UsersRepository,
  private localAdminPolicy: ManafieldLocalAdminPolicyService,
 ) {
  this.enabled = process.env.NOCTEMBLITH_MANAFIELD_SSO_ENABLED === 'true';
 }

 private async centralGuardActive(guard: string): Promise<boolean> {
  if (!this.enabled || !/^[A-Za-z0-9_-]{43}$/.test(guard)) return false;
  const origin = process.env.NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN;
  if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Core guard endpoint is not configured');
  const response = await fetch(new URL('/account/oauth/session-guard/status', origin), {
   method: 'POST',
   headers: { 'Authorization': 'Bearer ' + guard, 'Accept': 'application/json' },
   redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
   throw new Error('Core guard validation unavailable');
  }
  const result = await response.json() as { active?: unknown };
  if (typeof result.active !== 'boolean') throw new Error('Malformed Core guard status');
  return result.active;
 }

 async issue(userId: string, centralGuard?: string): Promise<string> {
  if (!this.enabled || !userId) throw new Error('Manafield sessions not enabled');
  // Every integrated browser token must descend from a verified central session.
  // Ordinary native sign-in is disabled; local recovery admins use a distinct token kind.
  if (!centralGuard || !await this.centralGuardActive(centralGuard)) {
   throw new Error('Active Manafield parent browser session required');
  }
  const hash = guardHash(centralGuard);
  const index = guardIndexPrefix + hash;
  const revoked = revokedGuardPrefix + hash;
  if (await this.redis.exists(revoked)) throw new Error('Manafield parent session revoked');
  const record: BrowserSession = { userId, createdAt: new Date().toISOString(), centralGuard };
  for (let attempt = 0; attempt < 3; attempt++) {
   const token = 'mfs1_' + randomBytes(32).toString('base64url');
   const result = await this.redis.set(sessionKey(token), JSON.stringify(record), 'EX', lifetimeSeconds, 'NX');
   if (result === 'OK') {
    // The reverse index contains hashed *local session keys*, never bearer
    // tokens. It permits authenticated backchannel cleanup by parent guard hash.
    try {
     const batch = await this.redis.multi().sadd(index, sessionKey(token))
      .expire(index, lifetimeSeconds).exec();
     if (!batch || batch.some(([error]) => error !== null)) throw new Error('Guard index unavailable');
     // Revocation sets its tombstone before scanning. An issuer that races
     // behind that scan must remove its newly inserted token itself.
     if (await this.redis.exists(revoked) || !await this.centralGuardActive(centralGuard)) {
      throw new Error('Manafield parent session revoked');
     }
    } catch (error) {
     await this.redis.del(sessionKey(token));
     await this.redis.srem(index, sessionKey(token));
     throw error;
    }
    return token;
   }
  }
  throw new Error('Could not allocate independent browser session');
 }

 /** Called only after the existing local password/passkey/MFA flow succeeds. */
 async issueLocalAdmin(user: MiLocalUser): Promise<string> {
  if (!this.enabled || !user.token || !await this.localAdminPolicy.allows(user)) {
   throw new Error('Local administrator login not permitted');
  }
  const record: BrowserSession = { userId: user.id, createdAt: new Date().toISOString(),
   kind: 'local-admin', credentialVersion: guardHash(user.token!) };
  for (let attempt = 0; attempt < 3; attempt++) {
   const token = 'nla1_' + randomBytes(32).toString('base64url');
   const stored = await this.redis.set(sessionKey(token), JSON.stringify(record), 'EX', lifetimeSeconds, 'NX');
   if (stored !== 'OK') continue;
   try {
    if (!await this.localAdminPolicy.allows(user)) throw new Error('Local administrator login not permitted');
   } catch (error) {
    await this.redis.del(sessionKey(token));
    throw error;
   }
   return token;
  }
  throw new Error('Could not allocate independent administrator session');
 }

 async resolve(token: string): Promise<MiLocalUser | null> {
  if (!this.enabled || !isManafieldBrowserSessionToken(token)) return null;
  const raw = await this.redis.get(sessionKey(token));
  if (raw === null) return null;
  let record: BrowserSession;
  try {
   record = JSON.parse(raw) as BrowserSession;
  } catch {
   return null;
  }
  if (!record || typeof record.userId !== 'string' || !record.userId) return null;
  if (token.startsWith('nla1_')) {
   if (record.kind !== 'local-admin' || record.centralGuard !== undefined) return null;
   const admin = await this.usersRepository.findOneBy({ id: record.userId }) as MiLocalUser | null;
   // Native-token regeneration must also invalidate recovery browser sessions.
   // Retain only a one-way credential-version snapshot, never the bearer token.
   if (!admin?.token || record.credentialVersion !== guardHash(admin.token)) return null;
   return await this.localAdminPolicy.allows(admin) ? admin : null;
  }
  if (record.kind !== undefined) return null;
  // Legacy pre-guard Redis sessions must reauthenticate; no grandfathering.
  if (!record.centralGuard || !await this.centralGuardActive(record.centralGuard)) return null;
  const user = await this.usersRepository.findOneBy({ id: record.userId }) as MiLocalUser | null;
  if (!user || user.host !== null || user.isDeleted || user.isSuspended) return null;
  if (!await this.localAdminPolicy.allowsCentral(user)) return null;
  return user;
 }

 async revoke(token: string): Promise<boolean> {
  if (!this.enabled || !isManafieldBrowserSessionToken(token)) return false;
  return (await this.redis.del(sessionKey(token))) === 1;
 }

 /**
  * Idempotent server-to-server cleanup for a revoked parent session.
  * Caller MUST authenticate and scope the revocation to its registered client.
  * No HTTP backchannel is registered yet; this primitive is not a public API.
  */
 async revokeByGuardHash(hash: string): Promise<number> {
  if (!this.enabled || !guardHashPattern.test(hash)) throw new Error('Invalid guard hash');
  const index = guardIndexPrefix + hash;
  // Retain a tombstone for the longest possible child lifetime. It closes
  // the issue/scan race even while Core revocation is being propagated.
  await this.redis.set(revokedGuardPrefix + hash, '1', 'EX', lifetimeSeconds);
  let cursor = '0';
  let removed = 0;
  do {
   const page = await this.redis.sscan(index, cursor, 'COUNT', 100);
   cursor = page[0];
   const sessions = page[1];
   if (sessions.some(key => !key.startsWith(keyPrefix) || !/^[a-f0-9]{64}$/.test(key.slice(keyPrefix.length)))) {
    throw new Error('Corrupt guard session index');
   }
   for (let start = 0; start < sessions.length; start += 100) {
    const chunk = sessions.slice(start, start + 100);
    const records = await this.redis.mget(...chunk);
    for (const raw of records) {
     if (raw === null) continue; // An expired child is safe to remove.
     let record: BrowserSession;
     try { record = JSON.parse(raw) as BrowserSession; } catch {
      throw new Error('Corrupt guard session index');
     }
     if (!record || typeof record.centralGuard !== 'string' || guardHash(record.centralGuard) !== hash) {
      throw new Error('Corrupt guard session index');
     }
    }
    // Delete before removing index members: a failed delete remains retryable.
    // DEL's result also handles duplicate SCAN entries and expired children.
    removed += await this.redis.del(...chunk);
    await this.redis.srem(index, ...chunk);
   }
  } while (cursor !== '0');
  return removed;
 }

 async isActive(token: string): Promise<boolean> {
  // Reuse current account/role/parent checks for idle sockets as well.
  return await this.resolve(token) !== null;
 }
}
