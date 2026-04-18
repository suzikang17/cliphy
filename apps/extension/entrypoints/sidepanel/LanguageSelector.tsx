import { useState, useEffect } from "react";
import { SUMMARY_LANGUAGES } from "@cliphy/shared";
import type { SummaryLanguageCode } from "@cliphy/shared";
import { getSettings, updateSettings } from "../../lib/api";
import { get, set } from "../../lib/storage";

const STORAGE_KEY = "cliphy_summary_language";

export function LanguageSelector() {
  const [language, setLanguage] = useState<SummaryLanguageCode>("en");

  useEffect(() => {
    async function load() {
      // Load from local storage first (fast)
      const cached = await get<SummaryLanguageCode>(STORAGE_KEY);
      if (cached) setLanguage(cached);

      // Then sync from server
      try {
        const settings = await getSettings();
        setLanguage(settings.summaryLanguage);
        await set(STORAGE_KEY, settings.summaryLanguage);
      } catch {
        // Use cached value on error
      }
    }
    load();
  }, []);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value as SummaryLanguageCode;
    const prev = language;
    setLanguage(code);
    await set(STORAGE_KEY, code);

    try {
      await updateSettings({ summaryLanguage: code });
    } catch {
      // Revert on error
      setLanguage(prev);
      await set(STORAGE_KEY, prev);
    }
  }

  return (
    <div className="px-3 py-1.5 border-b border-(--color-border-soft) flex items-center gap-1.5">
      <span
        title="Summary language"
        className="cursor-default select-none text-sm leading-none text-(--color-text-muted)"
      >
        🌐
      </span>
      <select
        value={language}
        onChange={handleChange}
        className="text-xs bg-(--color-surface-raised) border border-(--color-border-soft) rounded px-1.5 py-0.5 text-(--color-text) cursor-pointer"
      >
        {Object.entries(SUMMARY_LANGUAGES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
