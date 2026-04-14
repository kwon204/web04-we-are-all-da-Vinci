require("dotenv").config();
const { createClient } = require("redis");
const baseProcessor = require("../multi-room/processor");

const RUN_ID = process.env.RUN_ID ?? `run_${Date.now()}`;
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const KEY_TIMER_EVENTS = `test:${RUN_ID}:timer:events`;
const KEY_TIMER_TICKS = `test:${RUN_ID}:timer:ticks`;

let redis;

async function getRedis() {
  if (redis) return redis;

  try {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();
  } catch (error) {
    console.error("레디스 에러", error);
    process.exit(1);
  }

  return redis;
}

async function beforeAll(context, events) {
  await baseProcessor.beforeAll(context, events);

  const client = await getRedis();
  await client.del(KEY_TIMER_EVENTS, KEY_TIMER_TICKS);
}

async function afterPostRoom(requestParams, response, context, events) {
  return baseProcessor.afterPostRoom(requestParams, response, context, events);
}

function attachTimerTelemetry(userContext) {
  const socket = userContext.sockets[""];

  socket.on("room:timer", async (payload) => {
    try {
      const client = await getRedis();
      const receivedAt = Date.now();
      const sample = {
        runId: RUN_ID,
        roomId: payload.roomId,
        round: payload.round,
        timeLeft: payload.timeLeft,
        scheduledAt: payload.scheduledAt,
        processedAt: payload.processedAt,
        serverSentAt: payload.serverSentAt,
        processedByServerId: payload.processedByServerId,
        receivedAt,
        phase: userContext.vars.phase,
        nickname: userContext.vars.nickname,
        playerNumber: userContext.vars.playerNumber,
      };

      await client.rPush(KEY_TIMER_EVENTS, JSON.stringify(sample));
    } catch (error) {
      console.error("timer event capture error", error);
    }
  });
}

function initUser(userContext, events, done) {
  return baseProcessor.initUser(userContext, events, (err) => {
    if (err) {
      done(err);
      return;
    }

    try {
      attachTimerTelemetry(userContext);
      done();
    } catch (error) {
      done(error);
    }
  });
}

module.exports = {
  initUser,
  updateScore: baseProcessor.updateScore,
  waitAllPlayerReady: baseProcessor.waitAllPlayerReady,
  waitDrawingPhase: baseProcessor.waitDrawingPhase,
  waitRoundEnd: baseProcessor.waitRoundEnd,
  afterPostRoom,
  beforeAll,
};
