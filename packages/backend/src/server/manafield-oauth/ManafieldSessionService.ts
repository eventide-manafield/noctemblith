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
import type { MiLocalUser } from '@/models/User.js';

const tokenPattern = /^mfs1_[A-Za-z0-9_-]{43}$/;
const lifetimeSeconds = 60 * 60 * 24 * 30;
const keyPrefix = 'noctemblith:manafield:browser-session:';

export function isManafieldBrowserSessionToken(value: unknown): boolean {
 return typeof value === 'string' && tokenPattern.test(value);
}

function sessionKey(token: string): string {
 return keyPrefix + createHash('sha256').update(token).digest('hex');
}

interface BrowserSession {
 userId: string;
 createdAt: string;
}

@Injectable()
export class ManafieldSessionService {
 readonly enabled: boolean;

 constructor(
  @Inject(DI.redis) private redis: Redis.Redis,
  @Inject(DI.usersRepository) private usersRepository: UsersRepository,
 ) {
  this.enabled = process.env.NOCTEMBLITH_MANAFIELD_SSO_ENABLED === 'true';
 }

 async issue(userId: string): Promise<string> {
  if (!this.enabled || !userId) throw new Error('Manafield sessions not enabled');
  const record: BrowserSession = { userId, createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
   const token = 'mfs1_' + randomBytes(32).toString('base64url');
   const result = await this.redis.set(sessionKey(token), JSON.stringify(record), 'EX', lifetimeSeconds, 'NX');
   if (result === 'OK') return token;
  }
  throw new Error('Could not allocate independent browser session');
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
  const user = await this.usersRepository.findOneBy({ id: record.userId }) as MiLocalUser | null;
  if (!user || user.host !== null || user.isDeleted || user.isSuspended) return null;
  return user;
 }

 async revoke(token: string): Promise<boolean> {
  if (!this.enabled || !isManafieldBrowserSessionToken(token)) return false;
  return (await this.redis.del(sessionKey(token))) === 1;
 }

 async isActive(token: string): Promise<boolean> {
  if (!this.enabled || !isManafieldBrowserSessionToken(token)) return false;
  // Always consult the central Redis store rather than a positive cache.
  // WebSockets must stop after a logout performed in another process.
  return await this.redis.exists(sessionKey(token)) === 1;
 }
}
