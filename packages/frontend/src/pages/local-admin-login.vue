<!--
SPDX-FileCopyrightText: Noctemblith contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_m" :class="$style.root">
 <h1>{{ i18n.ts._noctemblithLogin.localAdmin }}</h1>
 <p>{{ i18n.ts._noctemblithLogin.localAdminDescription }}</p>
 <MkSignin localAdmin autoSet/>
</div>
</template>

<script setup lang="ts">
import MkSignin from '@/components/MkSignin.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

definePage(() => ({
 title: i18n.ts._noctemblithLogin.localAdmin,
 icon: 'ti ti-lock',
}));
</script>

<style lang="scss" module>
.root {
 max-width: 420px;
 margin: calc(var(--MI-margin) * 4) auto;
 padding: var(--MI-margin);
}
</style>
