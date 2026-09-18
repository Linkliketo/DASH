import random
from time import sleep
from unittest.mock import Mock

from quant.bench import measure_latency
from quant.bench import file_size_bytes

def test_measure_latency():
    result = measure_latency(lambda: sleep(random.uniform(0.001, 0.005)),n_warmup=0, n_runs=100)
    assert "mean_ms" in result, "mean_ms not found in result"
    assert "p50_ms" in result, "p50_ms not found in result"
    assert "p95_ms" in result, "p95_ms not found in result"
    assert "min_ms" in result, "min_ms not found in result"
    assert result["min_ms"] <= result["p50_ms"] <= result["p95_ms"], "the p50 of benchmark data should be large than the minimem of benchmark data and less than the p95 of benchmark data"
    assert 2 <= result["mean_ms"] <= 4, "mean_ms should be between 2 and 4"


# use the unittest's mock to check the run times
def test_measure_latency_run_times():
    mock = Mock()
    measure_latency(mock, n_warmup=10, n_runs=10)
    assert mock.call_count == 20, "run times didn't equal to the 20 (n_runs plus n_warmup that given)"

def test_file_size_bytes(tmp_path):
    f = tmp_path / "sample.bin"
    f.write_bytes(b"x" * 1234)
    assert file_size_bytes(f) == 1234, "the size of file should be 1234"
