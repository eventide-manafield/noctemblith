# Manafield object-storage binding for Noctemblith

Noctemblith already uploads/deletes through the AWS S3 SDK. The Manafield
integration changes **where the S3 configuration comes from**, not the upload
protocol. The Module manifest explicitly requires two different Capabilities:

- `state`: `database.postgresql@^1.0.0` (required; MySQL is **not** supported)
- `media`: `storage.object@^1.0.0` (S3-compatible storage, R2 first)

The manifest is for the **Noctemblith backend application**, not for the
existing `manafield-noctite` read-only status observer. Do not replace the
observer with this manifest without validating the entire Noctemblith runtime
configuration, Redis dependency, ingress and writable paths.

## Instance resource and binding example

```yaml
resources:
  - id: manafield-postgres
    provider: postgresql
  - id: manafield-r2
    provider: s3
    config:
      endpoint: https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
      bucket: manafield-storage-r2
      region: auto
      forcePathStyle: true
      # REQUIRED for Noctemblith media URLs (use your actual public domain):
      publicBaseUrl: https://media.example.test

modules:
  - id: noctemblith
    # source / build / exposure configured by the Instance administrator
    bindings:
      state: manafield-postgres
      media: manafield-r2
```

The executor injects the `MANAFIELD_BINDING_STATE_*` PostgreSQL values and
`MANAFIELD_BINDING_MEDIA_*` storage values. In managed mode Noctemblith
**fails closed** if either declared binding is incomplete; standalone mode
retains its existing YAML and DB-backed object-storage setup.

S3 binding fields consumed by Noctemblith:

```
MANAFIELD_BINDING_MEDIA_TARGET
MANAFIELD_BINDING_MEDIA_ENDPOINT_URL
MANAFIELD_BINDING_MEDIA_CONFIG_BUCKET
MANAFIELD_BINDING_MEDIA_CONFIG_REGION
MANAFIELD_BINDING_MEDIA_CONFIG_PREFIX
MANAFIELD_BINDING_MEDIA_CONFIG_FORCE_PATH_STYLE
MANAFIELD_BINDING_MEDIA_CONFIG_PUBLIC_BASE_URL
MANAFIELD_BINDING_MEDIA_SECRET_ACCESS_KEY_ID_FILE
MANAFIELD_BINDING_MEDIA_SECRET_SECRET_ACCESS_KEY_FILE
```

The credential *values* come only from the two read-only mounted files. They
must never be committed or entered in an admin setting, DB Meta table, registry,
Build Plan, or release YAML. The effective runtime `MiMeta` contains nonsecret
storage details and NULL S3 credentials; S3Service uses binding credentials
in-memory. Changes to storage settings via the admin API are rejected while
managed, but unrelated admin settings still work.

Noctemblith needs a **public media base URL**, such as an explicitly enabled
R2 custom-domain endpoint or `r2.dev` URL. The private
`*.r2.cloudflarestorage.com` S3 API endpoint cannot serve files publicly; the
binding intentionally refuses to start without a separate public URL. The
instance operator must configure R2 public access independently. Do not send
`public-read` ACL headers to R2.

**Important:** A key prefix, e.g. `modules/noctemblith/media/`, is only a
namespacing convention, not permission isolation. The application checks the
bucket and prefix before S3 write/delete, but leaked broad bucket credentials
would still permit other operations. Only bind trusted Modules until scoped
credentials/gateway enforcement exist.

## Validation and rollout

1. Check the storage Resource's S3 permission with an authenticated **read-only**
   probe. Do not put secrets on the command line or into logs.
2. Validate that `publicBaseUrl` actually responds to public GET requests for
   a disposable test object (only with permission to create such an object).
3. Build and boot a disposable Noctemblith environment using both bindings.
   The Instance needs a PostgreSQL schema with required privileges, Redis, a
   mounted Misskey `.config/default.yml`, and suitable writable temporary paths.
4. Exercise actual image upload, download and delete with **test** files only.
5. Review the admin settings UI: S3 values are managed externally and cannot
   be edited through the admin API in managed mode.

**Current status:** library/binding code and validation tests; not a live
service deployment. The existing Manafield CLI v0 alone does not provision
Noctemblith Redis/Instance configuration. Jenkins S3 releases are still
explicitly rejected until separately implemented. Never reset the live DB,
remove a live bucket, or rotate existing keys as part of this adapter work.


### 공개 도메인 활성화 후 임시 객체 전송 검증 (명시적 실행만 허용)

R2 도메인이 활성화되어도 루트 경로의 HTTP 403/404만으로는
업로드된 파일의 공개 접근 여부를 판단할 수 없다. 실험용 객체
하나를 전송해 확인하려면 다음 명령을 관리자가 **직접 실행**한다:

```bash
sudo node \
  /opt/manafield/ai-workspace/noctemblith-r2-binding-20261016/packages/backend/scripts/check_manafield_s3_public_delivery.mjs \
  /opt/manafield/ai-workspace/instance \
  manafield-r2 \
  --write-temporary-object
```

이 명령은 테스트용 경로
`modules/noctemblith/media/.manafield-probe/<random UUID>.txt`에
한 개의 **새 객체를 쓰고**, 같은 객체를 인증된 S3 API로 조회하고,
`publicBaseUrl`에서 인증 없이 GET한 뒤 **해당 테스트 객체만 삭제**한다.
다른 객체를 변경하거나 목록을 출력하지 않는다. 삭제가 실패하면
복구에 필요한 **테스트 객체 키만** 표시한다.

마나필드가 사용자의 동의 없이 이 스크립트를 자동 실행하지 않는다.
본체 SNS 서비스 배포·프로덕션 파일 테스트와는 무관하다.
