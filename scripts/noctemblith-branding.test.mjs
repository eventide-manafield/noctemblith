/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run with Node, no package installation or network calls required.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url));
const txt = (path) => read(path).toString('utf8');

test('Noctemblith canonical SVG is standalone, vector, and non-executable', () => {

	const s = txt('packages/backend/assets/noctemblith.svg');
	assert.match(s, /<svg\b/);
	assert.match(s, /<\/svg>/);
	assert.match(s, /<linearGradient\b/);
	assert.match(s, /<clipPath\b/);
	assert.doesNotMatch(s, /<script\b|<foreignObject\b|<image\b|<iframe\b/i);
	assert.doesNotMatch(s, /\b(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i);
});

test('Noctemblith compact emoji PNG is a valid-sized, fixed visual asset', () => {
	const png = read('assets/noctemblith-emoji.png');
	assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
	assert.equal(png.readUInt32BE(16), 128);
	assert.equal(png.readUInt32BE(20), 128);
	assert.equal(
		createHash('sha256').update(png).digest('hex'),
		'9b68462aec22424b77b17615974e1ed64039dfba317b7b77e0a4979a25a4b0fa',
	);
	assert.deepEqual(png, read('packages/backend/assets/noctemblith-emoji.png'));
});

test('server and frontend fallbacks respect instance overrides', () => {
	const server = txt('packages/backend/src/server/web/ClientServerService.ts');
	const html = txt('packages/backend/src/server/web/HtmlTemplateService.ts');
	assert.match(server, /meta\.app192IconUrl \|\| '\/static-assets\/noctemblith-emoji\.png'/);
	assert.match(server, /meta\.app512IconUrl \|\| '\/static-assets\/noctemblith\.svg'/);
	assert.match(server, /meta\.app192IconUrl \? '192x192' : '128x128'/);
	assert.match(server, /meta\.app512IconUrl \? '512x512' : 'any'/);
	assert.match(server, /sendFile\('\/noctemblith-emoji\.png', this\.staticAssets\)/);
	assert.match(html, /this\.meta\.iconUrl \|\| '\/static-assets\/noctemblith\.svg'/);
	assert.match(html, /this\.meta\.app512IconUrl \|\| '\/static-assets\/noctemblith-emoji\.png'/);

	for (const path of [
		'packages/frontend/src/ui/_common_/navbar.vue',
		'packages/frontend/src/ui/_common_/navbar-h.vue',
		'packages/frontend/src/pages/about.overview.vue',
	]) {
		assert.match(txt(path), /instance\.iconUrl\s*(?:\|\||\?\?)\s*'\/static-assets\/noctemblith\.svg'/);
	}
});

test('Noctemblith custom emoji is seeded at startup through the normal emoji database', () => {
	const docs = txt('docs/branding.md');
	const service = txt('packages/backend/src/core/CustomEmojiService.ts');
	const seeder = txt('packages/backend/src/core/noctemblith-default-emoji.ts');
	assert.match(docs, /:noctemblith:/);
	assert.match(docs, /automatically receives/);
	assert.match(service, /onApplicationBootstrap/);
	assert.match(service, /seedNoctemblithEmoji/);
	assert.match(seeder, /pg_advisory_xact_lock/);
	assert.match(seeder, /noctemblith_bootstrap_state/);
	assert.match(seeder, /if \(installed.length !== 0\) return null/);
	assert.match(seeder, /host: null/);
	assert.match(docs, /A deleted emoji stays deleted/);
	const migration = txt('packages/backend/migration/1792000000002-NoctemblithDefaultEmojiBootstrapState.js');
	assert.match(migration, /CREATE TABLE "noctemblith_bootstrap_state"/);
});
