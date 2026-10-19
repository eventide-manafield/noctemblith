<!--
SPDX-FileCopyrightText: Noctemblith contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<svg :class="$style.root" viewBox="0 0 600 640" fill="none" aria-hidden="true" focusable="false">
	<defs>
		<linearGradient :id="`${id}-contrast`" x1="300" y1="40" x2="60" y2="460" gradientUnits="userSpaceOnUse">
			<stop :class="$style.contrast"/>
			<stop offset="1" :class="$style.contrastShade"/>
		</linearGradient>
		<linearGradient :id="`${id}-accent`" x1="300" y1="40" x2="480" y2="520" gradientUnits="userSpaceOnUse">
			<stop :class="$style.accentLight"/>
			<stop offset="0.45" :class="$style.accent"/>
			<stop offset="1" :class="$style.accentShade"/>
		</linearGradient>
		<linearGradient :id="`${id}-band`" x2="0" y2="1">
			<stop stop-color="currentColor" stop-opacity="0"/>
			<stop offset="0.24" stop-color="currentColor" stop-opacity="0.4"/>
			<stop offset="0.48" :class="$style.sunsetLight" stop-opacity="0.95"/>
			<stop offset="0.65" stop-color="currentColor" stop-opacity="0.8"/>
			<stop offset="1" stop-color="currentColor" stop-opacity="0"/>
		</linearGradient>
		<linearGradient :id="`${id}-fade`">
			<stop stop-color="white" stop-opacity="0"/>
			<stop offset="0.18" stop-color="white"/>
			<stop offset="0.82" stop-color="white"/>
			<stop offset="1" stop-color="white" stop-opacity="0"/>
		</linearGradient>
		<mask :id="`${id}-fade-mask`" maskUnits="userSpaceOnUse" x="40" y="440" width="520" height="140">
			<rect x="40" y="440" width="520" height="140" :fill="`url(#${id}-fade)`"/>
		</mask>
		<filter :id="`${id}-haze`" x="-20%" y="-100%" width="140%" height="300%" color-interpolation-filters="sRGB">
			<feGaussianBlur stdDeviation="6"/>
		</filter>
		<clipPath :id="`${id}-lower`">
			<path d="M60 460L180 390L300 460L420 390L540 460L300 600Z"/>
		</clipPath>
		<clipPath :id="`${id}-contrast-face`">
			<path d="M300 40L60 180V460L180 390V250L300 180Z"/>
		</clipPath>
	</defs>
	<!-- The accent plane extends to the viewport edge behind the left crystal face. -->
	<path :class="$style.backdrop" d="M-4000 -4000H300V40L60 180V460L-4000 2828.333Z"/>
	<path :fill="`url(#${id}-contrast)`" d="M300 40L60 180V460L180 390V250L300 180Z"/>
	<!-- Sunset light stays on the left face, parallel to the upper-right edge. -->
	<g :clip-path="`url(#${id}-contrast-face)`">
		<g transform="rotate(30.26)" opacity="0.65">
			<g :fill="`url(#${id}-band)`">
				<rect x="100" y="154" width="300" height="28"/>
				<rect x="100" y="212" width="300" height="28"/>
				<rect x="100" y="270" width="300" height="28"/>
			</g>
			<g fill="currentColor" opacity="0.28">
				<rect x="100" y="167" width="300" height="1.5"/>
				<rect x="100" y="225" width="300" height="1.5"/>
				<rect x="100" y="283" width="300" height="1.5"/>
			</g>
		</g>
	</g>
	<path :fill="`url(#${id}-accent)`" d="M300 40L540 180V460L300 600L60 460L180 390L300 460L420 390V250L300 180Z"/>
	<!-- Cut faces and a narrow polished edge follow the existing crystal logo. -->
	<path :class="$style.edge" d="M540 180V460L522 449V190Z"/>
	<path :class="$style.lowerFace" d="M300 460H540L300 600Z"/>
	<path :class="$style.highlight" d="M300 40L540 180M420 250V390L540 460"/>
	<!-- Three horizontal layers of sunset light, clipped inside the lower crystal. -->
	<g :clip-path="`url(#${id}-lower)`">
		<g :mask="`url(#${id}-fade-mask)`">
			<g :filter="`url(#${id}-haze)`" fill="currentColor" opacity="0.55">
				<rect x="40" y="452" width="520" height="22"/>
				<rect x="120" y="500" width="360" height="20"/>
				<rect x="190" y="544" width="220" height="18"/>
			</g>
			<g :fill="`url(#${id}-band)`">
				<rect x="40" y="446" width="520" height="34"/>
				<rect x="110" y="494" width="380" height="32"/>
				<rect x="180" y="538" width="240" height="30"/>
			</g>
			<g :class="$style.sunsetCore">
				<rect x="40" y="461" width="520" height="3"/>
				<rect x="110" y="508" width="380" height="2.5"/>
				<rect x="180" y="551" width="240" height="2"/>
			</g>
		</g>
	</g>
	<path :class="$style.ridge" d="M298 460H302L300 598Z"/>
	<path :class="$style.outline" d="M60 460L300 600L540 460"/>
</svg>
</template>

<script lang="ts" setup>
import { useId } from 'vue';

const id = `${useId()}-entrance-crystal`;
</script>

<style lang="scss" module>
.root {
	display: block;
	overflow: visible;
	color: var(--MI_THEME-entranceSunset, var(--MI_THEME-warn));
	pointer-events: none;
	user-select: none;
}

.backdrop {
	fill: var(--MI_THEME-accent);
}

.contrast {
	stop-color: var(--MI_THEME-entranceContrast, var(--MI_THEME-fg));
}

.contrastShade {
	stop-color: color-mix(in srgb, var(--MI_THEME-entranceContrast, var(--MI_THEME-fg)) 90%, var(--MI_THEME-entranceBg, var(--MI_THEME-bg)));
}

.accent {
	stop-color: var(--MI_THEME-accent);
}

.accentLight {
	stop-color: color-mix(in srgb, var(--MI_THEME-accent) 82%, var(--MI_THEME-fgOnAccent));
}

.accentShade {
	stop-color: color-mix(in srgb, var(--MI_THEME-accent) 78%, var(--MI_THEME-entranceBg, var(--MI_THEME-bg)));
}

.edge {
	fill: color-mix(in srgb, var(--MI_THEME-accent) 65%, var(--MI_THEME-entranceBg, var(--MI_THEME-bg)));
}

.lowerFace {
	fill: var(--MI_THEME-entranceBg, var(--MI_THEME-bg));
	opacity: 0.16;
}

.highlight {
	stroke: var(--MI_THEME-fgOnAccent);
	stroke-width: 1;
	opacity: 0.25;
}

.sunsetLight {
	stop-color: color-mix(in srgb, currentColor 65%, var(--MI_THEME-fgOnAccent));
}

.sunsetCore {
	fill: color-mix(in srgb, currentColor 55%, var(--MI_THEME-fgOnAccent));
	opacity: 0.85;
}

.ridge {
	fill: var(--MI_THEME-fgOnAccent);
	opacity: 0.16;
}

.outline {
	stroke: var(--MI_THEME-accent);
	stroke-width: 1;
}
</style>
