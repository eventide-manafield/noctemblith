/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { validateExternalModuleUrl } from './external-module-url.js';

describe('Noctite external module URL validation', () => {
	it('accepts only absolute HTTPS module URLs', () => {
		expect(validateExternalModuleUrl('https://example.org/widget')).toBe('https://example.org/widget');
		expect(validateExternalModuleUrl('  https://echo.manafield.studio/widget/  ')).toBe('https://echo.manafield.studio/widget/');
	});
	it.each([
		'', ' ', '/widget', '//example.org/widget',
		'http://example.org/widget', 'javascript:alert(1)', 'data:text/html,hello',
		'https://user:pass@example.org/widget', 'https://user@example.org/widget',
		'https://example.org/widget?token=private', 'https://example.org/widget#token',
		'https://', 'https://example.org'.padEnd(2050, 'a'),
	])('rejects unsafe or unsuitable source %s', (input) => {
		expect(validateExternalModuleUrl(input)).toBeNull();
	});
});
