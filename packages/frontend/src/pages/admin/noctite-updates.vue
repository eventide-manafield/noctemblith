<!--
SPDX-FileCopyrightText: Noctite contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 760px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<NoctiteUpdatePanel v-if="$i?.isAdmin"/>
		<div v-else class="_panel" style="padding: 20px;">업데이트 관리는 인스턴스 관리자만 사용할 수 있어.</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import NoctiteUpdatePanel from '@/studio/manafield/eventide/NoctiteUpdatePanel.vue';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';

definePage(() => ({
	title: 'Noctite 업데이트',
	icon: 'ti ti-download',
}));
</script>
