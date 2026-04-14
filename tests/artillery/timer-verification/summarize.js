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
    "| metric | avg | p95 | p99 | max |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  const body = rows.map(
    (row) =>
      `| ${row.label} | ${formatNumber(row.summary.avg)} | ${formatNumber(
        row.summary.p95,
      )} | ${formatNumber(row.summary.p99)} | ${formatNumber(row.summary.max)} |`,
  );

  return [...header, ...body, ""].join("\n");
}

async function readJsonList(client, key) {
  const values = await client.lRange(key, 0, -1);
  return values.map((value) => JSON.parse(value));
}

function buildDuplicateSummary(events, playerPerRoom) {
  const logicalGroups = new Map();
  const roomGroups = new Map();

  for (const event of events) {
    const logicalKey = `${event.roomId}:${event.round}:${event.timeLeft}`;
    const logical = logicalGroups.get(logicalKey) ?? [];
    logical.push(event);
    logicalGroups.set(logicalKey, logical);

    const roomEntries = roomGroups.get(event.roomId) ?? [];
    roomEntries.push(logicalKey);
    roomGroups.set(event.roomId, roomEntries);
  }

  const duplicateExcessCounts = [];
  const duplicateRatios = [];
  const roomDuplicateRates = [];

  let duplicateExcessCount = 0;

  for (const keys of roomGroups.values()) {
    const uniqueKeys = new Set(keys);
    let roomDuplicateKeys = 0;

    for (const logicalKey of uniqueKeys) {
      const count = logicalGroups.get(logicalKey)?.length ?? 0;
      const excess = Math.max(0, count - playerPerRoom);
      if (excess > 0) {
        roomDuplicateKeys += 1;
        duplicateExcessCount += excess;
        duplicateExcessCounts.push(excess);
        duplicateRatios.push(excess / playerPerRoom);
      }
    }

    const rate =
      uniqueKeys.size === 0 ? 0 : roomDuplicateKeys / uniqueKeys.size;
    roomDuplicateRates.push(rate);
  }

  const totalReceipts = events.length;
  const duplicateRatio =
    totalReceipts === 0 ? 0 : duplicateExcessCount / totalReceipts;

  return {
    totalReceipts,
    logicalKeyCount: logicalGroups.size,
    duplicateExcessCount,
    duplicateRatio,
    duplicateExcessSummary: summarize(duplicateExcessCounts),
    duplicateRatioSummary: summarize(duplicateRatios),
    roomDuplicateRateSummary: summarize(roomDuplicateRates),
    roomsAffected: roomDuplicateRates.filter((rate) => rate > 0).length,
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

  const dueTimerQuery = ticks.map((tick) => toNumber(tick.dueTimerQueryMs));
  const queryDelete = ticks.map((tick) => toNumber(tick.queryDeleteMs));
  const decrement = ticks.map((tick) => toNumber(tick.decrementMs));
  const reschedule = ticks.map((tick) => toNumber(tick.rescheduleMs));
  const totalTick = ticks.map((tick) => toNumber(tick.totalTickMs));
  const throughput = ticks.map((tick) => toNumber(tick.timersProcessed));
  const cpuUsage = ticks.map((tick) => toNumber(tick.cpuTotalMs));
  const eventLoopDelay = ticks
    .map((tick) => toNumber(tick.eventLoopDelayMs))
    .filter((value) => Number.isFinite(value));

  return {
    runId,
    label,
    roomCount,
    playerPerRoom,
    eventCount: events.length,
    tickCount: ticks.length,
    duplicate: buildDuplicateSummary(events, playerPerRoom),
    metrics: {
      receivedLatency: summarize(receivedLatency),
      processedLatency: summarize(processedLatency),
      dueTimerQuery: summarize(dueTimerQuery),
      queryDelete: summarize(queryDelete),
      decrement: summarize(decrement),
      reschedule: summarize(reschedule),
      totalTick: summarize(totalTick),
      throughput: summarize(throughput),
      cpuUsage: summarize(cpuUsage),
      eventLoopDelay: summarize(eventLoopDelay),
    },
  };
}

function renderRunSection(summary) {
  const duplicateRows = [
    {
      label: "duplicate excess count",
      summary: summary.duplicate.duplicateExcessSummary,
    },
    {
      label: "duplicate ratio",
      summary: summary.duplicate.duplicateRatioSummary,
    },
    {
      label: "room duplicate rate",
      summary: summary.duplicate.roomDuplicateRateSummary,
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
      label: "due timer query time",
      summary: summary.metrics.dueTimerQuery,
    },
    {
      label: "query + delete time",
      summary: summary.metrics.queryDelete,
    },
    {
      label: "decrement time",
      summary: summary.metrics.decrement,
    },
    {
      label: "reschedule time",
      summary: summary.metrics.reschedule,
    },
    {
      label: "tick processing time",
      summary: summary.metrics.totalTick,
    },
    {
      label: "tick throughput",
      summary: summary.metrics.throughput,
    },
    {
      label: "CPU usage",
      summary: summary.metrics.cpuUsage,
    },
    {
      label: "Event Loop Delay",
      summary: summary.metrics.eventLoopDelay,
    },
  ];

  return [
    `## ${summary.label ?? summary.runId}`,
    "",
    `- run id: \`${summary.runId}\``,
    `- rooms: ${summary.roomCount}`,
    `- players per room: ${summary.playerPerRoom}`,
    `- raw receipts: ${summary.duplicate.totalReceipts}`,
    `- logical timer keys: ${summary.duplicate.logicalKeyCount}`,
    `- duplicate excess count: ${summary.duplicate.duplicateExcessCount}`,
    `- duplicate ratio: ${formatPercent(summary.duplicate.duplicateRatio)}`,
    `- rooms affected by duplicates: ${summary.duplicate.roomsAffected}`,
    "",
    renderMetricTable("Duplicate Analysis", duplicateRows),
    renderMetricTable("Latency", latencyRows),
    renderMetricTable("Timer Tick Cost", timerRows),
  ].join("\n");
}

function renderComparison(primary, secondary) {
  const rows = [
    [
      "duplicate excess count",
      primary.duplicate.duplicateExcessCount,
      secondary.duplicate.duplicateExcessCount,
    ],
    [
      "duplicate ratio",
      primary.duplicate.duplicateRatio,
      secondary.duplicate.duplicateRatio,
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
      primary.metrics.totalTick.avg,
      secondary.metrics.totalTick.avg,
    ],
    [
      "CPU usage avg",
      primary.metrics.cpuUsage.avg,
      secondary.metrics.cpuUsage.avg,
    ],
    [
      "Event Loop Delay avg",
      primary.metrics.eventLoopDelay.avg,
      secondary.metrics.eventLoopDelay.avg,
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
