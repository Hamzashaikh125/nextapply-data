#!/usr/bin/env node
/**
 * Data validator for nextapply-data.
 *
 * Zero dependencies. Run from the repo root:
 *   node scripts/validate-data.mjs
 *
 * Checks:
 *   a. Schema of data/opportunities/*.json and data/articles/*.json:
 *      required fields, ISO-8601 dates, status/deadlineType enums,
 *      ISO 3166-1 alpha-2 country codes.
 *   b. No duplicate slugs across opportunities + articles.
 *   c. public/data/all-slugs.json <-> disk parity (opportunity slugs are
 *      required to be listed; listed article slugs must exist too).
 *   d. data/index.json == exactly the published opportunity set.
 *   e. data/stats.json counts match disk reality.
 *   f. Every file in data/ has a byte-identical twin in public/data/.
 *      (public/data/ is allowed to be a superset: all-slugs.json and
 *      world-110m.json have no data/ twin by design.)
 *   g. Article charts use the valid type enum, structuredData.@type exists,
 *      and sources has at least one entry.
 *
 * Exit code 1 on any failure; 0 with a summary table otherwise.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const OPP_DIR = path.join(DATA, "opportunities");
const ART_DIR = path.join(DATA, "articles");

const STATUSES = new Set(["published", "expired", "draft"]);
const DEADLINE_TYPES = new Set(["fixed", "rolling", "custom"]);
const CHART_TYPES = new Set(["bar", "hbar", "line", "donut", "combo"]);

// ISO 3166-1 alpha-2 + EU (exceptionally reserved, used for multi-country
// listings such as Erasmus Mundus / MSCA Doctoral Networks).
const ISO_ALPHA2 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
    "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
    "DE DJ DK DM DO DZ " +
    "EC EE EG EH ER ES ET " +
    "FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
    "HK HM HN HR HT HU " +
    "ID IE IL IM IN IO IQ IR IS IT " +
    "JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ " +
    "LA LB LC LI LK LR LS LT LU LV LY " +
    "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ " +
    "OM " +
    "PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
    "QA " +
    "RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ " +
    "VA VC VE VG VI VN VU " +
    "WF WS " +
    "YE YT " +
    "ZA ZM ZW EU"
  ).split(/\s+/),
);

const OPP_REQUIRED = [
  "slug",
  "id",
  "title",
  "status",
  "deadlineType",
  "deadline",
  "deadlineText",
  "isOpen",
  "countryCode",
  "organizationId",
  "organization",
  "category",
  "opportunityType",
  "intro",
  "description",
  "applyLink",
  "canonicalUrl",
  "createdAt",
  "updatedAt",
  "structuredData",
];

const ARTICLE_REQUIRED = [
  "id",
  "slug",
  "title",
  "status",
  "publishedAt",
  "updatedAt",
  "createdAt",
  "content",
  "seoTitle",
  "seoDescription",
  "description",
  "canonicalUrl",
  "structuredData",
  "sources",
  "charts",
  "tags",
  "category",
  "wordCount",
];

const OPP_DATE_FIELDS = [
  "deadline",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "addedDate",
  "expiredAt",
  "verifiedAt",
  "lastVerifiedAt",
];

const ARTICLE_DATE_FIELDS = ["createdAt", "updatedAt", "publishedAt", "lastReviewedAt"];

const failures = [];

function fail(file, field, reason) {
  failures.push({ file, field, reason });
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(rel(file), "<json>", `cannot parse JSON: ${error.message}`);
    return null;
  }
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  if (!dateOnly.test(value) && !dateTime.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkRequired(file, record, fields) {
  for (const field of fields) {
    if (!(field in record)) fail(file, field, "required field missing");
  }
}

function checkSlug(file, record, expectedSlug, owners) {
  if (typeof record.slug !== "string" || record.slug.length === 0) {
    fail(file, "slug", "must be a non-empty string");
    return;
  }
  if (record.slug !== expectedSlug) {
    fail(file, "slug", `"${record.slug}" does not match filename "${expectedSlug}"`);
  }
  if (owners.has(record.slug)) {
    fail(file, "slug", `duplicate slug (also used by ${owners.get(record.slug)})`);
  } else {
    owners.set(record.slug, file);
  }
}

function checkDates(file, record, fields) {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && !isIsoDate(value)) {
      fail(file, field, `not an ISO-8601 date/datetime: ${JSON.stringify(value)}`);
    }
  }
}

function checkStructuredData(file, record) {
  if (!isPlainObject(record.structuredData)) {
    fail(file, "structuredData", "must be an object");
    return;
  }
  if (typeof record.structuredData["@type"] !== "string" || !record.structuredData["@type"]) {
    fail(file, "structuredData.@type", "required non-empty string");
  }
}

function listJsonFiles(dir, { skip = [] } = {}) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !skip.includes(name))
    .sort();
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// a + b + g: opportunities and articles
// ---------------------------------------------------------------------------

const owners = new Map();
const opportunities = [];
const articles = [];
let chartCount = 0;

for (const name of listJsonFiles(OPP_DIR)) {
  const file = rel(path.join(OPP_DIR, name));
  const record = readJson(path.join(OPP_DIR, name));
  if (!isPlainObject(record)) {
    if (record !== null) fail(file, "<root>", "expected a JSON object");
    continue;
  }

  checkRequired(file, record, OPP_REQUIRED);
  checkSlug(file, record, name.replace(/\.json$/, ""), owners);

  if (!STATUSES.has(record.status)) {
    fail(file, "status", `invalid status ${JSON.stringify(record.status)} (expected published|expired|draft)`);
  }

  if (!DEADLINE_TYPES.has(record.deadlineType)) {
    fail(
      file,
      "deadlineType",
      `invalid deadlineType ${JSON.stringify(record.deadlineType)} (expected fixed|rolling|custom)`,
    );
  }

  if (typeof record.countryCode !== "string" || !ISO_ALPHA2.has(record.countryCode)) {
    fail(
      file,
      "countryCode",
      `${JSON.stringify(record.countryCode)} is not an ISO 3166-1 alpha-2 country code`,
    );
  }

  checkDates(file, record, OPP_DATE_FIELDS);
  checkStructuredData(file, record);

  if (record.deadlineType === "fixed" && (record.deadline === null || record.deadline === undefined)) {
    fail(file, "deadline", "deadlineType fixed requires a deadline");
  }
  if (record.deadlineType === "rolling" && record.deadline !== null && record.deadline !== undefined) {
    fail(file, "deadline", "deadlineType rolling must have deadline: null");
  }

  opportunities.push({ file, record });
}

for (const name of listJsonFiles(ART_DIR, { skip: ["index.json"] })) {
  const file = rel(path.join(ART_DIR, name));
  const record = readJson(path.join(ART_DIR, name));
  if (!isPlainObject(record)) {
    if (record !== null) fail(file, "<root>", "expected a JSON object");
    continue;
  }

  checkRequired(file, record, ARTICLE_REQUIRED);
  checkSlug(file, record, name.replace(/\.json$/, ""), owners);

  if (!STATUSES.has(record.status)) {
    fail(file, "status", `invalid status ${JSON.stringify(record.status)} (expected published|expired|draft)`);
  }

  checkDates(file, record, ARTICLE_DATE_FIELDS);
  checkStructuredData(file, record);

  if (!Array.isArray(record.sources) || record.sources.length < 1) {
    fail(file, "sources", "must be a non-empty array (at least 1 source)");
  }

  const chartEntries = Array.isArray(record.charts)
    ? record.charts.map((chart, index) => [chart && chart.id ? chart.id : `[${index}]`, chart])
    : isPlainObject(record.charts)
      ? Object.entries(record.charts)
      : null;

  if (!chartEntries) {
    fail(file, "charts", "must be an array of charts or an object mapping chart id -> chart");
  } else {
    for (const [chartId, chart] of chartEntries) {
      if (!isPlainObject(chart)) {
        fail(file, `charts.${chartId}`, "must be an object");
        continue;
      }
      if (!CHART_TYPES.has(chart.type)) {
        fail(
          file,
          `charts.${chartId}.type`,
          `invalid chart type ${JSON.stringify(chart.type)} (expected bar|hbar|line|donut|combo)`,
        );
      } else {
        chartCount++;
      }
    }
  }

  articles.push({ file, record });
}

// ---------------------------------------------------------------------------
// c: all-slugs.json parity
// ---------------------------------------------------------------------------

const allSlugsPath = path.join(PUBLIC_DATA, "all-slugs.json");
const allSlugs = readJson(allSlugsPath);
const oppSlugs = new Set(opportunities.map(({ record }) => record.slug));
const articleSlugs = new Set(articles.map(({ record }) => record.slug));
let listedSlugCount = 0;

if (allSlugs !== null) {
  if (!Array.isArray(allSlugs)) {
    fail(rel(allSlugsPath), "<root>", "must be an array of slugs");
  } else {
    const seen = new Set();
    for (const slug of allSlugs) {
      if (typeof slug !== "string" || slug.length === 0) {
        fail(rel(allSlugsPath), "<entry>", `invalid slug ${JSON.stringify(slug)}`);
        continue;
      }
      if (seen.has(slug)) {
        fail(rel(allSlugsPath), slug, "duplicate slug in all-slugs.json");
        continue;
      }
      seen.add(slug);
      listedSlugCount++;
      if (!oppSlugs.has(slug) && !articleSlugs.has(slug)) {
        fail(rel(allSlugsPath), slug, "slug has no file in data/opportunities or data/articles");
      }
    }

    // all-slugs.json is the opportunity manifest (articles have their own
    // articles.json/index.json). Every opportunity file must be listed.
    for (const slug of oppSlugs) {
      if (!seen.has(slug)) {
        fail(rel(allSlugsPath), slug, "opportunity file is missing from all-slugs.json");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// d: index.json == exactly the published opportunity set
// ---------------------------------------------------------------------------

const indexPath = path.join(DATA, "index.json");
const index = readJson(indexPath);
const publishedSlugs = new Set(
  opportunities.filter(({ record }) => record.status === "published").map(({ record }) => record.slug),
);
let indexSlugCount = 0;

if (index !== null) {
  if (!Array.isArray(index)) {
    fail(rel(indexPath), "<root>", "must be an array of listing entries");
  } else {
    const seen = new Set();
    for (const entry of index) {
      if (!isPlainObject(entry) || typeof entry.slug !== "string" || !entry.slug) {
        fail(rel(indexPath), "<entry>", "entry must be an object with a non-empty slug");
        continue;
      }
      if (seen.has(entry.slug)) {
        fail(rel(indexPath), entry.slug, "duplicate slug in index.json");
        continue;
      }
      seen.add(entry.slug);
      indexSlugCount++;
      if ("status" in entry && entry.status !== "published") {
        fail(rel(indexPath), entry.slug, `index entry status must be published (found ${JSON.stringify(entry.status)})`);
      }
    }

    for (const slug of publishedSlugs) {
      if (!seen.has(slug)) fail(rel(indexPath), slug, "published record missing from index.json");
    }
    for (const slug of seen) {
      if (!publishedSlugs.has(slug)) {
        fail(rel(indexPath), slug, "index entry is not a published opportunity on disk");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// e: stats.json counts
// ---------------------------------------------------------------------------

const organizationsPath = path.join(DATA, "organizations.json");
const organizations = readJson(organizationsPath);
const statsPath = path.join(DATA, "stats.json");
const stats = readJson(statsPath);

const expectedStats = {
  totalOpportunities: opportunities.length,
  openOpportunities: publishedSlugs.size,
  articleCount: articles.length,
  organizationCount: Array.isArray(organizations) ? organizations.length : -1,
};

if (stats !== null) {
  if (!isPlainObject(stats)) {
    fail(rel(statsPath), "<root>", "must be a JSON object");
  } else {
    for (const [key, expected] of Object.entries(expectedStats)) {
      if (stats[key] !== expected) {
        fail(rel(statsPath), key, `expected ${expected}, found ${JSON.stringify(stats[key])}`);
      }
    }
    if (stats.lastExportAt !== undefined && !isIsoDate(stats.lastExportAt)) {
      fail(rel(statsPath), "lastExportAt", "not an ISO-8601 datetime");
    }
  }
}

// ---------------------------------------------------------------------------
// f: plane drift (data/ -> public/data/, one directional)
// ---------------------------------------------------------------------------

const dataFiles = walk(DATA);
let commonFiles = 0;
for (const dataFile of dataFiles) {
  const relative = path.relative(DATA, dataFile);
  const publicFile = path.join(PUBLIC_DATA, relative);
  const publicRel = rel(publicFile);
  if (!fs.existsSync(publicFile)) {
    fail(publicRel, "<file>", `missing twin of ${rel(dataFile)}`);
    continue;
  }
  commonFiles++;
  if (!fs.readFileSync(dataFile).equals(fs.readFileSync(publicFile))) {
    fail(publicRel, "<file>", `differs from ${rel(dataFile)}`);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const summaryRows = [
  ["Opportunity files", `${opportunities.length} scanned`],
  ["Article files", `${articles.length} scanned`],
  ["Slugs", `${owners.size} unique (${oppSlugs.size} opportunities, ${articleSlugs.size} articles)`],
  ["all-slugs.json", `${listedSlugCount} listed / ${oppSlugs.size} opportunity files`],
  ["index.json", `${indexSlugCount} entries / ${publishedSlugs.size} published`],
  [
    "stats.json",
    `${expectedStats.totalOpportunities} total / ${expectedStats.openOpportunities} open / ` +
      `${expectedStats.articleCount} articles / ${expectedStats.organizationCount} orgs`,
  ],
  ["Plane drift", `${commonFiles} files compared`],
  ["Article charts", `${chartCount} charts with a valid type`],
];

if (failures.length > 0) {
  console.error(`\nDATA VALIDATION FAILED — ${failures.length} error(s)\n`);
  const grouped = new Map();
  for (const { file, field, reason } of failures) {
    if (!grouped.has(file)) grouped.set(file, []);
    grouped.get(file).push({ field, reason });
  }
  for (const [file, items] of grouped) {
    console.error(file);
    for (const { field, reason } of items) {
      console.error(`  - ${field}: ${reason}`);
    }
    console.error("");
  }
  console.error("Fix the errors above and re-run `node scripts/validate-data.mjs`.");
  process.exit(1);
}

console.log("\nDATA VALIDATION PASSED\n");

const checkWidth = Math.max("Check".length, ...summaryRows.map(([label]) => label.length));
const resultWidth = Math.max("Result".length, ...summaryRows.map(([, value]) => value.length));
const line = `${"-".repeat(checkWidth)}  ${"-".repeat(resultWidth)}`;

console.log(`${"Check".padEnd(checkWidth)}  ${"Result".padEnd(resultWidth)}`);
console.log(line);
for (const [label, value] of summaryRows) {
  console.log(`${label.padEnd(checkWidth)}  ${value.padEnd(resultWidth)}`);
}
console.log(line);
console.log("\nAll checks passed.");
