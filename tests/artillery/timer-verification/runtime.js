require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { createClient } = require("redis");
const { DRAWING_DATA } = require("../multi-room/processor");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createBenchmarkConfig(overrides = {}) {
  const runId = overrides.runId ?? process.env.RUN_ID ?? `run_${Date.now()}`;
  const target =
    overrides.target ?? process.env.TARGET ?? "http://127.0.0.1:3000";
  const redisUrl =
    overrides.redisUrl ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  return {
    runId,
    target,
    redisUrl,
    duration: getInt(overrides.duration ?? process.env.DURATION, 2),
    arrivalRate: getInt(overrides.arrivalRate ?? process.env.ARRIVAL_RATE, 1),
    roomCount: getInt(overrides.roomCount ?? process.env.ROOM_COUNT, 1),
    playerPerRoom: getInt(
      overrides.playerPerRoom ?? process.env.PLAYER_PER_ROOM,
      1,
    ),
    totalRounds: getInt(overrides.totalRounds ?? process.env.TOTAL_ROUNDS, 1),
    drawingTime: getInt(overrides.drawingTime ?? process.env.DRAWING_TIME, 40),
    maxPlayer: getInt(overrides.maxPlayer ?? process.env.MAX_PLAYER, 1),
    benchmarkVariant:
      overrides.benchmarkVariant ?? process.env.BENCHMARK_VARIANT ?? "baseline",
    serverInstanceId:
      overrides.serverInstanceId ??
      process.env.SERVER_INSTANCE_ID ??
      `timer-server-${process.pid}`,
    timerBenchmarkRunId:
      overrides.timerBenchmarkRunId ??
      process.env.TIMER_BENCHMARK_RUN_ID ??
      runId,
    connectTimeoutMs: getInt(
      overrides.connectTimeoutMs ?? process.env.CONNECT_TIMEOUT_MS,
      30_000,
    ),
    phaseTimeoutMs: getInt(
      overrides.phaseTimeoutMs ?? process.env.PHASE_TIMEOUT_MS,
      120_000,
    ),
    timerEmitKey: `test:${runId}:timer:events`,
    timerTickKey: `test:${runId}:timer:ticks`,
    roomKey: `test:${runId}:rooms`,
    counterKey: `test:${runId}:counter`,
  };
}

function createBenchmarkRuntime(overrides = {}) {
  const config = createBenchmarkConfig(overrides);
  let redis;

  async function getRedis() {
    if (redis) {
      return redis;
    }

    redis = createClient({ url: config.redisUrl });
    redis.on("error", (error) => {
      console.error("레디스 에러", error);
    });
    await redis.connect();
    return redis;
  }

  async function resetBenchmarkState() {
    const client = await getRedis();
    await client.unlink([
      config.roomKey,
      config.counterKey,
      config.timerEmitKey,
      config.timerTickKey,
    ]);
    await client.set(config.counterKey, "0");
  }

  async function postRoom() {
    const response = await fetch(`${config.target}/room`, {
      method: "POST",
      body: JSON.stringify({
        maxPlayer: config.maxPlayer,
        totalRounds: config.totalRounds,
        drawingTime: config.drawingTime,
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Create Room Failed: ${response.status}`);
    }

    const { roomId } = await response.json();
    const client = await getRedis();
    await client.rPush(config.roomKey, roomId);
    return roomId;
  }

  async function afterPostRoom(requestParams, response) {
    const { roomId } = JSON.parse(response.body);
    const client = await getRedis();
    await client.rPush(config.roomKey, roomId);
  }

  async function getNextPlayerNumber() {
    const client = await getRedis();
    const number = await client.incr(config.counterKey);
    return number - 1;
  }

  async function resolveRoomId(roomIndex) {
    const client = await getRedis();
    let roomId = await client.lIndex(config.roomKey, roomIndex);

    for (let attempt = 0; attempt < 20 && !roomId; attempt += 1) {
      await sleep(100);
      roomId = await client.lIndex(config.roomKey, roomIndex);
    }

    if (!roomId) {
      throw new Error(
        `roomId not ready. roomIndex=${roomIndex}, runId=${config.runId}`,
      );
    }

    return roomId;
  }

  async function allocatePlayer() {
    const playerNumber = await getNextPlayerNumber();
    const roomIndex =
      Math.floor(playerNumber / config.playerPerRoom) % config.roomCount;
    const roomId = await resolveRoomId(roomIndex);

    return { playerNumber, roomIndex, roomId };
  }

  function createPlayerState({ playerNumber, roomIndex, roomId }) {
    const profileId = randomUUID();
    return {
      runId: config.runId,
      roomId,
      roomIndex,
      playerNumber,
      nickname: `bot_${roomIndex}_${playerNumber}`,
      profileId,
      strokes: DRAWING_DATA,
      similarity: {
        similarity: Math.random() * 100,
        strokeCountSimilarity: 10,
        strokeMatchSimilarity: 10,
        shapeSimilarity: 10,
      },
      timeLeft: config.drawingTime,
      playerCount: 0,
      phase: "WAITING",
      isHost: false,
      isJoined: false,
      startGame: "foo:bar",
    };
  }

  function bindSocket(socket, state, hooks = {}) {
    socket.auth = { profileId: state.profileId };

    socket.on("room:metadata", async (response) => {
      const { players, phase } = response;

      state.phase = phase;
      state.playerCount = players?.length ?? 0;

      if (!state.isJoined) {
        if ((players?.length ?? 0) === 1 && phase === "WAITING") {
          state.isHost = true;
          state.startGame = "room:start";
        } else {
          state.isHost = false;
          state.startGame = "foo:bar";
        }
        state.isJoined = true;
      }

      if (hooks.onMetadata) {
        await hooks.onMetadata(response, state);
      }
    });

    socket.on("room:timer", async (payload) => {
      const receivedAt = Date.now();

      state.timeLeft = payload.timeLeft;
      if (hooks.onTimerSample) {
        await hooks.onTimerSample({
          runId: config.runId,
          roomId: payload.roomId,
          round: payload.round,
          timeLeft: payload.timeLeft,
          scheduledAt: payload.scheduledAt,
          processedAt: payload.processedAt,
          serverSentAt: payload.serverSentAt,
          processedByServerId: payload.processedByServerId,
          receivedAt,
          profileId: state.profileId,
          phase: state.phase,
          nickname: state.nickname,
          playerNumber: state.playerNumber,
          benchmarkVariant: config.benchmarkVariant,
        });
      }
    });

    socket.on("connect_error", (error) => {
      if (hooks.onConnectError) {
        hooks.onConnectError(error, state);
      } else {
        console.error("socket connect error", error);
      }
    });
  }

  async function recordTimerSample(sample) {
    const client = await getRedis();
    await client.rPush(config.timerEmitKey, JSON.stringify(sample));
  }

  async function recordTickSample(sample) {
    const client = await getRedis();
    await client.rPush(config.timerTickKey, JSON.stringify(sample));
  }

  async function waitFor(predicate, options = {}) {
    const timeoutMs = options.timeoutMs ?? config.phaseTimeoutMs;
    const intervalMs = options.intervalMs ?? 50;
    const label = options.label ?? "condition";
    const startedAt = Date.now();

    while (true) {
      if (predicate()) {
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${label}`);
      }

      await sleep(intervalMs);
    }
  }

  function shouldWaitAllPlayerReady(state) {
    return (
      state.playerCount < config.playerPerRoom && state.phase === "WAITING"
    );
  }

  function shouldWaitDrawingPhase(state) {
    return state.phase === "WAITING" || state.phase === "PROMPT";
  }

  function shouldWaitRoundEnd(state) {
    return state.phase === "DRAWING" && state.timeLeft && state.timeLeft > 0;
  }

  function populateArtilleryUserContext(userContext, state) {
    userContext.vars.roomId = state.roomId;
    userContext.vars.playerNumber = state.playerNumber;
    userContext.vars.isFirstInRoom =
      state.playerNumber % config.playerPerRoom === 0;
    userContext.vars.nickname = state.nickname;
    userContext.vars.strokes = state.strokes;
    userContext.vars.similarity = state.similarity;
    userContext.vars.profileId = state.profileId;
    userContext.vars.timeLeft = state.timeLeft;
    userContext.vars.playerCount = state.playerCount;
    userContext.vars.phase = state.phase;
    userContext.vars.isHost = state.isHost;
    userContext.vars.startGame = state.startGame;
    userContext.vars.isJoined = state.isJoined;
  }

  function syncArtilleryState(userContext, state) {
    populateArtilleryUserContext(userContext, state);
  }

  return {
    config,
    getRedis,
    resetBenchmarkState,
    postRoom,
    afterPostRoom,
    getNextPlayerNumber,
    resolveRoomId,
    allocatePlayer,
    createPlayerState,
    bindSocket,
    recordTimerSample,
    recordTickSample,
    waitFor,
    sleep,
    shouldWaitAllPlayerReady,
    shouldWaitDrawingPhase,
    shouldWaitRoundEnd,
    populateArtilleryUserContext,
    syncArtilleryState,
  };
}

module.exports = {
  DRAWING_DATA,
  createBenchmarkConfig,
  createBenchmarkRuntime,
  sleep,
};
