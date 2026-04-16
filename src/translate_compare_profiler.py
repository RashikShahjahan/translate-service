import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
PASSAGES_PATH = ROOT / "artifacts" / "profiler_passages.json"
SAMPLE_INDEX = 0

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def sync():
    import mlx.core as mx

    synchronize = getattr(mx, "synchronize", None)
    if callable(synchronize):
        synchronize()


def mb(value):
    return round(value / 1024 / 1024, 1)


def load_sample() -> str:
    payload = json.loads(PASSAGES_PATH.read_text())
    chunks = payload["passages"][0]["base_chunks"]
    return chunks[SAMPLE_INDEX].strip()


def profile(fn):
    import mlx.core as mx

    reset_peak_memory = getattr(mx, "reset_peak_memory", None)
    if callable(reset_peak_memory):
        reset_peak_memory()
    else:
        mx.metal.reset_peak_memory()

    sync()
    started = time.perf_counter()
    output = fn()
    sync()

    get_peak_memory = getattr(mx, "get_peak_memory", None)
    peak_memory = (
        get_peak_memory() if callable(get_peak_memory) else mx.metal.get_peak_memory()
    )
    return output, time.perf_counter() - started, peak_memory


def run_method(name, fn, text):
    fn(text)
    output, elapsed, peak_memory = profile(lambda: fn(text))
    return {
        "method": name,
        "elapsed": round(elapsed, 4),
        "peak_metal_mb": mb(peak_memory),
        "output": output,
    }


def main():
    from utils.translation import translate, translate_custom

    text = load_sample()
    results = [
        run_method("translate", translate, text),
        run_method("translate_custom", translate_custom, text),
    ]

    print(
        json.dumps(
            {
                "sample_chars": len(text),
                "outputs_match": results[0]["output"] == results[1]["output"],
                "results": [
                    {
                        "method": result["method"],
                        "elapsed": result["elapsed"],
                        "peak_metal_mb": result["peak_metal_mb"],
                    }
                    for result in results
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
