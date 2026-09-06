import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
vi.mock("../supabase", () => ({ supabase: {} }));
vi.mock("../api", () => ({ addClip: vi.fn() }));

const { storagePathFor } = await import("../uploadImage");

describe("storagePathFor", () => {
  beforeEach(() => {
    layer("unit");
    epic("Capture");
    feature("Upload");
  });

  it("namespaces the path under the user id and keeps a jpg extension", () => {
    const p = storagePathFor("user-123");
    expect(p.startsWith("user-123/")).toBe(true);
    expect(p.endsWith(".jpg")).toBe(true);
  });
});
