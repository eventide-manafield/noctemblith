/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * External widgets are opt-in. Never save credentials or bearer tokens in
 * widget URLs, which may be synchronized as part of the user's preferences.
 * No internal application secrets are passed to an embedded document.
 */
export function validateExternalModuleUrl(input: string): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim();
	if (value.length === 0 || value.length > 2048) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || !url.hostname) return null;
		if (url.username || url.password || url.search || url.hash) return null;
		return url.href;
	} catch {
		return null;
	}
}
