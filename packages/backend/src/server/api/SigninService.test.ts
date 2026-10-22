/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from 'vitest';
import { SigninService } from './SigninService.js';

function fixture(integrated: boolean) {
 const session = { enabled: integrated, issue: vi.fn(async () => 'mfs1_' + 'x'.repeat(43)), issueLocalAdmin: vi.fn(async () => 'nla1_' + 'a'.repeat(43)) };
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
  const response = await signer.signin(request as any, reply as any, user as any, 'g'.repeat(43));
  expect(response).toMatchObject({ finished: true, id: user.id, i: 'mfs1_' + 'x'.repeat(43) });
  expect(response.i).not.toBe(user.token);
  expect(session.issue).toHaveBeenCalledWith(user.id, 'g'.repeat(43));
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

describe('Local login entry policy', () => {
 it('allows only the separate admin native route in integrated mode', () => {
  const { signer } = fixture(true);
  expect(signer.nativeLoginAllowed(false)).toBe(false);
  expect(signer.nativeLoginAllowed(true)).toBe(true);
 });
 it('preserves standalone routes and disables the integration admin route', () => {
  const { signer } = fixture(false);
  expect(signer.nativeLoginAllowed(false)).toBe(true);
  expect(signer.nativeLoginAllowed(true)).toBe(false);
 });
 it('returns an independent admin token only for the internal admin route context', async () => {
  const { signer, session, reply, request, user } = fixture(true);
  const response = await signer.signin(request as any, reply as any, user as any, undefined, true);
  expect(response.i).toMatch(/^nla1_/);
  expect(session.issueLocalAdmin).toHaveBeenCalledWith(user);
  expect(session.issue).not.toHaveBeenCalled();
  await new Promise(resolve => setImmediate(resolve));
 });
 it('never reports login success when recovery policy rejects the account', async () => {
  const { signer, session, reply, request, user } = fixture(true);
  session.issueLocalAdmin.mockRejectedValueOnce(new Error('not permitted'));
  await expect(signer.signin(request as any, reply as any, user as any, undefined, true)).rejects.toMatchObject({ statusCode: 403 });
  expect(reply.code).not.toHaveBeenCalledWith(200);
 });
});
