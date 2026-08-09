# server-toss

Apps-in-Toss 미니앱용 NestJS REST API. 매 획 단위의 유사도 계산과 최종 제출 저장을 담당한다.

## 로컬 환경 설정

> [!INFO]
> 이 프로젝트는 pnpm과 MySQL을 사용합니다.

**MySQL이 없는 경우**

1. 프로젝트 루트로 이동합니다.
2. `pnpm infra:mysql:up` 명령으로 MySQL을 실행합니다.
3. `pnpm dev:server-toss`로 서버를 실행합니다.

**MySQL이 이미 실행 중인 경우**

1. `cp server-toss/.env.example server-toss/.env`로 `server-toss/.env` 파일을 생성합니다.
2. 실행 중인 MySQL 설정에 맞게 값을 바꿉니다.
3. 프로젝트 루트에서 `pnpm dev:server-toss` 명령으로 서버를 실행합니다.

## 부팅 흐름

`apps/api/src/main.ts`는 다음 순서로 초기화한다.

1. Nest 앱 생성 + `ZodExceptionFilter` 전역 등록 + CORS/Swagger(`/docs`) 세팅
2. 비-프로덕션에서 `MikroORM.migrator.up()` 자동 실행
3. `PromptSeedService.run()` — `prompts` / `daily_prompts`가 **둘 다 비어있을 때만** `data/promptStrokes.json`의 명시적 `date` 필드대로 시드
4. `app.listen(PORT)`

## API

요청/응답 스키마 단일 소스는 `packages/toss-shared/src/schemas/drawing.schema.ts` 이다.

| Method | Path       | Request Body                      | Response (Success)              | 에러                                |
| ------ | ---------- | --------------------------------- | ------------------------------- | ----------------------------------- |
| GET    | `/health`  | —                                 | `200 { status: "ok" }`          | —                                   |
| GET    | `/prompt`  | —                                 | `200 { promptId, strokes }`     | `404 PROMPT_NOT_FOUND`              |
| POST   | `/strokes` | `{ strokes: Stroke[] }`           | `201 Similarity`                | `400` (Zod), `404 PROMPT_NOT_FOUND` |
| POST   | `/drawing` | `{ userKey: string, strokes: … }` | `201 { drawingId, similarity }` | `400` (Zod), `404 USER_NOT_FOUND`   |

### 타입

```ts
type Stroke = {
  points: [number[], number[]]; // [xs, ys]
  color: [number, number, number]; // RGB 0-255
};

type Similarity = {
  score: number; // 0~100
  strokeMatchSimilarity: number;
  shapeSimilarity: number;
  penalty: number;
};
```

### 주요 설계

- **`promptId`는 서버가 결정한다.** `/strokes`는 클라에서 `promptId`를 받지 않고 서버가 오늘 날짜(KST)의 `daily_prompts`로 매칭 — 프롬프트 조작 방지.
- **`/strokes`는 DB에 저장하지 않는다.** 획마다 호출되므로 쓰기 부하를 피함.
- **`/drawing`는 유사도를 재계산해서 저장한다.** 클라가 보낸 유사도를 신뢰하지 않음.

### curl 예시

```sh
curl http://localhost:3001/prompt

curl -X POST http://localhost:3001/strokes \
  -H 'Content-Type: application/json' \
  -d '{"strokes":[{"points":[[10,20],[10,20]],"color":[0,0,0]}]}'

curl -X POST http://localhost:3001/drawing \
  -H 'Content-Type: application/json' \
  -d '{"userKey":"1234","strokes":[{"points":[[10,20],[10,20]],"color":[0,0,0]}]}'
```

Swagger UI: `http://localhost:3001/docs`

## 환경변수

| 변수                                                          | 설명                                                                    | 기본값              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- |
| `PORT`                                                        | 서버 포트                                                               | `3001`              |
| `LOG_LEVEL`                                                   | Pino 로그 레벨. 미설정 시 개발 `debug`, 배포 `info`                     | env별 기본값        |
| `CORS_ORIGIN`                                                 | 허용 오리진 (쉼표 구분)                                                 | `*`                 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 접속                                                              | `.env.example` 참조 |
| `DISABLE_PROMPT_CACHE`                                        | `true`면 `PromptService`의 preprocessed 메모리 캐시를 우회 (벤치마크용) | unset               |

## 로깅

- 모든 HTTP 응답은 `X-Request-Id`를 포함한다. 요청에 `X-Request-Id`가 있으면 재사용하고, 없으면 서버가 UUID를 생성한다.
- 개발환경은 `pino-pretty`로 콘솔에 출력하고, 배포환경은 Docker `json-file` 로그 로테이션으로 JSON stdout을 파일 보관한다.
- 인증 헤더, 쿠키, Toss access token, authorizationCode, raw strokes, 복호화된 개인정보는 로그에 남기지 않는다.

## 테스트 / 벤치마크

```sh
pnpm --filter server-toss test

# POST /strokes 엔드-투-엔드 지연 (warmup 20, 샘플 200, 순차)
node server-toss/scripts/bench-strokes.mjs

# preprocessStrokes() 단독 비용
node server-toss/scripts/bench-preprocess.mjs
```

- `BENCH_WARMUP`, `BENCH_N`, `BENCH_URL` 환경변수로 조정 가능.
- 캐시 off/on 비교: `DISABLE_PROMPT_CACHE=true pnpm --filter server-toss start:dev`로 재기동 후 동일 벤치 실행.

## GCP 런타임 분리

`server-toss`는 하나의 워크스페이스에서 세 실행 단위를 빌드한다. 도메인·ORM·공유 계약은 같은 버전으로 유지하고, GCP에서만 독립적으로 배포·확장한다.

| 실행 단위     | 명령                                                            | GCP 대상                              |
| ------------- | --------------------------------------------------------------- | ------------------------------------- |
| API           | `node dist/apps/api/src/main.js`                                | Cloud Run Service                     |
| Point Worker  | `node dist/apps/point-worker/src/entrypoint.js`                 | 크기 1의 zonal Managed Instance Group |
| migration     | `pnpm run migration:up --config mikro-orm.migration.config.cjs` | Cloud Run Job                         |
| 콘텐츠 동기화 | `node dist/apps/maintenance/src/main.js --content`              | Cloud Run Job                         |
| 랭킹 보정     | `node dist/apps/maintenance/src/main.js --rankings`             | 수동 Cloud Run Job                    |

`data-maintenance`를 인자 없이 실행하면 이전과 같이 콘텐츠 동기화와 랭킹 보정을 모두 실행한다. CD에서는 `--content`만 사용하며 `server-toss/data/**`가 변경된 경우에만 실행한다.

Point Worker VM에는 `TOSS_POINT_WORKER_SECRET_ENV` GitHub Actions 변수로 `ENV_NAME=secret-name` 목록을 지정한다. 시작 entrypoint가 VM 서비스 계정으로 Secret Manager의 최신 값을 읽어 해당 환경변수에 주입한 후 Worker를 시작한다. VM 서비스 계정에는 최소한 Artifact Registry Reader와 사용한 secret별 Secret Manager Secret Accessor 권한이 필요하다. Worker는 포트 8080의 `/health`를 제공하므로 MIG의 HTTP health check와 방화벽을 `TOSS_POINT_WORKER_NETWORK_TAG`로 미리 연결한다.

배포 워크플로우는 API/Job 변수 외에 다음 GitHub Actions 변수를 요구한다: `TOSS_CLOUD_RUN_MIGRATION_JOB`, `TOSS_CLOUD_RUN_CONTENT_JOB`, `TOSS_POINT_WORKER_MIG`, `TOSS_POINT_WORKER_ZONE`, `TOSS_POINT_WORKER_MACHINE_TYPE`, `TOSS_POINT_WORKER_SERVICE_ACCOUNT`, `TOSS_POINT_WORKER_NETWORK`, `TOSS_POINT_WORKER_SUBNET`, `TOSS_POINT_WORKER_NETWORK_TAG`, `TOSS_POINT_WORKER_RUNTIME_ENV_VARS`, `TOSS_POINT_WORKER_SECRET_ENV`.
