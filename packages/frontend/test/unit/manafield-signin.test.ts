/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createApp, defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MkSigninInput from '@/components/MkSignin.input.vue';
import { i18n } from '@/i18n.js';
import { localAdminSignin } from '@/utility/local-admin-signin.js';

vi.mock('@/os.js', () => ({ inputText: vi.fn(), alert: vi.fn() }));
vi.mock('@/components/MkButton.vue', () => ({
 default: defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }),
}));
vi.mock('@/components/MkInput.vue', () => ({
 default: defineComponent({ setup: () => () => h('input') }),
}));
vi.mock('@/components/MkInfo.vue', () => ({
 default: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
}));

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
 apps.splice(0).forEach(app => app.unmount());
 document.body.innerHTML = '';
 vi.unstubAllGlobals();
});

function mountInput(localAdmin = false) {
 const root = document.createElement('div');
 document.body.append(root);
 const app = createApp(MkSigninInput, { localAdmin });
 app.component('MkLoading', defineComponent({ setup: () => () => h('span', 'loading') }));
 app.mount(root);
 apps.push(app);
 return root;
}

function settings(enabled: unknown) {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
 })));
}

describe('Manafield and hidden local-admin sign-in surfaces', () => {
 it('shows only Manafield login on an integrated public surface with no administrator link', async () => {
  settings(true);
  const root = mountInput();
  await vi.waitFor(() => expect(root.textContent).toContain(i18n.ts._noctemblithLogin.manafield));
  expect(root.querySelector('[data-testid="signin-username"]')).toBeNull();
  expect(root.textContent).not.toContain(i18n.ts.signinWithPasskey);
  expect(root.querySelector('a[href="/auth/local-admin"]')).toBeNull();
  expect(root.querySelectorAll('button')).toHaveLength(1);
 });

 it('keeps the original username and passkey choices on standalone installations', async () => {
  settings(false);
  const root = mountInput();
  await vi.waitFor(() => expect(root.querySelector('[data-testid="signin-username"]')).not.toBeNull());
  expect(root.textContent).toContain(i18n.ts.signinWithPasskey);
  expect(root.textContent).not.toContain(i18n.ts._noctemblithLogin.manafield);
 });

 it('shows native inputs on the explicit integrated administrator surface', async () => {
  settings(true);
  const root = mountInput(true);
  await vi.waitFor(() => expect(root.querySelector('[data-testid="signin-username"]')).not.toBeNull());
  expect(root.textContent).toContain(i18n.ts.signinWithPasskey);
  expect(root.textContent).not.toContain(i18n.ts._noctemblithLogin.manafield);
 });

 it('does not expose native login while settings are loading or unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  const root = mountInput();
  expect(root.querySelector('form')).toBeNull();
  await vi.waitFor(() => expect(root.textContent).toContain(i18n.ts._noctemblithLogin.unavailable));
  expect(root.querySelector('form')).toBeNull();
 });

 it('does not treat malformed settings as standalone mode', async () => {
  settings('true');
  const root = mountInput();
  await vi.waitFor(() => expect(root.textContent).toContain(i18n.ts._noctemblithLogin.unavailable));
  expect(root.querySelector('form')).toBeNull();
 });

 it('does not enable the integration admin form on a standalone server', async () => {
  settings(false);
  const root = mountInput(true);
  await vi.waitFor(() => expect(root.textContent).toContain(i18n.ts._noctemblithLogin.localAdminUnavailable));
  expect(root.querySelector('form')).toBeNull();
 });

 it('sends native administrator credentials only to the dedicated same-origin API', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ finished: false, next: 'totp' }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await localAdminSignin('signin-flow', { username: 'admin', password: 'password' });
  expect(fetcher).toHaveBeenCalledWith('/api/local-admin/signin-flow', expect.objectContaining({
   method: 'POST', credentials: 'same-origin', cache: 'no-store',
  }));
 });
});
