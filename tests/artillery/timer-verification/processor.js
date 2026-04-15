require("dotenv").config();

const { createBenchmarkRuntime } = require("./runtime");

const runtime = createBenchmarkRuntime();

async function beforeAll() {
  await runtime.resetBenchmarkState();
}

async function postRoom() {
  return runtime.postRoom();
}

async function afterPostRoom(requestParams, response) {
  return runtime.afterPostRoom(requestParams, response);
}

function initUser(userContext, events, done) {
  runtime
    .allocatePlayer()
    .then((player) => {
      const state = runtime.createPlayerState(player);
      const socket = userContext.sockets[""];
      let settled = false;

      const finish = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        done(error);
      };

      runtime.syncArtilleryState(userContext, state);
      runtime.bindSocket(socket, state, {
        onTimerSample: runtime.recordTimerSample,
        onConnectError: (error) => finish(error),
      });

      socket.once("connect", () => finish());

      socket.connect();
    })
    .catch((error) => {
      done(error);
    });
}

function updateScore(userContext, events, done) {
  userContext.vars.randomScore = Math.random() * 100;
  return done();
}

function waitAllPlayerReady(userContext, next) {
  return next(runtime.shouldWaitAllPlayerReady(userContext.vars));
}

function waitDrawingPhase(userContext, next) {
  return next(runtime.shouldWaitDrawingPhase(userContext.vars));
}

function waitRoundEnd(userContext, next) {
  return next(runtime.shouldWaitRoundEnd(userContext.vars));
}

module.exports = {
  initUser,
  updateScore,
  waitAllPlayerReady,
  waitDrawingPhase,
  waitRoundEnd,
  afterPostRoom,
  beforeAll,
  postRoom,
};
