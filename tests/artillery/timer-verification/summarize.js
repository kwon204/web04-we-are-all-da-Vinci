#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("redis");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;

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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarize(values) {
  if (!values.length) {
    return {
      count: 0,
      avg: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);

  return {
    count: values.length,
    avg: sum / values.length,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function renderMetricTable(title, rows) {
  const header = [
    `### ${title}`,
    "",
    "| metric | avg | p95 | p99 | min | max |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  const body = rows.map(
    (row) =>
      `| ${row.label} | ${formatNumber(row.summary.avg)} | ${formatNumber(
        row.summary.p95,
      )} | ${formatNumber(row.summary.p99)} | ${formatNumber(
        row.summary.min,
      )} | ${formatNumber(row.summary.max)} |`,
  );

  return [...header, ...body, ""].join("\n");
}

async function readJsonList(client, key) {
  const values = await client.lRange(key, 0, -1);
  return values.map((value) => JSON.parse(value));
}

function getRoomRoundKey(event) {
  return `${event.roomId}:${event.round}`;
}

function getTimerStateKey(event) {
  return `${event.roomId}:${event.round}:${event.scheduledAt}:${event.timeLeft}`;
}

function buildCadenceSummary(events) {
  const roomRoundGroups = new Map();

  for (const event of events) {
    const roomRoundKey = getRoomRoundKey(event);
    const stateKey = getTimerStateKey(event);

    const roomRound = roomRoundGroups.get(roomRoundKey) ?? {
      roomId: event.roomId,
      round: event.round,
      states: new Map(),
    };

    const state = roomRound.states.get(stateKey) ?? {
      roomId: event.roomId,
      round: event.round,
      scheduledAt: toNumber(event.scheduledAt),
      timeLeft: toNumber(event.timeLeft),
      serverSentAt: toNumber(event.serverSentAt, Number.POSITIVE_INFINITY),
      processedAt: toNumber(event.processedAt, Number.POSITIVE_INFINITY),
      receipts: 0,
      processedByServers: new Set(),
    };

    state.receipts += 1;
    state.serverSentAt = Math.min(
      state.serverSentAt,
      toNumber(event.serverSentAt, Number.POSITIVE_INFINITY),
    );
    state.processedAt = Math.min(
      state.processedAt,
      toNumber(event.processedAt, Number.POSITIVE_INFINITY),
    );
    if (event.processedByServerId) {
      state.processedByServers.add(event.processedByServerId);
    }

    roomRound.states.set(stateKey, state);
    roomRoundGroups.set(roomRoundKey, roomRound);
  }

  const intervals = [];
  const decrementDeltas = [];
  let subSecondUpdateCount = 0;
  let skipCount = 0;
  let roomRoundAnomalyCount = 0;
  let multiServerStateCount = 0;
  let maxServerCountPerState = 0;
  let lifecycleCount = 0;

  for (const roomRound of roomRoundGroups.values()) {
    const updates = [...roomRound.states.values()].sort((left, right) => {
      if (left.serverSentAt !== right.serverSentAt) {
        return left.serverSentAt - right.serverSentAt;
      }
      if (left.scheduledAt !== right.scheduledAt) {
        return left.scheduledAt - right.scheduledAt;
      }
      return right.timeLeft - left.timeLeft;
    });

    let roomRoundHasAnomaly = false;
    let previous = null;

    for (const update of updates) {
      if (!previous || update.timeLeft > previous.timeLeft) {
        lifecycleCount += 1;
        previous = update;
        continue;
      }

      const interval = update.serverSentAt - previous.serverSentAt;
      const decrement = previous.timeLeft - update.timeLeft;

      intervals.push(interval);
      decrementDeltas.push(decrement);

      if (interval < 800) {
        subSecondUpdateCount += 1;
        roomRoundHasAnomaly = true;
      }

      if (decrement > 1) {
        skipCount += 1;
        roomRoundHasAnomaly = true;
      }

      previous = update;
    }

    if (roomRoundHasAnomaly) {
      roomRoundAnomalyCount += 1;
    }
  }

  const transitionCount = intervals.length;
  const roomRoundCount = roomRoundGroups.size;
  const updateCount = [...roomRoundGroups.values()].reduce(
    (acc, roomRound) => acc + roomRound.states.size,
    0,
  );

  for (const roomRound of roomRoundGroups.values()) {
    for (const state of roomRound.states.values()) {
      const serverCount = state.processedByServers.size;
      if (serverCount > 1) {
        multiServerStateCount += 1;
      }
      if (serverCount > maxServerCountPerState) {
        maxServerCountPerState = serverCount;
      }
    }
  }

  return {
    roomRoundCount,
    updateCount,
    lifecycleCount,
    transitionCount,
    subSecondUpdateCount,
    subSecondUpdateRatio:
      transitionCount === 0 ? 0 : subSecondUpdateCount / transitionCount,
    skipCount,
    skipRatio: transitionCount === 0 ? 0 : skipCount / transitionCount,
    roomRoundAnomalyCount,
    roomRoundAnomalyRatio:
      roomRoundCount === 0 ? 0 : roomRoundAnomalyCount / roomRoundCount,
    multiServerStateCount,
    multiServerStateRatio:
      updateCount === 0 ? 0 : multiServerStateCount / updateCount,
    maxServerCountPerState,
    updateIntervalSummary: summarize(intervals),
    decrementDeltaSummary: summarize(decrementDeltas),
  };
}

function buildCommonTickSummary(ticks) {
  const scan = ticks.map((tick) =>
    toNumber(tick.scanMs ?? tick.dueTimerQueryMs),
  );
  const decrement = ticks.map((tick) => toNumber(tick.decrementMs));
  const unlink = ticks.map((tick) => toNumber(tick.unlinkMs));
  const totalTick = ticks.map((tick) => toNumber(tick.totalTickMs));
  const throughput = ticks.map((tick) => toNumber(tick.timersProcessed));
  const cpuUsage = ticks.map((tick) => toNumber(tick.cpuTotalMs));
  const eventLoopDelay = ticks
    .map((tick) => toNumber(tick.eventLoopDelayMs))
    .filter((value) => Number.isFinite(value));

  return {
    scan: summarize(scan),
    decrement: summarize(decrement),
    unlink: summarize(unlink),
    totalTick: summarize(totalTick),
    throughput: summarize(throughput),
    cpuUsage: summarize(cpuUsage),
    eventLoopDelay: summarize(eventLoopDelay),
  };
}

function buildRunSummary({
  runId,
  label,
  roomCount,
  playerPerRoom,
  events,
  ticks,
}) {
  const receivedLatency = events.map((event) =>
    Math.max(0, toNumber(event.receivedAt) - toNumber(event.serverSentAt)),
  );

  const processedLatency = events.map((event) =>
    Math.max(0, toNumber(event.processedAt) - toNumber(event.scheduledAt)),
  );

  return {
    runId,
    label,
    roomCount,
    playerPerRoom,
    benchmarkMode: ticks[0]?.benchmarkMode ?? null,
    eventCount: events.length,
    tickCount: ticks.length,
    cadence: buildCadenceSummary(events),
    metrics: {
      receivedLatency: summarize(receivedLatency),
      processedLatency: summarize(processedLatency),
      common: buildCommonTickSummary(ticks),
    },
  };
}

function renderRunSection(summary) {
  const cadenceRows = [
    {
      label: "update interval (serverSentAt diff)",
      summary: summary.cadence.updateIntervalSummary,
    },
    {
      label: "timeLeft decrement",
      summary: summary.cadence.decrementDeltaSummary,
    },
  ];

  const latencyRows = [
    {
      label: "receivedAt - serverSentAt",
      summary: summary.metrics.receivedLatency,
    },
    {
      label: "processedAt - scheduledAt",
      summary: summary.metrics.processedLatency,
    },
  ];

  const timerRows = [
    {
      label: "scan time",
      summary: summary.metrics.common.scan,
    },
    {
      label: "decrement time",
      summary: summary.metrics.common.decrement,
    },
    {
      label: "unlink time",
      summary: summary.metrics.common.unlink,
    },
    {
      label: "tick processing time",
      summary: summary.metrics.common.totalTick,
    },
    {
      label: "tick throughput",
      summary: summary.metrics.common.throughput,
    },
    {
      label: "CPU usage",
      summary: summary.metrics.common.cpuUsage,
    },
    {
      label: "Event Loop Delay",
      summary: summary.metrics.common.eventLoopDelay,
    },
  ];

  const sections = [
    `## ${summary.label ?? summary.runId}`,
    "",
    `- run id: \`${summary.runId}\``,
    `- rooms: ${summary.roomCount}`,
    `- players per room: ${summary.playerPerRoom}`,
    summary.benchmarkMode
      ? `- benchmark mode: \`${summary.benchmarkMode}\``
      : null,
    `- raw receipts: ${summary.eventCount}`,
    `- unique timer updates: ${summary.cadence.updateCount}`,
    `- room-rounds: ${summary.cadence.roomRoundCount}`,
    `- lifecycles: ${summary.cadence.lifecycleCount}`,
    `- multi-server timer states: ${summary.cadence.multiServerStateCount} (${formatPercent(
      summary.cadence.multiServerStateRatio,
    )}, max servers per state: ${summary.cadence.maxServerCountPerState})`,
    `- sub-second updates: ${summary.cadence.subSecondUpdateCount} (${formatPercent(
      summary.cadence.subSecondUpdateRatio,
    )})`,
    `- skip anomalies: ${summary.cadence.skipCount} (${formatPercent(
      summary.cadence.skipRatio,
    )})`,
    `- room-rounds affected by anomalies: ${summary.cadence.roomRoundAnomalyCount} (${formatPercent(
      summary.cadence.roomRoundAnomalyRatio,
    )})`,
    "",
    renderMetricTable("Cadence", cadenceRows),
    renderMetricTable("Latency", latencyRows),
    renderMetricTable("Timer Tick Cost", timerRows),
  ].filter(Boolean);

  return sections.join("\n");
}

function renderComparison(primary, secondary) {
  const rows = [
    [
      "scan time avg",
      primary.metrics.common.scan.avg,
      secondary.metrics.common.scan.avg,
    ],
    [
      "update interval avg",
      primary.cadence.updateIntervalSummary.avg,
      secondary.cadence.updateIntervalSummary.avg,
    ],
    [
      "update interval min",
      primary.cadence.updateIntervalSummary.min,
      secondary.cadence.updateIntervalSummary.min,
    ],
    [
      "timeLeft decrement avg",
      primary.cadence.decrementDeltaSummary.avg,
      secondary.cadence.decrementDeltaSummary.avg,
    ],
    [
      "decrement time avg",
      primary.metrics.common.decrement.avg,
      secondary.metrics.common.decrement.avg,
    ],
    [
      "unlink time avg",
      primary.metrics.common.unlink.avg,
      secondary.metrics.common.unlink.avg,
    ],
    [
      "sub-second update ratio",
      primary.cadence.subSecondUpdateRatio,
      secondary.cadence.subSecondUpdateRatio,
    ],
    ["skip ratio", primary.cadence.skipRatio, secondary.cadence.skipRatio],
    [
      "room-round anomaly ratio",
      primary.cadence.roomRoundAnomalyRatio,
      secondary.cadence.roomRoundAnomalyRatio,
    ],
    [
      "multi-server state ratio",
      primary.cadence.multiServerStateRatio,
      secondary.cadence.multiServerStateRatio,
    ],
    [
      "receivedAt - serverSentAt avg",
      primary.metrics.receivedLatency.avg,
      secondary.metrics.receivedLatency.avg,
    ],
    [
      "processedAt - scheduledAt avg",
      primary.metrics.processedLatency.avg,
      secondary.metrics.processedLatency.avg,
    ],
    [
      "tick processing time avg",
      primary.metrics.common.totalTick.avg,
      secondary.metrics.common.totalTick.avg,
    ],
    [
      "tick throughput avg",
      primary.metrics.common.throughput.avg,
      secondary.metrics.common.throughput.avg,
    ],
    [
      "CPU usage avg",
      primary.metrics.common.cpuUsage.avg,
      secondary.metrics.common.cpuUsage.avg,
    ],
    [
      "Event Loop Delay avg",
      primary.metrics.common.eventLoopDelay.avg,
      secondary.metrics.common.eventLoopDelay.avg,
    ],
  ];

  const lines = [
    "## Comparison",
    "",
    "| metric | primary | secondary | delta | delta % |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const [label, primaryValue, secondaryValue] of rows) {
    const delta = secondaryValue - primaryValue;
    const deltaRatio = primaryValue === 0 ? 0 : delta / primaryValue;
    lines.push(
      `| ${label} | ${formatNumber(primaryValue)} | ${formatNumber(secondaryValue)} | ${formatNumber(delta)} | ${formatPercent(deltaRatio)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

async function loadRun(client, runId, label, roomCount, playerPerRoom) {
  const eventKey = `test:${runId}:timer:events`;
  const tickKey = `test:${runId}:timer:ticks`;
  const [events, ticks] = await Promise.all([
    readJsonList(client, eventKey),
    readJsonList(client, tickKey),
  ]);

  return buildRunSummary({
    runId,
    label,
    roomCount,
    playerPerRoom,
    events,
    ticks,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args["run-id"] ?? process.env.RUN_ID;
  const compareRunId = args["compare-run-id"] ?? process.env.COMPARE_RUN_ID;
  const roomCount = Number.parseInt(
    args["room-count"] ?? process.env.ROOM_COUNT ?? "100",
    10,
  );
  const playerPerRoom = Number.parseInt(
    args["player-per-room"] ?? process.env.PLAYER_PER_ROOM ?? "5",
    10,
  );
  const outDir = path.resolve(
    args["out-dir"] ??
      process.env.OUT_DIR ??
      "./tests/artillery/timer-verification/results",
  );
  const primaryLabel =
    args["label"] ?? process.env.BENCHMARK_VARIANT ?? "baseline";
  const secondaryLabel = args["compare-label"] ?? "improved";
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  if (!runId) {
    throw new Error("run-id is required");
  }

  const client = createClient({ url: redisUrl });
  await client.connect();

  try {
    const primary = await loadRun(
      client,
      runId,
      primaryLabel,
      roomCount,
      playerPerRoom,
    );
    const comparison = compareRunId
      ? await loadRun(
          client,
          compareRunId,
          secondaryLabel,
          roomCount,
          playerPerRoom,
        )
      : null;

    const markdown = [
      "# Timer Verification Benchmark",
      "",
      renderRunSection(primary),
      comparison ? renderRunSection(comparison) : "",
      comparison ? renderComparison(primary, comparison) : "",
    ]
      .filter(Boolean)
      .join("\n");

    const artifact = {
      generatedAt: new Date().toISOString(),
      config: {
        runId,
        compareRunId,
        roomCount,
        playerPerRoom,
        primaryBenchmarkMode: primary.benchmarkMode,
        compareBenchmarkMode: comparison?.benchmarkMode ?? null,
      },
      primary,
      comparison,
      markdown,
    };

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${runId}.md`), markdown);
    fs.writeFileSync(
      path.join(outDir, `${runId}.json`),
      JSON.stringify(artifact, null, 2),
    );

    if (comparison) {
      fs.writeFileSync(
        path.join(outDir, `${runId}-vs-${compareRunId}.md`),
        markdown,
      );
      fs.writeFileSync(
        path.join(outDir, `${runId}-vs-${compareRunId}.json`),
        JSON.stringify(artifact, null, 2),
      );
    }

    process.stdout.write(`${markdown}\n`);
  } finally {
    await client.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  percentile,
  summarize,
  buildCadenceSummary,
  buildRunSummary,
  renderRunSection,
  renderComparison,
  readJsonList,
  main,
};
