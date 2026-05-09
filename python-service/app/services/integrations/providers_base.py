"""Provider abstract base classes for the CC6 integration adapter registry.

This module is intentionally separate from `integrations/base.py` which owns
the CBS/CRM Adapter Protocol. These base classes cover a different axis: the
*capability* providers that every DMS feature (OCR, LLM, storage, KMS, …) can
swap between local and cloud implementations via tenant_config.

Design decisions
----------------
- ABC over Protocol: consistent with BaseCBSAdapter in base.py; gives clear
  TypeError at instantiation when abstract methods are missing; no need for
  @runtime_checkable boilerplate.
- No pydantic: return types are plain dataclasses to keep this a pure-service
  layer with no framework dependency.
- Config re-read contract: implementations MUST re-read tenant_config on every
  call. The registry caches the provider *instance*, not its config. Providers
  that hold expensive resources (SMTP connections, model handles) MAY cache them
  but MUST expose a reset() method. The base class supplies a no-op default.
- key_id contract (KmsProvider): key_id is an opaque caller-supplied identifier.
  LocalKms uses it as the per-DEK lookup index in tenant_keys. Future providers
  (AWS KMS, HSM) interpret it according to their own scheme (ARN, key alias, etc.).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Shared return-type dataclasses
# ---------------------------------------------------------------------------


@dataclass
class OcrResult:
    """Text extracted from a document."""
    text: str
    confidence: float        # 0.0–1.0
    engine: str = "unknown"
    fields: dict = field(default_factory=dict)


@dataclass
class ChatMessage:
    """A single message in an LLM conversation."""
    role: str                # 'system' | 'user' | 'assistant'
    content: str


@dataclass
class LlmResponse:
    """Response from an LLM generate or chat call."""
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class FaceMatchResult:
    """Result of a biometric face comparison."""
    match: bool
    similarity: float        # 0.0–1.0; higher = more similar
    detail: Optional[str] = None


@dataclass
class SmsResult:
    """Result of an SMS send operation."""
    ok: bool
    message_id: str = ""
    detail: str = ""


@dataclass
class EmailResult:
    """Result of an email send operation."""
    ok: bool
    message_id: str = ""
    detail: str = ""


@dataclass
class WatchlistHit:
    """A single name-match result from the watchlist."""
    name: str
    list_id: str
    list_version: str
    score: float             # similarity score 0.0–1.0
    dob: Optional[str] = None
    country: Optional[str] = None
    aliases: list = field(default_factory=list)


@dataclass
class WatchlistVersion:
    """Metadata about a watchlist data version present in the loaded file."""
    version: str
    entry_count: int = 0


# ---------------------------------------------------------------------------
# Abstract base classes
# ---------------------------------------------------------------------------


class ProviderBase(ABC):
    """Root mixin for all capability providers.

    Supplies a no-op reset() that subclasses override when they hold resources
    (SMTP connections, model handles, file handles) that must be released when
    the registry invalidates a cached instance.
    """

    def reset(self) -> None:
        """Release any cached resources. Called by the registry on invalidation.

        Subclasses that cache connections or model handles override this method.
        The default implementation is a no-op.
        """


class OcrProvider(ProviderBase, ABC):
    """Extract text from document bytes."""

    @abstractmethod
    def extract_text(
        self,
        file_bytes: bytes,
        *,
        mime_type: str,
        lang: str = "en",
    ) -> OcrResult:
        """Run OCR on *file_bytes* and return structured text + confidence.

        Args:
            file_bytes: Raw document bytes (image or PDF).
            mime_type:  MIME type of the document (e.g. 'image/png', 'application/pdf').
            lang:       BCP-47 language hint (e.g. 'en', 'ar', 'dz').

        Returns:
            OcrResult with at minimum .text and .confidence populated.
        """


class EmbeddingProvider(ProviderBase, ABC):
    """Produce dense vector embeddings for text passages."""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text.

        Args:
            texts: Non-empty list of strings to embed.

        Returns:
            List of float vectors, one per input string, in the same order.
            Vector dimension is provider-specific (commonly 384, 768, or 1024).
        """


class LlmProvider(ProviderBase, ABC):
    """Generate text or chat completions via a language model."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> LlmResponse:
        """Single-turn text generation.

        Args:
            prompt:     The full prompt string.
            model:      Override the default model name for this call.
            max_tokens: Maximum tokens to generate.

        Returns:
            LlmResponse with .text populated.
        """

    @abstractmethod
    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: Optional[str] = None,
    ) -> LlmResponse:
        """Multi-turn chat completion.

        Args:
            messages: Conversation history as a list of ChatMessage objects.
            model:    Override the default model for this call.

        Returns:
            LlmResponse with .text set to the assistant's reply.
        """


class TranslateProvider(ProviderBase, ABC):
    """Translate text between languages."""

    @abstractmethod
    def translate(
        self,
        text: str,
        *,
        source_lang: str,
        target_lang: str,
    ) -> str:
        """Translate *text* from *source_lang* to *target_lang*.

        Args:
            text:        UTF-8 input text.
            source_lang: BCP-47 source language code (e.g. 'en', 'ar').
            target_lang: BCP-47 target language code (e.g. 'dz' for Dzongkha).

        Returns:
            Translated string in the target language.
        """


class FaceMatchProvider(ProviderBase, ABC):
    """Compare two face images and return a match decision."""

    @abstractmethod
    def compare(self, face_a: bytes, face_b: bytes) -> FaceMatchResult:
        """Compare two face images.

        Args:
            face_a: Raw image bytes of the first face (ID photo).
            face_b: Raw image bytes of the second face (live photo).

        Returns:
            FaceMatchResult with .match and .similarity populated.
        """


class SmsProvider(ProviderBase, ABC):
    """Send SMS messages."""

    @abstractmethod
    def send(self, to: str, body: str) -> SmsResult:
        """Send an SMS to *to* with content *body*.

        Args:
            to:   E.164 phone number (e.g. '+97517123456').
            body: Message text, max 160 chars for a single SMS segment.

        Returns:
            SmsResult indicating success/failure.
        """


class EmailProvider(ProviderBase, ABC):
    """Send email messages."""

    @abstractmethod
    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        html: Optional[str] = None,
    ) -> EmailResult:
        """Send an email.

        Args:
            to:      Recipient address.
            subject: Email subject line.
            body:    Plain-text body.
            html:    Optional HTML body (multipart/alternative when provided).

        Returns:
            EmailResult indicating success/failure.
        """


class StorageProvider(ProviderBase, ABC):
    """Content-addressed object storage."""

    @abstractmethod
    def put(self, key: str, data: bytes) -> str:
        """Persist *data* under *key*.

        Args:
            key:  Content-addressed key (SHA-256 hex or equivalent).
            data: Raw bytes to store.

        Returns:
            The canonical storage key (may differ from input if normalised).
        """

    @abstractmethod
    def get(self, key: str) -> bytes:
        """Retrieve bytes by *key*.

        Raises:
            FileNotFoundError: if *key* does not exist.
        """

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete the object at *key*.

        No-op if *key* does not exist (idempotent).
        """


class KmsProvider(ProviderBase, ABC):
    """Symmetric key wrap / unwrap for envelope encryption.

    key_id is an opaque caller-supplied identifier. LocalKms uses it as the
    per-DEK lookup index in tenant_keys. Future providers (AWS KMS, HSM)
    interpret key_id according to their own scheme (ARN, key alias, PKCS#11
    label, etc.).
    """

    @abstractmethod
    def encrypt(self, plaintext: bytes, *, key_id: str) -> bytes:
        """Encrypt *plaintext* under the key identified by *key_id*.

        Args:
            plaintext: Data to protect.
            key_id:    Opaque identifier resolved by the backend.

        Returns:
            Ciphertext bytes (format is backend-specific).
        """

    @abstractmethod
    def decrypt(self, ciphertext: bytes, *, key_id: str) -> bytes:
        """Decrypt *ciphertext* using the key identified by *key_id*.

        Args:
            ciphertext: Bytes previously returned by encrypt().
            key_id:     Same opaque identifier used during encrypt().

        Returns:
            Recovered plaintext bytes.
        """


class WatchlistProvider(ProviderBase, ABC):
    """Sanctions / PEP watchlist lookup."""

    @abstractmethod
    def search(
        self,
        name: str,
        *,
        dob: Optional[str] = None,
        country: Optional[str] = None,
    ) -> list[WatchlistHit]:
        """Search the watchlist for entries matching *name*.

        Args:
            name:    Full name to search.
            dob:     Optional date of birth string (ISO-8601 date) for filtering.
            country: Optional ISO-3166-1 alpha-2 country code for filtering.

        Returns:
            List of WatchlistHit, ordered by descending similarity score.
            Empty list means no match above the provider's internal threshold.
        """

    @abstractmethod
    def list_versions(self) -> list[WatchlistVersion]:
        """Return the distinct data versions present in the loaded watchlist.

        Returns:
            List of WatchlistVersion descriptors.
        """


class BiProvider(ProviderBase, ABC):
    """Business intelligence dataset export."""

    @abstractmethod
    def export_dataset(
        self,
        dataset: str,
        *,
        since: Optional[datetime] = None,
    ) -> Path:
        """Export a named dataset to a local file.

        Args:
            dataset: Dataset identifier (e.g. 'fact_documents', 'fact_workflow_steps').
            since:   Optional lower-bound datetime for incremental exports.

        Returns:
            Path to the exported file (Parquet or CSV, provider-specific).
        """


class CdnProvider(ProviderBase, ABC):
    """Generate public URLs for stored objects."""

    @abstractmethod
    def public_url(self, key: str) -> str:
        """Return a publicly reachable URL for the object at *key*.

        Args:
            key: Storage key as returned by StorageProvider.put().

        Returns:
            Absolute or root-relative URL string.
        """


class CacheProvider(ProviderBase, ABC):
    """Generic key-value byte cache with TTL."""

    @abstractmethod
    def get(self, key: str) -> Optional[bytes]:
        """Return cached bytes for *key*, or None if absent / expired."""

    @abstractmethod
    def set(self, key: str, value: bytes, *, ttl_s: int = 300) -> None:
        """Store *value* under *key* with a TTL of *ttl_s* seconds."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Evict *key* from the cache. No-op if absent."""


class NlpProvider(ProviderBase, ABC):
    """Natural-language processing utilities (entity detection, sentiment, etc.)."""

    @abstractmethod
    def detect_entities(self, text: str, *, lang: str = "en") -> list[dict]:
        """Detect named entities in *text*.

        Returns:
            List of dicts with at minimum keys: 'text', 'type', 'score'.
        """

    @abstractmethod
    def detect_sentiment(self, text: str, *, lang: str = "en") -> dict:
        """Return sentiment scores for *text*.

        Returns:
            Dict with at minimum keys: 'sentiment' ('POSITIVE'|'NEGATIVE'|'NEUTRAL'|'MIXED'),
            'score' (float 0–1).
        """


class PiiDetectorProvider(ProviderBase, ABC):
    """PII / sensitive data detection and classification."""

    @abstractmethod
    def detect_pii(self, text: str) -> list[dict]:
        """Detect PII entities in *text*.

        Returns:
            List of dicts with keys: 'type' (e.g. 'EMAIL', 'PHONE', 'NID'),
            'value', 'start', 'end', 'score'.
        """
