/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createManafieldAuthorization,
	createManafieldTokenRequest,
	matchesManafieldOAuthState,
	parseManafieldIdentity,
	readManafieldOAuthSettings,
} from './client.js';

const noctiteUrl = 'https://noctite.manafield.studio/';
const complete = {
	NOCTITE_MANAFIELD_ACCOUNT_ORIGIN: 'https://manafield.studio',
	NOCTITE_MANAFIELD_OAUTH_CLIENT_ID: 'noctite-manafield-integration',
	NOCTITE_MANAFIELD_OAUTH_CALLBACK_URL: 'https://noctite.manafield.studio/auth/manafield/callback',
};

describe('Manafield Account OAuth2 client foundation', () => {
	it('does not enable SSO for an unconfigured standalone Noctite', () => {
		expect(readManafieldOAuthSettings({}, noctiteUrl)).toBeNull();
	});

	it('rejects partial, insecure or external callback configurations', () => {
		expect(() => readManafieldOAuthSettings({
			NOCTITE_MANAFIELD_OAUTH_CLIENT_ID: complete.NOCTITE_MANAFIELD_OAUTH_CLIENT_ID,
		}, noctiteUrl)).toThrow();

		for (const changes of [
			{ NOCTITE_MANAFIELD_ACCOUNT_ORIGIN: 'http://manafield.studio' },
			{ NOCTITE_MANAFIELD_ACCOUNT_ORIGIN: 'https://manafield.studio/account' },
			{ NOCTITE_MANAFIELD_ACCOUNT_ORIGIN: 'https://user:pass@manafield.studio' },
			{ NOCTITE_MANAFIELD_OAUTH_CLIENT_ID: 'a value with spaces' },
			{ NOCTITE_MANAFIELD_OAUTH_CALLBACK_URL: 'https://evil.example/auth/manafield/callback' },
			{ NOCTITE_MANAFIELD_OAUTH_CALLBACK_URL: 'https://noctite.manafield.studio/auth/manafield/callback?next=evil' },
			{ NOCTITE_MANAFIELD_OAUTH_CALLBACK_URL: 'https://noctite.manafield.studio/api/signin' },
		]) {
			expect(() => readManafieldOAuthSettings({ ...complete, ...changes }, noctiteUrl)).toThrow();
		}
	});

	it('creates a S256 PKCE authorization request with fresh state', () => {
		const settings = readManafieldOAuthSettings(complete, noctiteUrl)!;
		const first = createManafieldAuthorization(settings);
		const second = createManafieldAuthorization(settings);
		expect(first.state).toMatch(/^[\w-]{43}$/);
		expect(first.verifier).toMatch(/^[\w-]{43}$/);
		expect(first.state).not.toBe(second.state);
		expect(first.verifier).not.toBe(second.verifier);
		const url = new URL(first.url);
		expect(url.origin).toBe('https://manafield.studio');
		expect(url.pathname).toBe('/account/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe(settings.clientId);
		expect(url.searchParams.get('redirect_uri')).toBe(settings.callbackUrl);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toBe(
			createHash('sha256').update(first.verifier).digest('base64url'),
		);
		expect(url.searchParams.has('code_verifier')).toBe(false);
	});

	it('compares state strictly and rejects malformed callback state', () => {
		const settings = readManafieldOAuthSettings(complete, noctiteUrl)!;
		const a = createManafieldAuthorization(settings).state;
		const b = createManafieldAuthorization(settings).state;
		expect(matchesManafieldOAuthState(a, a)).toBe(true);
		expect(matchesManafieldOAuthState(a, b)).toBe(false);
		expect(matchesManafieldOAuthState(a, a + 'x')).toBe(false);
		expect(matchesManafieldOAuthState(a, '')).toBe(false);
	});

	it('builds an exact authorization-code exchange without passwords', () => {
		const settings = readManafieldOAuthSettings(complete, noctiteUrl)!;
		const { verifier } = createManafieldAuthorization(settings);
		const code = 'a'.repeat(43);
		const request = createManafieldTokenRequest(settings, code, verifier);
		expect(request.url).toBe('https://manafield.studio/account/oauth/token');
		expect(request.body.get('grant_type')).toBe('authorization_code');
		expect(request.body.get('client_id')).toBe(settings.clientId);
		expect(request.body.get('redirect_uri')).toBe(settings.callbackUrl);
		expect(request.body.get('code')).toBe(code);
		expect(request.body.get('code_verifier')).toBe(verifier);
		expect(() => createManafieldTokenRequest(settings, 'bogus', verifier)).toThrow();
	});

	it('only accepts verified identity UUID and username claims', () => {
		const sub = '00000000-0000-4000-8000-000000000001';
		expect(parseManafieldIdentity({ sub, preferred_username: 'eventide' })).toEqual({
			sub, preferredUsername: 'eventide',
		});
		for (const input of [
			{}, { sub: 'eventide', preferred_username: 'eventide' },
			{ sub, preferred_username: '' },
			{ sub, preferred_username: 123 },
			{ sub, email: 'unverified@example.org' },
			null,
		]) {
			expect(() => parseManafieldIdentity(input)).toThrow();
		}
	});
});
