<!--
SPDX-FileCopyrightText: Noctite contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" class="mkw-externalModule">
	<template #icon><i class="ti ti-app-window"></i></template>
	<template #header>{{ i18n.ts._widgets.externalModule }}</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" @click="configure"><i class="ti ti-settings"></i></button></template>
	<div v-if="frameUrl" :class="$style.root">
		<!-- Opaque origin: no allow-same-origin, top-navigation, or popup privileges. -->
		<iframe
			:key="frameUrl"
			:src="frameUrl"
			:title="i18n.ts._widgets.externalModule"
			:height="frameHeight"
			:class="$style.frame"
			sandbox="allow-scripts allow-forms"
			referrerpolicy="no-referrer"
			loading="lazy"
		></iframe>
		<div :class="$style.footer">
			<a :href="frameUrl" target="_blank" rel="noopener noreferrer">{{ i18n.ts._widgetOptions._externalModule.openInNewTab }}</a>
		</div>
	</div>
	<div v-else :class="$style.empty">{{ i18n.ts._widgetOptions._externalModule.setupHint }}</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import { validateExternalModuleUrl } from './external-module-url.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import MkContainer from '@/components/MkContainer.vue';

const name = 'externalModule';

const widgetPropsDef = {
	url: {
		type: 'string',
		label: i18n.ts._widgetOptions._externalModule.url,
		default: '',
		manualSave: true,
	},
	height: {
		type: 'number',
		label: i18n.ts._widgetOptions.height,
		default: 320,
	},
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const frameUrl = computed(() => validateExternalModuleUrl(widgetProps.url));
const frameHeight = computed(() => Number.isFinite(widgetProps.height)
	? Math.max(200, Math.min(800, widgetProps.height))
	: 320);

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	min-width: 0;
}
.frame {
	display: block;
	width: 100%;
	border: 0;
	background: transparent;
}
.footer {
	padding: 8px 12px;
	text-align: right;
	font-size: 0.85em;
}
.empty {
	padding: 16px;
	font-size: 0.9em;
	color: var(--MI_THEME-fg);
	opacity: 0.7;
}
</style>
