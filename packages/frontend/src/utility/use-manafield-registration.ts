/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { onMounted, readonly, ref } from 'vue';

export type RegistrationMode = 'loading' | 'native' | 'manafield' | 'error';

/** Only an explicit disabled response may expose the native signup form. */
export function useManafieldRegistration() {
	const registrationMode = ref<RegistrationMode>('loading');

	async function refreshRegistrationMode(): Promise<void> {
		registrationMode.value = 'loading';
		try {
			const response = await window.fetch('/auth/manafield/status', {
				cache: 'no-store',
				signal: AbortSignal.timeout(10000),
			});
			if (!response.ok) throw new Error('Registration status request failed');
			const data: unknown = await response.json();
			if (typeof data !== 'object' || data === null || !('enabled' in data) || typeof data.enabled !== 'boolean') {
				throw new Error('Invalid registration status response');
			}
			registrationMode.value = data.enabled ? 'manafield' : 'native';
		} catch {
			registrationMode.value = 'error';
		}
	}

	onMounted(refreshRegistrationMode);
	return { registrationMode: readonly(registrationMode), refreshRegistrationMode };
}
