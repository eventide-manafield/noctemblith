/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Dependency-free checks for the fork's default theme and contrast choices.
 * Run: node --test scripts/noctemblith-themes.test.mjs
 */

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const theme = mode => read('packages/frontend-shared/themes/' + mode + '-noctemblith.json5');

function color(s, key) {
	const found = s.match(new RegExp('\\b' + key + ":\\s*'(#(?:[0-9a-fA-F]{6}))'"));
	assert.ok(found, 'Missing or nonliteral color: ' + key);
	return found[1].toUpperCase();
}
function luminance(hex) {
	const rgb = [1, 3, 5].map(pos => parseInt(hex.slice(pos, pos + 2), 16) / 255);
	const channels = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
	const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (l[0] + 0.05) / (l[1] + 0.05);
}

test('Noctemblith Dusk keeps the agreed twilight purple and sunset highlights', () => {
	const dark = theme('d');
	assert.match(dark, /base: 'dark'/);
	assert.match(dark, /name: 'Noctemblith Dusk'/);
	assert.equal(color(dark, 'bg'), '#17131F');
	assert.equal(color(dark, 'panel'), '#211A2B');
	assert.equal(color(dark, 'accent'), '#7A35B6');
	assert.equal(color(dark, 'hashtag'), '#FFC160');
	assert.equal(color(dark, 'navIndicator'), '#FF9D4D');
	assert.ok(contrast(color(dark, 'fg'), color(dark, 'bg')) >= 7);
	assert.ok(contrast('#FFFFFF', color(dark, 'accent')) >= 4.5);
});

test('Noctemblith Dawn draws the default light foundation from Manafield Home', () => {
	const light = theme('l');
	assert.match(light, /base: 'light'/);
	assert.match(light, /name: 'Noctemblith Dawn'/);
	assert.equal(color(light, 'bg'), '#F7F4EF');
	assert.equal(color(light, 'fg'), '#1F1B24');
	assert.equal(color(light, 'accent'), '#7B4FD6');
	assert.equal(color(light, 'mentionMe'), '#A84C1B');
	assert.ok(contrast(color(light, 'fg'), color(light, 'bg')) >= 7);
	assert.ok(contrast('#FFFFFF', color(light, 'accent')) >= 4.5);
	assert.ok(contrast(color(light, 'mentionMe'), color(light, 'bg')) >= 4.5);
});

test('the new themes are built in, not forced onto personal or instance themes', () => {
	const builtin = read('packages/frontend-shared/js/theme.ts');
	assert.match(builtin, /'d-noctemblith'/);
	assert.match(builtin, /'l-noctemblith'/);
	assert.doesNotMatch(builtin, /'l-noctite'|'d-noctite'/);

	for (const path of [
		'packages/frontend/src/boot/common.ts',
		'packages/frontend/src/pages/settings/theme.vue',
		'packages/frontend/src/utility/code-highlighter.ts',
		'packages/frontend-embed/src/boot.ts',
	]) {
		const file = read(path);
		assert.match(file, /themes\/d-noctemblith\.json5/);
		assert.match(file, /themes\/l-noctemblith\.json5/);
	}
	const common = read('packages/frontend/src/boot/common.ts');
	assert.match(common, /prefer\.s\.darkTheme \?\? defaultDarkTheme/);
	assert.match(common, /prefer\.s\.lightTheme \?\? defaultLightTheme/);
	assert.match(common, /instance\.defaultDarkTheme/);
	assert.match(common, /instance\.defaultLightTheme/);
});

test('brand colors do not replace semantic success, warning or error meanings', () => {
	const dark = theme('d');
	const light = theme('l');
	assert.equal(color(dark, 'success'), '#69C5A6');
	assert.equal(color(light, 'success'), '#287B66');
	assert.equal(color(dark, 'warn'), '#FFC160');
	assert.equal(color(light, 'warn'), '#A84C1B');
	// Critical errors keep the stock semantic red from the base themes.
	assert.doesNotMatch(dark, /\berror:/);
	assert.doesNotMatch(light, /\berror:/);
});
