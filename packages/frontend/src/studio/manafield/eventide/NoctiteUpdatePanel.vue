<!--
SPDX-FileCopyrightText: Noctite contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<section v-if="$i?.isAdmin && (!compact || pending)" class="_panel" :class="$style.root">
	<div class="_gaps_s">
		<div :class="$style.heading"><i class="ti ti-package"></i> <b>Noctite 업데이트</b></div>
		<template v-if="loading">
			<p class="_gaps_s">새 빌드를 확인하는 중이야…</p>
		</template>
		<template v-else-if="status?.state === 'available' && pending">
			<p>새로운 검증 빌드가 준비되었어. 적용 여부는 서버 관리자가 결정할 수 있어.</p>
			<div :class="$style.versions">
				<span>현재: <code>{{ status.current.sha.slice(0, 10) }}</code></span>
				<span>후보: <code>{{ status.candidate.sha.slice(0, 10) }}</code></span>
				<span>채널: <code>{{ status.candidate.channel }}</code></span>
			</div>
			<div :class="$style.actions">
				<MkButton @click="showGuide = !showGuide"><i class="ti ti-download"></i> 업데이트 적용</MkButton>
				<MkButton @click="skip"><i class="ti ti-ban"></i> 이번 버전 건너뛰기</MkButton>
				<MkButton @click="snooze"><i class="ti ti-clock"></i> 7일 뒤 다시 보기</MkButton>
			</div>
			<div v-if="showGuide" :class="$style.guide" class="_gaps_s">
				<b>업데이트 적용 안내 (수동 배포)</b>
				<p>현재 v0.1에는 서버 업데이트 에이전트가 없어. 이 버튼은 배포 절차를 보여주며 서버나 DB를 직접 변경하지 않아.</p>
				<p>먼저 <a :href="status.candidate.workflowUrl" target="_blank" rel="noopener noreferrer" class="_link">GitHub 빌드 실행 결과</a>에서 이미지 digest를 확인하고, DB 백업 후 앱 컨테이너만 교체해줘.</p>
				<div :class="$style.command"><code>{{ imageTag }}</code></div>
				<div :class="$style.actions">
					<MkButton @click="copyTag"><i class="ti ti-copy"></i> 이미지 태그 복사</MkButton>
					<MkButton type="a" :href="WORKFLOW_PAGE" target="_blank" rel="noopener noreferrer">
						<i class="ti ti-external-link"></i> 빌드 목록 보기
					</MkButton>
				</div>
				<p v-if="copied">태그 복사 완료. 실제 배포에는 Actions에서 확인한 digest를 사용해야 해.</p>
			</div>
		</template>
		<template v-else-if="!compact">
			<p>{{ status?.message ?? '업데이트 정보를 확인하지 못했어.' }}</p>
			<p v-if="status?.current">현재 채널: <code>{{ status.current.channel }}</code> · 커밋: <code>{{ status.current.sha.slice(0, 10) }}</code></p>
		</template>
		<div v-if="!compact" :class="$style.actions">
			<MkButton :disabled="loading" @click="refresh"><i class="ti ti-refresh"></i> 업데이트 다시 확인</MkButton>
			<MkButton type="a" :href="WORKFLOW_PAGE" target="_blank" rel="noopener noreferrer">
				<i class="ti ti-brand-github"></i> 이미지 빌드 보기
			</MkButton>
		</div>
	</div>
</section>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { $i } from '@/i.js';
import {
	WORKFLOW_PAGE,
	REPOSITORY,
	checkForUpdates,
	chooseUpdate,
	readDecision,
	saveDecision,
	shouldNotify,
} from '@/studio/manafield/eventide/noctite-updates.js';
import type { UpdateCheck } from '@/studio/manafield/eventide/noctite-updates.js';

defineProps<{ compact?: boolean }>();

const loading = ref(false);
const status = ref<UpdateCheck | null>(null);
const decision = ref(readDecision($i?.id ?? 'none'));
const showGuide = ref(false);
const copied = ref(false);
const pending = computed(() => status.value?.state === 'available' &&
	shouldNotify(status.value.candidate, decision.value));
const imageTag = computed(() => status.value?.state === 'available'
	? `ghcr.io/${REPOSITORY}:build-${status.value.candidate.sha}`
	: '');

async function refresh(): Promise<void> {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	try {
		status.value = await checkForUpdates();
		showGuide.value = false;
	} finally {
		loading.value = false;
	}
}

function choose(action: 'skip' | 'snooze'): void {
	if (status.value?.state !== 'available' || !$i?.isAdmin) return;
	decision.value = chooseUpdate(decision.value, status.value.candidate.sha, action);
	saveDecision($i.id, decision.value);
	showGuide.value = false;
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

onMounted(() => { void refresh(); });
</script>

<style lang="scss" module>
.root {
	padding: 20px;
	border: 1px solid var(--MI_THEME-divider);
}
.heading {
	font-size: 1.05em;
}
.versions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 16px;
}
.actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: center;
}
.guide {
	padding: 14px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	background: var(--MI_THEME-accentedBg);
}
.command {
	overflow-x: auto;
	padding: 10px;
	border-radius: 6px;
	background: var(--MI_THEME-bg);
	user-select: text;
}
</style>
