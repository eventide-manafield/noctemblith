/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Pure browser-correlation helpers for the Manafield OAuth consumer.
 */
import { randomBytes } from 'node:crypto';

export function createBrowserProof(): string {
 return randomBytes(32).toString('base64url');
}

/** Require an exact HTTPS origin, or an explicitly same-origin Fetch Metadata assertion. */
export function isSameOriginMutation(
 origin: string | string[] | undefined,
 fetchSite: string | string[] | undefined,
 instanceUrl: string,
): boolean {
 let expected: URL;
 try {
  expected = new URL(instanceUrl);
 } catch {
  return false;
 }
 if (expected.protocol !== 'https:' || Array.isArray(origin) || Array.isArray(fetchSite) ||
     fetchSite === 'cross-site' || fetchSite === 'same-site') {
  return false;
 }
 if (origin === expected.origin) return true;
 return (origin == null || origin === 'null') && fetchSite === 'same-origin';
}

export function safeRedirectTarget(mode: 'link' | 'login', status: string): string {
 const linkStatus = ['linked', 'conflict', 'denied', 'failed'];
 const loginStatus = ['unlinked', 'signup', 'denied', 'failed'];
 if (mode === 'link') {
  return '/settings/connect?manafield=' + (linkStatus.includes(status) ? status : 'failed');
 }
 return '/auth/manafield/finish?status=' + (loginStatus.includes(status) ? status : 'failed');
}
