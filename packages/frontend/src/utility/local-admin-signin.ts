/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type * as Misskey from 'misskey-js';

export async function localAdminSignin<T>(
 endpoint: 'signin-flow' | 'signin-with-passkey',
 data: Misskey.entities.SigninFlowRequest | Misskey.entities.SigninWithPasskeyRequest,
): Promise<T> {
 const response = await window.fetch('/api/local-admin/' + endpoint, {
  method: 'POST', credentials: 'same-origin', cache: 'no-store',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
 });
 const result = await response.json();
 if (!response.ok) throw result.error;
 return result as T;
}
