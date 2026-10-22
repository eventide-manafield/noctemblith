# Noctemblith 0.1.1: 단독 / Manafield 통합 릴리스

같은 linux/amd64 이미지가 두 모드를 지원한다. 이미지 이름이나 설치 서버의 도메인으로 모드를 추측하지 않는다.

| 기능 | 단독: SSO 미설정 또는 false | 통합: SSO true |
|---|---|---|
| 일반 로그인 | 기존 비밀번호·패스키·설정된 MFA | Manafield OAuth+PKCE만 |
| 일반 native 로그인 API | 기존 동작 | 서버측 403 |
| 계정 생성 | 기존 가입 정책 | 검증된 중앙 UUID·고정 공개 핸들 + 최초 명시적 동의 JIT |
| 로컬 관리자 | 기존 로그인 | 미연동 서버 관리자만 /auth/local-admin 직접 진입 |
| 부모 세션 | 없음 | 원래 Account Core 브라우저 세션 하나 |
| 모듈 로그아웃 | 기존 동작 | 해당 Noctemblith 브라우저 세션만 철회 |
| 중앙 로그아웃 | 적용 안 됨 | 같은 부모에서 발급한 모든 자식 철회; 다른 부모와 로컬 관리자 유지 |

## 설정

독립 설치에는 Manafield 환경변수·중앙 토큰·중앙 서비스 접근 권한이 필요하지 않다. 통합 설치는 기존 PostgreSQL/Redis/미디어 설정에 다음을 추가한다.

```ini
NOCTEMBLITH_MANAFIELD_SSO_ENABLED=true
NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN=https://accounts.example.org
NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID=noctemblith-example
NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL=https://social.example.org/auth/manafield/callback
NOCTEMBLITH_MANAFIELD_BACKCHANNEL_SECRET_FILE=/run/secrets/noctemblith-backchannel
```

마지막 항목은 새 필수 설정이다. 충분히 무작위인 32–512바이트 전용 키를 파일로 주입한다. 키 값은 env·이미지·Git·로그에 넣지 않는다. Noctemblith UID 991이 읽는 RO 파일로 제공한다. 각 OAuth client마다 다른 키를 사용한다. Account Core에는 같은 키를 UID 65532가 읽을 수 있게 별도로 RO 주입한다. 예시 도메인은 실제 공개 HTTPS 주소로 바꾼다.

Core는 기존 `MANAFIELD_ACCOUNT_OAUTH_CLIENTS_JSON`에 정확한 callback을 등록하고 다음을 설정한다.

```json
{"noctemblith-example":{"url":"https://social.example.org/auth/manafield/backchannel/logout","secret_file":"/run/secrets/noctemblith-backchannel"}}
```

위 JSON을 `MANAFIELD_ACCOUNT_OAUTH_BACKCHANNELS_JSON` 값으로 지정한다. URL은 해당 client의 등록 callback과 같은 HTTPS origin 및 고정 backchannel 경로여야 한다. 다른 host·HTTP·redirect·브라우저 입력 URL을 허용하지 않는다. Core는 backchannel이 등록되지 않은 client에 중앙 세션 guard를 발급하지 않는다.

Ingress는 기존 OAuth 경로와 `/auth/manafield/backchannel/logout`의 서버 간 전달을 허용해야 한다. 후자는 같은 키의 HMAC·audience·시간·Redis nonce 검증을 요구한다. Core의 `/account/oauth/session-guard` 및 `/account/oauth/session-guard/status`도 모듈에서 접근할 수 있어야 한다. 공개 프로필 안내는 서버가 검증한 Account origin으로 생성한다.

## 설치 순서와 데이터

1. Account Core DB를 백업하고 새 Core 이미지를 적용한다. `oauth_session_guards`, `oauth_session_logout_outbox` 테이블과 guard 삭제·계정 비활성화 트리거가 추가된다. Profile 이미지는 기존 호환 버전을 사용한다.
2. client 등록·서버 간 HTTPS 접근·키 파일을 준비한다. 통합 Module 선언은 `deploy/manafield/integrated.module.json`을 사용하고 Account OAuth 및 session-guard capability를 명시적으로 Binding한다. 이것만으로 SSO가 자동 활성화되지는 않는다.
3. Noctemblith 설정을 준비하고 새 digest를 적용한다. Noctemblith DB migration은 추가하지 않는다. 이전 guard 없는 mfs1 세션은 다시 로그인해야 한다. 기존 로컬 관리자 자격증명·MFA와 DB·origin을 보존한다.
4. 검증한 source SHA·이미지 digest·모드와 결과를 릴리스 images.lock.json으로 확인한다. Nexus에서 소스를 빌드하지 않는다.

Core outbox는 부모 세션과 guard 삭제의 같은 DB 트랜잭션에 생성된다. 실패한 전달은 영속 상태로 남아 최대 5분 간격으로 재시도한다. 전달이 늦거나 Core가 응답하지 않아도 인증 요청과 통합 WebSocket 보호 메시지는 중앙 활성 상태 확인에 실패하면 거부한다. 비활성 소켓 정리는 별도 주기 검사도 수행한다. 이 검증은 Core 가용성과 부하에 영향을 받으며, 정상 인증을 위해 Core·PostgreSQL·Redis가 필요하다.

## 권한 계정과 기존 미연동 계정

로컬 관리자 예외는 활성·미연동 서버 관리자(root 포함)에 한정한다. 모더레이터 권한만으로는 사용할 수 없다. 별도 nla1 브라우저 세션도 철회·만료·관리자 권한 상실·중앙 연결·기존 계정 토큰 재발급 시 거부된다. 일반 화면·메뉴·푸터에는 관리자 링크를 제공하지 않는다.

**중앙 연결 관리자·모더레이터의 추가 MFA/step-up은 이번 릴리스에서도 지원하지 않는다.** 해당 계정의 SSO와 새로운 중앙 연결을 차단하며, 일반 세션 발급 후 권한이 생겨도 기존 세션을 계속 허용하지 않는다. 관리자 예외로 이를 우회하지 않는다. 서버마다 미연동 로컬 복구 관리자를 확보한다. 중앙에 연결된 권한 계정의 별도 이관·복구는 운영 검토가 필요하다.

기존 미연동 일반 계정은 통합 모드에서 native 로그인으로 우회할 수 없다. UUID·공개 핸들이 같다는 이유로 자동 연결하지 않는다. 기존 연결은 유지하고, 신규 충돌 계정은 관리자에게 소유권 확인·이관을 문의하도록 안내한다. 관리자 보조 계정 연결 기능은 이번 릴리스에 추가하지 않는다.

## 롤백

기존 이미지 digest·설정·DB 백업을 보관한다. 중앙 guard가 없는 구 Core로 Noctemblith를 먼저 내리면 일반 통합 로그인이 실패하므로 버전 조합을 임의로 섞지 않는다. 구 Noctemblith는 일반 native 로그인 차단 정책을 충족하지 않으므로 보안상 동등한 롤백 대상이 아니다. 구 릴리스 복원은 운영자가 로그인 노출 정책과 기존 세션 처리까지 검토해야 한다. DB 테이블·트리거를 임의 삭제하지 않는다.

이 문서는 새 소스의 동작과 배포 계약이다. 기존 Studio·Nexus 배포 완료를 의미하지 않는다. 실제 검사 결과와 게시 digest는 릴리스 산출물에 별도로 기록한다.

## Jenkins 없는 이미지 제작

확정 커밋의 깨끗한 archive를 별도 디렉터리에 추출하고 기존 Dockerfile로 빌드한다. 자격증명이나 인스턴스 파일이 있는 개발 디렉터리 전체를 컨텍스트로 사용하지 않는다.

```sh
release_sha=$(git rev-parse HEAD)
docker buildx build --load --provenance=false --platform linux/amd64 --target runner \
  --build-arg NOCTEMBLITH_BUILD_SHA="$release_sha" \
  --build-arg NOCTEMBLITH_UPDATE_CHANNEL=noctemblith/dev \
  --label org.opencontainers.image.version=0.1.1 \
  --label org.opencontainers.image.revision="$release_sha" \
  --label org.opencontainers.image.source=https://github.com/eventide-manafield/noctemblith \
  --tag "ghcr.io/eventide-manafield/noctemblith:sha-$release_sha" .
```

검증 후 새 커밋 태그와 새 버전 태그만 게시하고 `0.1.0`, 기존 SHA 태그, `latest`는 덮어쓰지 않는다. Nexus는 게시된 digest만 Pull한다.
