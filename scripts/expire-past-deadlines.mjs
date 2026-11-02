#!/usr/bin/env node
/**
 * scripts/expire-past-deadlines.mjs
 *
 * Flips published listings whose deadline has passed to `status: "expired"`,
 * then rebuilds the published projections from disk truth:
 *
 *   index.json        published-only listing entries (order preserved)
 *   all-slugs.json    every record slug, sorted (public/data is its home)
 *   stats.json        totalOpportunities / openOpportunities / org / article
 *
 * Both planes are written together (data/ + public/data/) and the script ends
 * with a byte-level drift report that must read "0 differing files".
 *
 * DEFAULT IS A DRY RUN. Pass --apply to write anything.
 *
 * ── Deadline policy (IMPORTANT) ────────────────────────────────────────────
 * The site's single source of truth is src/lib/deadline.mjs. Its expiry rule is
 * NOT "deadline < Date.now()":
 *
 *   - EXPIRY IS DAY-GRANULAR in Europe/London. A record expires only once the
 *     London civil day containing its deadline has ENDED. A 18:00 deadline is
 *     not expired at 06:00 the same day.
 *   - deadlineType "rolling" | "open_until_filled" | "custom" NEVER expire.
 *     `servingExpired()` returns false for them by design.
 *
 * This script mirrors those helpers (zero dependencies, Intl only) so a data
 * sweep can never disagree with the site that serves the data.
 *
 * `--utc` switches to the literal "deadline < now (UTC)" predicate, which also
 * expires custom/rolling listings and same-day deadlines. Use it only when you
 * deliberately want to diverge from the serving policy.
 *
 * Usage:
 *   node scripts/expire-past-deadlines.mjs                  # dry run (canonical)
 *   node scripts/expire-past-deadlines.mjs --utc            # dry run (literal UTC)
 *   node scripts/expire-past-deadlines.mjs --apply          # write (canonical)
 *   node scripts/expire-past-deadlines.mjs --apply --utc    # write (literal UTC)
 *   node scripts/expire-past-deadlines.mjs --now=2026-11-02T00:00:00Z
 *   node scripts/expire-past-deadlines.mjs --mirror-all-slugs
 *
 * Flags:
 *   --apply              write changes (default: dry run, nothing is written)
 *   --utc                literal UTC predicate instead of the canonical policy
 *   --now=<ISO>          evaluate at this instant (default: now)
 *   --mirror-all-slugs   also write data/all-slugs.json (repoStore declares
 *                        public/data/all-slugs.json as its only home, so the
 *                        data-plane twin is NOT created by default)
 *   --quiet              omit the per-record list
 *   --help               print this help
 *
 * Exit codes: 0 = ok, 1 = error / plane drift / unsafe state.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLANES = ["data", "public/data"];
const OPP_DIR = "opportunities";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

if (has("--help") || has("-h")) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 62)
      .map((l) => l.replace(/^ \* ?/, ""))
      .join("\n")
  );
  process.exit(0);
}

const APPLY = has("--apply");
const QUIET = has("--quiet");
const MIRROR_ALL_SLUGS = has("--mirror-all-slugs");
const MODE = has("--utc") ? "utc" : "canonical";

if (MODE !== "canonical" && MODE !== "utc") {
  console.error(`Unknown mode: ${MODE}`);
  process.exit(1);
}

const nowArg = argValue("now");
const NOW = nowArg ? new Date(nowArg) : new Date();
if (Number.isNaN(NOW.getTime())) {
  console.error(`Invalid --now value: ${nowArg}`);
  process.exit(1);
}

// ── deadline helpers — copied verbatim from src/lib/deadline.mjs ────────────
// Kept in sync by hand: this repo cannot import from the site repo. The site's
// copy is the single source of truth; any change there must be mirrored here.

const DEADLINE_EVAL_TZ = "Europe/London";
const DATE_ONLY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DD_MM_YYYY_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const HAS_EXPLICIT_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const WALL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?/;

const TZ_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: DEADLINE_EVAL_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function evalTzOffsetMs(utcMs) {
  const parts = TZ_FORMATTER.formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function wallToUtcMs(y, mo, d, h, mi, s, ms) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let utc = wallAsUtc - evalTzOffsetMs(wallAsUtc);
  utc = wallAsUtc - evalTzOffsetMs(utc);
  return utc;
}

function validWallDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d
  );
}

function parseDeadlineInput(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime());
  if (typeof v === "number") return Number.isNaN(v) ? null : new Date(v);
  if (typeof v === "object") return null;

  const s = String(v).trim();
  if (!s) return null;

  if (DATE_ONLY_RE.test(s)) {
    const [y, mo, d] = s.split("-").map(Number);
    if (!validWallDate(y, mo, d)) return null;
    return new Date(wallToUtcMs(y, mo, d, 23, 59, 59, 999));
  }

  if (DD_MM_YYYY_RE.test(s)) {
    const [d, mo, y] = s.split("/").map(Number);
    if (!validWallDate(y, mo, d)) return null;
    return new Date(wallToUtcMs(y, mo, d, 23, 59, 59, 999));
  }

  const wall = s.match(WALL_DATETIME_RE);
  if (wall && !HAS_EXPLICIT_TZ_RE.test(s)) {
    const [, y, mo, d, h, mi, sec, frac] = wall;
    const hy = Number(y), hmo = Number(mo), hd = Number(d);
    const hh = Number(h), hmi = Number(mi), hsec = Number(sec || 0);
    if (!validWallDate(hy, hmo, hd) || hh > 23 || hmi > 59 || hsec > 59) return null;
    const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
    return new Date(wallToUtcMs(hy, hmo, hd, hh, hmi, hsec, ms));
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const formatterCache = new Map();
function partsFormatter(tz) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function wallParts(instant, tz) {
  const parts = partsFormatter(tz).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMsAt(utcMs, tz) {
  const p = wallParts(new Date(utcMs), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function wallToUtcInTz(y, mo, d, h, mi, s, ms, tz) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let utc = wallAsUtc - offsetMsAt(wallAsUtc, tz);
  utc = wallAsUtc - offsetMsAt(utc, tz);
  return utc;
}

function endOfDayInTz(instant, tz = DEADLINE_EVAL_TZ) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = wallParts(d, tz);
  return new Date(wallToUtcInTz(p.year, p.month, p.day, 23, 59, 59, 999, tz));
}

function endOfTodayInTz(now = new Date(), tz = DEADLINE_EVAL_TZ) {
  return endOfDayInTz(now, tz);
}

function isDeadlineExpired(deadline, now = new Date()) {
  const t = parseDeadlineInput(deadline);
  if (t === null) return false;
  const endOfDay = endOfDayInTz(t, DEADLINE_EVAL_TZ);
  const endOfToday = endOfTodayInTz(
    now instanceof Date ? now : new Date(now),
    DEADLINE_EVAL_TZ
  );
  if (!endOfDay || !endOfToday) return false;
  return endOfDay.getTime() < endOfToday.getTime();
}

function deadlineNeverExpires(deadlineType) {
  const t = String(deadlineType ?? "").trim().toLowerCase();
  return t === "rolling" || t === "open_until_filled" || t === "custom";
}

// ── io helpers ──────────────────────────────────────────────────────────────

const abs = (rel) => path.join(ROOT, rel);
const readText = (rel) => readFileSync(abs(rel), "utf8");
const eolOf = (raw) => (raw.includes("\r\n") ? "\r\n" : "\n");

/** Serialize exactly like the data repo's exporter: 1-space JSON, same EOL and
 *  same trailing-newline convention as the file it replaces. */
function serializeLike(obj, raw) {
  const eol = eolOf(raw);
  const trailing = /\r?\n$/.test(raw) ? eol : "";
  return JSON.stringify(obj, null, 1).replace(/\n/g, eol) + trailing;
}

/** Write only when the bytes actually change. Returns true when written. */
function writeIfChanged(rel, content) {
  const file = abs(rel);
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  if (!APPLY) return false; // dry run: never touch disk
  writeFileSync(file, content, "utf8");
  return true;
}

function sha256(rel) {
  return createHash("sha256").update(readFileSync(abs(rel))).digest("hex");
}

function walk(plane) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(abs(dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  visit(plane);
  return out;
}

function fail(msg) {
  console.error(`\nABORT: ${msg}`);
  process.exit(1);
}

// ── load records ────────────────────────────────────────────────────────────

const primaryDir = `${PLANES[0]}/${OPP_DIR}`;
const publicDir = `${PLANES[1]}/${OPP_DIR}`;

if (!existsSync(abs(primaryDir))) fail(`missing directory: ${primaryDir}`);
if (!existsSync(abs(publicDir))) fail(`missing directory: ${publicDir}`);

const primaryFiles = readdirSync(abs(primaryDir)).filter((f) => f.endsWith(".json")).sort();
const publicFiles = readdirSync(abs(publicDir)).filter((f) => f.endsWith(".json")).sort();

const onlyData = primaryFiles.filter((f) => !publicFiles.includes(f));
const onlyPublic = publicFiles.filter((f) => !primaryFiles.includes(f));
if (onlyData.length || onlyPublic.length) {
  fail(
    `opportunity file sets differ between planes (data-only: ${onlyData.length}, public-only: ${onlyPublic.length}). ` +
      `Fix the drift before expiring anything.`
  );
}

const records = [];
const unparseable = [];

for (const file of primaryFiles) {
  const raw = readText(`${primaryDir}/${file}`);
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    fail(`unparseable JSON in ${primaryDir}/${file}: ${err.message}`);
  }
  const expectedSlug = file.slice(0, -".json".length);
  if (obj.slug !== expectedSlug) {
    fail(`slug/filename mismatch: ${primaryDir}/${file} has slug "${obj.slug}"`);
  }
  records.push({ file, slug: obj.slug, raw, obj });
}

// ── decide ──────────────────────────────────────────────────────────────────

function evaluate(row) {
  const parsed = row.deadline ? parseDeadlineInput(row.deadline) : null;
  const rawPast = parsed !== null && parsed.getTime() < NOW.getTime();

  if (MODE === "utc") {
    if (rawPast) return { expire: true, rawPast, reason: "deadline < now (UTC)" };
    return { expire: false, rawPast, reason: "" };
  }

  if (deadlineNeverExpires(row.deadlineType)) {
    return {
      expire: false,
      rawPast,
      reason: `deadlineType "${row.deadlineType}" never expires`,
    };
  }
  if (isDeadlineExpired(row.deadline, NOW)) {
    return { expire: true, rawPast, reason: "London civil day ended" };
  }
  if (rawPast) {
    return { expire: false, rawPast, reason: "London civil day not over yet" };
  }
  return { expire: false, rawPast, reason: "" };
}

const matches = [];
const excluded = [];

for (const rec of records) {
  if (rec.obj.status !== "published") continue;
  if (!rec.obj.deadline) continue;
  if (parseDeadlineInput(rec.obj.deadline) === null) {
    unparseable.push(rec);
    continue;
  }
  const verdict = evaluate(rec.obj);
  if (verdict.expire) matches.push({ ...rec, ...verdict });
  else if (verdict.rawPast) excluded.push({ ...rec, ...verdict });
}

matches.sort((a, b) => {
  const ta = parseDeadlineInput(a.obj.deadline)?.getTime() ?? 0;
  const tb = parseDeadlineInput(b.obj.deadline)?.getTime() ?? 0;
  return ta - tb || a.slug.localeCompare(b.slug);
});
excluded.sort((a, b) => a.slug.localeCompare(b.slug));

if (unparseable.length) {
  console.warn(
    `\nWARNING: ${unparseable.length} published record(s) have an unparseable deadline and are skipped:`
  );
  for (const r of unparseable) console.warn(`  ${r.slug} | ${JSON.stringify(r.obj.deadline)}`);
}

// ── projected projections (computed before writing) ─────────────────────────

const beforePublished = records.filter((r) => r.obj.status === "published").length;
const afterPublished = beforePublished - matches.length;

const openSlugs = new Set(
  records.filter((r) => r.obj.status === "published").map((r) => r.slug)
);
for (const m of matches) openSlugs.delete(m.slug);

// index.json — filter the existing entries (never regenerate the shape).
const idxRawData = readText("data/index.json");
const idxRawPublic = readText("public/data/index.json");
if (idxRawData.replace(/\r\n/g, "\n") !== idxRawPublic.replace(/\r\n/g, "\n")) {
  fail("data/index.json and public/data/index.json are not identical — fix the drift first.");
}
const indexEntries = JSON.parse(idxRawData);
const nextIndex = indexEntries.filter((e) => openSlugs.has(e.slug));
const indexSlugSet = new Set(nextIndex.map((e) => e.slug));
const missingFromIndex = [...openSlugs].filter((s) => !indexSlugSet.has(s));
if (missingFromIndex.length) {
  fail(
    `index.json is missing ${missingFromIndex.length} published slug(s) (e.g. ${missingFromIndex
      .slice(0, 3)
      .join(", ")}). Refusing to guess-add entries — rebuild the index properly first.`
  );
}

// all-slugs.json — every record slug, sorted (status-independent).
const nextAllSlugs = records.map((r) => r.slug).sort();
const allSlugsRaw = readText("public/data/all-slugs.json");
const currentAllSlugs = JSON.parse(allSlugsRaw);

// stats.json — disk truth, lastExportAt preserved unless something changes.
const statsRawData = readText("data/stats.json");
const statsRawPublic = readText("public/data/stats.json");
if (statsRawData.replace(/\r\n/g, "\n") !== statsRawPublic.replace(/\r\n/g, "\n")) {
  fail("data/stats.json and public/data/stats.json are not identical — fix the drift first.");
}
const currentStats = JSON.parse(statsRawData);
const orgs = JSON.parse(readText("data/organizations.json"));
const articles = JSON.parse(readText("data/articles.json"));

const nextStats = {
  totalOpportunities: records.length,
  openOpportunities: afterPublished,
  organizationCount: orgs.length,
  articleCount: articles.length,
  lastExportAt: currentStats.lastExportAt,
  version: currentStats.version ?? 1,
};
const statsFieldsChanged =
  nextStats.totalOpportunities !== currentStats.totalOpportunities ||
  nextStats.openOpportunities !== currentStats.openOpportunities ||
  nextStats.organizationCount !== currentStats.organizationCount ||
  nextStats.articleCount !== currentStats.articleCount ||
  nextStats.version !== currentStats.version;
if (statsFieldsChanged) nextStats.lastExportAt = NOW.toISOString();

// ── report ──────────────────────────────────────────────────────────────────

const londonDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEADLINE_EVAL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(NOW);

console.log("nextapply-data · expire past-deadline listings");
console.log(`now              ${NOW.toISOString()}  (London day ${londonDay})`);
console.log(`mode             ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
console.log(
  `deadline policy  ${
    MODE === "utc"
      ? "literal UTC: deadline < now (includes custom/rolling + same-day)"
      : "canonical serving semantics: day-granular Europe/London; rolling/open_until_filled/custom never expire"
  }`
);
console.log("");

if (!QUIET) {
  console.log(`Matched (${matches.length}):`);
  if (matches.length === 0) console.log("  (none)");
  for (const m of matches) {
    console.log(`  ${m.slug}`);
    console.log(`    deadline ${m.obj.deadline}  ·  ${m.obj.deadlineType ?? "(no type)"}  ·  ${m.reason}`);
    console.log(`    ${m.obj.title ?? "(no title)"}`);
  }
  console.log("");
}

if (excluded.length) {
  console.log(`Excluded by policy despite a past deadline (${excluded.length}):`);
  for (const e of excluded) {
    console.log(`  ${e.slug} | ${e.obj.deadline} | ${e.obj.deadlineType ?? "(no type)"} — ${e.reason}`);
  }
  console.log("");
}

console.log("Projected result:");
console.log(`  published records   ${beforePublished} -> ${afterPublished}`);
console.log(`  index.json          ${indexEntries.length} -> ${nextIndex.length}`);
console.log(
  `  all-slugs.json      ${currentAllSlugs.length} -> ${nextAllSlugs.length}${
    JSON.stringify(currentAllSlugs) === JSON.stringify(nextAllSlugs) ? " (unchanged)" : ""
  }`
);
console.log(
  `  stats.json          openOpportunities ${currentStats.openOpportunities} -> ${nextStats.openOpportunities}` +
    (statsFieldsChanged ? `, lastExportAt -> ${nextStats.lastExportAt}` : " (unchanged)")
);
if (currentStats.organizationCount !== orgs.length || currentStats.articleCount !== articles.length) {
  console.log(
    `  NOTE: stats counts drift from disk — organizations ${currentStats.organizationCount} -> ${orgs.length}, ` +
      `articles ${currentStats.articleCount} -> ${articles.length}`
  );
}
console.log("");

// ── apply ───────────────────────────────────────────────────────────────────

const written = [];
const unchanged = [];

if (APPLY) {
  const nowIso = NOW.toISOString();

  // 1. Expire records in both planes. Verify plane parity per touched record
  //    BEFORE writing anything.
  for (const m of matches) {
    const pubRel = `${publicDir}/${m.file}`;
    if (!existsSync(abs(pubRel))) fail(`missing public twin: ${pubRel}`);
    const pubRaw = readText(pubRel);
    if (JSON.stringify(JSON.parse(pubRaw)) !== JSON.stringify(m.obj)) {
      fail(`plane drift on ${m.file}: data/ and public/data/ records differ. Fix drift first.`);
    }
  }

  for (const m of matches) {
    m.obj.status = "expired";
    m.obj.isOpen = false;
    m.obj.expiredAt = nowIso;

    const dataRel = `${primaryDir}/${m.file}`;
    const pubRel = `${publicDir}/${m.file}`;
    const dataContent = serializeLike(m.obj, readText(dataRel));
    const pubContent = serializeLike(m.obj, readText(pubRel));

    (writeIfChanged(dataRel, dataContent) ? written : unchanged).push(dataRel);
    (writeIfChanged(pubRel, pubContent) ? written : unchanged).push(pubRel);
  }

  // 2. index.json (both planes, same bytes).
  const nextIndexContent = serializeLike(nextIndex, idxRawData);
  (writeIfChanged("data/index.json", nextIndexContent) ? written : unchanged).push("data/index.json");
  (writeIfChanged("public/data/index.json", nextIndexContent) ? written : unchanged).push(
    "public/data/index.json"
  );

  // 3. all-slugs.json — public/data is its contractual home.
  const allSlugsContent = serializeLike(nextAllSlugs, allSlugsRaw);
  (writeIfChanged("public/data/all-slugs.json", allSlugsContent) ? written : unchanged).push(
    "public/data/all-slugs.json"
  );
  if (existsSync(abs("data/all-slugs.json")) || MIRROR_ALL_SLUGS) {
    const dataTwinRaw = existsSync(abs("data/all-slugs.json"))
      ? readText("data/all-slugs.json")
      : allSlugsRaw;
    (writeIfChanged("data/all-slugs.json", serializeLike(nextAllSlugs, dataTwinRaw))
      ? written
      : unchanged
    ).push("data/all-slugs.json");
  }

  // 4. stats.json (both planes).
  if (statsFieldsChanged) {
    const statsContent = serializeLike(nextStats, statsRawData);
    (writeIfChanged("data/stats.json", statsContent) ? written : unchanged).push("data/stats.json");
    (writeIfChanged("public/data/stats.json", statsContent) ? written : unchanged).push(
      "public/data/stats.json"
    );
  }
} else {
  for (const m of matches) {
    m.obj.status = "expired";
    m.obj.isOpen = false;
  }
}

// ── drift report (always, even on dry run) ──────────────────────────────────

// Keys are data-relative: data/x and public/data/x share the key "data/x".
const planeKey = (p) => p.replace(/^public\//, "");
const dataFiles = walk("data");
const publicFilesAll = walk("public/data");
const dataKeys = new Set(dataFiles);
const publicByKey = new Map(publicFilesAll.map((p) => [planeKey(p), p]));
const common = dataFiles.filter((p) => publicByKey.has(p));
const differing = common.filter((p) => sha256(p) !== sha256(publicByKey.get(p)));
const dataOnly = dataFiles.filter((p) => !publicByKey.has(p));
const publicOnly = publicFilesAll.filter((p) => !dataKeys.has(planeKey(p)));

console.log("Plane drift report (data/ vs public/data/):");
console.log(`  common files        ${common.length}`);
console.log(`  differing files     ${differing.length}${differing.length ? "  <-- MUST BE 0" : "  (ok)"}`);
console.log(`  data-only files     ${dataOnly.length}${dataOnly.length ? `: ${dataOnly.join(", ")}` : ""}`);
console.log(`  public-only files   ${publicOnly.length}${publicOnly.length ? `: ${publicOnly.join(", ")}` : ""}`);
if (differing.length) for (const p of differing) console.log(`    DIFF ${p}`);
console.log("");

if (APPLY) {
  console.log(`Written: ${written.length} file(s)`);
  for (const p of written) console.log(`  ${p}`);
  if (unchanged.length) console.log(`Already up to date: ${unchanged.length} file(s)`);
  console.log("");
  console.log(
    `Expired ${matches.length} listing(s). Re-running will match 0 (their status is now "expired").`
  );
} else {
  console.log(
    `Dry run — nothing written. Re-run with --apply to expire ${matches.length} listing(s).`
  );
  if (MODE === "canonical") {
    console.log(
      "Use --utc to see the literal 'deadline < now (UTC)' set (also expires custom/rolling and same-day deadlines)."
    );
  }
}

if (differing.length) {
  console.error("\nABORT: plane drift detected — data/ and public/data/ must be byte-identical.");
  process.exit(1);
}
