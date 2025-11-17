import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Settings as SettingsIcon, Download, Upload, RotateCcw } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { usePersistentTab } from "@/hooks/use-persistent-tab";
import { useTabScrollRestoration } from "@/hooks/use-tab-scroll-restoration";
import { validateSettings } from "@/lib/settings-validation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { VacationSettings } from "@/components/settings/VacationSettings";
import { PrimaryCallSettings } from "@/components/settings/PrimaryCallSettings";
import { JeopardySettings } from "@/components/settings/JeopardySettings";
import { HFSettings } from "@/components/settings/HFSettings";
import { ClinicSettings } from "@/components/settings/ClinicSettings";
import { AmbulatorySettings } from "@/components/settings/AmbulatorySettings";
import { BlockRotationSettings } from "@/components/settings/BlockRotationSettings";

export default function Settings() {
  const location = useLocation();
  
  const {
    settings,
    hasUnsavedChanges,
    updateSection,
    save,
    resetToDefaults,
    exportSettings,
    importSettings,
  } = useSettings();

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [activeTab, setActiveTab] = usePersistentTab('settings', 'vacation');
  const validation = validateSettings(settings);
  
  useTabScrollRestoration(location.pathname, activeTab);

  const handleSave = () => {
    if (!validation.valid) {
      toast({
        title: "Validation Error",
        description: validation.errors.join(", "),
        variant: "destructive",
      });
      return;
    }
    save();
    toast({
      title: "Settings Saved",
      description: "Your settings have been saved successfully.",
    });
  };

  const handleReset = () => {
    resetToDefaults();
    setShowResetDialog(false);
    toast({
      title: "Settings Reset",
      description: "All settings have been reset to defaults.",
    });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importSettings(file);
    if (result.success) {
      toast({
        title: "Settings Imported",
        description: "Settings imported successfully. Remember to save changes.",
      });
    } else {
      toast({
        title: "Import Failed",
        description: result.error,
        variant: "destructive",
      });
    }
    e.target.value = "";
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-2">
            <SettingsIcon className="h-8 w-8" />
            Scheduler Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Customize scheduling rules and constraints
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportSettings}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" asChild>
            <label>
              <Upload className="h-4 w-4 mr-2" />
              Import
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
            </label>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetDialog(true)}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All
          </Button>
        </div>
      </div>

      {hasUnsavedChanges && (
        <Alert className="mb-6">
          <AlertDescription>
            You have unsaved changes. Click "Save Changes" to apply them.
          </AlertDescription>
        </Alert>
      )}

      {validation.warnings.length > 0 && (
        <Alert className="mb-6">
          <AlertDescription>
            <strong>Warnings:</strong> {validation.warnings.join("; ")}
          </AlertDescription>
        </Alert>
      )}

      {validation.errors.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            <strong>Errors:</strong> {validation.errors.join("; ")}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="vacation">Vacation</TabsTrigger>
          <TabsTrigger value="blocks">Block Rotations</TabsTrigger>
          <TabsTrigger value="primary">Primary Call</TabsTrigger>
          <TabsTrigger value="jeopardy">Jeopardy</TabsTrigger>
          <TabsTrigger value="hf">HF Coverage</TabsTrigger>
          <TabsTrigger value="clinics">Clinics</TabsTrigger>
          <TabsTrigger value="ambulatory">Ambulatory</TabsTrigger>
        </TabsList>

        <TabsContent value="vacation">
          <VacationSettings
            settings={settings.vacation}
            onUpdate={(data) => updateSection("vacation", data)}
          />
        </TabsContent>

        <TabsContent value="blocks">
          <BlockRotationSettings settings={settings.blockRotations} />
        </TabsContent>

        <TabsContent value="primary">
          <PrimaryCallSettings
            settings={settings.primaryCall}
            onUpdate={(data) => updateSection("primaryCall", data)}
          />
        </TabsContent>

        <TabsContent value="jeopardy">
          <JeopardySettings
            settings={settings.jeopardyCall}
            onUpdate={(data) => updateSection("jeopardyCall", data)}
          />
        </TabsContent>

        <TabsContent value="hf">
          <HFSettings
            settings={settings.hfCoverage}
            onUpdate={(data) => updateSection("hfCoverage", data)}
          />
        </TabsContent>

        <TabsContent value="clinics">
          <ClinicSettings
            settings={settings.clinics}
            onUpdate={(data) => updateSection("clinics", data)}
          />
        </TabsContent>

        <TabsContent value="ambulatory">
          <AmbulatorySettings
            settings={settings.ambulatoryFellow}
            onUpdate={(data) => updateSection("ambulatoryFellow", data)}
          />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-3 mt-8">
        <Button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || !validation.valid}
          size="lg"
        >
          Save Changes
        </Button>
      </div>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all settings to their default values. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
