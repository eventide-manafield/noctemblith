/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Locale } from './autogen/locale.js';

// Only current-product copy is changed. Protocol keys, upstream credits,
// donation destinations and achievement conditions remain unchanged.
const productCopyKeys = [
  "introMisskey",
  "poweredByMisskeyDescription",
  "initialPasswordForSetupDescription",
  "aboutMisskey",
  "useSoundOnlyWhenActive",
  "scratchpadDescription",
  "misskeyUpdated",
  "invalidParamErrorDescription",
  "goToMisskey",
  "_initialAccountSetting.youCanContinueTutorial",
  "_initialTutorial._timeline.description1",
  "_initialTutorial._postNote.description1",
  "_initialTutorial._done.description",
  "_achievements._types._notes1.flavor",
  "_achievements._types._login1000.flavor",
  "_achievements._types._tutorialCompleted.title",
  "_role._options.maxFileSize_caption2",
  "_urlPreviewSetting.summaryProxyDescription",
  "_bootErrors.otherOption4",
  "_search.serverHostPlaceholder",
  "_serverSetupWizard.installCompleted",
  "_serverSetupWizard.howWillYouUseMisskey"
];
const koreanCopy: Record<string, string> = {
  "introMisskey": "환영합니다! 녹템블리스는 오픈소스 분산형 소셜 네트워크입니다. 노트와 리액션으로 이야기를 나누어 보세요.",
  "poweredByMisskeyDescription": "{name} 서버는 오픈소스 플랫폼 <b>녹템블리스</b>를 사용합니다. 녹템블리스는 Misskey를 기반으로 개발되었습니다.",
  "aboutMisskey": "녹템블리스에 대하여",
  "initialPasswordForSetupDescription": "직접 설치하셨다면 설정 파일에 지정한 초기 비밀번호를 입력해 주세요. 호스팅 서비스를 사용하신다면 제공받은 비밀번호를 입력해 주세요. 설정하지 않으셨다면 비워 두세요.",
  "goToMisskey": "녹템블리스로",
  "misskeyUpdated": "녹템블리스가 업데이트되었습니다!",
  "_serverSetupWizard.installCompleted": "녹템블리스 설치가 완료되었습니다!",
  "_serverSetupWizard.howWillYouUseMisskey": "녹템블리스를 어떻게 사용하시겠습니까?",
  "_bootErrors.otherOption4": "녹템블리스를 안전 모드로 열기",
  "sendErrorReportsDescription": "오류 보고를 활성화하면 관리자가 설정한 수집 대상으로 오류 정보를 전송합니다. 전송 대상과 수집 정책을 확인해 주세요."
};
const brandCopy: Record<string, Locale['_noctemblithBrand']> = {
  "en": {
    "name": "Noctemblith",
    "games": "Noctemblith Games",
    "upstreamCredits": "Upstream Misskey credits",
    "fanout": "Fan-out timeline (FTT)",
    "reactionsBoost": "Reaction boost (RBT)"
  },
  "ko": {
    "name": "녹템블리스",
    "games": "녹템블리스 게임",
    "upstreamCredits": "원작 Misskey 크레딧",
    "fanout": "타임라인 배포 최적화 (FTT)",
    "reactionsBoost": "리액션 최적화 (RBT)"
  },
  "ja": {
    "name": "Noctemblith",
    "games": "Noctemblith ゲーム",
    "upstreamCredits": "原作 Misskey のクレジット",
    "fanout": "タイムライン配信最適化 (FTT)",
    "reactionsBoost": "リアクション最適化 (RBT)"
  }
};

export function applyNoctemblithBranding(locale: Locale, language: string): void {
	const root = locale as unknown as Record<string, unknown>;
	for (const path of productCopyKeys) {
		const keys = path.split('.');
		let parent = root;
		for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
		const key = keys[keys.length - 1];
		if (typeof parent[key] === 'string') {
			parent[key] = language === 'ko' && koreanCopy[path]
				? koreanCopy[path]
				: (parent[key] as string).replaceAll('Misskey', language === 'ko' ? '녹템블리스' : 'Noctemblith').replaceAll('misskey.example', 'social.example');
		}
	}
	locale._noctemblithBrand = { ...(brandCopy[language] ?? brandCopy.en) };
	// This card still links to upstream donations; make the beneficiary explicit.
	locale.didYouLikeMisskey = `${locale._aboutMisskey.original}: ${locale.didYouLikeMisskey}`;
	locale._serverSetupWizard._donationRequest.text1 = `${locale._aboutMisskey.original}: ${locale._serverSetupWizard._donationRequest.text1}`;
	if (language === 'ko') {
		locale.didYouLikeMisskey = '원작 Misskey 개발 후원 안내';
		locale.pleaseDonate = '{host} 서버의 녹템블리스는 Misskey를 기반으로 합니다. 아래 링크는 원작 Misskey의 개발 후원 안내로 연결됩니다.' as Locale['pleaseDonate'];
		locale.i18nInfo = '원작 Misskey의 번역은 자원봉사자들이 참여하고 있습니다. {link}에서 원작 번역에 참여하실 수 있습니다.' as Locale['i18nInfo'];
		locale._serverSetupWizard._donationRequest.text1 = '녹템블리스는 원작 Misskey를 기반으로 합니다. 다음은 원작 Misskey의 개발 후원 안내입니다.';
		locale.sendErrorReportsDescription = koreanCopy.sendErrorReportsDescription;
	} else if (language === 'en') {
		locale.sendErrorReportsDescription = 'Error reports are sent to the collection service configured by your administrator. Review the destination and its collection policy before enabling this option.';
	}
}
