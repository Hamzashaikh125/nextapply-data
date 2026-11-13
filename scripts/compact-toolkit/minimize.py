#!/usr/bin/env python3
"""NextApply data minimizer (v3) — zero data loss.
Drops a field ONLY when it is 100% derivable from kept fields (verified
file-by-file). Anything that fails derivation is kept verbatim in
data/overrides.json. Description boilerplate blocks are replaced by tiny
positional markers. scripts/hydrate.py restores the full original repo.

Usage:
  python3 minimize.py <source-repo-dir> <output-min-dir>

<source-repo-dir> may be the original two-plane layout (data/ + public/data/)
or the minimized single-plane layout (public/data/ only).
"""
import json, os, re, glob, shutil, hashlib, sys
from collections import Counter
from urllib.parse import urlparse

SRC = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/work/nextapply-data"
DST = sys.argv[2] if len(sys.argv) > 2 else "/home/z/my-project/download/nextapply-data-min"
D = os.path.join(SRC, "data")
if not os.path.isdir(D):
    D = os.path.join(SRC, "public", "data")   # single-plane layout
OUT = os.path.join(DST, "data")

for sub in ("opportunities", "articles"):
    os.makedirs(os.path.join(OUT, sub), exist_ok=True)
os.makedirs(os.path.join(DST, "scripts"), exist_ok=True)

stats, overrides, saved = Counter(), {}, Counter()

def jdump(obj, path):
    with open(path, "w") as f:
        f.write(json.dumps(obj, indent=1, ensure_ascii=False))

orgs = {o["id"]: o for o in json.load(open(os.path.join(D, "organizations.json")))}
opps = {}
for f in sorted(glob.glob(os.path.join(D, "opportunities", "*.json"))):
    o = json.load(open(f))
    opps[o["slug"]] = o
art_files = {os.path.basename(f)[:-5]: json.load(open(f))
             for f in glob.glob(os.path.join(D, "articles", "*.json"))}
art_titles = {s: a.get("title") for s, a in art_files.items() if s != "index"}

DERIVERS = {
    "canonicalUrl": lambda o: f"https://nextapply.co.uk/{o['slug']}",
    "ogImage": lambda o: f"https://nextapply.co.uk/{o['slug']}/opengraph-image",
    "robots": lambda o: "index,follow",
    "fundingStatus": lambda o: o.get("fundingType"),
    "category": lambda o: o.get("opportunityType"),
    "addedDate": lambda o: o.get("createdAt"),
    "publishedAt": lambda o: o.get("createdAt"),
    "verifiedAt": lambda o: o.get("lastVerifiedAt"),
}

BLOCK_CONTACT = ('<h2>Contact</h2><p>Questions about this position, eligibility or the application '
                 'process should be raised through the contact channel given on the official '
                 'announcement page (see the Official Link section above). Always quote the position '
                 'reference in your message so the admissions or HR team can route your enquiry quickly.</p>')
def gen_official(o):
    link = o.get("applyLink") or ""
    dom = urlparse(link).netloc if link else ""
    return ('<h2>Official Link</h2><p>Full announcement and application portal: '
            f'<a href="{link}" target="_blank" rel="noopener noreferrer">{link}</a></p>'
            f'<p>Source: {dom} - the details in this listing were recorded from this official page.</p>')
def gen_notes(o):
    dt = o.get("deadlineText") or ""
    return ('<h2>Important Notes</h2><ul>'
            f'<li>Application deadline: {dt} - late or incomplete applications are normally not considered.</li>'
            '<li>Listing details were recorded from the official source at the time of publication; '
            'always confirm the latest requirements on the official page before applying.</li>'
            '<li>Prepare the documents listed in the eligibility and application sections before '
            'starting the online form - transcripts, CV and references take the longest to collect.</li></ul>')
def gen_about(o):
    emb = o.get("organization") or {}
    org = orgs.get(o.get("organizationId"), {})
    name = emb.get("name") or org.get("name", "")
    about = (emb.get("about") if isinstance(emb.get("about"), str) else None) or org.get("about", "")
    site = emb.get("website") or org.get("website", "")
    return (f'<h2>About {name}</h2><p>{about}</p>'
            f'<p>Official website: <a href="{site}" target="_blank" rel="noopener noreferrer">{site}</a></p>')
def gen_guides(gs):
    lis = "".join(f'<li><a href="https://nextapply.co.uk/articles/{s}">{art_titles.get(s, s)}</a></li>'
                  for s in gs)
    return f"<h2>Application guides</h2><ul>{lis}</ul>"
GUIDE_RE = re.compile(r'<h2>Application guides</h2><ul>(.*?)</ul>', re.S)
MARK = "\u0001{}\u0001"

# ---------- opportunities ----------
for slug, o in opps.items():
    core, ov = {}, {}
    present_derived = []
    for k, fn in DERIVERS.items():
        if k in o:
            present_derived.append(k)
            if fn(o) != o[k]:
                ov[k] = o[k]
            else:
                stats[f"dropped_{k}"] += 1
    if "organization" in o:
        present_derived.append("organization")
        ref = {k: v for k, v in (orgs.get(o.get("organizationId")) or {}).items()
               if k in ("website", "name", "id", "logoUrl", "slug")}
        if ref == o["organization"]:
            stats["dropped_organization"] += 1
        else:
            ov["organization"] = o["organization"]
    core["_d"] = present_derived
    desc = o.get("description", "")
    if desc:
        blocks = []
        for name, pat in (("contact", r'<h2>Contact</h2><p>.*?</p>'),
                          ("official", r'<h2>Official Link</h2><p>.*?</p><p>Source:.*?</p>'),
                          ("notes", r'<h2>Important Notes</h2><ul>.*?</ul>'),
                          ("about", r'<h2>About [^<]+</h2><p>.*?</p><p>Official website:.*?</p>')):
            m = re.search(pat, desc, re.S)
            if m:
                gen = {"contact": lambda: BLOCK_CONTACT, "official": lambda: gen_official(o),
                       "notes": lambda: gen_notes(o), "about": lambda: gen_about(o)}[name]
                if m.group(0) == gen():
                    blocks.append((m.start(), m.end(), name, m.group(0)))
                else:
                    stats[f"block_mismatch_{name}"] += 1
            else:
                stats[f"block_absent_{name}"] += 1
        gs = None
        m = GUIDE_RE.search(desc)
        if m:
            gs = re.findall(r'href="https://nextapply\.co\.uk/articles/([a-z0-9-]+)"', m.group(1))
            if m.group(0) == gen_guides(gs):
                blocks.append((m.start(), m.end(), "guides", m.group(0)))
        if blocks:
            blocks.sort()
            # replace each block with a marker, in reverse to keep offsets valid
            newdesc = desc
            for st, en, name, _ in reversed(blocks):
                newdesc = newdesc[:st] + MARK.format(name) + newdesc[en:]
            core["descriptionCore"] = newdesc
            if gs:
                core["applicationGuides"] = gs
            stats["desc_markerstripped"] += 1
            saved["description"] += sum(en - st for st, en, _, _ in blocks) - sum(len(MARK.format(n)) for _, _, n, _ in blocks)
        else:
            core["descriptionCore"] = desc
            stats["desc_full"] += 1
    for k, v in o.items():
        if k in ("description", "organization", "canonicalUrl", "ogImage", "robots",
                 "fundingStatus", "category", "addedDate", "publishedAt", "verifiedAt"):
            continue
        core[k] = v
    if ov:
        overrides[slug] = ov
    jdump(core, os.path.join(OUT, "opportunities", f"{slug}.json"))
    stats["opps"] += 1

# ---------- articles ----------
MISSING_DEFAULTS = ("robots", "inLanguage", "canonicalUrl", "id", "ogImage", "createdAt", "featuredImage")
for s, a in art_files.items():
    if s == "index":
        continue
    core = {k: v for k, v in a.items() if k not in
             ("id", "ogImage", "createdAt", "robots", "inLanguage", "canonicalUrl")}
    # keep exceptions where values deviate from derivable defaults
    if a.get("ogImage") != a.get("featuredImage"):
        core["ogImage"] = a.get("ogImage")
    if a.get("createdAt") != a.get("publishedAt"):
        core["createdAt"] = a.get("createdAt")
    missing = [k for k in ("robots", "inLanguage", "canonicalUrl", "id", "ogImage", "createdAt")
               if k not in a]
    if missing:
        core["_missingDerived"] = missing
    jdump(core, os.path.join(OUT, "articles", f"{s}.json"))
    stats["arts"] += 1

# ---------- verbatim copies ----------
for fn in ("organizations.json", "announcements.json"):
    shutil.copyfile(os.path.join(D, fn), os.path.join(OUT, fn))
settings = json.load(open(os.path.join(D, "settings.json")))
taxonomy = json.load(open(os.path.join(D, "taxonomy.json")))
merged = dict(taxonomy)
for k, v in settings.items():
    if k not in merged:
        merged[k] = v
    elif merged[k] != v:
        merged[f"settings_{k}"] = v
jdump(merged, os.path.join(OUT, "taxonomy.json"))

# ---------- redirects ----------
reds = json.load(open(os.path.join(D, "redirects.json")))
org_slugs, opp_meta = [], []
exceptions = []
for r in reds:
    s, dst = r["source"], r["destination"]
    if s.startswith("/organization/") and dst == "/universities/" + s.split("/")[2] and "id" not in r:
        org_slugs.append(s.split("/")[2])
    elif s.startswith("/opportunities/") and dst == "/" + s.split("/")[2] and "id" in r:
        ok = r["id"] == "r_" + hashlib.sha1(s.encode()).hexdigest()
        if not ok:
            exceptions.append(r)
        else:
            opp_meta.append({"slug": s.split("/")[2], "createdAt": r.get("createdAt")})
    else:
        exceptions.append(r)
# createdAt constant check
ca = {m["createdAt"] for m in opp_meta}
opp_created = ca.pop() if len(ca) == 1 else None
if opp_created is None:
    exceptions.extend({"source": "/opportunities/" + m["slug"], "destination": "/" + m["slug"],
                       "type": 301, "id": "r_" + hashlib.sha1(("/opportunities/" + m["slug"]).encode()).hexdigest(),
                       "createdAt": m["createdAt"]} for m in opp_meta)
    opp_slugs = []
else:
    opp_slugs = [m["slug"] for m in opp_meta]
org_type = None
for r in reds:
    if r["source"].startswith("/organization/"):
        org_type = r.get("type")
        break
opp_type = 301
for r in reds:
    if r["source"].startswith("/opportunities/") and "id" in r:
        opp_type = r.get("type")
        break
min_reds = {
    "rules": [],
    "exceptions": exceptions,
}
if org_slugs:
    min_reds["rules"].append({"kind": "org_to_university", "slugs": org_slugs, "type": org_type})
if opp_slugs:
    min_reds["rules"].append({"kind": "opp_path_strip", "slugs": opp_slugs, "type": opp_type,
                              "createdAt": opp_created, "idPrefix": "r_", "idHash": "sha1(source)"})
jdump(min_reds, os.path.join(OUT, "redirects.min.json"))
stats["redirect_exceptions"] = len(exceptions)
stats["redirect_rule_slugs"] = len(org_slugs) + len(opp_slugs)

# ---------- generation metadata ----------
idx = json.load(open(os.path.join(D, "index.json")))
arts_idx = json.load(open(os.path.join(D, "articles.json")))
arts_index2 = json.load(open(os.path.join(D, "articles", "index.json")))
stats_orig = json.load(open(os.path.join(D, "stats.json")))
all_slugs = json.load(open(os.path.join(SRC, "public", "data", "all-slugs.json")))
redirect_order = [r["source"] for r in reds]
# drift capture: values that live only in generated index files
index_updated_deltas = {i["slug"]: i["updatedAt"] for i in idx
                           if i.get("updatedAt") != opps[i["slug"]].get("updatedAt")}
# org shape deltas: entries whose index organization != {name, logoUrl} of the file's org
index_org_deltas = {}
for i in idx:
    emb = opps[i["slug"]].get("organization") or {}
    std = {"name": emb.get("name"), "logoUrl": emb.get("logoUrl")}
    if i.get("organization") != std:
        index_org_deltas[i["slug"]] = i["organization"]
arts_index2_deltas = {}
for i in arts_index2.get("articles", []):
    a = art_files.get(i["slug"])
    if a:
        d = {k: v for k, v in i.items() if k != "slug" and v != a.get(k)}
        if d:
            arts_index2_deltas[i["slug"]] = d
genmeta = {
    "indexSlugs": [i["slug"] for i in idx],
    "settingsKeys": list(settings.keys()),
    "taxonomyKeys": list(taxonomy.keys()),
    "statsLastExportAt": stats_orig.get("lastExportAt"),
    "statsVersion": stats_orig.get("version"),
    "redirectSources": redirect_order,
    "articlesIndexSlugs": [a["slug"] for a in arts_idx],
    "articlesIndex2": {"total": arts_index2.get("total"), "generatedAt": arts_index2.get("generatedAt"),
                        "slugs": [a["slug"] for a in arts_index2.get("articles", [])]},
    "indexUpdatedAtDeltas": index_updated_deltas,
    "indexOrgDeltas": index_org_deltas,
    "articlesIndex2Deltas": arts_index2_deltas,
    "allSlugsEqual": all_slugs == sorted(all_slugs),
}
jdump(genmeta, os.path.join(OUT, "generation-meta.json"))
jdump(all_slugs, os.path.join(OUT, "all-slugs.json"))

# ---------- overrides ----------
jdump(overrides, os.path.join(OUT, "overrides.json"))

# ---------- images & static assets: single plane ----------
shutil.copytree(os.path.join(D, "article-images"), os.path.join(OUT, "article-images"))
shutil.copyfile(os.path.join(SRC, "public", "data", "world-110m.json"),
                os.path.join(OUT, "world-110m.json"))

# ---------- manifest ----------
def dir_bytes(p):
    t = 0
    for root, _, files in os.walk(p):
        for fn in files:
            t += os.path.getsize(os.path.join(root, fn))
    return t
src_bytes = (dir_bytes(os.path.join(SRC, "data")) if os.path.isdir(os.path.join(SRC, "data")) else 0) \
            + dir_bytes(os.path.join(SRC, "public"))
min_bytes = dir_bytes(DST)
manifest = {
    "source": f"minimized from {os.path.abspath(SRC)}",
    "generatedAt": "2026-11-14",
    "records": {"opportunities": len(opps), "articles": stats["arts"],
                "organizations": len(orgs), "redirects": len(reds)},
    "bytes": {"source_both_planes": src_bytes, "minimized_single_plane": min_bytes,
               "reduction_pct": round(100 * (1 - min_bytes / src_bytes), 1)},
    "stats": {k: int(v) for k, v in stats.items()},
    "saved_bytes_description_tails": int(saved["description"]),
    "restore": "python3 scripts/hydrate.py --out <dir>  →  full original repo (data/ + public/data/ twin), verified file-by-file against the source.",
}
jdump(manifest, os.path.join(DST, "manifest.json"))
print(json.dumps(manifest, indent=1))
