use tauri::State;

use crate::error::AppError;
use crate::services::{CompanyKeySetupRequest, CompanyKeySetupResult, CompanyQuickSetupService};
use crate::store::AppState;

#[tauri::command]
pub async fn quick_setup_company_key(
    state: State<'_, AppState>,
    request: CompanyKeySetupRequest,
) -> Result<CompanyKeySetupResult, String> {
    CompanyQuickSetupService::quick_setup_company_key(state.inner(), request)
        .await
        .map_err(|e: AppError| e.to_string())
}
