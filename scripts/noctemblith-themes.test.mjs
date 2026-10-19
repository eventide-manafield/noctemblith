/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Dependency-free checks for theme registration and user/instance overrides.
 * Run: node --test scripts/noctemblith-themes.test.mjs
 */

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('the new themes are built in, not forced onto personal or instance themes', () => {
	const builtin = read('packages/frontend-shared/js/theme.ts');
	assert.match(builtin, /'d-noctemblith'/);
	assert.match(builtin, /'l-noctemblith'/);

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
