"""Validate Agent Hub protocol messages (stdlib only), for the connector `agentctl.py`.

The schema is `hub-protocol.schema.json` next to this file, a byte copy of the source of truth
`hub/protocol/schemas/protocol.schema.json` (kept in sync by `npm run gen -w @agent-hub/protocol`).
It uses only a JSON Schema subset, which this module implements: type (string or list), enum,
const, required, properties, additionalProperties (bool or schema), items, minItems, maxItems,
minLength, maxLength, pattern, minimum, maximum, $ref to #/$defs/*, anyOf.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "hub-protocol.schema.json"

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}
_KNOWN = {"type", "enum", "const", "required", "properties", "additionalProperties", "items", "minItems",
          "maxItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "$ref", "anyOf",
          "description", "title"}


@lru_cache(maxsize=1)
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def errors(def_name: str, data) -> list[str]:
    """All problems of `data` against `$defs[def_name]`, as `<path> <message>`; [] means valid."""
    defs = schema()["$defs"]
    if def_name not in defs:
        raise KeyError(f"unknown protocol definition {def_name}")
    out: list[str] = []
    _check(defs[def_name], data, "", defs, out)
    return out


def validate(def_name: str, data) -> None:
    """Raise ValueError with the first few problems when `data` is not a valid `def_name`."""
    errs = errors(def_name, data)
    if errs:
        raise ValueError(f"invalid {def_name}: " + "; ".join(errs[:5]))


def _check(s: dict, v, path: str, defs: dict, out: list[str]) -> None:
    unknown = set(s) - _KNOWN
    if unknown:
        raise ValueError(f"schema at {path or '/'} uses unsupported keywords {sorted(unknown)}")
    where = path or "/"
    if "$ref" in s:
        _check(defs[s["$ref"].rsplit("/", 1)[-1]], v, path, defs, out)
    if "anyOf" in s:
        if not any(not _sub(alt, v, path, defs) for alt in s["anyOf"]):
            out.append(f"{where} matches none of the allowed shapes")
        return
    if "type" in s:
        types = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(_TYPES[t](v) for t in types):
            out.append(f"{where} must be {' or '.join(types)}")
            return
    if "const" in s and v != s["const"]:
        out.append(f"{where} must be {s['const']!r}")
    if "enum" in s and v not in s["enum"]:
        out.append(f"{where} must be one of {s['enum']}")
    if isinstance(v, str):
        if "minLength" in s and len(v) < s["minLength"]:
            out.append(f"{where} is shorter than {s['minLength']}")
        if "maxLength" in s and len(v) > s["maxLength"]:
            out.append(f"{where} is longer than {s['maxLength']}")
        if "pattern" in s and not re.search(s["pattern"], v):
            out.append(f"{where} must match {s['pattern']}")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s and v < s["minimum"]:
            out.append(f"{where} must be >= {s['minimum']}")
        if "maximum" in s and v > s["maximum"]:
            out.append(f"{where} must be <= {s['maximum']}")
    if isinstance(v, list):
        if "minItems" in s and len(v) < s["minItems"]:
            out.append(f"{where} needs at least {s['minItems']} items")
        if "maxItems" in s and len(v) > s["maxItems"]:
            out.append(f"{where} allows at most {s['maxItems']} items")
        if "items" in s:
            for i, item in enumerate(v):
                _check(s["items"], item, f"{path}/{i}", defs, out)
    if isinstance(v, dict):
        for key in s.get("required", []):
            if key not in v:
                out.append(f"{where} is missing {key}")
        props, extra = s.get("properties", {}), s.get("additionalProperties", True)
        for key, item in v.items():
            if key in props:
                _check(props[key], item, f"{path}/{key}", defs, out)
            elif extra is False:
                out.append(f"{where} has unexpected property {key}")
            elif isinstance(extra, dict):
                _check(extra, item, f"{path}/{key}", defs, out)


def _sub(s: dict, v, path: str, defs: dict) -> list[str]:
    out: list[str] = []
    _check(s, v, path, defs, out)
    return out
