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
PASSAGE_COUNT = 4
DEFAULT_CHUNK_SIZES = [100, 200, 500, 1000, 2000]
DEFAULT_BATCH_SIZES = [1, 2, 4]
DEFAULT_BATCH_CHUNK_SIZE = 500
DEFAULT_SPECULATIVE_CHUNK_SIZE = 500
DEFAULT_NUM_DRAFT_TOKENS = range(1, 8)
DEFAULT_COMPARE_CHUNK_SIZE = 500
DEFAULT_COMPARE_BATCH_SIZE = 4
DEFAULT_COMPARE_NUM_DRAFT_TOKENS = 1
PROFILE_CHOICES = ("chunk", "batch", "speculative", "compare", "all")

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def sync():
    import mlx.core as mx

    synchronize = getattr(mx, "synchronize", None)
    if callable(synchronize):
        synchronize()


def mb(value):
    return round(value / 1024 / 1024, 1)


def load_passages() -> tuple[list[dict], int, int]:
    if not PASSAGES_PATH.exists():
        raise ValueError(
            f"Profiler passages JSON not found: {PASSAGES_PATH}"
        )

    payload = json.loads(PASSAGES_PATH.read_text())
    base_chunk_size = payload.get("base_chunk_size")
    if base_chunk_size != BASE_CHUNK_SIZE:
        raise ValueError(
            f"{PASSAGES_PATH} has base_chunk_size={base_chunk_size}; "
            f"expected {BASE_CHUNK_SIZE}"
        )
    passage_size = payload.get("passage_size")
    if not isinstance(passage_size, int) or passage_size <= 0:
        raise ValueError(
            f"{PASSAGES_PATH} has invalid passage_size={passage_size}"
        )
    if passage_size % base_chunk_size != 0:
        raise ValueError(
            f"{PASSAGES_PATH} has passage_size={passage_size}; expected a multiple of {base_chunk_size}"
        )

    passages = payload.get("passages", [])
    if len(passages) != PASSAGE_COUNT:
        raise ValueError(
            f"{PASSAGES_PATH} has {len(passages)} passages; expected {PASSAGE_COUNT}"
        )
    expected_chunk_count = passage_size // base_chunk_size
    for passage in passages:
        base_chunks = passage.get("base_chunks", [])
        if len(base_chunks) != expected_chunk_count:
            raise ValueError(
                f"Passage {passage.get('passage_index')} has {len(base_chunks)} "
                f"base chunks; expected {expected_chunk_count}"
            )
    return passages, base_chunk_size, passage_size


def build_inputs(
    passages: list[dict], chunk_size: int, base_chunk_size: int, passage_size: int
) -> list[dict]:
    if chunk_size % base_chunk_size != 0:
        raise ValueError(
            f"Chunk size {chunk_size} must be a multiple of {base_chunk_size}"
        )
    if chunk_size > passage_size:
        raise ValueError(
            f"Chunk size {chunk_size} cannot exceed passage size {passage_size}"
        )

    chunks_per_input = chunk_size // base_chunk_size
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


def warmup(fn):
    run_profile(fn)


def load_inputs(chunk_size: int):
    passages, base_chunk_size, passage_size = load_passages()
    inputs = build_inputs(passages, chunk_size, base_chunk_size, passage_size)

    if not inputs:
        raise ValueError(
            f"No non-empty token chunks produced from {PASSAGES_PATH} at chunk size {chunk_size}"
        )

    return inputs, passage_size


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


def plot_compare_profile(output_dir: Path, totals: list[dict]):
    if not totals:
        return None

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    methods = [item["method"] for item in totals]
    elapsed_values = [round(item["elapsed"], 4) for item in totals]
    memory_values = [item["peak_metal_mb"] for item in totals]

    figure, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    axes[0].bar(methods, elapsed_values, color="tab:blue")
    axes[0].set_title("Total Runtime")
    axes[0].set_xlabel("Method")
    axes[0].set_ylabel("Seconds")
    axes[0].grid(True, axis="y", alpha=0.3)

    axes[1].bar(methods, memory_values, color="tab:orange")
    axes[1].set_title("Peak Metal Memory")
    axes[1].set_xlabel("Method")
    axes[1].set_ylabel("MB")
    axes[1].grid(True, axis="y", alpha=0.3)

    figure.suptitle("Compare Profile")
    figure.tight_layout()

    plot_path = output_dir / "compare.png"
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
        inputs, _ = load_inputs(chunk_size)
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print({"chunk_size": chunk_size, "method": "translate"})
        if inputs:
            warmup(
                lambda source_text=inputs[0]["source_text"]: translate(source_text)
            )
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


def run_batch_profile(batch_sizes, chunk_size):
    from utils.translation import translate_batch

    inputs, _ = load_inputs(chunk_size)
    samples = []
    totals = []
    for batch_size in batch_sizes:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": chunk_size,
                "method": "translate_batch",
                "batch_size": batch_size,
            }
        )
        if inputs:
            warmup(
                lambda batch_texts=[inputs[0]["source_text"]]: translate_batch(
                    batch_texts
                )
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
                    "chunk_size": chunk_size,
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
            chunk_size=chunk_size,
            batch_size=batch_size,
        )

        totals.append(
            {
                "batch_size": batch_size,
                "chunk_size": chunk_size,
                "method": "translate_batch",
                "elapsed": round(total["elapsed"], 4),
                "peak_metal_mb": total["peak_metal_mb"],
            }
        )

    return {"samples": samples, "totals": totals}


def run_speculative_profile(num_draft_tokens_values, chunk_size):
    from utils.translation import translate_speculative_decoding

    inputs, _ = load_inputs(chunk_size)
    speculative_input = inputs[:1]
    samples = []
    totals = []
    for num_draft_tokens in num_draft_tokens_values:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": chunk_size,
                "method": "translate_speculative_decoding",
                "num_draft_tokens": num_draft_tokens,
            }
        )
        if inputs:
            warmup(
                lambda source_text=speculative_input[0][
                    "source_text"
                ], num_draft_tokens=num_draft_tokens: translate_speculative_decoding(
                    source_text,
                    num_draft_tokens=num_draft_tokens,
                )
            )
        for item in speculative_input:
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
                    "chunk_size": chunk_size,
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
            chunk_size=chunk_size,
            num_draft_tokens=num_draft_tokens,
        )

        totals.append(
            {
                "num_draft_tokens": num_draft_tokens,
                "chunk_size": chunk_size,
                "method": "translate_speculative_decoding",
                "elapsed": round(total["elapsed"], 4),
                "peak_metal_mb": total["peak_metal_mb"],
            }
        )

    return {"samples": samples, "totals": totals}


def run_compare_profile(chunk_size, batch_size, num_draft_tokens):
    from utils.translation import (
        translate,
        translate_batch,
        translate_speculative_decoding,
    )

    inputs, _ = load_inputs(chunk_size)
    samples = []
    totals = []

    print(
        {
            "profile": "compare",
            "chunk_size": chunk_size,
            "batch_size": batch_size,
            "num_draft_tokens": num_draft_tokens,
        }
    )

    translate_total = {"elapsed": 0.0, "peak_metal_mb": 0.0}
    print({"chunk_size": chunk_size, "method": "translate"})
    if inputs:
        warmup(lambda source_text=inputs[0]["source_text"]: translate(source_text))
    for item in inputs:
        result = profile(
            "translate",
            lambda source_text=item["source_text"]: translate(source_text),
        )
        translate_total["elapsed"] += result["elapsed"]
        translate_total["peak_metal_mb"] = max(
            translate_total["peak_metal_mb"], result["peak_metal_mb"]
        )
        samples.append(
            {
                "profile": "compare",
                "method": "translate",
                "chunk_size": chunk_size,
                "chunk_index": item["chunk_index"],
                "elapsed": round(result["elapsed"], 4),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
        print(
            {
                "method": "translate",
                "chunk": item["chunk_index"],
                "seconds": round(result["elapsed"], 2),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
    print_total(translate_total, "translate", chunk_size=chunk_size)
    totals.append(
        {
            "method": "translate",
            "chunk_size": chunk_size,
            "elapsed": round(translate_total["elapsed"], 4),
            "peak_metal_mb": translate_total["peak_metal_mb"],
        }
    )

    batch_total = {"elapsed": 0.0, "peak_metal_mb": 0.0}
    print(
        {
            "chunk_size": chunk_size,
            "method": "translate_batch",
            "batch_size": batch_size,
        }
    )
    if inputs:
        warmup(
            lambda batch_texts=[
                item["source_text"] for item in inputs[:batch_size]
            ]: translate_batch(batch_texts)
        )
    for batch in chunked(inputs, batch_size):
        result = profile(
            "translate_batch",
            lambda batch_texts=[item["source_text"] for item in batch]: translate_batch(
                batch_texts
            ),
        )
        batch_total["elapsed"] += result["elapsed"]
        batch_total["peak_metal_mb"] = max(
            batch_total["peak_metal_mb"], result["peak_metal_mb"]
        )
        samples.append(
            {
                "profile": "compare",
                "method": "translate_batch",
                "chunk_size": chunk_size,
                "batch_size": batch_size,
                "chunks": [item["chunk_index"] for item in batch],
                "elapsed": round(result["elapsed"], 4),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
        print(
            {
                "method": "translate_batch",
                "chunks": [item["chunk_index"] for item in batch],
                "seconds": round(result["elapsed"], 2),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
    print_total(
        batch_total,
        "translate_batch",
        chunk_size=chunk_size,
        batch_size=batch_size,
    )
    totals.append(
        {
            "method": "translate_batch",
            "chunk_size": chunk_size,
            "batch_size": batch_size,
            "elapsed": round(batch_total["elapsed"], 4),
            "peak_metal_mb": batch_total["peak_metal_mb"],
        }
    )

    speculative_total = {"elapsed": 0.0, "peak_metal_mb": 0.0}
    print(
        {
            "chunk_size": chunk_size,
            "method": "translate_speculative_decoding",
            "num_draft_tokens": num_draft_tokens,
        }
    )
    if inputs:
        warmup(
            lambda source_text=inputs[0][
                "source_text"
            ]: translate_speculative_decoding(
                source_text,
                num_draft_tokens=num_draft_tokens,
            )
        )
    for item in inputs:
        result = profile(
            "translate_speculative_decoding",
            lambda source_text=item[
                "source_text"
            ]: translate_speculative_decoding(
                source_text,
                num_draft_tokens=num_draft_tokens,
            ),
        )
        speculative_total["elapsed"] += result["elapsed"]
        speculative_total["peak_metal_mb"] = max(
            speculative_total["peak_metal_mb"], result["peak_metal_mb"]
        )
        samples.append(
            {
                "profile": "compare",
                "method": "translate_speculative_decoding",
                "chunk_size": chunk_size,
                "num_draft_tokens": num_draft_tokens,
                "chunk_index": item["chunk_index"],
                "elapsed": round(result["elapsed"], 4),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
        print(
            {
                "method": "translate_speculative_decoding",
                "chunk": item["chunk_index"],
                "num_draft_tokens": num_draft_tokens,
                "seconds": round(result["elapsed"], 2),
                "peak_metal_mb": result["peak_metal_mb"],
            }
        )
    print_total(
        speculative_total,
        "translate_speculative_decoding",
        chunk_size=chunk_size,
        num_draft_tokens=num_draft_tokens,
    )
    totals.append(
        {
            "method": "translate_speculative_decoding",
            "chunk_size": chunk_size,
            "num_draft_tokens": num_draft_tokens,
            "elapsed": round(speculative_total["elapsed"], 4),
            "peak_metal_mb": speculative_total["peak_metal_mb"],
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
        "--batch-chunk-size",
        type=int,
        default=DEFAULT_BATCH_CHUNK_SIZE,
        help="Token chunk size used by the batch profile.",
    )
    parser.add_argument(
        "--num-draft-tokens",
        type=int,
        nargs="+",
        default=list(DEFAULT_NUM_DRAFT_TOKENS),
        help="Draft token counts used by the speculative profile.",
    )
    parser.add_argument(
        "--speculative-chunk-size",
        type=int,
        default=DEFAULT_SPECULATIVE_CHUNK_SIZE,
        help="Token chunk size used by the speculative profile.",
    )
    parser.add_argument(
        "--compare-chunk-size",
        type=int,
        default=DEFAULT_COMPARE_CHUNK_SIZE,
        help="Token chunk size used by the compare profile.",
    )
    parser.add_argument(
        "--compare-batch-size",
        type=int,
        default=DEFAULT_COMPARE_BATCH_SIZE,
        help="Batch size used by the compare profile.",
    )
    parser.add_argument(
        "--compare-num-draft-tokens",
        type=int,
        default=DEFAULT_COMPARE_NUM_DRAFT_TOKENS,
        help="Draft token count used by the compare profile.",
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


def validate_args(args):
    positive_list_options = {
        "--chunk-sizes": args.chunk_sizes,
        "--batch-sizes": args.batch_sizes,
        "--num-draft-tokens": args.num_draft_tokens,
    }
    for option_name, values in positive_list_options.items():
        if any(value <= 0 for value in values):
            raise ValueError(f"{option_name} values must all be positive integers")

    positive_scalar_options = {
        "--batch-chunk-size": args.batch_chunk_size,
        "--speculative-chunk-size": args.speculative_chunk_size,
        "--compare-chunk-size": args.compare_chunk_size,
        "--compare-batch-size": args.compare_batch_size,
        "--compare-num-draft-tokens": args.compare_num_draft_tokens,
    }
    for option_name, value in positive_scalar_options.items():
        if value <= 0:
            raise ValueError(f"{option_name} must be a positive integer")


def main():
    args = parse_args()
    validate_args(args)
    run_name = args.run_name or make_run_name()
    output_dir = prepare_output_dir(args.output_dir, run_name)
    results = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "profile": args.profile,
        "config": {
            "chunk_sizes": args.chunk_sizes,
            "batch_sizes": args.batch_sizes,
            "batch_chunk_size": args.batch_chunk_size,
            "num_draft_tokens": args.num_draft_tokens,
            "speculative_chunk_size": args.speculative_chunk_size,
            "compare_chunk_size": args.compare_chunk_size,
            "compare_batch_size": args.compare_batch_size,
            "compare_num_draft_tokens": args.compare_num_draft_tokens,
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
        results["profiles"]["batch"] = run_batch_profile(
            args.batch_sizes, args.batch_chunk_size
        )
        plots["batch"] = plot_profile(
            output_dir,
            "batch",
            "batch_size",
            "Batch Size",
            results["profiles"]["batch"]["totals"],
        )

    if args.profile in {"speculative", "all"}:
        results["profiles"]["speculative"] = run_speculative_profile(
            args.num_draft_tokens, args.speculative_chunk_size
        )
        plots["speculative"] = plot_profile(
            output_dir,
            "speculative",
            "num_draft_tokens",
            "Draft Tokens",
            results["profiles"]["speculative"]["totals"],
        )

    if args.profile in {"compare", "all"}:
        results["profiles"]["compare"] = run_compare_profile(
            args.compare_chunk_size,
            args.compare_batch_size,
            args.compare_num_draft_tokens,
        )
        plots["compare"] = plot_compare_profile(
            output_dir,
            results["profiles"]["compare"]["totals"],
        )

    results_path = write_results(output_dir, results)
    print({"saved_results": str(results_path)})
    for profile_name, plot_path in plots.items():
        if plot_path is not None:
            print({"saved_plot": str(plot_path), "profile": profile_name})


if __name__ == "__main__":
    main()
