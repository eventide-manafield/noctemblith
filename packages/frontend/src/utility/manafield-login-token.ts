/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Validate login result shape before handing it to Misskey's client store.
 * The integrated server now issues per-browser `mfs1_` tokens; native tokens
 * from older compatible deployments are 16 characters long.
 * Credential existence/authorization is always checked by the backend.
 */
export function isValidManafieldLoginToken(value: unknown): value is string {
 return typeof value === 'string' && (
  value.length === 16 || /^mfs1_[A-Za-z0-9_-]{43}$/.test(value)
 );
}
