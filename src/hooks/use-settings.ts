import { useState, useCallback } from "react";
import {
  SchedulerSettings,
  loadSettings,
  saveSettings,
  resetSettings as resetSettingsEngine,
  exportSettings as exportSettingsEngine,
  importSettings as importSettingsEngine,
  DEFAULT_SETTINGS,
} from "@/lib/settings-engine";

export function useSettings() {
  const [settings, setSettings] = useState<SchedulerSettings>(() => loadSettings());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const updateSettings = useCallback((partial: Partial<SchedulerSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      return updated;
    });
    setHasUnsavedChanges(true);
  }, []);

  const updateSection = useCallback(
    <K extends keyof SchedulerSettings>(
      section: K,
      data: Partial<SchedulerSettings[K]>
    ) => {
      setSettings((prev) => ({
        ...prev,
        [section]: { ...(prev[section] as object), ...(data as object) },
      }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const save = useCallback(() => {
    saveSettings(settings);
    setHasUnsavedChanges(false);
  }, [settings]);

  const resetToDefaults = useCallback(() => {
    const defaults = resetSettingsEngine();
    setSettings(defaults);
    setHasUnsavedChanges(false);
  }, []);

  const resetSection = useCallback(
    <K extends keyof SchedulerSettings>(section: K) => {
      setSettings((prev) => ({
        ...prev,
        [section]: DEFAULT_SETTINGS[section],
      }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const exportSettings = useCallback(() => {
    exportSettingsEngine(settings);
  }, [settings]);

  const importSettings = useCallback(async (file: File) => {
    try {
      const imported = await importSettingsEngine(file);
      setSettings(imported);
      setHasUnsavedChanges(true);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Import failed" };
    }
  }, []);

  const isDefault = useCallback(
    <K extends keyof SchedulerSettings>(section: K): boolean => {
      return JSON.stringify(settings[section]) === JSON.stringify(DEFAULT_SETTINGS[section]);
    },
    [settings]
  );

  return {
    settings,
    hasUnsavedChanges,
    updateSettings,
    updateSection,
    save,
    resetToDefaults,
    resetSection,
    exportSettings,
    importSettings,
    isDefault,
  };
}
