"""Write a shared table as a bundled extension pack.

The reference tools (maneuvers_ref.py, vancian_ref.py, psionic_ref.py) used
to write bare table files under data/. The engine reads those tables from
extension packs now -- one JSON document per pack under data/extensions/,
listed in data/extensions/index.json -- so each tool wraps its table in a pack
here. An existing pack's header (name, author, description, source, license)
is kept and its revision bumped, so re-running a tool updates the table
without losing what somebody wrote about it.
"""
import datetime
import json
import os

FORMAT = "character-sheet-extension"
FORMAT_VERSION = 1


def write_pack(path, pack_id, kind, table, name=None, description=""):
    prior = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                prior = json.load(f)
        except (OSError, ValueError):
            prior = {}
    now = datetime.datetime.now().isoformat(timespec="seconds")
    doc = {
        "format": FORMAT,
        "formatVersion": FORMAT_VERSION,
        "id": prior.get("id") or pack_id,
        "name": prior.get("name") or name or pack_id,
        "author": prior.get("author", ""),
        "description": prior.get("description") or description,
        "source": prior.get("source", ""),
        "license": prior.get("license", ""),
        "revision": int(prior.get("revision", 0) or 0) + 1,
        "createdAt": prior.get("createdAt") or now,
        "updatedAt": now,
    }
    provides = dict(prior.get("provides") or {})
    provides[kind] = table
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("{\n")
        lines = [f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in doc.items()]
        lines.append(f' "provides": {json.dumps(provides, separators=(",", ":"), ensure_ascii=False)}')
        lines.append(f' "blocks": {json.dumps(prior.get("blocks") or [], ensure_ascii=False)}')
        f.write(",\n".join(lines))
        f.write("\n}\n")
    return doc
