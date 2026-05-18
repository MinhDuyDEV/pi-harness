---
name: pikit-translate
version: 1.0.0
---

## preferences
# Target language to translate into
target_language: vi-VN
# Default mode: quick, normal, or refined
default_mode: normal
# Target reader: general, technical, academic, business
audience: general
# Style: storytelling, formal, technical, literal, conversational
style: storytelling
# Word count threshold to trigger chunked parallel translation
chunk_threshold: 4000
# Max words per chunk when chunking
chunk_max_words: 5000
# Verbose logging
verbose: false

## glossary
# Technical terms specific to this project
# Format: <source term>: <target translation>
# Example:
# API: 应用程序接口
# latency: 延迟
