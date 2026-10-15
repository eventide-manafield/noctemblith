/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Dependency-free smoke tests for the pure OAuth foundation.
 * Run: node --experimental-strip-types --test test/unit/noctemblith-manafield-oauth-node.test.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

test('Manafield SSO UI messages use polite Korean and disclose unavailable JIT signup', () => {
	const files = [
		'packages/frontend/src/pages/manafield-login-finish.vue',
		'packages/frontend/src/pages/settings/connect.vue',
		'packages/frontend/src/components/MkSignin.input.vue',
	];
	const sources = files.map(path =>
		readFileSync(new URL('../../' + path, import.meta.url), 'utf8'));
	// Regression guard: this feature was added after the update-center copy audit.
	// Cover both Vue templates and messages dynamically assigned in scripts.
	for (const [index, src] of sources.entries()) {
		assert.doesNotMatch(src, /(?:없어|있어|됐어|했어|못했어|유지돼|연결해|해 줘|해야 해|중이야)(?=[.!?…'"])/u,
			'Informal end-user Korean copy found in ' + files[index]);
	}
	const [finish, connect, signin] = sources;
	assert.match(finish, /신규 계정 생성 기능은 아직 제공되지 않습니다/);
	assert.match(finish, /기존 Noctemblith 계정이 있다면/);
	assert.match(finish, /관리자 및 모더레이터 계정은 보안 정책에 따라/);
	assert.match(connect, /Noctemblith 계정과 마나필드 계정의 소유권을 모두 확인해야 합니다/);
	assert.match(connect, /마나필드 계정 연결이 완료되었습니다/);
	assert.match(signin, /v-if="manafieldAvailable"/);
	assert.match(signin, /마나필드 계정으로 계속하기/);
});
