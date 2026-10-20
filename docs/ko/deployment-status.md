# 녹템블리스 현재 배포·검증 현황

[문서 목록](../README.md)

- 기준 시각: **2026-10-19 16:00 KST**
- 대상: **마나필드 적용 개발 인스턴스**
- 공개 주소: **https://noctemblith-dev.manafield.studio**
- 이 문서는 해당 시점에 확인한 실제 배포 기록입니다. 기능 명세 전체나 운영 환경 출시 선언이 아닙니다.

## 1. 현재 실행 버전

| 항목 | 확인 내용 | 근거 |
|---|---|---|
| 공개 실행 커밋 | `fdabde539776ee0be6c7e5f32dc4530dfe061a0b` | 공개 `/noctemblith-build.json` 응답 |
| 빌드 채널 | `noctemblith/dev` | 같은 빌드 정보 응답 |
| 릴리스 설정의 고정 이미지 ID | `sha256:2617f69bbacf365fb2a84721a3d496f49958a6dede59f3de373ace8021393b00` | 현재 네이티브 릴리스의 `modules.compose.yml` |
| 공개 헬스체크 | `GET /healthz` → HTTP 200 | 기준 시각에 재조회 |
| SSO 활성 상태 | `GET /auth/manafield/status` → HTTP 200, `{"enabled":true}` | 기준 시각에 재조회 |

빌드 정보 응답은 다음과 같습니다.

```json
{"sha":"fdabde539776ee0be6c7e5f32dc4530dfe061a0b","channel":"noctemblith/dev"}
```

현재 공개 실행 커밋과 저장소 HEAD는 일치합니다. README 정리와 한국어 문서는 작업 폴더의 미커밋 변경입니다. 소스를 커밋·푸시한 것만으로 공개 서버의 이미지가 바뀌지는 않습니다.

## 2. 현재 배포 구성

본체는 기존 Manafield Compose 프로젝트에 네이티브 모듈로 연결되어 있습니다.

| 구분 | 구성 |
|---|---|
| Compose 프로젝트 | `manafield` |
| 앱 서비스 | `module-noctemblith` |
| 앱 컨테이너 이름 | `manafield-module-noctemblith-1` — 운영자 배포 로그 기준 |
| 네이티브 릴리스 | `/opt/manafield/ai-workspace/instance/releases/native-20261019T005014Z` |
| Compose 파일 | 릴리스의 `compose.yml`, `modules.compose.yml` |
| 공개 라우팅 | Traefik → `http://noctemblith-native:8080` |
| 공개 네트워크 별칭 | `noctemblith-native` |
| 앱 네트워크 | `modules`, `edge` |
| 공개 origin | `https://noctemblith-dev.manafield.studio` |

기준 시각에는 공개 HTTPS 응답, 릴리스 설정 파일, Traefik 동적 라우트를 읽어 확인했습니다. 연결 계정에는 Docker 소켓 권한이 없으므로, 컨테이너의 실시간 `docker inspect`나 `docker ps`를 새로 실행한 기록은 아닙니다.

### 필수 Resource 바인딩

[모듈 매니페스트](../../manafield.module.json)는 다음 세 Capability를 필수로 선언합니다. 리소스 ID는 현재 릴리스 설정에서 확인했습니다.

| 슬롯 | Capability | 현재 Resource ID | 용도 |
|---|---|---|---|
| `state` | `database.postgresql@^1.0.0` | `manafield-postgres` | 계정·게시글·설정 등 영구 상태. 기존 PG18 사용 |
| `media` | `storage.object@^1.0.0` | `manafield-r2` | S3 호환 R2 미디어 저장소 |
| `cache` | `cache.redis@^1.0.0` | `noctemblith-redis` | 녹템블리스 전용 Redis 캐시·작업 큐·pub/sub |

내부 기동 단계의 운영자 실행 로그에서 실제 Core의 PostgreSQL·S3·전용 Redis Resource 등록 확인이 통과했습니다. 이번 문서 작성 중 Core 등록 API를 다시 조회하지는 않았습니다.

관리형 실행에서는 리소스 바인딩과 읽기 전용 비밀 파일로 설정을 전달합니다. 기존 독립 실행용 YAML이나 DB의 저장소 설정을 임의의 대체값으로 사용하지 않는 구조입니다. R2의 S3 API endpoint와 공개 미디어 URL은 서로 다른 용도입니다.

비밀번호·OAuth 인증 코드·브라우저 토큰·R2 키·비밀 파일 내용은 이 문서에 기록하지 않습니다.

## 3. 배포된 로그인·계정 연결 구현

현재 실행 커밋의 [ManafieldSsoService](https://github.com/eventide-manafield/noctemblith/blob/fdabde539776ee0be6c7e5f32dc4530dfe061a0b/packages/backend/src/server/manafield-oauth/ManafieldSsoService.ts)를 확인했습니다.

- `NOCTEMBLITH_MANAFIELD_SSO_ENABLED=true`로 SSO가 활성화되어 있습니다.
- 일반 진입은 `/auth/manafield/login/start`에서 시작합니다. Authorization Code + PKCE S256, 일회용 state, 브라우저 연관 HttpOnly 쿠키를 사용합니다.
- Account Core의 `userinfo`에서 신원을 확인하고, 별도의 `/account/oauth/profile-handle` 응답으로 같은 UUID 소유자의 공개 핸들을 확인합니다.
- **로그인 ID와 공개 핸들은 다릅니다.** 통합 Noctemblith의 로컬 username은 검증된 공개 핸들과 일치해야 합니다.
- 기존 연결 계정은 UUID 매핑과 공개 핸들 일치를 확인한 뒤 로그인 티켓을 발급합니다.
- 같은 핸들의 미연결 로컬 계정이 있으면 자동으로 소유권을 주장하거나 새로 연결하지 않습니다.
- 신규 신원에는 가입 대기와 공개 actor 안내를 제공합니다. `POST /auth/manafield/provision/confirm`에서 명시적 동의를 확인한 뒤 신원을 재검증합니다.
- 신규 로컬 사용자 생성과 UUID 연결은 같은 PostgreSQL 트랜잭션 안에서 수행합니다. 최초 관리자 설정이 없는 인스턴스에서는 일반 JIT 가입으로 root를 만들지 않습니다.
- 브라우저는 일회용 티켓을 동일 출처 POST로 교환합니다. 장기 브라우저 로그인 토큰을 URL에 넣지 않습니다.
- SSO 활성 환경의 `/api/signup`, `/api/signup-pending`은 `manafield_account_required`로 거부하는 코드가 배포 커밋에 있습니다.
- 권한 계정의 SSO 완료 단계에는 로컬 로그인 필요 검사가 있습니다. `roleService.isModerator(local)`가 참이면 `privileged_account_requires_local_login`으로 거부합니다. 중앙 MFA/step-up을 완료한 것으로 해석하지 않습니다.

### 방문·가입 화면

현재 배포에는 다음 화면 수정이 포함됩니다.

- 초기 HTML의 기본 브랜드 이름과 로고를 Noctemblith로 표시합니다. 인스턴스가 명시적으로 설정한 이름·아이콘은 유지합니다.
- 방문 화면과 가입 다이얼로그는 SSO 상태를 조회합니다.
- 명시적으로 SSO가 활성화되어 있으면 마나필드 진입 안내를 제공합니다.
- 상태 조회 중이거나 실패한 경우 일반 가입 폼으로 자동 대체하지 않습니다.
- 명시적으로 SSO가 꺼진 독립 실행 환경에는 네이티브 가입 흐름을 유지하도록 구현되어 있습니다.

이 화면 변경은 **모든 네이티브 로그인 API를 중앙 로그인 전용으로 바꿨다는 뜻이 아닙니다.** 아래 미완료 항목과 구분해야 합니다.

## 4. 브라우저 세션과 로그아웃

현재 배포 커밋에는 다음 구현이 있습니다.

- [SigninService](https://github.com/eventide-manafield/noctemblith/blob/fdabde539776ee0be6c7e5f32dc4530dfe061a0b/packages/backend/src/server/api/SigninService.ts)는 통합 환경 로그인 시 공유 네이티브 토큰 대신 독립 브라우저 세션 토큰을 발급합니다.
- [ManafieldSessionService](https://github.com/eventide-manafield/noctemblith/blob/fdabde539776ee0be6c7e5f32dc4530dfe061a0b/packages/backend/src/server/manafield-oauth/ManafieldSessionService.ts)는 `mfs1_` 토큰의 SHA-256 해시를 Redis 키로 저장하며 30일 만료를 사용합니다.
- [AuthenticateService](https://github.com/eventide-manafield/noctemblith/blob/fdabde539776ee0be6c7e5f32dc4530dfe061a0b/packages/backend/src/server/api/AuthenticateService.ts)는 통합 브라우저 세션을 Redis에서 확인하고, 기존 공유 네이티브 토큰의 일반 API 인증을 거부합니다.
- `POST /auth/manafield/session/logout`은 제출된 브라우저 세션을 철회합니다. Account Core의 중앙 세션을 종료하는 API가 아닙니다.
- StreamingApiServerService에도 브라우저 세션 활성 상태를 재확인하는 코드가 있습니다.

**소스에 포함된 것과 실제로 검증한 범위는 다릅니다.** 단일 브라우저에서 로그아웃·재로그인하는 흐름은 사용자가 확인했습니다. 기기 A만 철회되는지, 기기 B가 유지되는지, 기존 WebSocket이 철회 후 닫히는지, Redis 장애 시 어떻게 동작하는지는 이번 사용자 검증에 포함되지 않았습니다.

## 5. 완료된 검증

### 운영자 실행 로그로 확인한 내용

최신 빌드·배포는 **2026-10-19 15:59 KST**에 완료되었습니다. 운영자 로그에서 정확한 새 이미지, 변경 없는 마이그레이션, 앱 서비스만 교체, 공개 HTTPS·빌드·SSO 상태 확인이 모두 통과했습니다.

- 네이티브 앱을 기존 PG18·R2·전용 Redis에 연결하고 Core에 Resource를 등록했습니다.
- 공개 주소를 새 네이티브 앱으로 전환하고 정확한 빌드·HTTPS health·SSO 활성 상태를 확인했습니다.
- 이후 이미지 교체에서는 `module-noctemblith`만 대상으로 삼았습니다.
- 기존 Account 이미지, PostgreSQL 데이터, 리소스 바인딩을 유지하도록 검증한 배포 절차를 사용했습니다.
- 운영자 로그상 기존 `noctemblith-dev` 앱·DB·Redis는 공개 전환 뒤 중지되었으며 당시 데이터·볼륨은 보존되었습니다. 이후 별도 삭제 여부는 이번에 확인하지 않았습니다.

### 사용자 브라우저 검증 — 2026-10-19 확인 보고

사용자는 이전 실행 버전 `c6136c016fff42f7095c87d907830e63e7e17540`에서 다음 네 단계를 모두 통과했다고 보고했습니다.

| 항목 | 확인 범위 |
|---|---|
| 첫 화면 | 초기 탭 제목·로고 브랜딩, 마나필드 가입·로그인 안내 |
| 마나필드 로그인 | 인증 후 Noctemblith 복귀, 공개 핸들 일치, 새로고침 후 로그인 유지 |
| 글·미디어 | 테스트 글과 이미지 업로드, 새로고침 후 조회, 글과 드라이브 파일 삭제 |
| 모듈 로그아웃 | 로그아웃 후 비로그인 상태, 다시 마나필드 로그인으로 진입 |

이는 **사용자가 수행하고 완료를 보고한 브라우저 검증 기록**입니다. 에이전트가 별도로 같은 브라우저 작업을 재실행한 기록이 아닙니다. R2 원본 객체의 삭제 여부를 S3 API로 직접 조회한 별도 검사도 이번 기록에는 포함되지 않습니다.

최신 `fdabde539776`은 이 검증 버전에서 인증 화면의 아이콘 클래스 두 곳만 수정한 커밋입니다. 두 클래스가 같은 코드 포인트 `U+F554`를 가리키는지, Vue 컴파일과 변경 파일 린트가 통과하는지는 배포 전에 확인했습니다. **새 버전에서 네 단계의 브라우저 E2E를 다시 수행했다는 보고는 아직 없습니다.** 최신 배포에서는 HTTPS health·정확한 빌드·SSO 활성 상태를 운영자 도구와 공개 조회로 확인했습니다.

### 문서 작성 시 재확인 — 2026-10-19 16:00 KST

- 공개 health HTTP 200
- 공개 빌드 정보 HTTP 200 및 정확한 `fdabde539776ee0be6c7e5f32dc4530dfe061a0b`
- SSO 상태 HTTP 200 및 `enabled: true`
- 릴리스 설정의 이미지 ID·공개 origin·세 리소스 대상
- Traefik의 `noctemblith-native:8080` 연결

## 6. 추가 변경과 남은 작업

| 항목 | 현재 상태 |
|---|---|
| 아이콘 대표 이름 정리 | `fdabde539776ee0be6c7e5f32dc4530dfe061a0b`로 커밋·푸시하고 **배포했습니다**. 비밀번호 확인창과 TOTP 로그인 화면의 `ti-123`을 `ti-number-123`으로 변경했습니다. |
| README 한국어 정리·후원 링크 | 작업 폴더에서 수정했고 아직 커밋하지 않았습니다. |
| 한국어 배포 현황 문서 | 이 문서에서 현재 상태를 먼저 기록합니다. 과거 문서의 전체 번역·영문 재작성은 별도 작업입니다. |
| 중앙 로그아웃 전파 | 중앙 브라우저 세션에서 파생된 모듈 세션 전체를 철회하는 목표는 **현재 배포 완료로 보지 않습니다**. |
| 통합 환경 일반 로그인의 SSO 전용 강제 | 전체 네이티브 비밀번호·패스키 우회 차단과 별도 관리자 정책은 현재 배포 완료로 보지 않습니다. |
| 숨겨진 관리자 진입 경로 | `/auth/local-admin` 구현 후보는 별도 작업 영역에 있으며 현재 실행 커밋에는 없습니다. |
| 권한 계정 중앙 MFA/step-up | 완료되지 않았습니다. 현재 SSO 권한 계정 차단을 MFA 연동 완료로 보지 않습니다. |
| Jenkins·active Instance 승격 | 별도 단계입니다. 현재 네이티브 앱 교체 완료와 자동 배포 경로 정비를 같은 것으로 취급하지 않습니다. |
| 연합·장애·다기기 검증 | 실제 외부 서버와의 연합, 동시 가입, 충돌·철회·장애·다기기 흐름의 전수 E2E는 이번 사용자 확인 범위 밖입니다. |

아이콘 경고는 그대로 유지합니다. Tabler 3.35.0의 공식 별칭 때문에 `ti-package`/`ti-box-seam`, `ti-code-asterisk`/`ti-code-asterix`, `ti-number-123`/`ti-123`이 각각 같은 글리프를 가리킵니다. 애플리케이션 코드에서 대표 이름을 사용해도 원본 폰트 CSS의 별칭은 남으므로 `Maybe it's deprecated?` 경고가 계속 출력될 수 있습니다. 이 문구는 공식 사용 중단 메타데이터를 조회한 결과가 아닙니다.

이번 빌드에는 Dockerfile 54·77행의 `RedundantTargetPlatform` 경고 두 건도 남아 있습니다. 기본값과 같은 `--platform=$TARGETPLATFORM` 지정에 대한 경고이며, 빌드·배포 실패로 처리되지 않았습니다.

## 7. 독립 인스턴스와 운영 경계

- `https://noctemblith-only.manafield.studio`는 독립 실행 검증 환경입니다. 통합 개발 인스턴스와 별도 Compose 프로젝트·DB·Redis·미디어·origin을 사용합니다.
- 이번 네이티브 이미지 교체는 독립 인스턴스를 대상으로 하지 않았습니다.
- 독립 인스턴스가 현재 통합 환경과 같은 이미지인지, 같은 브라우저 검증을 통과하는지는 이번 문서 작성에서 재확인하지 않았습니다.
- 이미 사용 중인 ActivityPub origin을 문서 수정이나 이미지 업데이트에 맞추어 바꾸지 않습니다.
- 이 문서 작성은 DB·볼륨 초기화, 키 교체, 공개 경로 변경을 수행하거나 허가하는 작업이 아닙니다.

## 8. 읽기 전용 재확인 방법

다음 명령은 공개 상태를 읽기만 합니다. 로그인을 수행하거나 테스트 데이터를 생성하지 않습니다.

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://noctemblith-dev.manafield.studio/healthz
curl -fsS -H 'Cache-Control: no-cache' https://noctemblith-dev.manafield.studio/noctemblith-build.json
curl -fsS -H 'Cache-Control: no-cache' https://noctemblith-dev.manafield.studio/auth/manafield/status
```

실행 커밋을 판단할 때는 로컬 `git log`나 이미지 태그만 보지 말고 공개 빌드 응답을 확인해야 합니다. `enabled: true` 응답만으로 로그인·계정 연결·로그아웃의 전체 보안 정책이 검증된 것은 아닙니다.

## 9. 운영자용 배포·복구 기록

현재 네이티브 릴리스:

```text
/opt/manafield/ai-workspace/instance/releases/native-20261019T005014Z
```

현재 실행 커밋으로 교체한 운영자 실행 로그에 기록된 복구 디렉터리:

```text
/opt/manafield/ai-workspace/instance/releases/native-20261019T005014Z/image-update-20261019T065911Z-b75097
```

해당 빌드·배포 결과 파일:

```text
/opt/manafield/ai-workspace/instance/builds/noctemblith-fdabde539776-20261019T065742Z-19ff5c/result.json
```

위 경로는 운영자 로그에서 확인했습니다. 비공개 복구 파일의 내용은 이번 문서 작성에서 읽지 않았습니다.

`instance/current` 심볼릭 링크는 기준 시각에 `releases/24`를 가리켰습니다. 공개 네이티브 앱 릴리스와 같은 경로라고 가정해서는 안 됩니다. active Instance/Jenkins 승격을 확인하지 않은 채 이 링크를 기준으로 재배포하면 안 됩니다.

이미지 교체 도구는 배포할 커밋·트리·이미지 ID, 현재 공개 라우트와 바인딩, 마이그레이션 파일 동일성을 확인하고 앱 서비스만 교체하도록 구성되어 있습니다. 실패 시 이전 앱 이미지 복구를 시도하고 결과를 남깁니다. 이미지 복구가 DB 마이그레이션을 되돌린다는 뜻은 아닙니다.

## 10. 이 기록을 갱신하는 방법

1. 실제 배포 후 공개 빌드 SHA, 고정 이미지 ID, 확인 시각을 갱신합니다.
2. 소스 포함·배포 완료·자동 검사·사용자 브라우저 확인을 각각 구분합니다.
3. 미검증 항목은 재현 가능한 확인 결과가 생긴 경우에만 완료로 바꿉니다.
4. 계정·바인딩·origin·데이터 보존 정책이 바뀌면 영향 범위와 확인 근거를 함께 기록합니다.
5. 한국어 문서를 먼저 수정합니다. 사용자가 내용을 정리한 뒤 해당 기준에 맞추어 영문 문서를 갱신합니다.

`docs/`의 기존 문서는 여러 개발 단계의 설계와 구현 후보를 담고 있습니다. 기존 문서의 “기반 구현만 존재”, “미배포”, “네이티브 가입·로그인 유지” 같은 설명을 현재 전체 배포 상태로 그대로 인용하지 말고, 이 기록의 실행 커밋과 검증 범위를 먼저 확인해 주세요.
