from __future__ import annotations

import ast
import json
import math
from typing import Any, Callable, Set


_CIRCULAR_MARKER = "[Circular]"
_DANGEROUS_BUILTINS = {"open", "__import__", "eval", "exec", "compile", "input", "breakpoint"}
_SAFE_BUILTINS = {
    k: v for k, v in (__builtins__ if isinstance(__builtins__, dict) else __builtins__.__dict__).items()
    if k not in _DANGEROUS_BUILTINS
}

class UnserializableValueError(Exception):
    """Raised when a value cannot be deterministically serialized."""
    pass


def _to_canonical(val: Any, seen: Set[int]) -> Any:
    """
    Recursively converts a Python value into a 100% JSON-compatible structure
    (dict / list / str / int / float / bool / None), ready to be passed directly
    to json.dumps().

    Important: We intercept tuples, sets, and objects ourselves before any call
    to json.dumps, because json.dumps natively treats tuples as lists (it never
    calls default() for them) -- which would lose the tuple/list distinction
    at any depth if we delegated this step.
    """
    if val is None or isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        if math.isnan(val):
            return float("nan")
        if math.isinf(val):
            return float("inf") if val > 0 else float("-inf")
        if val == 0 and math.copysign(1, val) < 0:
            return -0.0
        return val
    if isinstance(val, str):
        return val

    val_id = id(val)
    if val_id in seen:
        return _CIRCULAR_MARKER
    seen.add(val_id)

    try:
        if isinstance(val, dict):
            # JSON keys must be strings: {1: 'a'} and {'1': 'a'} both serialize to {"1": "a"}.
            # Accepted trade-off: wrapping keys with type metadata is overkill for probe clustering.
            return {
                _to_canonical(k, seen): _to_canonical(v, seen)
                for k, v in sorted(val.items(), key=lambda item: repr(item[0]))
            }

        if isinstance(val, (list, tuple, set, frozenset)):
            items = [_to_canonical(item, seen) for item in val]
            if isinstance(val, (set, frozenset)):
                items.sort(key=repr)
                return {"$type": "set", "items": items}
            if isinstance(val, tuple):
                return {"$type": "tuple", "items": items}
            return items

        if hasattr(val, "__class__") and val.__class__.__name__ not in ("type", "function"):
            if type(val).__repr__ is object.__repr__:
                raise UnserializableValueError(
                    f"Cannot serialize instance of '{val.__class__.__name__}' with default address-based repr"
                )
            return {"$type": "object", "class": val.__class__.__name__, "repr": repr(val)}

        raise UnserializableValueError(
            f"Cannot serialize value of type {type(val).__name__}"
        )
    finally:
        seen.remove(val_id)


def canonical_serialise(val: Any) -> str:
    """
    Serializes a Python value in a stable and canonical way.
    """
    structure = _to_canonical(val, set())
    return json.dumps(structure, separators=(",", ":"), allow_nan=True)


def invoke_candidate(fn: Callable[..., Any], args_json: str) -> str:
    """
    Invokes the candidate function with JSON arguments and intercepts
    results/errors.

    Returns a JSON string:
    - Success: {"ok": true, "value": canonical_serialized_result}
    - Error: {"ok": false, "name": exception_type, "message": exception_message}
    - UnserializableValueError: {"ok": false, unserializable: true, "name": exception_type, "message": exception_message} 
    - KeyboardInterrupt: re-raised to be mapped as throw:Timeout
      at the worker level (see python.worker.ts)
    """
    try:
        args = json.loads(args_json)
        res = fn(*args)
        serialized = canonical_serialise(res)
        return json.dumps({"ok": True, "value": serialized})
    except KeyboardInterrupt:
        raise
    except UnserializableValueError as e:
        return json.dumps({
            "ok": False,
            "unserializable": True,
            "name": type(e).__name__,
            "message": str(e),
        })
    except Exception as e:
        return json.dumps({
            "ok": False,
            "name": type(e).__name__,
            "message": str(e),
        })


def extract_and_prepare_candidate(
    body_source: str,
    preamble_source: str | None,
    scope: dict[str, Any],
) -> Callable[..., Any]:
    """
    Executes the preamble (if any) and member body within the given scope,
    then locates and returns the target callable candidate function.

    Uses Python's ast module to inspect the member body statically, ensuring
    inner helper functions or imports do not shadow the main candidate.
    """
    if "__builtins__" not in scope:
        scope["__builtins__"] = _SAFE_BUILTINS.copy()
        
    if preamble_source:
        try:
            exec(preamble_source, scope)
        except Exception as e:
            raise RuntimeError(f"Preamble evaluation failed: {type(e).__name__}: {e}") from e

    tree = ast.parse(body_source)

    target_name: str | None = None

    # 1. Standard function definition at the top level of the body
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            target_name = node.name
            break
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    target_name = target.id
                    break
            if target_name:
                break

    # 2. Direct anonymous lambda expression: e.g. "lambda x: x + 1"
    if not target_name and len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr):
        val = eval(body_source, scope)
        if callable(val):
            return val

    if not target_name:
        raise ValueError("No callable function found in member body")

    exec(body_source, scope)

    candidate = scope.get(target_name)
    if not callable(candidate):
        raise ValueError(f"Symbol '{target_name}' is not callable")

    return candidate
