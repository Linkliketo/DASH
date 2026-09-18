import os
import time
import numpy as np

# run_once can fit different framework from mediapipe to onnx
def measure_latency(run_once, n_warmup: int = 10, n_runs: int = 100) -> dict:
    """
    :param run_once: different frameworks of model
    :param n_warmup: warmup runs
    :param n_runs: times that run to get benchmark scores
    :return: {'mean_ms': float, 'p50_ms': float, 'p95_ms': float, 'min_ms': float}
    """
    if n_warmup < 0 :
        raise ValueError("n_warmup must be non-negative, got {}".format(n_warmup))
    if n_runs <= 0 :
        raise ValueError("n_runs must be positive, got {}".format(n_runs))



    for i in range(n_warmup):
        run_once()

    durations = np.empty(n_runs,dtype=np.float64)
    for i in range(n_runs):
        time_counter = time.perf_counter()
        run_once()
        time_detector = time.perf_counter()-time_counter
        durations[i] = time_detector * 1000

    mean_ms = np.mean(durations)
    p95_ms = np.percentile(durations, 95)
    p50_ms = np.percentile(durations, 50)
    min_ms = np.min(durations)

    latency_col = {'mean_ms': mean_ms, 'p50_ms': p50_ms, 'p95_ms': p95_ms, 'min_ms': min_ms}
    return latency_col
    

def file_size_bytes(path) -> int:
    """
    :param path: path to file
    :return: the file size in bytes
    """
    return os.path.getsize(path)
