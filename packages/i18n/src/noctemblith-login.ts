/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Locale } from './autogen/locale.js';

// Fork-owned copy; do not hand-edit Crowdin-managed translation YAML files.
export const noctemblithLoginTranslations: Record<string, Locale['_noctemblithLogin']> = {
 'ko': {
  manafield: '마나필드 계정으로 로그인',
  description: '이 서버는 마나필드 계정으로 로그인합니다.',
  localAdmin: '로컬 관리자 로그인',
  localAdminDescription: '이 서버의 마나필드 미연동 로컬 관리자 계정으로 로그인합니다.',
  unavailable: '로그인 설정을 확인하지 못했습니다. 다시 시도해 주세요.',
  unlinkedAccount: '같은 핸들의 기존 녹템블리스 계정이 있습니다. 계정 소유권 확인과 마나필드 연결을 서버 관리자에게 문의해 주세요.',
  privilegedUnavailable: '이 권한 계정은 마나필드 로그인을 완료할 수 없습니다. 서버 관리자에게 문의해 주세요.',
  localAdminUnavailable: '이 서버에서는 로컬 관리자 전용 로그인을 사용할 수 없습니다.',
 },
 'en': {
  manafield: 'Log in with Manafield',
  description: 'Use your Manafield account to log in to this server.',
  localAdmin: 'Local administrator login',
  localAdminDescription: 'Log in with an unlinked local administrator account for this server.',
  unavailable: 'Unable to check login settings. Please try again.',
  unlinkedAccount: 'An existing Noctemblith account already has this handle. Please contact your server administrator to verify ownership and link it to Manafield.',
  privilegedUnavailable: 'Manafield login is not available for this privileged account. Please contact your server administrator.',
  localAdminUnavailable: 'Local administrator login is not available on this server.',
 },
};
