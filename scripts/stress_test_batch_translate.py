import sys
import time
from pathlib import Path

import matplotlib
import mlx.core as mx
from mlx_lm import batch_generate, generate

matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from utils.translation import (  # noqa: E402
    get_model_and_tokenizer,
    prepare_prompt,
)


START_BATCH_SIZE = 2
MAX_BATCH_SIZE = 16
TOKENS_PER_FILE = 1000
OUTPUT_DIR = ROOT / "artifacts"
PLOT_PATH = OUTPUT_DIR / "stress_test_batch_translate.png"
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


def synchronize_if_available() -> None:
    synchronize = getattr(mx, "synchronize", None)
    if callable(synchronize):
        synchronize()


def current_metal_memory_mb() -> float:
    return memory_mb(mx.get_active_memory())


def print_memory_before_model_load() -> None:
    print(f"metal_active_before_model_load_mb={current_metal_memory_mb():.1f}")


def translate_batch_profiled(batch: list[str]) -> dict[str, object]:
    overall_start = time.perf_counter()
    model, tokenizer = get_model_and_tokenizer()
    synchronize_if_available()

    prompts = [prepare_prompt(text) for text in batch]
    synchronize_if_available()

    response = batch_generate(
        model,
        tokenizer,
        prompts=prompts,
        max_tokens=2048,
    )
    texts = response.texts
    synchronize_if_available()

    return {
        "texts": texts,
        "elapsed_seconds": time.perf_counter() - overall_start,
    }


def translate_single_profiled(text: str) -> dict[str, object]:
    overall_start = time.perf_counter()
    model, tokenizer = get_model_and_tokenizer()
    synchronize_if_available()

    prompt = prepare_prompt(text)
    synchronize_if_available()

    generated_text = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=2048,
    )
    synchronize_if_available()

    return {
        "text": generated_text,
        "elapsed_seconds": time.perf_counter() - overall_start,
    }


def plot_results(
    rows: list[dict[str, float | int]],
) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    batch_sizes = [int(row["batch_size"]) for row in rows]
    elapsed_per_item = [
        float(row["elapsed_seconds"]) / int(row["batch_size"]) for row in rows
    ]
    incremental_peak_memory_per_item = [
        float(row["metal_peak_delta_mb"]) / int(row["batch_size"]) for row in rows
    ]

    fig, ax_time = plt.subplots(figsize=(10, 6))
    ax_memory = ax_time.twinx()

    ax_time.plot(
        batch_sizes,
        elapsed_per_item,
        color="#1f77b4",
        marker="o",
        linewidth=2,
        label="Elapsed Time / Batch Size (s)",
    )
    ax_memory.plot(
        batch_sizes,
        incremental_peak_memory_per_item,
        color="#d62728",
        marker="s",
        linewidth=2,
        label="Metal Peak Delta / Batch Size (MB)",
    )

    ax_time.set_xlabel("Batch Size")
    ax_time.set_ylabel("Elapsed Time / Batch Size (s)", color="#1f77b4")
    ax_memory.set_ylabel("Metal Peak Delta / Batch Size (MB)", color="#d62728")
    ax_time.tick_params(axis="y", labelcolor="#1f77b4")
    ax_memory.tick_params(axis="y", labelcolor="#d62728")
    ax_time.grid(True, alpha=0.3)
    ax_time.set_title("Batch Translation Stress Test Per Item")

    lines = ax_time.get_lines() + ax_memory.get_lines()
    labels = [line.get_label() for line in lines]
    ax_time.legend(lines, labels, loc="upper left")

    fig.tight_layout()
    fig.savefig(PLOT_PATH, dpi=200)
    plt.close(fig)
    return PLOT_PATH

print_memory_before_model_load()
_, tokenizer = get_model_and_tokenizer()
text, true_prompt_tokens = make_text(tokenizer)
rows: list[dict[str, object]] = []
baseline_metal_mb = current_metal_memory_mb()
print(f"baseline_metal_active_mb={baseline_metal_mb:.1f}")

mx.reset_peak_memory()
single_profile = translate_single_profiled(text)
single_peak_metal = memory_mb(mx.get_peak_memory())
print(
    {
        "mode": "single_generate",
        "input_count": 1,
        "prompt_tokens": true_prompt_tokens,
        "elapsed_seconds": round(float(single_profile["elapsed_seconds"]), 2),
        "metal_peak_mb": round(single_peak_metal, 1),
        "metal_peak_delta_mb": round(single_peak_metal - baseline_metal_mb, 1),
    }
)

batch_size = START_BATCH_SIZE
while batch_size <= MAX_BATCH_SIZE:
    batch = [text] * batch_size
    mx.reset_peak_memory()
    profile = translate_batch_profiled(batch)
    peak_metal = memory_mb(mx.get_peak_memory())
    row = {
        "batch_size": batch_size,
        "elapsed_seconds": round(float(profile["elapsed_seconds"]), 2),
        "metal_peak_mb": round(peak_metal, 1),
        "metal_peak_delta_mb": round(peak_metal - baseline_metal_mb, 1),
    }
    rows.append(row)
    print(row)
    batch_size *= 2

plot_path = plot_results(rows)
print(f"plot_saved_to={plot_path}")
