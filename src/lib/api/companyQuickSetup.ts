import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "./types";

export type CompanySetupStatus = "needsConfirmation" | "configured" | "failed";
export type CompanyAppSetupStatus =
  | "pending"
  | "success"
  | "failed"
  | "rolledBack"
  | "skipped";

export interface CompanyKeySetupRequest {
  apiKey: string;
  mode: "default" | "custom";
  apps?: AppId[];
  baseUrl?: string;
  model?: string;
  confirmOverwrite?: boolean;
  resolveUserEnvConflicts?: boolean;
}

export interface ExistingConfig {
  app: string;
  kind: string;
  label: string;
  action: string;
  source?: string;
  resolvable: boolean;
}

export interface AppSetupResult {
  app: string;
  status: CompanyAppSetupStatus;
  message: string;
  rollbackStatus?: string;
}

export interface CompanyKeySetupResult {
  status: CompanySetupStatus;
  existingConfigs: ExistingConfig[];
  appResults: AppSetupResult[];
  warnings: string[];
  backupPath?: string;
  restartRequiredApps: string[];
}

export const companyQuickSetupApi = {
  async quickSetup(
    request: CompanyKeySetupRequest,
  ): Promise<CompanyKeySetupResult> {
    return await invoke("quick_setup_company_key", { request });
  },
};
