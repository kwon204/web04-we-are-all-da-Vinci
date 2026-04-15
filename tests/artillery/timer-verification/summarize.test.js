const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCadenceSummary, buildRunSummary } = require("./summarize");

function createEvent(overrides = {}) {
  return {
    runId: "test-run",
    roomId: "room-1",
    round: 1,
    scheduledAt: 1000,
    timeLeft: 10,
    profileId: "player-1",
    playerNumber: 1,
    phase: "DRAWING",
    receivedAt: 1000,
    serverSentAt: 1000,
    processedAt: 1000,
    processedByServerId: "server-1",
    ...overrides,
  };
}

test("fanout receipts collapse into a single timer update stream", () => {
  const summary = buildCadenceSummary([
    createEvent({ timeLeft: 15, scheduledAt: 1000, serverSentAt: 1000 }),
    createEvent({
      profileId: "player-2",
      playerNumber: 2,
      timeLeft: 15,
      scheduledAt: 1000,
      serverSentAt: 1000,
    }),
    createEvent({ timeLeft: 14, scheduledAt: 2000, serverSentAt: 2000 }),
    createEvent({
      profileId: "player-2",
      playerNumber: 2,
      timeLeft: 14,
      scheduledAt: 2000,
      serverSentAt: 2000,
    }),
  ]);

  assert.equal(summary.roomRoundCount, 1);
  assert.equal(summary.updateCount, 2);
  assert.equal(summary.lifecycleCount, 1);
  assert.equal(summary.transitionCount, 1);
  assert.equal(summary.subSecondUpdateCount, 0);
  assert.equal(summary.skipCount, 0);
  assert.equal(summary.updateIntervalSummary.avg, 1000);
  assert.equal(summary.decrementDeltaSummary.avg, 1);
});

test("timeLeft increase starts a new lifecycle", () => {
  const summary = buildCadenceSummary([
    createEvent({ timeLeft: 15, scheduledAt: 1000, serverSentAt: 1000 }),
    createEvent({ timeLeft: 14, scheduledAt: 2000, serverSentAt: 2000 }),
    createEvent({ timeLeft: 13, scheduledAt: 3000, serverSentAt: 3000 }),
    createEvent({ timeLeft: 15, scheduledAt: 4000, serverSentAt: 4000 }),
    createEvent({ timeLeft: 14, scheduledAt: 5000, serverSentAt: 5000 }),
  ]);

  assert.equal(summary.lifecycleCount, 2);
  assert.equal(summary.transitionCount, 3);
  assert.equal(summary.subSecondUpdateCount, 0);
  assert.equal(summary.skipCount, 0);
  assert.equal(summary.roomRoundAnomalyCount, 0);
});

test("sub-second intervals and skip anomalies are detected", () => {
  const summary = buildCadenceSummary([
    createEvent({ timeLeft: 15, scheduledAt: 1000, serverSentAt: 1000 }),
    createEvent({ timeLeft: 14, scheduledAt: 2000, serverSentAt: 1500 }),
    createEvent({ timeLeft: 12, scheduledAt: 3000, serverSentAt: 2600 }),
  ]);

  assert.equal(summary.transitionCount, 2);
  assert.equal(summary.subSecondUpdateCount, 1);
  assert.equal(summary.skipCount, 1);
  assert.equal(summary.subSecondUpdateRatio, 0.5);
  assert.equal(summary.skipRatio, 0.5);
  assert.equal(summary.roomRoundAnomalyCount, 1);
});

test("run summary keeps common tick metrics", () => {
  const event = createEvent({ scheduledAt: 1000, serverSentAt: 1000 });
  const summary = buildRunSummary({
    runId: "test-run",
    label: "baseline",
    roomCount: 1,
    playerPerRoom: 1,
    events: [event],
    ticks: [
      {
        benchmarkMode: "baseline",
        scanMs: 12,
        decrementMs: 3,
        unlinkMs: 1,
        rescheduleMs: 2,
        totalTickMs: 20,
        timersProcessed: 1,
        cpuTotalMs: 4,
        eventLoopDelayMs: 6,
      },
    ],
  });

  assert.equal(summary.metrics.common.scan.avg, 12);
  assert.equal(summary.metrics.common.decrement.avg, 3);
  assert.equal(summary.metrics.common.unlink.avg, 1);
  assert.equal(summary.metrics.common.totalTick.avg, 20);
});
