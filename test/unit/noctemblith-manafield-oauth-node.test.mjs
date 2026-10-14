/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Dependency-free smoke tests for the pure OAuth foundation.
 * Run: node --experimental-strip-types --test test/unit/noctemblith-manafield-oauth-node.test.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	createManafieldAuthorization,
	createManafieldTokenRequest,
	matchesManafieldOAuthState,
	parseManafieldIdentity,
	readManafieldOAuthSettings,
} from '../../packages/backend/src/server/manafield-oauth/client.ts';

const base = 'https://noctemblith.manafield.studio/';
const env = {
	NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN: 'https://manafield.studio',
	NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID: 'noctemblith-manafield-integration',
	NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL: 'https://noctemblith.manafield.studio/auth/manafield/callback',
};

test('standalone Noctemblith is not automatically enrolled', () => {
	assert.equal(readManafieldOAuthSettings({}, base), null);
});

test('reject partial or redirect-to-external client configuration', () => {
	assert.throws(() => readManafieldOAuthSettings({
		NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID: 'incomplete',
	}, base));
	assert.throws(() => readManafieldOAuthSettings({
		...env,
		NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL: 'https://attacker.invalid/auth/manafield/callback',
	}, base));
});

test('generates random state and correct PKCE S256 challenge', () => {
	const config = readManafieldOAuthSettings(env, base);
	assert.ok(config);
	const first = createManafieldAuthorization(config);
	const second = createManafieldAuthorization(config);
	assert.notEqual(first.state, second.state);
	assert.notEqual(first.verifier, second.verifier);
	const url = new URL(first.url);
	assert.equal(url.pathname, '/account/oauth/authorize');
	assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
	assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(url.searchParams.get('state'), first.state);
	assert.equal(url.searchParams.get('redirect_uri'), config.callbackUrl);
	assert.equal(matchesManafieldOAuthState(first.state, first.state), true);
	assert.equal(matchesManafieldOAuthState(first.state, second.state), false);
	const exchange = createManafieldTokenRequest(config, 'a'.repeat(43), first.verifier);
	assert.equal(exchange.url, 'https://manafield.studio/account/oauth/token');
	assert.equal(exchange.body.get('code_verifier'), first.verifier);
});

test('parses only stable identity UUID + username claims', () => {
	const id = '00000000-0000-4000-8000-000000000001';
	assert.deepEqual(parseManafieldIdentity({ sub: id, preferred_username: 'tester' }), {
		sub: id, preferredUsername: 'tester',
	});
	assert.throws(() => parseManafieldIdentity({ sub: 'tester', preferred_username: 'tester' }));
	assert.throws(() => parseManafieldIdentity({ sub: id, email: 'unknown@example.invalid' }));
});
