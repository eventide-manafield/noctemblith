<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="meta" :class="$style.root">
	<MkFeaturedPhotos :class="$style.bg"/>
	<div :class="$style.artwork" aria-hidden="true">
		<XCrystal :class="$style.crystal"/>
	</div>
	<XTimeline :class="$style.tl"/>
	<div :class="$style.logoWrapper">
		<div :class="$style.poweredBy">Powered by</div>
		<div :class="$style.brand"><img src="/static-assets/noctemblith.svg" alt="" :class="$style.brandIcon"/><span>Noctemblith</span></div>
	</div>
	<div :class="$style.contents">
		<MkVisitorDashboard/>
	</div>
	<div v-if="instances && instances.length > 0" :class="$style.federation">
		<MkMarqueeText :duration="40">
			<MkA v-for="instance in instances" :key="instance.id" :class="$style.federationInstance" :to="`/instance-info/${instance.host}`" behavior="window">
				<!--<MkInstanceCardMini :instance="instance"/>-->
				<img v-if="instance.iconUrl" :class="$style.federationInstanceIcon" :src="getInstanceIcon(instance)" alt=""/>
				<span class="_monospace">{{ instance.host }}</span>
			</MkA>
		</MkMarqueeText>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import * as Misskey from 'misskey-js';
import XTimeline from './welcome.timeline.vue';
import XCrystal from './welcome.entrance.crystal.vue';
import MkMarqueeText from '@/components/MkMarqueeText.vue';
import MkFeaturedPhotos from '@/components/MkFeaturedPhotos.vue';
import { misskeyApiGet } from '@/utility/misskey-api.js';
import MkVisitorDashboard from '@/components/MkVisitorDashboard.vue';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';
import { instance as meta } from '@/instance.js';

const instances = ref<Misskey.entities.FederationInstance[]>();

function getInstanceIcon(instance: Misskey.entities.FederationInstance): string {
	if (!instance.iconUrl) {
		return '';
	}

	return getProxiedImageUrl(instance.iconUrl, 'preview');
}

misskeyApiGet('federation/instances', {
	sort: '+pubSub',
	limit: 20,
	blocked: false,
}).then(_instances => {
	instances.value = _instances;
});
</script>

<style lang="scss" module>
.root {
	--MI-local-welcome-logo-filter: drop-shadow(0 0 1px rgb(255 255 255 / 95%)) drop-shadow(0 0 1px rgb(255 255 255 / 95%)) drop-shadow(0 3px 6px rgb(0 0 0 / 55%));

	position: relative;
	isolation: isolate;
	height: 100cqh;
	overflow: auto;
	overscroll-behavior: contain;
	background: var(--MI_THEME-entranceBg, var(--MI_THEME-bg));
}

.bg {
	position: fixed;
	top: 0;
	right: 0;
	width: 100vw;
	height: 100vh;
	// 固定レイヤがホイール操作を奪い、コンテンツ列以外の上でページをスクロールできなくなるのを防ぐ (issue #17680)
	pointer-events: none;
}

.artwork {
	position: fixed;
	inset: 0;
	overflow: clip;
	pointer-events: none;
}

.crystal {
	position: absolute;
	top: min(50svh, 480px);
	left: calc(50% + 40px);
	width: min(84vw, 92svh, 920px);
	transform: translate(-50%, -50%);

	@media (max-width: 700px) {
		top: 100px;
		left: 50%;
		width: min(120vw, 580px);
		transform: translate(-25%, 0);
	}
}

.tl {
	position: fixed;
	z-index: 1;
	top: 0;
	bottom: 0;
	right: 64px;
	margin: auto;
	padding: 128px 0;
	width: 500px;
	height: calc(100% - 256px);
	overflow: hidden;
	-webkit-mask-image: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 128px, rgba(0,0,0,1) calc(100% - 128px), rgba(0,0,0,0) 100%);
	mask-image: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 128px, rgba(0,0,0,1) calc(100% - 128px), rgba(0,0,0,0) 100%);

	@media (max-width: 1200px) {
		display: none;
	}
}

.logoWrapper {
	position: absolute;
	z-index: 2;
	top: 36px;
	left: 36px;
	flex: auto;
	color: var(--MI_THEME-fgOnAccent);
	user-select: none;
	pointer-events: none;
}

.poweredBy {
	margin-bottom: 2px;
}

.brand {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: bold;
}

.brandIcon {
	width: 40px;
	height: 40px;
	object-fit: contain;
	filter: var(--MI-local-welcome-logo-filter);
}

.contents {
	position: relative;
	z-index: 1;
	width: min(400px, calc(100% - 32px));
	margin-left: clamp(24px, 6vw, 112px);
	padding: 180px 0 112px;

	@media (max-width: 700px) {
		margin: auto;
	}
}

.federation {
	position: fixed;
	z-index: 3;
	bottom: 16px;
	left: 0;
	right: 0;
	margin: auto;
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.5);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	border-radius: 999px;
	overflow: clip;
	width: 800px;
	padding: 8px 0;

	@media (max-width: 900px) {
		display: none;
	}
}

.federationInstance {
	display: inline-flex;
	align-items: center;
	vertical-align: bottom;
	padding: 6px 12px 6px 6px;
	margin: 0 10px 0 0;
	background: var(--MI_THEME-panel);
	border-radius: 999px;
}

.federationInstanceIcon {
	display: inline-block;
	width: 20px;
	height: 20px;
	margin-right: 5px;
	border-radius: 999px;
}
</style>
