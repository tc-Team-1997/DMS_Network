"""Local provider implementations — default-on, no cloud credentials required."""
from .ollama_ocr import OllamaOcr
from .local_embedding import LocalEmbedding
from .ollama_llm import OllamaLlm
from .ollama_translate import OllamaTranslate
from .local_face_match import LocalFaceMatch
from .local_smtp import LocalSmtp
from .noop_sms import NoopSms
from .twilio_sms import TwilioSms
from .local_fs_storage import LocalFsStorage
from .local_kms import LocalKms
from .ofac_json_watchlist import OfacJsonWatchlist
from .local_parquet_bi import LocalParquetBi
from .noop_cdn import NoopCdn
from .local_lru_cache import LocalLruCache

__all__ = [
    "OllamaOcr",
    "LocalEmbedding",
    "OllamaLlm",
    "OllamaTranslate",
    "LocalFaceMatch",
    "LocalSmtp",
    "NoopSms",
    "TwilioSms",
    "LocalFsStorage",
    "LocalKms",
    "OfacJsonWatchlist",
    "LocalParquetBi",
    "NoopCdn",
    "LocalLruCache",
]
