import math
from datetime import datetime

def normalize_phone(phone: str) -> str:
    """Normalizes phone numbers to standard format."""
    digits = [c for c in phone if c.isdigit()]
    return "".join(digits)

def _private_helper(val: int) -> int:
    doubled = val * 2
    return doubled + 1

class Formatter:
    def format_text(self, text: str, max_len: int = 100) -> str:
        if len(text) <= max_len:
            return text
        return text[:max_len] + "..."

def impure_io(path: str) -> str:
    print(f"Reading {path}")
    return path.strip()

def impure_time() -> str:
    return str(datetime.now())

def sum_squares(items: list) -> int:
    total = sum([x * x for x in items])
    return total

def log_and_return(x: str) -> str:
    print(x)
    return x.strip()

def calc_hypot(a: float, b: float) -> float:
    """Compute the Euclidean norm of a 2D vector."""
    return math.hypot(a, b)
