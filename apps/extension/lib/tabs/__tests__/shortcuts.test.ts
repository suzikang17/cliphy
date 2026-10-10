// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { PANEL_SHORTCUTS, resolveShortcut, isTypingTarget } from "../shortcuts";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  }) as KeyboardEvent;

describe("panel shortcuts", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — shortcuts");
  });

  it.each([
    ["/", "focusSearch"],
    ["j", "next"],
    ["ArrowDown", "next"],
    ["k", "prev"],
    ["ArrowUp", "prev"],
    ["Enter", "open"],
    ["x", "closeTab"],
    ["s", "stowTab"],
    ["m", "moveTab"],
    ["r", "renameTab"],
    ["n", "noteTab"],
    ["e", "editGroup"],
    ["a", "acceptGroup"],
    ["X", "closeGroup"],
    ["S", "stowGroup"],
    ["D", "closeDuplicates"],
    ["?", "help"],
  ])("%s → %s", (k, action) => {
    expect(resolveShortcut(key(k, { shiftKey: k !== k.toLowerCase() || k === "?" }))).toBe(action);
  });

  it("ignores keys with Cmd/Ctrl/Alt so browser and ⌥↑/↓ shortcuts keep working", () => {
    expect(resolveShortcut(key("x", { metaKey: true }))).toBeNull();
    expect(resolveShortcut(key("s", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("ArrowUp", { altKey: true }))).toBeNull();
  });

  it("ignores unmapped keys", () => {
    expect(resolveShortcut(key("q"))).toBeNull();
  });

  it("every action has a label shown in the cheat sheet", () => {
    for (const s of PANEL_SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.label).toBeTruthy();
    }
    expect(new Set(PANEL_SHORTCUTS.map((s) => s.action)).size).toBe(PANEL_SHORTCUTS.length);
  });

  it("treats inputs, textareas, selects and contenteditable as typing targets", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
