/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl, host } from '@@/js/config.js';
import { cloudBackup } from '@/preferences/utility.js';
import { store } from '@/store.js';
import { waiting, alert } from '@/os.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { clear } from '@/utility/idb-proxy.js';
import { $i } from '@/i.js';
import { encodePushSubscriptionKey } from '@/utility/encode-push-subscription-key.js';

export async function signout() {
	if (!$i) return;

	// Integrated browser tokens are individually revocable. Never delete the
	// Account Core session when leaving Noctemblith. Standalone users retain
	// the historical local-only sign-out behavior.
	const sessionPattern = /^mfs1_[A-Za-z0-9_-]{43}$/;
	// The existing logout clears all locally saved accounts, so revoke every
	// session token owned by this Noctemblith origin before clearing storage.
	// Never send credentials belonging to another instance to this origin.
	const sessions = new Set([
		$i.token,
		...Object.entries(store.s.accountTokens)
			.filter(([key]) => key.startsWith(host + '/'))
			.map(([, token]) => token),
	].filter((token): token is string => typeof token === 'string' && sessionPattern.test(token)));
	if (sessions.size > 0) {
		try {
			for (const token of sessions) {
				const response = await window.fetch('/auth/manafield/session/logout', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Authorization': 'Bearer ' + token },
					cache: 'no-store',
				});
				// An already-revoked session can safely be removed from browser storage.
				if (response.status !== 204 && response.status !== 401) {
					throw new Error('Session logout rejected');
				}
			}
		} catch {
			await alert({
				type: 'error',
				title: '로그아웃에 실패했습니다',
				text: '서버에서 로그인 세션을 종료하지 못했습니다. 다시 시도해 주세요.',
			});
			return;
		}
	}

	waiting();

	if (store.s.enablePreferencesAutoCloudBackup) {
		await cloudBackup();
	}

	localStorage.clear();

	const idbAbortController = new AbortController();
	const timeout = window.setTimeout(() => idbAbortController.abort(), 5000);

	const idbPromises = ['MisskeyClient'].map((name, i, arr) => new Promise<void>((res, rej) => {
		const delidb = indexedDB.deleteDatabase(name);
		delidb.onsuccess = () => res();
		delidb.onerror = e => rej(e);
		delidb.onblocked = () => idbAbortController.signal.aborted && rej(new Error('Operation aborted'));
	}));

	try {
		await Promise.race([
			Promise.all([
				...idbPromises,
				// idb keyval-storeはidb-keyvalライブラリによる別管理
				clear(),
			]),
			new Promise((_, rej) => idbAbortController.signal.addEventListener('abort', () => rej(new Error('Operation timed out')))),
		]);
	} catch {
		// nothing
	} finally {
		window.clearTimeout(timeout);
	}

	//#region Remove service worker registration
	try {
		if (navigator.serviceWorker.controller) {
			const registration = await navigator.serviceWorker.ready;
			const push = await registration.pushManager.getSubscription();
			if (push) {
				// Service Workerごと登録解除するので、この購読に紐づく全アカウントの登録を解除する
				await window.fetch(`${apiUrl}/sw/unregister`, {
					method: 'POST',
					body: JSON.stringify({
						endpoint: push.endpoint,
						auth: encodePushSubscriptionKey(push.getKey('auth')),
						publickey: encodePushSubscriptionKey(push.getKey('p256dh')),
					}),
					headers: {
						'Content-Type': 'application/json',
					},
				});
			}
		}

		await navigator.serviceWorker.getRegistrations()
			.then(registrations => {
				return Promise.all(registrations.map(registration => registration.unregister()));
			});
	} catch {
		// nothing
	}
	//#endregion

	unisonReload('/');
}
