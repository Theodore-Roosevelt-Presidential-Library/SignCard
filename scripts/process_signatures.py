#!/usr/bin/env python3
"""
SignCard: screen new signatures and rebuild the public numbers.

Runs in GitHub Actions every 10 minutes (see .github/workflows/process.yml).

1. Reads signatures with status "new" from Firestore (service account, bypasses browser rules).
2. Screens names and messages with OpenAI: the free moderation model first, then a small
   chat model that checks names, approves or holds each message and scores it for featuring.
   If OpenAI is unreachable nothing is approved; the signatures stay "new" and are retried.
3. Keeps private running totals in Firestore (aggregates/<campaign>): count, ZIP counts,
   recent signer names and a pool of the best approved messages.
4. Writes data/<campaign>.json for the website: totals, featured messages (first name, last
   initial, city), signer names for the card, and ZIP-level map points. No emails, no full
   last names, no ZIP codes leave Firestore.

Local run (needs the same two environment variables):
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r scripts/requirements.txt
  FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" OPENAI_KEY=sk-... python3 scripts/process_signatures.py
Add --dry-run to screen and print without writing anything.
"""
import glob
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.environ.get("SIGNCARD_MODEL", "gpt-4.1-mini-2025-04-14")
MOD_MODEL = "omni-moderation-latest"
BATCH = 20            # signatures per chat-model call
MAX_PER_RUN = 600     # signatures read per run
POOL_SIZE = 200       # approved messages kept per campaign
SIGNERS_KEPT = 60     # recent names kept for the card
DRY = "--dry-run" in sys.argv


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- OpenAI

def openai(path, body, key, tries=3):
    req = urllib.request.Request(
        "https://api.openai.com/v1/" + path,
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    for n in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503) and n < tries - 1:
                time.sleep(4 * (n + 1))
                continue
            raise RuntimeError(f"OpenAI {path} {e.code}: {msg}")
        except urllib.error.URLError as e:
            if n < tries - 1:
                time.sleep(4 * (n + 1))
                continue
            raise RuntimeError(f"OpenAI {path} unreachable: {e}")


def moderate(texts, key):
    flagged = []
    for i in range(0, len(texts), 32):
        out = openai("moderations", {"model": MOD_MODEL, "input": texts[i:i + 32]}, key)
        flagged += [bool(r.get("flagged")) for r in out["results"]]
    return flagged


def review(items, campaign, key):
    """items: list of dicts with i, name, message. Returns dict i -> review."""
    ai = campaign.get("ai", {})
    system = (
        "You screen entries people submitted to sign a public online card on the website of the "
        "Theodore Roosevelt Presidential Library, a nonpartisan presidential library.\n"
        f"What people are writing: {ai.get('topic') or campaign.get('name', '')}.\n"
        f"What to feature: {ai.get('guidance') or 'heartfelt, specific, hopeful messages'}\n\n"
        "For every entry return an object with:\n"
        "- i: the entry number you were given\n"
        "- name_ok: true if the name looks like a real person's name; false for jokes, insults, "
        "celebrity or historical figures (including Theodore Roosevelt), slogans, spam or gibberish\n"
        "- approve: true only if the message is safe to show publicly here: on topic, no profanity, "
        "hate, harassment, sexual or violent content, no personal information (phone, email, address), "
        "no links or ads, and no partisan politics (no named living politicians, parties, campaigns, "
        "slogans or hot-button policy fights). Empty message: false\n"
        "- score: 0 to 10, how worth featuring it is: heartfelt, specific, hopeful, well written and "
        "connected to the topic. Generic one-liners score 3 or less. Not approved: 0\n"
        "- reason: at most 12 words\n"
        'Reply with JSON only: {"items": [...]}'
    )
    user = json.dumps([{"i": it["i"], "name": it["name"], "message": it["message"]} for it in items], ensure_ascii=False)
    out = openai("chat/completions", {
        "model": MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }, key)
    data = json.loads(out["choices"][0]["message"]["content"])
    res = {}
    for r in data.get("items", []):
        try:
            res[int(r["i"])] = {
                "name_ok": bool(r.get("name_ok")),
                "approve": bool(r.get("approve")),
                "score": max(0, min(10, float(r.get("score") or 0))),
                "reason": str(r.get("reason", ""))[:120],
            }
        except (KeyError, TypeError, ValueError):
            continue
    return res


# ---------------------------------------------------------------- helpers

def tidy_name(s):
    s = " ".join(str(s or "").split())[:60]
    if s and (s.islower() or s.isupper()):
        s = " ".join(w[:1].upper() + w[1:].lower() for w in s.split(" "))
    return s


def display_name(first, last):
    first, last = tidy_name(first), tidy_name(last)
    return (first + (" " + last[0].upper() + "." if last else "")).strip()


def load_campaigns():
    out = {}
    for p in glob.glob(os.path.join(ROOT, "campaigns", "*.json")):
        if os.path.basename(p) == "index.json":
            continue
        try:
            c = json.load(open(p, encoding="utf-8"))
            if c.get("id"):
                out[c["id"]] = c
        except Exception as e:
            log("Skipping unreadable campaign file", p, e)
    return out


def pick_featured(pool, campaign):
    mod = campaign.get("moderation", {}) or {}
    hide, pin = set(mod.get("hide", [])), list(mod.get("pin", []))
    want = max(1, min(40, int(campaign.get("wall", {}).get("count", 12) or 12)))
    pool = [p for p in pool if p["id"] not in hide]
    by_id = {p["id"]: p for p in pool}
    chosen = [by_id[i] for i in pin if i in by_id]
    rest = sorted((p for p in pool if p["id"] not in pin), key=lambda p: (-p["score"], -p["ts"]))
    per_state = {}
    for limit in (2, 999):  # first pass spreads picks across states
        for p in rest:
            if len(chosen) >= want:
                break
            if p in chosen:
                continue
            st = p.get("st", "")
            if per_state.get(st, 0) >= limit:
                continue
            chosen.append(p)
            per_state[st] = per_state.get(st, 0) + 1
    return [{"id": p["id"], "name": p["name"], "place": p["place"], "message": p["message"]} for p in chosen[:want]]


def public_json(cid, campaign, agg, zips):
    pts, states = {}, set()
    for z, n in (agg.get("zips") or {}).items():
        g = zips.get(z)
        if not g:
            continue
        states.add(g[3])
        k = (round(g[1], 2), round(g[0], 2))
        pts[k] = pts.get(k, 0) + n
    return {
        "campaign": cid,
        "updated": None,
        "total": int(agg.get("total", 0)),
        "states": len(states),
        "featured": pick_featured(agg.get("pool") or [], campaign),
        "signers": (agg.get("signers") or [])[:40],
        "points": sorted([[k[0], k[1], n] for k, n in pts.items()], key=lambda p: (-p[2], p[0])),
    }


def write_public(cid, data):
    path = os.path.join(ROOT, "data", cid + ".json")
    old = None
    if os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf-8"))
        except Exception:
            old = None
    if old is not None:
        a, b = dict(old), dict(data)
        a.pop("updated", None), b.pop("updated", None)
        if a == b:
            return False
    data["updated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return True


# ---------------------------------------------------------------- main

def main():
    sa, key = os.environ.get("FIREBASE_SERVICE_ACCOUNT", ""), os.environ.get("OPENAI_KEY", "")
    if not sa:
        log("FIREBASE_SERVICE_ACCOUNT is not set; nothing to do. Add it under Settings > Secrets and variables > Actions.")
        return 0
    if not key:
        log("OPENAI_KEY is not set; signatures stay unscreened until it is added.")
        return 0

    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud.firestore_v1.base_query import FieldFilter

    firebase_admin.initialize_app(credentials.Certificate(json.loads(sa)))
    db = firestore.client()
    campaigns = load_campaigns()
    zips = json.load(gzip.open(os.path.join(ROOT, "scripts", "zips.json.gz"), "rt", encoding="utf-8"))

    q = db.collection("signatures").where(filter=FieldFilter("status", "==", "new")).limit(MAX_PER_RUN)
    snaps = list(q.stream())
    log(f"{len(snaps)} new signature(s)")

    by_c = {}
    for s in snaps:
        d = s.to_dict()
        by_c.setdefault(d.get("campaign", ""), []).append((s, d))

    touched = set()
    for cid, rows in by_c.items():
        if cid not in campaigns:
            log(f"Unknown campaign '{cid}': {len(rows)} signature(s) set aside")
            if not DRY:
                b = db.batch()
                for s, _ in rows:
                    b.update(s.reference, {"status": "unknown_campaign", "processedAt": firestore.SERVER_TIMESTAMP})
                b.commit()
            continue
        campaign = campaigns[cid]
        try:
            texts = [f"{d.get('first', '')} {d.get('last', '')}\n{d.get('message', '')}".strip() for _, d in rows]
            flagged = moderate(texts, key)
            reviews = {}
            items = [{"i": i, "name": f"{d.get('first', '')} {d.get('last', '')}".strip(), "message": (d.get("message") or "").strip()}
                     for i, (_, d) in enumerate(rows)]
            for j in range(0, len(items), BATCH):
                reviews.update(review(items[j:j + BATCH], campaign, key))
        except RuntimeError as e:
            log(f"Screening failed for {cid}, will retry next run: {e}")
            continue

        agg_ref = db.collection("aggregates").document(cid)
        agg = (agg_ref.get().to_dict() or {}) if not DRY else {}
        agg.setdefault("total", 0)
        agg.setdefault("zips", {})
        agg.setdefault("pool", [])
        agg.setdefault("signers", [])

        batch, n_in_batch = (db.batch() if not DRY else None), 0
        for i, (s, d) in enumerate(rows):
            rv = reviews.get(i)
            if rv is None:  # model skipped it: retry next run
                continue
            fl = flagged[i]
            z = str(d.get("zip", ""))[:5]
            g = zips.get(z)
            place = f"{g[2]}, {g[3]}" if g else ""
            name = display_name(d.get("first"), d.get("last"))
            msg = " ".join(str(d.get("message") or "").split())
            agg["total"] += 1
            if g:
                agg["zips"][z] = agg["zips"].get(z, 0) + 1
            if rv["name_ok"] and not fl:
                agg["signers"] = [name] + [x for x in agg["signers"] if x != name]
                agg["signers"] = agg["signers"][:SIGNERS_KEPT]
            if rv["approve"] and rv["name_ok"] and not fl and msg:
                agg["pool"].append({"id": s.id[:10], "name": name, "place": place, "st": g[3] if g else "",
                                    "message": msg, "score": rv["score"], "ts": int(time.time())})
            log(f"  {s.id[:10]} {name:<18} flagged={fl} name_ok={rv['name_ok']} approve={rv['approve']} score={rv['score']:.0f} {rv['reason']}")
            if not DRY:
                batch.update(s.reference, {
                    "status": "done", "flagged": fl, "review": rv, "place": place,
                    "processedAt": firestore.SERVER_TIMESTAMP,
                })
                n_in_batch += 1
                if n_in_batch >= 400:
                    batch.commit()
                    batch, n_in_batch = db.batch(), 0
        agg["pool"] = sorted(agg["pool"], key=lambda p: (-p["score"], -p["ts"]))[:POOL_SIZE]
        agg["updatedAt"] = datetime.now(timezone.utc)
        if not DRY:
            # Totals first, then mark the signatures done. A crash in between can only
            # recount a few signatures on the next run, never lose them.
            agg_ref.set(agg)
            if n_in_batch:
                batch.commit()
        touched.add(cid)

    # Rebuild public files for every live campaign, so moderation edits (hide/pin) apply too.
    changed = 0
    for cid, campaign in campaigns.items():
        if DRY:
            continue
        snap = db.collection("aggregates").document(cid).get()
        agg = snap.to_dict() if snap.exists else {"total": 0}
        if write_public(cid, public_json(cid, campaign, agg, zips)):
            changed += 1
            log(f"Updated data/{cid}.json (total {agg.get('total', 0)})")
    log(f"Done. {changed} public file(s) changed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
