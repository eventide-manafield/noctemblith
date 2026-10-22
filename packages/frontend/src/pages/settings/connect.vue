<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/connect" :label="i18n.ts._settings.serviceConnection" :keywords="['app', 'service', 'connect', 'webhook', 'api', 'token']" icon="ti ti-link">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/fluent-emoji/1f517.png" color="#ff0088">
			<SearchText>{{ i18n.ts._settings.serviceConnectionBanner }}</SearchText>
		</MkFeatureBanner>

		<SearchMarker :keywords="['manafield', 'sso', 'oauth', 'account']">
			<FormSection v-if="manafieldEnabled">
				<template #label><i class="ti ti-link"></i> 마나필드 계정</template>
				<div class="_gaps_s">
					<p v-if="manafieldLinked">이 Noctemblith 계정은 마나필드 계정과 연결되어 있습니다.</p>
					<p v-else>계정을 연결하려면 현재 Noctemblith 계정과 마나필드 계정의 소유권을 모두 확인해야 합니다.</p>
					<p v-if="manafieldMessage" role="status">{{ manafieldMessage }}</p>
					<a v-if="manafieldHandleRequired && manafieldProfileUrl" :href="manafieldProfileUrl">마나필드에서 공개 프로필 핸들 등록하기</a>
					<MkButton v-if="!manafieldLinked && manafieldLinkAllowed" primary :disabled="manafieldBusy" @click="startManafieldLink">
						{{ manafieldBusy ? '연결 준비 중…' : '마나필드 계정 연결하기' }}
					</MkButton>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['api', 'app', 'token', 'accessToken']">
			<FormSection>
				<template #label><i class="ti ti-api"></i> <SearchLabel>{{ i18n.ts._settings.api }}</SearchLabel></template>

				<div class="_gaps_m">
					<MkButton primary @click="generateToken">{{ i18n.ts.generateAccessToken }}</MkButton>
					<FormLink to="/settings/apps">{{ i18n.ts.manageAccessTokens }}</FormLink>
					<FormLink to="/api-console" :behavior="isDesktop ? 'window' : null">API console</FormLink>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['webhook']">
			<FormSection>
				<template #label><i class="ti ti-webhook"></i> <SearchLabel>{{ i18n.ts._settings.webhook }}</SearchLabel></template>

				<div class="_gaps_m">
					<FormLink :to="`/settings/webhook/new`">
						{{ i18n.ts._webhookSettings.createWebhook }}
					</FormLink>

					<MkFolder :defaultOpen="true">
						<template #label>{{ i18n.ts.manage }}</template>

						<MkPagination :paginator="paginator" withControl>
							<template #default="{items}">
								<div class="_gaps">
									<FormLink v-for="webhook in items" :key="webhook.id" :to="`/settings/webhook/edit/${webhook.id}`">
										<template #icon>
											<i v-if="webhook.active === false" class="ti ti-player-pause"></i>
											<i v-else-if="webhook.latestStatus === null" class="ti ti-circle"></i>
											<i v-else-if="[200, 201, 204].includes(webhook.latestStatus)" class="ti ti-check" :style="{ color: 'var(--MI_THEME-success)' }"></i>
											<i v-else class="ti ti-alert-triangle" :style="{ color: 'var(--MI_THEME-error)' }"></i>
										</template>
										{{ webhook.name || webhook.url }}
										<template #suffix>
											<MkTime v-if="webhook.latestSentAt" :time="webhook.latestSentAt"></MkTime>
										</template>
									</FormLink>
								</div>
							</template>
						</MkPagination>
					</MkFolder>
				</div>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, ref, defineAsyncComponent, markRaw, onMounted } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import FormSection from '@/components/form/section.vue';
import FormLink from '@/components/form/link.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import { Paginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';

const isDesktop = ref(window.innerWidth >= 1100);
const manafieldEnabled = ref(false);
const manafieldLinked = ref(false);
const manafieldLinkAllowed = ref(false);
const manafieldBusy = ref(false);
const manafieldMessage = ref('');
const manafieldHandleRequired = ref(false);
const manafieldProfileUrl = ref<string | null>(null);

async function getManafieldState() {
 try {
  const status = await window.fetch('/auth/manafield/status', { cache: 'no-store' });
  if (!status.ok) return;
  const availability = await status.json() as { enabled?: boolean; accountProfileUrl?: string | null };
  if (!availability.enabled || !$i) return;
  manafieldEnabled.value = true;
  manafieldProfileUrl.value = typeof availability.accountProfileUrl === 'string' ? availability.accountProfileUrl : null;

  const linked = await window.fetch('/auth/manafield/link/status', {
   method: 'POST',
   headers: { Authorization: 'Bearer ' + $i.token, 'Content-Type': 'application/json' },
   credentials: 'same-origin',
   cache: 'no-store',
   body: '{}',
  });
  if (linked.ok) {
   const result = await linked.json() as { linked?: boolean; linkAllowed?: boolean };
   manafieldLinked.value = result.linked === true;
   manafieldLinkAllowed.value = result.linkAllowed === true;
   if (!manafieldLinkAllowed.value && !manafieldLinked.value) {
    manafieldMessage.value = '관리자·모더레이터 계정의 중앙 연결에는 추가 인증이 필요합니다. 현재 릴리스에서는 이 연결을 지원하지 않습니다.';
   }
  }
  const feedback = new URL(window.location.href).searchParams.get('manafield');
  const messages: Record<string, string> = {
   linked: '마나필드 계정 연결이 완료되었습니다.',
   'handle-required': '마나필드 공개 프로필 핸들을 최초 등록한 뒤 다시 계정을 연결해 주세요.',
   conflict: '계정 정보가 일치하지 않거나 이미 연결된 계정이 있어 연결할 수 없습니다.',
   denied: '마나필드 인증이 취소되었습니다.',
   failed: '연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  };
  if (feedback && messages[feedback]) manafieldMessage.value = messages[feedback];
  manafieldHandleRequired.value = feedback === 'handle-required';
 } catch {
  // The integration is optional; other settings must remain functional.
 }
}

async function startManafieldLink() {
 if (!$i || manafieldBusy.value) return;
 manafieldBusy.value = true;
 try {
  const response = await window.fetch('/auth/manafield/link/start', {
   method: 'POST',
   credentials: 'same-origin',
   cache: 'no-store',
   headers: { Authorization: 'Bearer ' + $i.token, 'Content-Type': 'application/json' },
   body: '{}',
  });
  if (!response.ok) throw new Error('link_start_failed');
  const data = await response.json() as { authorizationUrl?: string };
  if (!data.authorizationUrl) throw new Error('missing_url');
  window.location.assign(data.authorizationUrl);
 } catch {
  manafieldMessage.value = '마나필드 계정 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  manafieldBusy.value = false;
 }
}

onMounted(() => { void getManafieldState(); });

const paginator = markRaw(new Paginator('i/webhooks/list', {
	limit: 100,
	noPaging: true,
}));

async function generateToken() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkTokenGenerateWindow.vue').then(x => x.default), {}, {
		done: async result => {
			const { name, permissions } = result;
			const { token } = await misskeyApi('miauth/gen-token', {
				session: null,
				name: name,
				permission: permissions,
			});

			os.alert({
				type: 'success',
				title: i18n.ts.accessToken,
				text: token,
			});
		},
		closed: () => dispose(),
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._settings.serviceConnection,
	icon: 'ti ti-link',
}));
</script>
