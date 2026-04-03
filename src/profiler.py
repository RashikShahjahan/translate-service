import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
PASSAGES_PATH = ROOT / "artifacts" / "profiler_passages.json"
DEFAULT_OUTPUT_DIR = ROOT / "artifacts" / "profiler"
BASE_CHUNK_SIZE = 100
PASSAGE_SIZE = 1000
PASSAGE_COUNT = 4
DEFAULT_CHUNK_SIZES = [100, 200, 500, 1000]
DEFAULT_BATCH_SIZES = [1,2,4]
DEFAULT_NUM_DRAFT_TOKENS = range(2, 8)
PROFILE_CHOICES = ("chunk", "batch", "speculative", "all")

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def sync():
    import mlx.core as mx

    synchronize = getattr(mx, "synchronize", None)
    if callable(synchronize):
        synchronize()


def mb(value):
    return round(value / 1024 / 1024, 1)


def load_passages() -> list[dict]:
    if not PASSAGES_PATH.exists():
        raise ValueError(
            f"Profiler passages JSON not found: {PASSAGES_PATH}"
        )

    payload = json.loads(PASSAGES_PATH.read_text())
    if payload.get("base_chunk_size") != BASE_CHUNK_SIZE:
        raise ValueError(
            f"{PASSAGES_PATH} has base_chunk_size={payload.get('base_chunk_size')}; "
            f"expected {BASE_CHUNK_SIZE}"
        )
    if payload.get("passage_size") != PASSAGE_SIZE:
        raise ValueError(
            f"{PASSAGES_PATH} has passage_size={payload.get('passage_size')}; "
            f"expected {PASSAGE_SIZE}"
        )

    passages = payload.get("passages", [])
    if len(passages) != PASSAGE_COUNT:
        raise ValueError(
            f"{PASSAGES_PATH} has {len(passages)} passages; expected {PASSAGE_COUNT}"
        )
    for passage in passages:
        base_chunks = passage.get("base_chunks", [])
        if len(base_chunks) != PASSAGE_SIZE // BASE_CHUNK_SIZE:
            raise ValueError(
                f"Passage {passage.get('passage_index')} has {len(base_chunks)} "
                f"base chunks; expected {PASSAGE_SIZE // BASE_CHUNK_SIZE}"
            )
    return passages


def build_inputs(passages: list[dict], chunk_size: int) -> list[dict]:
    if chunk_size % BASE_CHUNK_SIZE != 0:
        raise ValueError(
            f"Chunk size {chunk_size} must be a multiple of {BASE_CHUNK_SIZE}"
        )
    if chunk_size > PASSAGE_SIZE:
        raise ValueError(
            f"Chunk size {chunk_size} cannot exceed passage size {PASSAGE_SIZE}"
        )

    chunks_per_input = chunk_size // BASE_CHUNK_SIZE
    inputs = []
    global_chunk_index = 1
    for passage in passages:
        for offset in range(0, len(passage["base_chunks"]), chunks_per_input):
            chunk_text = "".join(
                passage["base_chunks"][offset : offset + chunks_per_input]
            ).strip()
            if not chunk_text:
                continue
            inputs.append(
                {
                    "chunk_index": global_chunk_index,
                    "passage_index": passage["passage_index"],
                    "source_text": chunk_text,
                }
            )
            global_chunk_index += 1

    return inputs


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def run_profile(fn):
    import mlx.core as mx

    mx.reset_peak_memory()
    sync()
    started = time.perf_counter()
    output = fn()
    sync()
    elapsed = time.perf_counter() - started
    return output, elapsed, mx.get_peak_memory()


def profile(method_name, fn):
    _, elapsed, peak_metal = run_profile(fn)
    return {
        "method": method_name,
        "elapsed": elapsed,
        "peak_metal_mb": mb(peak_metal),
    }


def load_inputs(chunk_size: int):
    passages = load_passages()
    inputs = build_inputs(passages, chunk_size)

    if not inputs:
        raise ValueError(
            f"No non-empty token chunks produced from {PASSAGES_PATH} at chunk size {chunk_size}"
        )

    return inputs


def make_run_name():
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def prepare_output_dir(base_dir: Path, run_name: str) -> Path:
    output_dir = base_dir / run_name
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def write_results(output_dir: Path, payload: dict):
    results_path = output_dir / "results.json"
    results_path.write_text(json.dumps(payload, indent=2) + "\n")
    return results_path


def plot_profile(output_dir: Path, profile_name: str, x_key: str, x_label: str, totals: list[dict]):
    if not totals:
        return None

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    x_values = [item[x_key] for item in totals]
    elapsed_values = [round(item["elapsed"], 4) for item in totals]
    memory_values = [item["peak_metal_mb"] for item in totals]

    figure, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    axes[0].plot(x_values, elapsed_values, marker="o", linewidth=2)
    axes[0].set_title("Total Runtime")
    axes[0].set_xlabel(x_label)
    axes[0].set_ylabel("Seconds")
    axes[0].grid(True, alpha=0.3)

    axes[1].plot(x_values, memory_values, marker="o", linewidth=2, color="tab:orange")
    axes[1].set_title("Peak Metal Memory")
    axes[1].set_xlabel(x_label)
    axes[1].set_ylabel("MB")
    axes[1].grid(True, alpha=0.3)

    figure.suptitle(f"{profile_name.title()} Profile")
    figure.tight_layout()

    plot_path = output_dir / f"{profile_name}.png"
    figure.savefig(plot_path, dpi=200, bbox_inches="tight")
    plt.close(figure)
    return plot_path


def print_total(total, method_name, **metadata):
    print(
        {
            **metadata,
            "method": method_name,
            "total_seconds": round(total["elapsed"], 2),
            "peak_metal_mb": total["peak_metal_mb"],
        }
    )


def run_translate_profile(chunk_sizes):
    from utils.translation import translate

    samples = []
    totals = []
    for chunk_size in chunk_sizes:
        inputs = load_inputs(chunk_size)
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print({"chunk_size": chunk_size, "method": "translate"})
        for item in inputs:
            result = profile(
                "translate",
                lambda source_text=item["source_text"]: translate(source_text),
            )
            total["elapsed"] += result["elapsed"]
            total["peak_metal_mb"] = max(
                total["peak_metal_mb"], result["peak_metal_mb"]
            )
            samples.append(
                {
                    "chunk_size": chunk_size,
                    "chunk_index": item["chunk_index"],
                    "method": result["method"],
                    "elapsed": round(result["elapsed"], 4),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )
            print(
                {
                    "chunk_size": chunk_size,
                    "chunk": item["chunk_index"],
                    "method": result["method"],
                    "seconds": round(result["elapsed"], 2),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )

        totals.append(
            {
                "chunk_size": chunk_size,
                "method": "translate",
                "elapsed": round(total["elapsed"], 4),
                "peak_metal_mb": total["peak_metal_mb"],
            }
        )
        print_total(total, "translate", chunk_size=chunk_size)

    return {"samples": samples, "totals": totals}


def run_batch_profile(batch_sizes):
    from utils.translation import translate_batch

    inputs = load_inputs(PASSAGE_SIZE)
    samples = []
    totals = []
    for batch_size in batch_sizes:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": PASSAGE_SIZE,
                "method": "translate_batch",
                "batch_size": batch_size,
            }
        )
        for batch in chunked(inputs, batch_size):
            result = profile(
                "translate_batch",
                lambda batch_texts=[item["source_text"] for item in batch]: translate_batch(
                    batch_texts
                ),
            )
            total["elapsed"] += result["elapsed"]
            total["peak_metal_mb"] = max(
                total["peak_metal_mb"], result["peak_metal_mb"]
            )
            samples.append(
                {
                    "batch_size": batch_size,
                    "chunks": [item["chunk_index"] for item in batch],
                    "method": result["method"],
                    "elapsed": round(result["elapsed"], 4),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )
            print(
                {
                    "chunks": [item["chunk_index"] for item in batch],
                    "seconds": round(result["elapsed"], 2),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )

        print_total(
            total,
            "translate_batch",
            chunk_size=PASSAGE_SIZE,
            batch_size=batch_size,
        )

        totals.append(
            {
                "batch_size": batch_size,
                "chunk_size": PASSAGE_SIZE,
                "method": "translate_batch",
                "elapsed": round(total["elapsed"], 4),
                "peak_metal_mb": total["peak_metal_mb"],
            }
        )

    return {"samples": samples, "totals": totals}


def run_speculative_profile(num_draft_tokens_values):
    from utils.translation import translate_speculative_decoding

    inputs = load_inputs(PASSAGE_SIZE)
    samples = []
    totals = []
    for num_draft_tokens in num_draft_tokens_values:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": PASSAGE_SIZE,
                "method": "translate_speculative_decoding",
                "num_draft_tokens": num_draft_tokens,
            }
        )
        for item in inputs:
            result = profile(
                "translate_speculative_decoding",
                lambda source_text=item[
                    "source_text"
                ], num_draft_tokens=num_draft_tokens: translate_speculative_decoding(
                    source_text,
                    num_draft_tokens=num_draft_tokens,
                ),
            )
            total["elapsed"] += result["elapsed"]
            total["peak_metal_mb"] = max(
                total["peak_metal_mb"], result["peak_metal_mb"]
            )
            samples.append(
                {
                    "chunk_index": item["chunk_index"],
                    "num_draft_tokens": num_draft_tokens,
                    "method": result["method"],
                    "elapsed": round(result["elapsed"], 4),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )
            print(
                {
                    "chunk": item["chunk_index"],
                    "num_draft_tokens": num_draft_tokens,
                    "seconds": round(result["elapsed"], 2),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )

        print_total(
            total,
            "translate_speculative_decoding",
            chunk_size=PASSAGE_SIZE,
            num_draft_tokens=num_draft_tokens,
        )

        totals.append(
            {
                "num_draft_tokens": num_draft_tokens,
                "chunk_size": PASSAGE_SIZE,
                "method": "translate_speculative_decoding",
                "elapsed": round(total["elapsed"], 4),
                "peak_metal_mb": total["peak_metal_mb"],
            }
        )

    return {"samples": samples, "totals": totals}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run translation profiling with selectable profile modes."
    )
    parser.add_argument(
        "--profile",
        choices=PROFILE_CHOICES,
        default="all",
        help="Which profiling mode to run.",
    )
    parser.add_argument(
        "--chunk-sizes",
        type=int,
        nargs="+",
        default=list(DEFAULT_CHUNK_SIZES),
        help="Token chunk sizes to profile.",
    )
    parser.add_argument(
        "--batch-sizes",
        type=int,
        nargs="+",
        default=list(DEFAULT_BATCH_SIZES),
        help="Batch sizes used by the batch profile.",
    )
    parser.add_argument(
        "--num-draft-tokens",
        type=int,
        nargs="+",
        default=list(DEFAULT_NUM_DRAFT_TOKENS),
        help="Draft token counts used by the speculative profile.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Base directory where profiler JSON and plots are written.",
    )
    parser.add_argument(
        "--run-name",
        default=None,
        help="Optional profiler run name. Defaults to a timestamp.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    run_name = args.run_name or make_run_name()
    output_dir = prepare_output_dir(args.output_dir, run_name)
    results = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "profile": args.profile,
        "config": {
            "chunk_sizes": args.chunk_sizes,
            "batch_sizes": args.batch_sizes,
            "num_draft_tokens": args.num_draft_tokens,
        },
        "profiles": {},
    }
    plots = {}

    if args.profile in {"chunk", "all"}:
        results["profiles"]["chunk"] = run_translate_profile(args.chunk_sizes)
        plots["chunk"] = plot_profile(
            output_dir,
            "chunk",
            "chunk_size",
            "Chunk Size",
            results["profiles"]["chunk"]["totals"],
        )

    if args.profile in {"batch", "all"}:
        results["profiles"]["batch"] = run_batch_profile(args.batch_sizes)
        plots["batch"] = plot_profile(
            output_dir,
            "batch",
            "batch_size",
            "Batch Size",
            results["profiles"]["batch"]["totals"],
        )

    if args.profile in {"speculative", "all"}:
        results["profiles"]["speculative"] = run_speculative_profile(args.num_draft_tokens)
        plots["speculative"] = plot_profile(
            output_dir,
            "speculative",
            "num_draft_tokens",
            "Draft Tokens",
            results["profiles"]["speculative"]["totals"],
        )

    results_path = write_results(output_dir, results)
    print({"saved_results": str(results_path)})
    for profile_name, plot_path in plots.items():
        if plot_path is not None:
            print({"saved_plot": str(plot_path), "profile": profile_name})


if __name__ == "__main__":
    main()
