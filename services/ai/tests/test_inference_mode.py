from zordms_ai.settings import Settings


def test_gpu_mode_not_degraded():
    assert Settings(inference_mode="gpu").is_degraded is False


def test_cpu_degraded_mode_flag():
    s = Settings(inference_mode="cpu_degraded")
    assert s.is_degraded is True
