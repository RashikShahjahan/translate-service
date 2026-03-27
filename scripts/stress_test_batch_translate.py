import sys
import time
from pathlib import Path

import mlx.core as mx


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from utils.translation import (  # noqa: E402
    get_model_and_tokenizer,
    prepare_prompt,
    translate_batch,
)


START_BATCH_SIZE = 1
MAX_BATCH_SIZE = 64
STEP = 1
TOKENS_PER_FILE = 1000
BASE_TEXT = (
    "শের মুহাম্মদ যখন অল্প বয়স্ক বালক তখন তাঁর পিতা হজরত আতামুহাম্মদ ইন্তেকাল করেন। সেই হতে দুই ভ্রাতা মাতার তত্ত্বাবধানে লালিত পালিত হতে থাকেন।"
)


def memory_mb(value: int | float) -> float:
    return value / (1024 * 1024)


def prompt_token_count(tokenizer, text: str) -> int:
    prompt = prepare_prompt(text)
    if isinstance(prompt, str):
        return len(tokenizer.encode(prompt))
    return len(prompt)


def make_text(tokenizer) -> tuple[str, int]:
    text = BASE_TEXT
    tokens = prompt_token_count(tokenizer, text)
    while tokens < TOKENS_PER_FILE:
        text = f"{text} {BASE_TEXT.strip()}"
        tokens = prompt_token_count(tokenizer, text)
    return text, tokens

_, tokenizer = get_model_and_tokenizer()
text, true_prompt_tokens = make_text(tokenizer)
total_metal_memory = memory_mb(mx.device_info()["memory_size"])
print(f"total_metal_memory_mb={total_metal_memory:.1f}")
rows: list[dict[str, object]] = []
baseline_metal = memory_mb(mx.get_active_memory())
print(f"baseline_metal_memory_mb={baseline_metal:.1f}")

for batch_size in range(START_BATCH_SIZE, MAX_BATCH_SIZE + 1, STEP):
    batch = [text] * batch_size
    mx.reset_peak_memory()
    start = time.perf_counter()
    translate_batch(batch)

    elapsed = time.perf_counter() - start
    peak_metal = memory_mb(mx.get_peak_memory())
    row = {
        "batch_size": batch_size,
        "elapsed_seconds": round(elapsed, 2),
        "peak_metal_mb": round(peak_metal, 1),
    }
    rows.append(row)
    print(row)
