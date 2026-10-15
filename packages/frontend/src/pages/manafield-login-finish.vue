<!--
SPDX-FileCopyrightText: Noctemblith contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_m" style="max-width: 520px; margin: 4rem auto; padding: 24px;">
 <h1>마나필드 로그인</h1>
 <p role="status">{{ message }}</p>
 <MkA to="/">Noctemblith로 돌아가기</MkA>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';

const message = ref('로그인 인증을 완료하는 중입니다…');

onMounted(async () => {
 const uri = new URL(window.location.href);
 const ticket = uri.searchParams.get('ticket');
 const status = uri.searchParams.get('status');
 // Clear short-lived credentials from browser history and referrers immediately.
 window.history.replaceState(window.history.state, '', '/auth/manafield/finish');
 if (!ticket) {
  message.value = status === 'unlinked'
   ? '이 마나필드 계정과 연결된 Noctemblith 계정이 없습니다. 신규 계정 생성 기능은 아직 제공되지 않습니다. 기존 Noctemblith 계정이 있다면 해당 계정으로 로그인한 뒤 설정 → 서비스 연동에서 연결해 주세요.'
   : status === 'denied'
   ? '마나필드 인증이 취소되었습니다.'
   : '마나필드 로그인을 완료하지 못했습니다.';
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
  if (!response.ok) {
   const error = await response.json().catch(() => null) as { error?: string } | null;
   if (error?.error === 'privileged_account_requires_local_login') {
    message.value = '관리자 및 모더레이터 계정은 보안 정책에 따라 기존 Noctemblith 로그인 방식으로 로그인해야 합니다. 마나필드 계정 연결은 유지됩니다.';
    return;
   }
   throw new Error('expired_or_invalid_ticket');
  }
  const result = await response.json() as { finished?: boolean; i?: unknown };
  if (result.finished !== true || typeof result.i !== 'string' || result.i.length !== 16) {
   throw new Error('invalid_login_response');
  }
  await login(result.i, '/');
 } catch {
  message.value = '로그인 인증이 만료되었거나 실패했습니다. 다시 시도해 주세요.';
 }
});

definePage(() => ({ title: '마나필드 로그인', icon: 'ti ti-link' }));
</script>
