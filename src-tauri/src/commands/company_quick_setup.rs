use tauri::State;

use crate::services::{CompanyKeySetupRequest, CompanyKeySetupResult, CompanyQuickSetupService};
use crate::store::AppState;

#[tauri::command]
pub async fn quick_setup_company_key(
    state: State<'_, AppState>,
    request: CompanyKeySetupRequest,
) -> Result<CompanyKeySetupResult, String> {
    log::info!(
        "[QuickSetup] command received apps={:?} mode={:?} confirm_overwrite={} resolve_env_conflicts={} api_key_len={}",
        request.apps,
        request.mode,
        request.confirm_overwrite,
        request.resolve_user_env_conflicts,
        request.api_key.trim().len()
    );

    match CompanyQuickSetupService::quick_setup_company_key(state.inner(), request).await {
        Ok(result) => {
            log::info!(
                "[QuickSetup] command completed status={:?} app_results={} existing_configs={} warnings={} backup_path={:?}",
                result.status,
                result.app_results.len(),
                result.existing_configs.len(),
                result.warnings.len(),
                result.backup_path
            );
            Ok(result)
        }
        Err(error) => {
            log::error!("[QuickSetup] command failed: {error}");
            Err(error.to_string())
        }
    }
}
