/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * A small, server-side OAuth2 + PKCE client protocol helper. This file does
 * not create Noctemblith users, issue sessions or register HTTP routes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface ManafieldOAuthSettings {
	readonly accountOrigin: string;
	readonly clientId: string;
	readonly callbackUrl: string;
}

export interface ManafieldIdentity {
	readonly sub: string;
	readonly preferredUsername: string;
}

const clientIdPattern = /^[a-zA-Z0-9._-]{1,100}$/;
const oauthCodePattern = /^[a-zA-Z0-9_-]{22,128}$/;
const oauthStatePattern = /^[a-zA-Z0-9_-]{43}$/;
const pkceVerifierPattern = /^[a-zA-Z0-9_-]{43,128}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// Account Core owns this immutable canonical lowercase handle policy.
const centralHandlePattern = /^[a-z0-9_]{1,20}$/;
const localHandlePattern = /^[a-z0-9_]{1,20}$/i;

/** UUID ownership is necessary but NOT sufficient: block AB-BA account swapping. */
export function matchesManafieldHandle(centralHandle: string, localUsername: string): boolean {
	return centralHandlePattern.test(centralHandle) &&
		localHandlePattern.test(localUsername) &&
		localUsername.toLowerCase() === centralHandle;
}

function strictHttpsUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
		throw new Error('OAuth configuration requires an uncredentialed HTTPS URL');
	}
	return url;
}

/**
 * An incomplete configuration is an error, not a request to activate a broken
 * login button. Omitting all settings keeps standalone Noctemblith independent.
 */
export function readManafieldOAuthSettings(
	env: Record<string, string | undefined>,
	instancePublicUrl: string,
): ManafieldOAuthSettings | null {
	const accountOrigin = env.NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN;
	const clientId = env.NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID;
	const callbackUrl = env.NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL;
	if (!accountOrigin && !clientId && !callbackUrl) return null;
	if (!accountOrigin || !clientId || !callbackUrl || !clientIdPattern.test(clientId)) {
		throw new Error('Incomplete Manafield OAuth configuration');
	}

	const account = strictHttpsUrl(accountOrigin);
	if (account.pathname !== '/' || account.href !== account.origin + '/') {
		throw new Error('Manafield Account endpoint must be an HTTPS origin');
	}
	const own = strictHttpsUrl(instancePublicUrl);
	const callback = strictHttpsUrl(callbackUrl);
	if (callback.origin !== own.origin || callback.pathname !== '/auth/manafield/callback') {
		throw new Error('Manafield OAuth callback must be owned by this Noctemblith instance');
	}

	return { accountOrigin: account.origin, clientId, callbackUrl: callback.href };
}

function randomBase64url32(): string {
	return randomBytes(32).toString('base64url');
}

export function createManafieldAuthorization(settings: ManafieldOAuthSettings): {
	url: string;
	state: string;
	verifier: string;
} {
	const state = randomBase64url32();
	const verifier = randomBase64url32();
	const codeChallenge = createHash('sha256').update(verifier).digest('base64url');

	const url = new URL('/account/oauth/authorize', settings.accountOrigin);
	url.searchParams.set('client_id', settings.clientId);
	url.searchParams.set('redirect_uri', settings.callbackUrl);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('code_challenge', codeChallenge);

	return { url: url.toString(), state, verifier };
}

/** Constant-time callback state check. It must be one-time and expire server-side. */
export function matchesManafieldOAuthState(expected: string, actual: string): boolean {
	if (!oauthStatePattern.test(expected) || !oauthStatePattern.test(actual)) return false;
	return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function createManafieldTokenRequest(
	settings: ManafieldOAuthSettings,
	code: string,
	verifier: string,
): { url: string; body: URLSearchParams } {
	if (!oauthCodePattern.test(code) || !pkceVerifierPattern.test(verifier)) {
		throw new Error('Invalid OAuth authorization code or PKCE verifier');
	}
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: settings.clientId,
		redirect_uri: settings.callbackUrl,
		code,
		code_verifier: verifier,
	});
	return { url: new URL('/account/oauth/token', settings.accountOrigin).toString(), body };
}

/** Returns only the trusted identity claims; never derive an email or actor from them. */
export function parseManafieldIdentity(value: unknown): ManafieldIdentity {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid Manafield identity response');
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.sub !== 'string' || !uuidPattern.test(raw.sub) ||
		typeof raw.preferred_username !== 'string' || !centralHandlePattern.test(raw.preferred_username)) {
		throw new Error('Invalid Manafield identity claims');
	}
	return { sub: raw.sub.toLowerCase(), preferredUsername: raw.preferred_username };
}
