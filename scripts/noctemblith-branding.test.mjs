/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run with Node, no package installation or network calls required.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url));
const txt = (path) => read(path).toString('utf8');

test('Noctemblith SVG asset is self-contained and non-executable', () => {

	const s = txt('packages/backend/assets/noctemblith.svg');
	assert.match(s, /<svg\b/);
	assert.match(s, /<\/svg>/);
	assert.doesNotMatch(s, /<script\b|<foreignObject\b|<image\b|<iframe\b/i);
	assert.doesNotMatch(s, /\b(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i);
});

test('Noctemblith PNG copies have a valid header and stay synchronized', () => {
	const png = read('assets/noctemblith-emoji.png');
	assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
	assert.ok(png.readUInt32BE(16) > 0);
	assert.ok(png.readUInt32BE(20) > 0);
	assert.deepEqual(png, read('packages/backend/assets/noctemblith-emoji.png'));
});

test('server and frontend fallbacks respect instance overrides', () => {
	const server = txt('packages/backend/src/server/web/ClientServerService.ts');
	const html = txt('packages/backend/src/server/web/HtmlTemplateService.ts');
	const png = read('packages/backend/assets/noctemblith-emoji.png');
	const pngSize = png.readUInt32BE(16) + 'x' + png.readUInt32BE(20);
	assert.match(server, /meta\.app192IconUrl \|\| '\/static-assets\/noctemblith-emoji\.png'/);
	assert.match(server, /meta\.app512IconUrl \|\| '\/static-assets\/noctemblith\.svg'/);
	assert.ok(server.includes("meta.app192IconUrl ? '192x192' : '" + pngSize + "'"));
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
	const service = txt('packages/backend/src/core/CustomEmojiService.ts');
	const seeder = txt('packages/backend/src/core/noctemblith-default-emoji.ts');
	assert.match(service, /onApplicationBootstrap/);
	assert.match(service, /seedNoctemblithEmoji/);
	assert.match(seeder, /pg_advisory_xact_lock/);
	assert.match(seeder, /noctemblith_bootstrap_state/);
	assert.match(seeder, /if \(installed.length !== 0\) return null/);
	assert.match(seeder, /host: null/);
	const migration = txt('packages/backend/migration/initial-baseline.sql');
	assert.match(migration, /CREATE TABLE __MANAFIELD_SCHEMA__\.noctemblith_bootstrap_state\b/);
});
