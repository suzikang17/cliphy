# Dynamic Context Section

**Date:** 2026-03-04
**Status:** Approved

## Problem

The `actionItems` field is hardcoded for every summary, but only makes sense for instructional/how-to videos. For other video types (cooking, lectures, discussions), a different section would be more useful.

## Design

Replace the fixed `actionItems` field with an optional `contextSection` — an AI-chosen section with a title, icon, and items that fit the video's content.

### Examples

| Video type    | Section title | Icon |
| ------------- | ------------- | ---- |
| Tutorial      | Steps         | `🔧` |
| Cooking       | Recipe        | `🍳` |
| How-to        | Action Items  | `✅` |
| Lecture       | Key Concepts  | `📚` |
| Entertainment | _(omitted)_   | —    |

### Type Changes

```typescript
// packages/shared/src/types.ts
export interface ContextSection {
  title: string; // AI-chosen
  icon: string; // emoji
  items: string[];
}

export interface SummaryJson {
  summary: string;
  keyPoints: string[];
  contextSection?: ContextSection; // replaces actionItems
  timestamps: string[];
  truncated?: boolean;
}
```

### Prompt Changes

- Remove `actionItems` from the JSON schema
- Add `contextSection` as optional with `title`, `icon`, `items`
- Instruct AI to pick a title and emoji fitting the video content
- Provide examples of good section types
- Omit entirely if nothing fits (entertainment, music, etc.)

### Frontend Changes

- `SummaryDetail.tsx`: render `contextSection` with dynamic title/icon
- TOC button uses `contextSection.title`
- Backward compat: if old `actionItems` exists, render as `{ title: "Action Items", icon: "→", items }`
- Export (markdown/plaintext): use `contextSection.title` as section header

### Eval Changes

- Update fixtures to use `contextSection` format
- Update rubric to evaluate context section generically

### No DB Migration

JSONB storage handles both old and new shapes. Frontend fallback bridges the gap.

## Decisions

- **Scope:** Only replace Action Items; summary, keyPoints, timestamps stay fixed
- **Titles:** Freeform AI-chosen (not from a predefined set)
- **Icons:** AI-chosen emoji
- **Optional:** Omit when nothing fits (entertainment, music)
- **Data model:** Single `contextSection` object (not array, not dual fields)
