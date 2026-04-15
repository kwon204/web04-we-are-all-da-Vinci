#!/usr/bin/env node

const path = require("node:path");
const { io } = require("socket.io-client");
const dotenv = require("dotenv");

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    i += 1;
  }

  return args;
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function connectSocket(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timeoutHandle;

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
    socket.connect();

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        onError(new Error(`Socket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeoutHandle.unref?.();
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile =
    args["env-file"] ??
    process.env.ENV_FILE ??
    "./tests/artillery/timer-verification/.env.baseline.example";

  dotenv.config({
    path: path.resolve(envFile),
  });

  const { createBenchmarkRuntime } = require("./runtime");
  const runtime = createBenchmarkRuntime({
    runId: args["run-id"] ?? process.env.RUN_ID,
    timerBenchmarkRunId:
      args["timer-benchmark-run-id"] ?? process.env.TIMER_BENCHMARK_RUN_ID,
    benchmarkMode: args["benchmark-mode"] ?? process.env.BENCHMARK_MODE,
    benchmarkVariant:
      args["benchmark-variant"] ?? process.env.BENCHMARK_VARIANT,
    target: args.target ?? process.env.TARGET,
    redisUrl: args["redis-url"] ?? process.env.REDIS_URL,
    duration: args.duration ?? process.env.DURATION,
    arrivalRate: args["arrival-rate"] ?? process.env.ARRIVAL_RATE,
    roomCount: args["room-count"] ?? process.env.ROOM_COUNT,
    playerPerRoom: args["player-per-room"] ?? process.env.PLAYER_PER_ROOM,
    totalRounds: args["total-rounds"] ?? process.env.TOTAL_ROUNDS,
    drawingTime: args["drawing-time"] ?? process.env.DRAWING_TIME,
    maxPlayer: args["max-player"] ?? process.env.MAX_PLAYER,
    connectTimeoutMs:
      args["connect-timeout-ms"] ?? process.env.CONNECT_TIMEOUT_MS,
    phaseTimeoutMs: args["phase-timeout-ms"] ?? process.env.PHASE_TIMEOUT_MS,
    serverInstanceId:
      args["server-instance-id"] ?? process.env.SERVER_INSTANCE_ID,
  });

  const config = runtime.config;
  const totalPlayers = config.roomCount * config.playerPerRoom;
  const expectedPlayers = config.duration * config.arrivalRate;

  if (expectedPlayers !== totalPlayers) {
    throw new Error(
      `Load shape mismatch: ROOM_COUNT x PLAYER_PER_ROOM = ${totalPlayers}, but DURATION x ARRIVAL_RATE = ${expectedPlayers}. Align the benchmark env before running.`,
    );
  }

  const sessionHoldMs = readInt(
    args["session-hold-ms"] ?? process.env.SESSION_HOLD_MS,
    (config.drawingTime * config.totalRounds + 30) * 1000,
  );
  const interArrivalMs = 1000 / config.arrivalRate;

  console.log(
    JSON.stringify(
      {
        runId: config.runId,
        benchmarkMode: config.benchmarkMode,
        benchmarkVariant: config.benchmarkVariant,
        target: config.target,
        redisUrl: config.redisUrl,
        roomCount: config.roomCount,
        playerPerRoom: config.playerPerRoom,
        totalPlayers,
        interArrivalMs,
        sessionHoldMs,
      },
      null,
      2,
    ),
  );

  await runtime.resetBenchmarkState();

  for (let index = 0; index < config.roomCount; index += 1) {
    await runtime.postRoom();
    if ((index + 1) % 10 === 0 || index + 1 === config.roomCount) {
      console.log(`created rooms: ${index + 1}/${config.roomCount}`);
    }
  }

  const userTasks = Array.from({ length: totalPlayers }, (_, index) =>
    (async () => {
      await runtime.sleep(index * interArrivalMs);

      const player = await runtime.allocatePlayer();
      const state = runtime.createPlayerState(player);
      const socket = io(config.target, {
        autoConnect: false,
        transports: ["websocket"],
        reconnection: false,
        timeout: config.connectTimeoutMs,
      });

      runtime.bindSocket(socket, state, {
        onTimerSample: runtime.recordTimerSample,
        onMetadata: runtime.recordMetadata,
      });

      try {
        await connectSocket(socket, config.connectTimeoutMs);

        socket.emit("user:join", {
          roomId: state.roomId,
          nickname: state.nickname,
          profileId: state.profileId,
        });

        await runtime.waitFor(() => state.isJoined, {
          label: `room join acknowledgement for ${state.nickname}`,
          timeoutMs: config.phaseTimeoutMs,
        });

        await runtime.waitFor(() => !runtime.shouldWaitAllPlayerReady(state), {
          label: `all players ready in ${state.roomId}`,
          timeoutMs: config.phaseTimeoutMs,
        });

        if (state.isHost && state.startGame === "room:start") {
          socket.emit(state.startGame, {
            roomId: state.roomId,
          });
        }

        await runtime.waitFor(() => !runtime.shouldWaitDrawingPhase(state), {
          label: `drawing phase for ${state.roomId}`,
          timeoutMs: config.phaseTimeoutMs,
        });

        while (runtime.shouldWaitRoundEnd(state)) {
          socket.emit("user:score", {
            similarity: Math.random() * 100,
            roomId: state.roomId,
          });
          await runtime.sleep(1000);
        }

        socket.emit("user:drawing", {
          roomId: state.roomId,
          similarity: state.similarity,
          strokes: state.strokes,
        });

        await runtime.sleep(sessionHoldMs);
      } finally {
        socket.disconnect();
      }
    })(),
  );

  await Promise.all(userTasks);
  console.log("benchmark completed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
