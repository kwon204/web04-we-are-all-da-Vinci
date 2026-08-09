import { createServer, type Server, type ServerResponse } from "node:http";

const METADATA_BASE_URL = "http://metadata.google.internal/computeMetadata/v1";

export type SecretEnvironment = {
  envName: string;
  secretName: string;
};

export const parseSecretEnvironment = (
  value: string | undefined,
): SecretEnvironment[] => {
  if (!value?.trim()) return [];

  return value.split(",").map((entry) => {
    const [envName, secretName, ...rest] = entry
      .split("=")
      .map((part) => part.trim());
    if (!envName || !secretName || rest.length > 0) {
      throw new Error(
        "WORKER_SECRET_ENV는 ENV_NAME=secret-name 형식의 쉼표 구분 목록이어야 해요.",
      );
    }
    return { envName, secretName };
  });
};

const fetchMetadata = async (path: string): Promise<string> => {
  const response = await fetch(`${METADATA_BASE_URL}/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) {
    throw new Error(`Compute Engine 메타데이터 조회 실패: ${response.status}`);
  }
  return response.text();
};

const getAccessToken = async (): Promise<string> => {
  const response = await fetch(
    `${METADATA_BASE_URL}/instance/service-accounts/default/token`,
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) {
    throw new Error(`Worker 서비스 계정 토큰 조회 실패: ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Worker 서비스 계정 토큰이 없어요.");
  return body.access_token;
};

const readSecret = async (
  projectId: string,
  secretName: string,
  accessToken: string,
): Promise<string> => {
  const response = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${secretName}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Worker 비밀값 조회 실패 (${secretName}): ${response.status}`,
    );
  }
  const body = (await response.json()) as { payload?: { data?: string } };
  if (!body.payload?.data) {
    throw new Error(`Worker 비밀값 응답이 비어 있어요: ${secretName}`);
  }
  return Buffer.from(body.payload.data, "base64").toString("utf8");
};

export async function loadWorkerSecrets(): Promise<void> {
  const secrets = parseSecretEnvironment(process.env.WORKER_SECRET_ENV);
  if (secrets.length === 0) return;

  const projectId =
    process.env.GCP_PROJECT_ID ?? (await fetchMetadata("project/project-id"));
  const accessToken = await getAccessToken();
  const values = await Promise.all(
    secrets.map(async ({ envName, secretName }) => ({
      envName,
      value: await readSecret(projectId, secretName, accessToken),
    })),
  );

  for (const { envName, value } of values) process.env[envName] = value;
}

export const respondToWorkerHealthCheck = (
  url: string | undefined,
  response: ServerResponse,
): void => {
  if (url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end('{"status":"ok"}');
};

export const createWorkerHealthServer = (): Server =>
  createServer((request, response) =>
    respondToWorkerHealthCheck(request.url, response),
  );

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });

export async function bootstrapPointWorker(): Promise<void> {
  await loadWorkerSecrets();
  const workerEntrypoint =
    (await import("./main.js")) as unknown as typeof import("./main");
  const { bootstrap } = workerEntrypoint;
  await bootstrap();

  const port = Number(process.env.WORKER_HEALTH_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("WORKER_HEALTH_PORT는 1~65535 사이의 정수여야 해요.");
  }

  const healthServer = createWorkerHealthServer();
  await listen(healthServer, port);
  process.once("SIGTERM", () => healthServer.close());
  process.once("SIGINT", () => healthServer.close());
}

if (require.main === module) {
  void bootstrapPointWorker();
}
