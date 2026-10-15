# Manafield–Noctemblith 신규 계정 생성 — 개발 환경

**상태:** 코드 및 회귀 테스트 단계. 배포/실제 브라우저 가입 검증 여부는 별도로 기록해야 함.
**필독:** `/opt/manafield/ai-workspace/local-modules/manafield-noctemblith/docs/ACCOUNT_INTEGRATION_POLICY.md`가 이 문서보다 우선한다.

## 목적 및 실행 경계

- `noctemblith-only.manafield.studio`: Noctemblith **독립 실행**, native 가입/로그인은 기존 방식 유지. `NOCTEMBLITH_MANAFIELD_SSO_ENABLED=false`.
- `noctemblith-dev.manafield.studio`: **마나필드 적용 환경**, 중앙 Account Core의 검증된 UUID와 불변 canonical lowercase 핸들을 요구. SSO opt-in 플래그를 명시적으로 `true`로 지정.
- 독립 설치와 적용 환경은 DB/Redis/미디어/ActivityPub origin을 공유하지 않는다. 동일 immutable 이미지에서 플래그 차이에 의한 회귀를 비교한다.

## 신규 가입 (JIT) 흐름

1. 로그인 화면 **마나필드 계정으로 시작하기** → 기존 PKCE S256 + 1회성 state + 브라우저별 HttpOnly 쿠키.
2. Account Core의 `userinfo`로 활성 계정 UUID `sub`와 중앙 불변 핸들을 서버에서 검증한다.
3. 이미 연결된 Noctemblith 계정은 UUID+핸들 일치 검사 후 기존 SSO 로그인.
4. 같은 핸들의 기존 로컬 계정이 있으면 **연결 필요**로 중단. username 일치만으로 소유권 주장 불가.
5. 처음 가입하는 신원은 Redis에 **5분 만료** 일회용 가입 대기를 만들고, 독립 HttpOnly 쿠키만 보낸다. 중앙 인증 토큰은 Redis에서만 짧게 보관하며 브라우저에 반환하지 않는다.
6. 브라우저에 서버가 결정한 `@공통핸들@인스턴스`와 공개 ActivityPub 전파/보존 안내를 표시한다. **동의 체크를 하지 않으면 생성하지 않는다.**
7. `POST /auth/manafield/provision/confirm`에서 같은 출처·쿠키·명시적 동의를 검증하고 대기 증명을 원자적으로 소비한다. Account Core `userinfo` 재호출로 중앙 활성 신원과 핸들을 다시 확인한다.
8. Misskey `SignupService.signup`으로 로컬 사용자·프로필·키페어를 만들며 **동일 PostgreSQL 트랜잭션 내부에서** `manafield_identity_link` UUID 바인딩까지 수행한다. 충돌 시 원자적으로 롤백된다.
9. 자체 로컬 비밀번호는 사용자에게 발급하지 않고 임의의 높은 엔트로피 비밀번호를 내부 해시로만 생성한다. 반환된 브라우저용 1회성·1분 티켓을 **같은 출처 POST**로 교환해 기존 Noctemblith 로그인 세션을 만든다.

## 적용 환경의 네이티브 우회 차단 범위

`NOCTEMBLITH_MANAFIELD_SSO_ENABLED=true`에서 `/api/signup`, `/api/signup-pending`, `admin/accounts/create`를 백엔드에서 거절한다. 기존 초대권·관리자 경로로 중앙 계정 없이 신규 로컬 사용자를 생성할 수 없도록 하는 **이번 단계의 방어**다. SSO용 내부 생성은 별도 서버 인증 이후에만 가능하다.

신규 최초 관리자 설치에는 기존 운영자 초기화 절차가 선행되어야 한다. 설정되지 않은 인스턴스에서 JIT로 자동 root 계정이 탄생하지 않도록 생성 전 `meta.rootUserId` 존재를 확인한다.

## 아직 구현·검증되지 않은 목표 정책

- 기존 로컬 네이티브 로그인으로 중앙 Manafield 세션을 발급하는 **역방향 로그인** 및 관리자 MFA/step-up.
- 기존 비밀번호/패스키 로컬 로그인을 통해 중앙 계정 연결 없이 인증된 기능을 사용하는 **과도기적 우회**를 완전히 차단하는 세션/권한 정책. 이 단계만으로 전체 계정통합 보안 정책이 완료된 것은 아니다.
- 로그인된 로컬 세션의 중앙 계정 비활성화/삭제/로그아웃 시 철회 전파 정책 및 시점.
- 실사용자 Central OAuth → 동의 → 새 ActivityPub actor → 로그인 → federation end-to-end 개발환경 검증.

**운영 및 독립 인스턴스에 자동 반영하지 말 것.** 독립 실행 네이티브 가입/로그인, 중앙 장애 fail-closed, UUID+핸들 충돌, 기존 사용자의 양쪽 소유권 증명, 다중 동시가입과 미동의/만료를 별도로 테스트해야 한다.
