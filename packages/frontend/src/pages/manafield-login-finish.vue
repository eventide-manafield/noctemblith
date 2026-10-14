<!--
SPDX-FileCopyrightText: Noctemblith contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_m" style="max-width: 520px; margin: 4rem auto; padding: 24px;">
 <h1>Manafield 로그인</h1>
 <p role="status">{{ message }}</p>
 <MkA to="/">Noctemblith로 돌아가기</MkA>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';

const message = ref('로그인 인증을 마무리하고 있어…');

onMounted(async () => {
 const uri = new URL(window.location.href);
 const ticket = uri.searchParams.get('ticket');
 const status = uri.searchParams.get('status');
 // Clear short-lived credentials from browser history and referrers immediately.
 window.history.replaceState(window.history.state, '', '/auth/manafield/finish');
 if (!ticket) {
  message.value = status === 'unlinked'
   ? '연결된 Noctemblith 계정이 없어. 기존 계정으로 로그인한 뒤 설정 → 서비스 연동에서 먼저 연결해 줘.'
   : status === 'denied'
   ? '마나필드 인증이 취소됐어.'
   : '마나필드 로그인을 완료하지 못했어.';
  return;
 }
 try {
  const response = await window.fetch('/auth/manafield/login/finish', {
   method: 'POST',
   credentials: 'same-origin',
   cache: 'no-store',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ ticket }),
  });
  if (!response.ok) throw new Error('expired_or_invalid_ticket');
  const result = await response.json() as { token?: unknown };
  if (typeof result.token !== 'string' || result.token.length !== 16) throw new Error('invalid_login_response');
  await login(result.token, '/');
 } catch {
  message.value = '로그인 확인이 만료됐거나 실패했어. 다시 시도해 줘.';
 }
});

definePage(() => ({ title: 'Manafield 로그인', icon: 'ti ti-link' }));
</script>
