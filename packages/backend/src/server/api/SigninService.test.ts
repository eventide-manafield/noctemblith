/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from 'vitest';
import { SigninService } from './SigninService.js';

function fixture(integrated: boolean) {
 const session = { enabled: integrated, issue: vi.fn(async () => 'mfs1_' + 'x'.repeat(43)) };
 const signins = { insertOne: vi.fn(async () => ({ id: 'record' })) };
 const profiles = { findOneByOrFail: vi.fn(async () => ({ email: null })) };
 const signer = new SigninService(
  signins as any, profiles as any,
  { pack: vi.fn(async () => ({})) } as any,
  { sendEmail: vi.fn() } as any,
  { createNotification: vi.fn() } as any,
  { gen: vi.fn(() => 'record') } as any,
  { publishMainStream: vi.fn() } as any,
  session as any,
 );
 const reply = { code: vi.fn() };
 const request = { ip: '127.0.0.1', headers: {} };
 const user = { id: 'u1', token: 'n'.repeat(16) };
 return { signer, session, reply, request, user };
}

describe('SigninService returns independent Manafield browser credentials', () => {
 it('never hands the persistent native user token to an integrated browser', async () => {
  const { signer, session, reply, request, user } = fixture(true);
  const response = await signer.signin(request as any, reply as any, user as any);
  expect(response).toMatchObject({ finished: true, id: user.id, i: 'mfs1_' + 'x'.repeat(43) });
  expect(response.i).not.toBe(user.token);
  expect(session.issue).toHaveBeenCalledWith(user.id);
  await new Promise(resolve => setImmediate(resolve));
 });
 it('retains the original native login for standalone installations', async () => {
  const { signer, session, reply, request, user } = fixture(false);
  const response = await signer.signin(request as any, reply as any, user as any);
  expect(response.i).toBe(user.token);
  expect(session.issue).not.toHaveBeenCalled();
  await new Promise(resolve => setImmediate(resolve));
 });
});
