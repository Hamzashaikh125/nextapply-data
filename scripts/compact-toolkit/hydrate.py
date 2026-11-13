#!/usr/bin/env python3
"""NextApply data hydrator — restores the FULL original nextapply-data repo
from the minimized copy. Usage:

  python3 hydrate.py --out <target-dir>          # regenerate full repo
  python3 hydrate.py --out <dir> --verify <src>   # + compare against original
  python3 hydrate.py --min <min-dir> --out <dir>  # min repo lives elsewhere

Run from the minimized repo (default), or point --min at it. --verify accepts
both the old two-plane layout (data/ + public/data/) and the single-plane
push layout (public/data/ only).

The minimized repo is info-complete: every file this script writes is either
copied verbatim, restored from overrides.json, or regenerated with rules that
were verified file-by-file at minimize time.
"""
import json, os, re, glob, hashlib, shutil, argparse, sys
from urllib.parse import urlparse

def _min_dir():
    # --min <path> wins (used when this script is invoked from another toolkit
    # location); default is the minimized repo this script lives in.
    for i, a in enumerate(sys.argv):
        if a == "--min" and i + 1 < len(sys.argv):
            return os.path.abspath(sys.argv[i + 1])
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MIN = _min_dir()
MIN_DATA = os.path.join(MIN, "data")

def jload(p):
    with open(p) as f:
        return json.load(f)

def jdump(obj, path):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    with open(path, "w") as f:
        f.write(json.dumps(obj, indent=1, ensure_ascii=False))

# ---------- load minimized ----------
orgs = {o["id"]: o for o in jload(os.path.join(MIN_DATA, "organizations.json"))}
overrides = jload(os.path.join(MIN_DATA, "overrides.json"))
genmeta = jload(os.path.join(MIN_DATA, "generation-meta.json"))
merged_taxonomy = jload(os.path.join(MIN_DATA, "taxonomy.json"))
min_reds = jload(os.path.join(MIN_DATA, "redirects.min.json"))
announcements = jload(os.path.join(MIN_DATA, "announcements.json"))
all_slugs = jload(os.path.join(MIN_DATA, "all-slugs.json"))

art_core = {}
for f in glob.glob(os.path.join(MIN_DATA, "articles", "*.json")):
    a = jload(f)
    art_core[a["slug"]] = a
art_titles = {s: a.get("title") for s, a in art_core.items()}

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

MARK = "\u0001{}\u0001"
def expand_description(o):
    desc = o.get("descriptionCore", "")
    if not desc:
        return desc
    gens = {"contact": lambda: BLOCK_CONTACT, "official": lambda: gen_official(o),
            "notes": lambda: gen_notes(o), "about": lambda: gen_about(o)}
    if "applicationGuides" in o:
        gens["guides"] = lambda: gen_guides(o["applicationGuides"])
    for name, fn in gens.items():
        desc = desc.replace(MARK.format(name), fn())
    return desc

def restore_opportunity(core):
    o = {k: v for k, v in core.items()
         if k not in ("descriptionCore", "applicationGuides", "_d")}
    slug = o["slug"]
    ov = overrides.get(slug, {})
    present = core.get("_d", [])
    # organization
    if "organization" in present:
        if "organization" in ov:
            o["organization"] = ov["organization"]
        else:
            ref = orgs.get(o.get("organizationId"), {})
            o["organization"] = {k: v for k, v in ref.items()
                                 if k in ("website", "name", "id", "logoUrl", "slug")}
    # description
    o["description"] = expand_description(core)
    # derived scalars (only those originally present)
    DERIVERS = {
        "canonicalUrl": f"https://nextapply.co.uk/{slug}",
        "ogImage": f"https://nextapply.co.uk/{slug}/opengraph-image",
        "robots": "index,follow",
        "fundingStatus": o.get("fundingType"),
        "category": o.get("opportunityType"),
        "addedDate": o.get("createdAt"),
        "publishedAt": o.get("createdAt"),
        "verifiedAt": o.get("lastVerifiedAt"),
    }
    for k, v in DERIVERS.items():
        if k not in present:
            continue
        if k in ov:
            o[k] = ov[k]
        elif v is not None:
            o[k] = v
    return o

# ---------- main ----------
def build(out):
    # opportunities
    for f in glob.glob(os.path.join(MIN_DATA, "opportunities", "*.json")):
        core = jload(f)
        o = restore_opportunity(core)
        jdump(o, os.path.join(out, "data", "opportunities", f"{o['slug']}.json"))
    # articles
    for slug, a in art_core.items():
        r = {k: v for k, v in a.items() if k != "_missingDerived"}
        missing = a.get("_missingDerived", [])
        if "id" not in missing and "id" not in a:
            r["id"] = slug
        if "ogImage" not in missing and "ogImage" not in a:
            r["ogImage"] = a.get("featuredImage")
        if "createdAt" not in missing and "createdAt" not in a:
            r["createdAt"] = a.get("publishedAt")
        if "robots" not in missing and "robots" not in a:
            r["robots"] = "index,follow"
        if "inLanguage" not in missing and "inLanguage" not in a:
            r["inLanguage"] = "en-GB"
        if "canonicalUrl" not in missing and "canonicalUrl" not in a:
            r["canonicalUrl"] = f"https://nextapply.co.uk/articles/{slug}"
        jdump(r, os.path.join(out, "data", "articles", f"{slug}.json"))
    # verbatim files
    for fn in ("organizations.json", "announcements.json"):
        shutil.copyfile(os.path.join(MIN_DATA, fn), os.path.join(out, "data", fn))
    # taxonomy.json + settings.json from merged (both originals preserved)
    settings_keys = genmeta["settingsKeys"]
    taxonomy_keys = genmeta.get("taxonomyKeys", list(merged_taxonomy.keys()))
    taxonomy = {k: merged_taxonomy[k] for k in taxonomy_keys}
    settings = {k: merged_taxonomy.get(f"settings_{k}", merged_taxonomy.get(k))
                for k in settings_keys}
    jdump(taxonomy, os.path.join(out, "data", "taxonomy.json"))
    jdump(settings, os.path.join(out, "data", "settings.json"))
    # redirects
    rule_entries = {}
    for rule in min_reds["rules"]:
        if rule["kind"] == "org_to_university":
            for s in rule["slugs"]:
                rule_entries[f"/organization/{s}"] = {"source": f"/organization/{s}",
                        "destination": f"/universities/{s}", "type": rule["type"]}
        elif rule["kind"] == "opp_path_strip":
            for s in rule["slugs"]:
                src = f"/opportunities/{s}"
                rule_entries[src] = {"id": "r_" + hashlib.sha1(src.encode()).hexdigest(),
                        "source": src, "destination": f"/{s}", "type": rule["type"],
                        "createdAt": rule["createdAt"]}
    for e in min_reds["exceptions"]:
        rule_entries[e["source"]] = e
    reds_out = [rule_entries[s] for s in genmeta["redirectSources"] if s in rule_entries]
    # any leftovers (order unknown) appended
    leftover = [v for k, v in rule_entries.items() if k not in set(genmeta["redirectSources"])]
    reds_out.extend(leftover)
    jdump(reds_out, os.path.join(out, "data", "redirects.json"))
    # index.json
    idx_out = []
    for slug in genmeta["indexSlugs"]:
        core = jload(os.path.join(MIN_DATA, "opportunities", f"{slug}.json"))
        o = restore_opportunity(core)
        org = o.get("organization", {})
        org_entry = genmeta.get("indexOrgDeltas", {}).get(o["slug"],
                                                          {"name": org.get("name"), "logoUrl": org.get("logoUrl")})
        idx_out.append({
            "slug": o["slug"], "id": o.get("id"), "title": o.get("title"), "intro": o.get("intro"),
            "organization": org_entry,
            "organizationId": o.get("organizationId"), "city": o.get("city"),
            "countryCode": o.get("countryCode"), "regionId": o.get("regionId"),
            "category": o.get("category"), "disciplines": o.get("disciplines"),
            "subjects": o.get("subjects"), "degreeLevels": o.get("degreeLevels"),
            "tags": o.get("tags"), "eligibility": o.get("eligibility"),
            "fundingType": o.get("fundingType"), "fundingCoverage": o.get("fundingCoverage"),
            "stipend": o.get("stipend"), "stipendAmount": o.get("stipendAmount"),
            "stipendPeriod": o.get("stipendPeriod"), "deadline": o.get("deadline"),
            "deadlineText": o.get("deadlineText"), "deadlineType": o.get("deadlineType"),
            "status": o.get("status"), "isFeatured": o.get("isFeatured"),
            "isRemote": o.get("isRemote"), "ieltsRequired": o.get("ieltsRequired"),
            "ogImage": o.get("ogImage"), "opportunityType": o.get("opportunityType"),
            "addedDate": o.get("addedDate"), "updatedAt": genmeta.get("indexUpdatedAtDeltas", {}).get(o["slug"], o.get("updatedAt")),
            "verificationStatus": o.get("verificationStatus"),
        })
    jdump(idx_out, os.path.join(out, "data", "index.json"))
    # articles.json
    arts_out = []
    for slug in genmeta["articlesIndexSlugs"]:
        a = art_core[slug]
        arts_out.append({
            "id": slug, "slug": slug, "title": a.get("title"), "excerpt": a.get("excerpt"),
            "wordCount": a.get("wordCount"), "author": a.get("author"), "tags": a.get("tags"),
            "featuredImage": a.get("featuredImage"), "publishedAt": a.get("publishedAt"),
            "createdAt": a.get("createdAt", a.get("publishedAt")), "updatedAt": a.get("updatedAt"),
            "readingTimeMinutes": a.get("readingTimeMinutes"),
        })
    jdump(arts_out, os.path.join(out, "data", "articles.json"))
    # articles/index.json
    i2 = []
    a2d = genmeta.get("articlesIndex2Deltas", {})
    for slug in genmeta["articlesIndex2"]["slugs"]:
        a = art_core[slug]
        entry = {"slug": slug, "title": a.get("title"), "category": a.get("category"),
                 "wordCount": a.get("wordCount"), "isFeatured": a.get("isFeatured"),
                 "updatedAt": a.get("updatedAt"),
                 "readingTimeMinutes": a.get("readingTimeMinutes")}
        for k, v in a2d.get(slug, {}).items():
            entry[k] = v
        i2.append(entry)
    jdump({"total": genmeta["articlesIndex2"]["total"],
            "generatedAt": genmeta["articlesIndex2"]["generatedAt"], "articles": i2},
          os.path.join(out, "data", "articles", "index.json"))
    # stats.json
    opp_count = len(glob.glob(os.path.join(MIN_DATA, "opportunities", "*.json")))
    open_count = sum(1 for f in glob.glob(os.path.join(MIN_DATA, "opportunities", "*.json"))
                     if jload(f).get("status") == "published")
    jdump({"totalOpportunities": opp_count, "openOpportunities": open_count,
            "organizationCount": len(orgs), "articleCount": len(art_core),
            "lastExportAt": genmeta["statsLastExportAt"], "version": genmeta["statsVersion"]},
          os.path.join(out, "data", "stats.json"))
    # activity_logs.json (empty in source)
    jdump([], os.path.join(out, "data", "activity_logs.json"))
    # images + static (single-plane minimized layout)
    shutil.copytree(os.path.join(MIN_DATA, "article-images"),
                    os.path.join(out, "data", "article-images"))
    # public/data twin = exact original layout: data/* + all-slugs + world-110m
    pub = os.path.join(out, "public", "data")
    os.makedirs(pub, exist_ok=True)
    for root, _, files in os.walk(os.path.join(out, "data")):
        rel = os.path.relpath(root, os.path.join(out, "data"))
        for fn in files:
            dst = os.path.join(pub, rel, fn) if rel != "." else os.path.join(pub, fn)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(root, fn), dst)
    shutil.copyfile(os.path.join(MIN_DATA, "world-110m.json"), os.path.join(pub, "world-110m.json"))
    jdump(all_slugs, os.path.join(pub, "all-slugs.json"))
    return out

def verify(out, src):
    """Semantic JSON equality of every file vs original repo (+ byte stats).
    Works with both repo layouts: two-plane (data/ + public/data/) and the
    minimized single-plane push layout (public/data/ only)."""
    import glob as g
    plane = os.path.join(src, "data")
    if not os.path.isdir(plane):
        plane = os.path.join(src, "public", "data")
    checks = {"semantic_ok": 0, "semantic_fail": 0, "byte_ok": 0, "byte_total": 0}
    fails = []
    pairs = []
    for f in g.glob(os.path.join(plane, "opportunities", "*.json")):
        pairs.append((f, os.path.join(out, "data", "opportunities", os.path.basename(f))))
    for f in g.glob(os.path.join(plane, "articles", "*.json")):
        pairs.append((f, os.path.join(out, "data", "articles", os.path.basename(f))))
    for fn in ("organizations.json", "announcements.json", "taxonomy.json", "settings.json",
               "redirects.json", "index.json", "articles.json", "stats.json"):
        pairs.append((os.path.join(plane, fn), os.path.join(out, "data", fn)))
    for orig, gen in pairs:
        if not os.path.exists(gen):
            checks["semantic_fail"] += 1
            fails.append(("MISSING", gen))
            continue
        a, b = open(orig).read(), open(gen).read()
        checks["byte_total"] += 1
        if a == b:
            checks["byte_ok"] += 1
        try:
            if jload(orig) == jload(gen):
                checks["semantic_ok"] += 1
            else:
                checks["semantic_fail"] += 1
                fails.append(("SEMANTIC", orig))
        except Exception as e:
            checks["semantic_fail"] += 1
            fails.append(("ERROR", f"{orig}: {e}"))
    print(json.dumps(checks, indent=1))
    if fails:
        print("FAILURES (first 20):")
        for kind, p in fails[:20]:
            print(" ", kind, p)
    return checks, fails

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--verify", default=None)
    ap.add_argument("--min", default=None,
                    help="path to the minimized repo (default: this script's repo)")
    args = ap.parse_args()
    build(args.out)
    print("built:", args.out)
    if args.verify:
        verify(args.out, args.verify)
