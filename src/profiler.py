import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
PASSAGES_PATH = ROOT / "artifacts" / "profiler_passages.json"
BASE_CHUNK_SIZE = 100
PASSAGE_SIZE = 1000
PASSAGE_COUNT = 4
DEFAULT_CHUNK_SIZES = range(100, 1001, 100)
DEFAULT_BATCH_SIZES = range(1, 4)
DEFAULT_NUM_DRAFT_TOKENS = range(1, 5)
PROFILE_CHOICES = ("translate", "batch", "speculative", "all")

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
            print(
                {
                    "chunk_size": chunk_size,
                    "chunk": item["chunk_index"],
                    "method": result["method"],
                    "seconds": round(result["elapsed"], 2),
                    "peak_metal_mb": result["peak_metal_mb"],
                }
            )

        print_total(total, "translate", chunk_size=chunk_size)


def run_batch_profile(chunk_sizes, batch_sizes):
    from utils.translation import translate_batch

    chunk_size = chunk_sizes[0]
    inputs = load_inputs(chunk_size)
    for batch_size in batch_sizes:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": chunk_size,
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
            print(
                {
                    "chunk_size": chunk_size,
                    "chunks": [item["chunk_index"] for item in batch],
                    "method": result["method"],
                    "batch_size": len(batch),
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


def run_speculative_profile(chunk_sizes, num_draft_tokens_values):
    from utils.translation import translate_speculative_decoding

    chunk_size = chunk_sizes[0]
    inputs = load_inputs(chunk_size)
    for num_draft_tokens in num_draft_tokens_values:
        total = {"elapsed": 0.0, "peak_metal_mb": 0.0}

        print(
            {
                "chunk_size": chunk_size,
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
            print(
                {
                    "chunk": item["chunk_index"],
                    "method": result["method"],
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
    return parser.parse_args()


def main():
    args = parse_args()

    if args.profile in {"translate", "all"}:
        run_translate_profile(args.chunk_sizes)

    if args.profile in {"batch", "all"}:
        run_batch_profile(args.chunk_sizes, args.batch_sizes)

    if args.profile in {"speculative", "all"}:
        run_speculative_profile(args.chunk_sizes, args.num_draft_tokens)


if __name__ == "__main__":
    main()
