# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-12

### Added

- Desktop indexing for recursive local `.eml` archives, preserving the original
  email files.
- Keyword search across sender names and addresses, subjects, message content,
  and attachment filenames.
- Local semantic search with Qwen3 embedding models and optional local
  reranking, both powered by Transformers.js.
- Configurable embedding-model size, inference device, quantization, ranking
  limits, and reranking defaults.
- Sender and inclusive date-range filters, sortable result columns, and
  double-click opening of the original message in its associated application.
- Local SQLite, FTS5, and vector storage, with incremental reindexing for
  unchanged messages.
- Settings for selecting the archive folder and maintaining the index, including
  clearing semantic data or all indexed mail without deleting source messages
  or cached models.
- Per-user configuration and application-data storage on Windows, macOS, and
  Linux, with a first-launch archive-folder prompt.
- Native Windows installer and portable executable, macOS DMG, and Linux
  AppImage package targets, with CI runtime verification and SHA-256 checksums.
