---
date: 2026-03-03
title: "Promptfoo for prompt evaluation"
category: Tech
revisit: false
---

# Promptfoo for prompt evaluation

**Date:** 2026-03-03 · **Category:** Tech · **Revisit?** no

## Why this choice

Open-source, runs locally with no accounts or SaaS dependencies. Native Anthropic provider support, llm-rubric assertions for judge scoring, A/B matrix comparison built-in. TS config for programmatic fixture loading. Custom auto-iterate script on top for Phase 2.

## Options considered

Promptfoo (open-source CLI), Braintrust (SaaS), LangSmith (LangChain SaaS), Langfuse (open-source SaaS)

## Tradeoffs

Less polished UI than Braintrust. No built-in auto-iterate (need custom script for Phase 2). javascript assertion metric names don't display cleanly. But free, local, no vendor lock-in.
