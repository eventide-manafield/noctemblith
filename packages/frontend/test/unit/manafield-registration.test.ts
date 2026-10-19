/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import type { App, Component } from 'vue';
import Dashboard from '../../src/components/MkVisitorDashboard.vue';
import SignupDialog from '../../src/components/MkSignupDialog.vue';

vi.mock('@@/js/config.js', () => ({ instanceName: 'Noctemblith' }));
vi.mock('@/instance.js', () => ({
	instance: {
		description: 'Example server',
		disableRegistration: true,
		federation: 'none',
		clientOptions: { showActivitiesForVisitor: false, showTimelineForVisitor: false },
		policies: { ltlAvailable: false },
	},
}));
vi.mock('@/i18n.js', () => ({
	i18n: { ts: new Proxy({}, { get: (_, key) => String(key) }), tsx: { signinWith: ({ x }: { x: string }) => x } },
}));
vi.mock('@/os.js', () => ({ popup: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/ui/_common_/common.js', () => ({ openInstanceMenu: vi.fn() }));
vi.mock('@/components/MkSigninDialog.vue', () => ({ default: {} }));
vi.mock('@/components/MkStreamingNotesTimeline.vue', () => ({ default: {} }));
vi.mock('@/components/MkNumber.vue', () => ({ default: {} }));
vi.mock('@/components/MkVisitorDashboard.ActiveUsersChart.vue', () => ({ default: {} }));
vi.mock('@/components/MkInfo.vue', () => ({ default: defineComponent({
	setup: (_, { slots }) => () => h('div', { 'data-info': '' }, slots.default?.()),
}) }));
vi.mock('@/components/MkButton.vue', () => ({ default: defineComponent({
	inheritAttrs: false,
	props: ['type'],
	setup: (props, { attrs, slots }) => () => h(props.type === 'a' ? 'a' : 'button', attrs, slots.default?.()),
}) }));
vi.mock('@/components/MkModalWindow.vue', () => ({ default: defineComponent({
	setup: (_, { slots }) => () => h('section', [slots.header?.(), slots.default?.()]),
}) }));
vi.mock('@/components/MkSignupDialog.rules.vue', () => ({ default: defineComponent({
	emits: ['done'],
	setup: (_, { emit }) => () => h('button', { 'data-rules': '', onClick: () => emit('done') }),
}) }));
vi.mock('@/components/MkSignupDialog.form.vue', () => ({ default: defineComponent({
	setup: () => () => h('form', { 'data-native-form': '' }),
}) }));

const mounted: { app: App; element: HTMLElement }[] = [];

function mount(component: Component) {
	const element = window.document.createElement('div');
	window.document.body.appendChild(element);
	const app = createApp(component);
	app.config.globalProperties.$style = new Proxy({}, { get: (_, key) => String(key) });
	app.component('MkA', { setup: (_, { slots }) => () => h('a', slots.default?.()) });
	app.component('MkLoading', { setup: () => () => h('span', { 'data-loading': '' }) });
	app.mount(element);
	mounted.push({ app, element });
	return element;
}

afterEach(() => {
	for (const { app, element } of mounted.splice(0)) {
		app.unmount();
		element.remove();
	}
	vi.restoreAllMocks();
});

describe('registration entrypoints', () => {
	it.each([Dashboard, SignupDialog])('waits for status and offers SSO without a local signup form', async (component) => {
		let resolveStatus!: (response: Response) => void;
		const request = vi.spyOn(window, 'fetch').mockReturnValue(new Promise(resolve => { resolveStatus = resolve; }));
		const element = mount(component);
		expect(element.querySelector('[data-loading]')).not.toBeNull();
		expect(element.querySelector('[data-testid="signup"], [data-rules], [data-native-form]')).toBeNull();
		resolveStatus(new Response(JSON.stringify({ enabled: true })));
		await vi.waitFor(() => expect(element.querySelector('[data-testid="manafield-signin"]')).not.toBeNull());
		expect(element.querySelector('[data-testid="manafield-signin"]')?.getAttribute('href')).toBe('/auth/manafield/login/start');
		expect(element.querySelector('[data-testid="signup"], [data-rules], [data-native-form]')).toBeNull();
		expect(element.textContent).not.toContain('invitationRequiredToRegister');
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][0]).toBe('/auth/manafield/status');
	});

	it('preserves standalone signup and invitation guidance after an explicit disabled response', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ enabled: false })));
		const dashboard = mount(Dashboard);
		await vi.waitFor(() => expect(dashboard.querySelector('[data-testid="signup"]')).not.toBeNull());
		expect(dashboard.querySelector('[data-testid="signin"]')).not.toBeNull();
		expect(dashboard.querySelector('[data-testid="manafield-signin"]')).toBeNull();
		expect(dashboard.textContent).toContain('invitationRequiredToRegister');
		const dialog = mount(SignupDialog);
		await vi.waitFor(() => expect(dialog.querySelector('[data-rules]')).not.toBeNull());
		(dialog.querySelector('[data-rules]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(dialog.querySelector('[data-native-form]')).not.toBeNull());
	});

	it.each([
		() => Promise.resolve(new Response('{}', { status: 503 })),
		() => Promise.resolve(new Response(JSON.stringify({ enabled: 'false' }))),
		() => Promise.reject(new TypeError('Network unavailable')),
	])('keeps signup closed on status failure and recovers through retry', async (response) => {
		vi.spyOn(window, 'fetch').mockImplementationOnce(response)
			.mockResolvedValue(new Response(JSON.stringify({ enabled: true })));
		const dialog = mount(SignupDialog);
		await vi.waitFor(() => expect(dialog.querySelector('[data-info]')).not.toBeNull());
		expect(dialog.querySelector('[data-rules], [data-native-form], [data-testid="manafield-signin"]')).toBeNull();
		(dialog.querySelector('button') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(dialog.querySelector('[data-testid="manafield-signin"]')).not.toBeNull());
		expect(dialog.querySelector('[data-native-form]')).toBeNull();
	});
});
