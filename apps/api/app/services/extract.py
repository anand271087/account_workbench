"""Text extraction for AK03.c uploads.

Audio/video transcription is deferred to v1.1 — the worker raises a clear
'not supported' error for those mime types so the UI can show the right
message instead of a stack trace.

Format coverage (M16.x — markitdown switchover):
  - .docx / .pptx / .xlsx / .xls / .pdf → Microsoft's `markitdown` library.
    Single API, produces structured Markdown (slide numbers, speaker notes,
    tables, image alt-text), wheel-only deps (clean on Render).
  - .txt, .vtt, .eml                     → our own handlers (fast paths;
    .eml has Outlook-specific parsing markitdown's `[outlook]` extra
    targets .msg files, not RFC-5322 .eml).
  - .doc / .ppt                          → rejected with a friendly
    "Save As .docx/.pptx and re-upload" message. Legacy OLE binary
    formats have no reliable pure-Python parser.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Final

logger = logging.getLogger(__name__)

# Cap the text we feed Claude so a 200-page PDF doesn't blow our token budget.
# Claude Sonnet 4.5 has plenty of context, but we only summarise meeting docs;
# the first ~24k characters cover everything that matters.
MAX_EXTRACT_CHARS: Final[int] = 24_000

# Extensions markitdown handles in our deployment (we install the matching extras).
_MARKITDOWN_EXTS: Final[tuple[str, ...]] = (".docx", ".pptx", ".xlsx", ".xls", ".pdf")


class ExtractError(Exception):
    """Raised when we can't get text out — surfaced to the user verbatim."""


def extract_text(filename: str, mime_type: str | None, data: bytes) -> str:
    name = (filename or "").lower()

    # Defer audio/video to v1.1 explicitly.
    if name.endswith((".mp3", ".mp4", ".m4a", ".wav", ".mov")) or (
        mime_type and (mime_type.startswith("audio/") or mime_type.startswith("video/"))
    ):
        raise ExtractError(
            "Audio/video transcription lands in v1.1. "
            "Upload a .docx/.pptx/.xlsx/.pdf/.txt/.vtt/.eml instead."
        )

    # Legacy OLE binary formats — no reliable pure-Python parser. Friendly
    # error so the user knows the actionable next step.
    if name.endswith(".doc"):
        raise ExtractError(
            "Legacy .doc format isn't supported for text extraction. "
            "Open the file in Word and 'Save As' .docx, then re-upload."
        )
    if name.endswith(".ppt"):
        raise ExtractError(
            "Legacy .ppt format isn't supported for text extraction. "
            "Open the file in PowerPoint and 'Save As' .pptx, then re-upload."
        )

    if name.endswith(_MARKITDOWN_EXTS):
        text = _extract_with_markitdown(name, data)
    elif name.endswith(".vtt"):
        text = _extract_vtt(data)
    elif name.endswith(".eml"):
        text = _extract_eml(data)
    elif name.endswith((".txt", ".csv", ".md", ".markdown")):
        # Bug 6 — CSV / MD treated as plain text. UTF-8 decode is correct
        # for both: CSV stays as-is (Claude reads tabular text fine) and
        # markdown is already a text format. Replace errors keeps the
        # extraction non-fatal on dirty inputs.
        text = data.decode("utf-8", errors="replace")
    else:
        raise ExtractError(f"Unsupported extension for text extraction: {filename}")

    text = (text or "").strip()
    if not text:
        raise ExtractError("File contained no extractable text.")
    if len(text) > MAX_EXTRACT_CHARS:
        text = text[:MAX_EXTRACT_CHARS] + "\n\n…[truncated]"
    return text


def _extract_with_markitdown(filename: str, data: bytes) -> str:
    """Single entry for .docx / .pptx / .xlsx / .xls / .pdf via markitdown.

    markitdown's `convert_stream()` exists but it sniffs by content; the more
    reliable path on every release is to write to a temp file with the right
    extension and call `convert()`. Marginal disk cost; bulletproof routing.
    """
    from markitdown import MarkItDown  # type: ignore

    md = MarkItDown(enable_plugins=False)
    suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
        fh.write(data)
        tmp_path = Path(fh.name)
    try:
        result = md.convert(str(tmp_path))
    except Exception as exc:  # noqa: BLE001 — surface as ExtractError, not a 500
        raise ExtractError(f"Failed to extract text from {filename}: {exc}") from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Could not clean up tempfile %s", tmp_path)
    return getattr(result, "text_content", "") or ""


def _extract_vtt(data: bytes) -> str:
    """Strip WebVTT cue headers + timestamps; keep only the spoken text lines."""
    raw = data.decode("utf-8", errors="replace")
    out: list[str] = []
    for line in raw.splitlines():
        s = line.strip()
        if not s or s == "WEBVTT" or "-->" in s or s.isdigit():
            continue
        out.append(s)
    return " ".join(out)


def _extract_eml(data: bytes) -> str:
    """Parse an Outlook/RFC-5322 .eml file. Prefer text/plain; fall back to a
    naive HTML strip for text/html. Prepend a small header summary so the AI
    sees subject + participants alongside the body."""
    import re
    from email import message_from_bytes
    from email.policy import default as default_policy

    msg = message_from_bytes(data, policy=default_policy)

    header_lines: list[str] = []
    for label, key in (("From", "From"), ("To", "To"), ("Cc", "Cc"), ("Subject", "Subject"), ("Date", "Date")):
        val = msg.get(key)
        if val:
            header_lines.append(f"{label}: {val}")

    # Walk parts, prefer text/plain. Capture text/html as fallback.
    plain_parts: list[str] = []
    html_parts: list[str] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = (part.get_content_type() or "").lower()
        # Skip attachments by Content-Disposition.
        disp = (part.get("Content-Disposition") or "").lower()
        if "attachment" in disp:
            continue
        try:
            content = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b""
            content = payload.decode("utf-8", errors="replace") if isinstance(payload, bytes) else str(payload)
        if not isinstance(content, str):
            continue
        if ctype == "text/plain":
            plain_parts.append(content)
        elif ctype == "text/html":
            html_parts.append(content)

    body = "\n\n".join(plain_parts).strip()
    if not body and html_parts:
        # Naive HTML → text: drop tags + collapse whitespace. Good enough for MOMs.
        raw_html = "\n\n".join(html_parts)
        # Drop <style>/<script> blocks entirely.
        raw_html = re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", raw_html)
        # Convert <br> and </p> to newlines so paragraph structure survives.
        raw_html = re.sub(r"(?i)<br\s*/?>", "\n", raw_html)
        raw_html = re.sub(r"(?i)</p\s*>", "\n\n", raw_html)
        # Strip remaining tags.
        text_only = re.sub(r"<[^>]+>", " ", raw_html)
        # Unescape common entities.
        text_only = (
            text_only.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
        )
        # Collapse runs of whitespace per line; keep paragraph breaks.
        lines = [re.sub(r"\s+", " ", ln).strip() for ln in text_only.splitlines()]
        body = "\n".join(ln for ln in lines if ln)

    header_block = "=== HEADERS ===\n" + "\n".join(header_lines) if header_lines else ""
    body_block = f"\n\n=== BODY ===\n{body}" if body else ""
    return (header_block + body_block).strip()
