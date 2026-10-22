<!--
SPDX-FileCopyrightText: Noctemblith contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_m" style="max-width: 520px; margin: 4rem auto; padding: 24px;">
 <h1>마나필드 로그인</h1>
 <p role="status">{{ message }}</p>
 <div v-if="handleRequired" class="_gaps_m">
  <p>마나필드 공개 프로필 핸들이 아직 등록되지 않았습니다. 먼저 마나필드에서 핸들을 최초 등록해 주세요. 등록한 공개 핸들은 녹템블리스 사용자명과 ActivityPub 주소로 사용되며, 등록 후에는 직접 변경할 수 없습니다.</p>
  <a v-if="manafieldProfileUrl" :href="manafieldProfileUrl">마나필드 공개 프로필 핸들 등록하기</a>
  <p>등록을 마친 뒤 이 페이지로 돌아와 마나필드 계정으로 다시 로그인해 주세요.</p>
 </div>
 <div v-if="signupAvailable" class="_gaps_m">
  <p><strong>생성할 계정:</strong> {{ signupActor }}</p>
  <p>마나필드에서 최초 등록한 공개 프로필 핸들을 녹템블리스 계정 주소로 사용합니다. 마나필드 로그인 ID와 다를 수 있으며, 녹템블리스에서 임의로 변경할 수 없습니다.</p>
  <p>이 계정은 다른 ActivityPub 서버에서도 검색하거나 팔로우할 수 있는 공개 연합 신원입니다. 작성한 공개 게시물과 프로필은 다른 서버로 전달될 수 있으며, 마나필드 계정을 삭제해도 다른 서버에 전달된 기록이 자동으로 삭제되는 것은 아닙니다.</p>
  <p>마나필드에서 인증된 공통 핸들로만 계정이 생성되며, 녹템블리스 전용 비밀번호는 따로 발급되지 않습니다.</p>
  <label>
   <input v-model="signupConsent" type="checkbox" :disabled="signupBusy">
   공개 ActivityPub 계정 생성과 위 내용을 이해했으며, 계정 생성에 동의합니다.
  </label>
  <MkButton primary :disabled="!signupConsent || signupBusy" @click="confirmProvision">
   {{ signupBusy ? '계정을 생성하는 중입니다…' : '동의하고 녹템블리스 계정 생성' }}
  </MkButton>
 </div>
 <MkA to="/">Noctemblith로 돌아가기</MkA>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { login } from '@/accounts.js';
import { isValidManafieldLoginToken } from '@/utility/manafield-login-token.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';

const message = ref('로그인 인증을 완료하는 중입니다…');
const signupAvailable = ref(false);
const handleRequired = ref(false);
const manafieldProfileUrl = ref<string | null>(null);
const signupActor = ref('');
const signupConsent = ref(false);
const signupBusy = ref(false);

async function completeLogin(ticket: string): Promise<void> {
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
 if (result.finished !== true || !isValidManafieldLoginToken(result.i)) {
  throw new Error('invalid_login_response');
 }
 await login(result.i, '/');
}

async function loadProvision(): Promise<void> {
 try {
  const response = await window.fetch('/auth/manafield/provision/status', {
   method: 'POST', credentials: 'same-origin', cache: 'no-store',
   headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!response.ok) throw new Error('expired_provision');
  const data = await response.json() as { actor?: unknown };
  if (typeof data.actor !== 'string' || !/^@[a-z0-9_]{1,20}@[a-z0-9.-]+$/.test(data.actor)) {
   throw new Error('invalid_actor');
  }
  signupActor.value = data.actor;
  signupAvailable.value = true;
  message.value = '마나필드 계정 인증이 완료되었습니다. 아래 안내를 확인한 뒤 녹템블리스 계정을 생성할 수 있습니다.';
 } catch {
  message.value = '계정 생성 인증이 만료되었거나 유효하지 않습니다. 마나필드 계정으로 다시 로그인해 주세요.';
 }
}

async function confirmProvision(): Promise<void> {
 if (!signupConsent.value || signupBusy.value) return;
 signupBusy.value = true;
 try {
  const response = await window.fetch('/auth/manafield/provision/confirm', {
   method: 'POST', credentials: 'same-origin', cache: 'no-store',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ consent: true }),
  });
  if (!response.ok) throw new Error('provision_failed');
  const payload = await response.json() as { ticket?: unknown };
  if (typeof payload.ticket !== 'string') throw new Error('no_login_ticket');
  signupAvailable.value = false;
  message.value = '계정이 생성되었습니다. 로그인을 완료하는 중입니다…';
  await completeLogin(payload.ticket);
 } catch {
  signupAvailable.value = false;
  message.value = '계정 생성을 완료하지 못했습니다. 계정이 이미 존재하거나 인증이 만료되었을 수 있습니다. 마나필드 계정으로 다시 로그인해 주세요.';
 } finally {
  signupBusy.value = false;
 }
}

onMounted(async () => {
 const uri = new URL(window.location.href);
 const ticket = uri.searchParams.get('ticket');
 const status = uri.searchParams.get('status');
 // Clear short-lived credentials from browser history and referrers immediately.
 window.history.replaceState(window.history.state, '', '/auth/manafield/finish');
 if (!ticket && status === 'signup') {
  await loadProvision();
  return;
 }
 if (!ticket) {
  handleRequired.value = status === 'handle-required';
  if (handleRequired.value) {
   try {
    const response = await window.fetch('/auth/manafield/status', { credentials: 'same-origin', cache: 'no-store' });
    if (response.ok) {
     const settings = await response.json() as { enabled?: boolean; accountProfileUrl?: string | null };
     if (settings.enabled && typeof settings.accountProfileUrl === 'string') {
      manafieldProfileUrl.value = settings.accountProfileUrl;
     }
    }
   } catch {
    // Keep the guidance visible without inventing a fallback Account origin.
   }
  }
  message.value = status === 'handle-required'
   ? '녹템블리스 계정을 이용하려면 마나필드 공개 프로필 핸들을 먼저 등록해야 합니다.'
   : status === 'unlinked'
   ? '같은 핸들의 기존 Noctemblith 계정이 이미 있어 신규 계정을 생성할 수 없습니다. 기존 계정으로 로그인한 뒤 설정 → 서비스 연동에서 두 계정의 소유권을 확인하고 연결해 주세요.'
   : status === 'denied'
   ? '마나필드 인증이 취소되었습니다.'
   : '마나필드 로그인을 완료하지 못했습니다.';
  return;
 }
 try {
  await completeLogin(ticket);
 } catch {
  message.value = '로그인 인증이 만료되었거나 실패했습니다. 다시 시도해 주세요.';
 }
});

definePage(() => ({ title: '마나필드 로그인', icon: 'ti ti-link' }));
</script>
