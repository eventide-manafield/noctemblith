<!--
SPDX-FileCopyrightText: Noctite contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<section v-if="$i?.isAdmin && (!compact || pending)" class="_panel" :class="$style.root">
	<div class="_gaps_s">
		<div :class="$style.heading"><i class="ti ti-package"></i> <b>Noctite 업데이트</b></div>
		<template v-if="!compact">
			<div :class="$style.settings" class="_gaps_s">
				<b>서버 업데이트 구독</b>
				<p>이 설정은 인스턴스 관리자 전체에게 적용됩니다. 안정 릴리스만 기본 구독합니다.</p>
				<MkRadios v-model="channelDraft" :options="channelOptions" vertical/>
				<div :class="$style.actions">
					<MkButton :disabled="saving || loadingSettings || channelDraft === subscription" @click="saveSubscription">구독 채널 저장</MkButton>
				</div>
				<p v-if="settingsError" role="alert">{{ settingsError }}</p>
			</div>
			<div :class="$style.settings" class="_gaps_s">
				<MkSwitch v-model="showDev" @change="toggleDev">
					<template #label>개발 빌드 보기</template>
					<template #caption>개인 화면에서만 개발 빌드를 조회합니다. 서버의 구독 채널은 변경되지 않습니다.</template>
				</MkSwitch>
				<p v-if="showDev">개발 빌드를 수동으로 조회 중입니다. 개발 빌드는 안정 릴리스가 아닙니다.</p>
			</div>
		</template>
		<template v-if="loading || loadingSettings">
			<p>업데이트 정보를 확인하는 중입니다…</p>
		</template>
		<template v-else-if="status?.state === 'available' && pending">
			<p>새로운 검증 빌드가 준비되었습니다. 적용 여부는 서버 관리자가 결정할 수 있습니다.</p>
			<div :class="$style.versions">
				<span>현재: <code>{{ status.current.sha.slice(0, 10) }}</code></span>
				<span>후보: <code>{{ status.candidate.sha.slice(0, 10) }}</code></span>
				<span>채널: <code>{{ status.candidate.channel }}</code></span>
			</div>
			<div :class="$style.actions">
				<MkButton @click="requestGuide"><i class="ti ti-download"></i> 업데이트 적용</MkButton>
				<MkButton @click="skip"><i class="ti ti-ban"></i> 이번 버전 건너뛰기</MkButton>
				<MkButton @click="snooze"><i class="ti ti-clock"></i> 7일 뒤 다시 보기</MkButton>
			</div>
			<div v-if="showDevWarning" class="_gaps_s" :class="$style.warning" role="alert">
				<b><i class="ti ti-alert-triangle"></i> 주의: 개발 버전 업데이트</b>
				<p>선택한 빌드는 개발 및 테스트가 진행 중인 <code>noctite/dev</code> 브랜치의 이미지입니다. 기능 오류, 서버 중단, 데이터 손상 또는 데이터베이스 호환성 문제가 발생할 수 있습니다.</p>
				<p><strong>개발 버전의 안정성과 이전 버전으로의 복구는 보장되지 않습니다.</strong> 데이터베이스와 첨부파일을 백업하고 위험을 이해한 경우에만 진행해 주세요.</p>
				<label :class="$style.acknowledge">
					<input v-model="devRiskAccepted" type="checkbox"/>
					<span>개발 버전 사용에 따른 위험을 이해했으며 계속 진행하겠습니다.</span>
				</label>
				<div :class="$style.actions">
					<MkButton :disabled="!devRiskAccepted" @click="confirmDev">위험을 이해하고 계속</MkButton>
					<MkButton @click="showDevWarning = false">취소</MkButton>
				</div>
			</div>
			<div v-if="showGuide" :class="$style.guide" class="_gaps_s">
				<b>업데이트 적용 안내 (수동 배포)</b>
				<p>현재 v0.2a에서는 자동 업데이트를 지원하지 않습니다. 이 버튼은 수동 배포 절차를 안내하며 서버나 데이터베이스를 직접 변경하지 않습니다.</p>
				<p>먼저 <a :href="status.candidate.workflowUrl" target="_blank" rel="noopener noreferrer" class="_link">GitHub 빌드 실행 결과</a>에서 이미지 digest를 확인한 뒤, 데이터베이스를 백업하고 앱 컨테이너만 교체해 주세요.</p>
				<div :class="$style.command"><code>{{ imageTag }}</code></div>
				<div :class="$style.actions">
					<MkButton @click="copyTag"><i class="ti ti-copy"></i> 이미지 태그 복사</MkButton>
					<MkButton type="a" :href="WORKFLOW_PAGE" target="_blank" rel="noopener noreferrer">
						<i class="ti ti-external-link"></i> 빌드 목록 보기
					</MkButton>
				</div>
				<p v-if="copied">이미지 태그를 복사했습니다. 실제 배포에는 GitHub Actions에서 확인한 digest를 사용해야 합니다.</p>
			</div>
		</template>
		<template v-else-if="!compact">
			<p>{{ pending ? '업데이트가 준비되었습니다.' : status?.state === 'available' ? '이 빌드의 업데이트 알림이 보류되었거나 건너뛰기 처리되었습니다.' : status?.message ?? '업데이트 정보를 확인하지 못했습니다.' }}</p>
			<p v-if="status?.current">설치된 이미지 채널: <code>{{ status.current.channel }}</code> · 커밋: <code>{{ status.current.sha.slice(0, 10) }}</code></p>
		</template>
		<div v-if="!compact" :class="$style.actions">
			<MkButton :disabled="loading || loadingSettings" @click="refresh"><i class="ti ti-refresh"></i> 업데이트 다시 확인</MkButton>
			<MkButton type="a" :href="WORKFLOW_PAGE" target="_blank" rel="noopener noreferrer"><i class="ti ti-brand-github"></i> 이미지 빌드 보기</MkButton>
		</div>
	</div>
</section>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { UpdateChannel, UpdateCheck } from '@/studio/manafield/eventide/noctite-updates.js';
import MkButton from '@/components/MkButton.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import {
	WORKFLOW_PAGE,
	REPOSITORY,
	RELEASE_CHANNEL,
	DEV_CHANNEL,
	checkForUpdates,
	chooseUpdate,
	parseSubscription,
	readDecision,
	saveDecision,
	shouldNotify,
} from '@/studio/manafield/eventide/noctite-updates.js';

const props = defineProps<{ compact?: boolean }>();
const channelOptions: { value: UpdateChannel; label: string; caption: string }[] = [
	{ value: RELEASE_CHANNEL, label: '안정 릴리스', caption: 'noctite/release/latest — 기본 구독 채널' },
	{ value: DEV_CHANNEL, label: '개발 빌드', caption: 'noctite/dev — 구독 변경 시 개발 빌드도 업데이트 알림에 포함됩니다.' },
];

const subscription = ref<UpdateChannel>(RELEASE_CHANNEL);
const channelDraft = ref<UpdateChannel>(RELEASE_CHANNEL);
const loadingSettings = ref(true);
const settingsError = ref('');
const saving = ref(false);
const loading = ref(false);
const status = ref<UpdateCheck | null>(null);
const decision = ref(readDecision($i?.id ?? 'none'));
const showGuide = ref(false);
const showDevWarning = ref(false);
const devRiskAccepted = ref(false);
const copied = ref(false);
const devVisibilityKey = `studio.manafield.eventide:noctite-show-dev:${$i?.id ?? 'none'}`;
const showDev = ref(false);
const activeChannel = computed(() => !props.compact && showDev.value ? DEV_CHANNEL : subscription.value);
const pending = computed(() => status.value?.state === 'available' &&
	shouldNotify(status.value.candidate, decision.value));
const imageTag = computed(() => status.value?.state === 'available'
	? `ghcr.io/${REPOSITORY}:build-${status.value.candidate.sha}`
	: '');

async function loadSettings(): Promise<void> {
	if (!$i?.isAdmin) return;
	loadingSettings.value = true;
	settingsError.value = '';
	try {
		const meta = await misskeyApi('admin/meta') as { noctiteUpdateChannel?: unknown };
		subscription.value = parseSubscription(meta.noctiteUpdateChannel);
		channelDraft.value = subscription.value;
	} catch {
		settingsError.value = '구독 설정을 가져오지 못했습니다. 다시 접속하거나 잠시 후 재시도해 주세요.';
	} finally {
		loadingSettings.value = false;
	}
	if (!settingsError.value) await refresh();
}

async function saveSubscription(): Promise<void> {
	if (!$i?.isAdmin || saving.value) return;
	saving.value = true;
	settingsError.value = '';
	try {
		// The API schema requires administrator authentication and a fixed channel enum.
		await misskeyApi('admin/update-meta', { noctiteUpdateChannel: channelDraft.value });
		subscription.value = channelDraft.value;
		showGuide.value = false;
		showDevWarning.value = false;
		await refresh();
		window.dispatchEvent(new Event('noctite-update-channel'));
	} catch {
		settingsError.value = '구독 채널을 저장하지 못했습니다. 다시 시도해 주세요.';
	} finally {
		saving.value = false;
	}
}

async function refresh(): Promise<void> {
	if (!$i?.isAdmin || loading.value || loadingSettings.value) return;
	loading.value = true;
	showGuide.value = false;
	showDevWarning.value = false;
	devRiskAccepted.value = false;
	status.value = null;
	try {
		status.value = await checkForUpdates(activeChannel.value);
	} finally {
		loading.value = false;
	}
}

function toggleDev(): void {
	try { localStorage.setItem(devVisibilityKey, String(showDev.value)); } catch { /* private mode */ }
	void refresh();
}

function requestGuide(): void {
	if (status.value?.state !== 'available') return;
	if (status.value.candidate.channel === DEV_CHANNEL && !showGuide.value) {
		showDevWarning.value = true;
		devRiskAccepted.value = false;
		return;
	}
	showGuide.value = !showGuide.value;
}

function confirmDev(): void {
	if (!devRiskAccepted.value || status.value?.state !== 'available' || status.value.candidate.channel !== DEV_CHANNEL) return;
	showDevWarning.value = false;
	showGuide.value = true;
}

function choose(action: 'skip' | 'snooze'): void {
	if (status.value?.state !== 'available' || !$i?.isAdmin) return;
	decision.value = chooseUpdate(decision.value, status.value.candidate.sha, action);
	saveDecision($i.id, decision.value);
	showGuide.value = false;
	showDevWarning.value = false;
}

function skip(): void { choose('skip'); }

function snooze(): void { choose('snooze'); }

async function copyTag(): Promise<void> {
	if (!imageTag.value) return;
	try {
		await navigator.clipboard.writeText(imageTag.value);
		copied.value = true;
	} catch {
		copied.value = false;
	}
}

function synchronizeDecision(): void {
	decision.value = readDecision($i?.id ?? 'none');
}

onMounted(() => {
	if (!props.compact) {
		try { showDev.value = localStorage.getItem(devVisibilityKey) === 'true'; } catch { /* private mode */ }
	}
	window.addEventListener('noctite-update-decision', synchronizeDecision);
	window.addEventListener('storage', synchronizeDecision);
	window.addEventListener('noctite-update-channel', loadSettings);
	void loadSettings();
});
onBeforeUnmount(() => {
	window.removeEventListener('noctite-update-decision', synchronizeDecision);
	window.removeEventListener('storage', synchronizeDecision);
	window.removeEventListener('noctite-update-channel', loadSettings);
});
</script>

<style lang="scss" module>
.root { padding: 20px; border: 1px solid var(--MI_THEME-divider); }
.heading { font-size: 1.05em; }
.settings { padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; }
.versions { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.guide, .warning { padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; }
.guide { background: var(--MI_THEME-accentedBg); }
.warning { background: var(--MI_THEME-infoWarnBg); color: var(--MI_THEME-infoWarnFg); }
.acknowledge { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
.command { overflow-x: auto; padding: 10px; border-radius: 6px; background: var(--MI_THEME-bg); user-select: text; }
</style>
