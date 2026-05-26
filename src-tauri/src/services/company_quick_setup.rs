use crate::app_config::AppType;
use crate::codex_config::{get_codex_auth_path, get_codex_config_path};
use crate::config::get_app_config_dir;
use crate::error::AppError;
use crate::opencode_config;
use crate::provider::{
    OpenCodeModel, OpenCodeProviderConfig, OpenCodeProviderOptions, Provider, ProviderMeta,
};
use crate::proxy::providers::{AuthInfo, AuthStrategy};
use crate::services::env_checker;
use crate::services::env_manager;
use crate::services::provider::{read_live_settings, ProviderService};
use crate::services::stream_check::{StreamCheckConfig, StreamCheckService};
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const COMPANY_PROVIDER_ID_CODEX: &str = "quick-setup-gateway";
const COMPANY_PROVIDER_ID_OPENCODE: &str = "quick-setup-gateway";
const COMPANY_PROVIDER_NAME: &str = "Quick Setup Gateway";
const DEFAULT_BASE_URL_DISPLAY: &str = "https://catcatcode.com/";
const DEFAULT_MODEL: &str = "gpt-5.5";
const CODEX_MODEL_PROVIDER_ID: &str = "quick_setup_gateway";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompanySetupMode {
    Default,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompanySetupStatus {
    NeedsConfirmation,
    Configured,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompanyAppSetupStatus {
    Pending,
    Success,
    Failed,
    RolledBack,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyKeySetupRequest {
    pub api_key: String,
    #[serde(default = "default_setup_mode")]
    pub mode: CompanySetupMode,
    #[serde(default)]
    pub apps: Option<Vec<AppType>>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub confirm_overwrite: bool,
    #[serde(default)]
    pub resolve_user_env_conflicts: bool,
}

fn default_setup_mode() -> CompanySetupMode {
    CompanySetupMode::Default
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingConfig {
    pub app: String,
    pub kind: String,
    pub label: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default)]
    pub resolvable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSetupResult {
    pub app: String,
    pub status: CompanyAppSetupStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyKeySetupResult {
    pub status: CompanySetupStatus,
    pub existing_configs: Vec<ExistingConfig>,
    pub app_results: Vec<AppSetupResult>,
    pub warnings: Vec<String>,
    pub backup_path: Option<String>,
    pub restart_required_apps: Vec<String>,
}

impl CompanyKeySetupResult {
    fn failed(message: String) -> Self {
        Self {
            status: CompanySetupStatus::Failed,
            existing_configs: Vec::new(),
            app_results: vec![AppSetupResult {
                app: "quick_setup".to_string(),
                status: CompanyAppSetupStatus::Failed,
                message,
                rollback_status: None,
            }],
            warnings: Vec::new(),
            backup_path: None,
            restart_required_apps: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct DbSnapshot {
    codex_provider: Option<Provider>,
    opencode_provider: Option<Provider>,
    codex_current: Option<String>,
}

#[derive(Clone)]
struct FileSnapshot {
    target: PathBuf,
    backup: Option<PathBuf>,
}

struct BackupSnapshot {
    dir: PathBuf,
    files: Vec<FileSnapshot>,
}

pub struct CompanyQuickSetupService;

impl CompanyQuickSetupService {
    pub fn normalize_base_url(raw: Option<&str>) -> Result<String, AppError> {
        let raw = raw
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_BASE_URL_DISPLAY)
            .trim_end_matches('/')
            .to_string();
        let parsed = url::Url::parse(&raw)
            .map_err(|e| AppError::Message(format!("Invalid gateway URL: {e}")))?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(AppError::Message(
                "Gateway URL must start with http:// or https://".to_string(),
            ));
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(AppError::Message(
                "Gateway URL must not contain query or fragment".to_string(),
            ));
        }
        let path = parsed.path().trim_end_matches('/');
        if path == "/v1" || path.starts_with("/v1/") {
            Ok(raw)
        } else {
            Ok(format!("{raw}/v1"))
        }
    }

    pub async fn quick_setup_company_key(
        state: &AppState,
        request: CompanyKeySetupRequest,
    ) -> Result<CompanyKeySetupResult, AppError> {
        let api_key = request.api_key.trim().to_string();
        log::info!(
            "[QuickSetup] service started mode={:?} confirm_overwrite={} resolve_env_conflicts={} api_key_len={}",
            request.mode,
            request.confirm_overwrite,
            request.resolve_user_env_conflicts,
            api_key.len()
        );
        if api_key.is_empty() {
            log::warn!("[QuickSetup] rejected empty API key");
            return Ok(CompanyKeySetupResult::failed(
                "API key is required".to_string(),
            ));
        }

        let model = request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_MODEL)
            .to_string();
        let base_url = Self::normalize_base_url(request.base_url.as_deref())?;
        let apps = match Self::resolve_apps(request.apps) {
            Ok(apps) => apps,
            Err(message) => {
                log::warn!("[QuickSetup] unsupported app selection: {message}");
                return Ok(CompanyKeySetupResult::failed(message));
            }
        };
        log::info!(
            "[QuickSetup] resolved target apps={:?} base_url={} model={}",
            apps,
            base_url,
            model
        );

        log::info!("[QuickSetup] validating API key");
        if let Err(error) = Self::validate_company_key(&api_key, &base_url, &model).await {
            let sanitized = Self::sanitize_message(&error.to_string(), &api_key);
            log::warn!("[QuickSetup] validation failed: {sanitized}");
            return Ok(CompanyKeySetupResult::failed(sanitized));
        }
        log::info!("[QuickSetup] validation succeeded");

        let existing_configs = Self::detect_existing_configs(state, &apps)?;
        log::info!(
            "[QuickSetup] detected existing configs count={}",
            existing_configs.len()
        );
        let needs_confirmation = !existing_configs.is_empty();
        if needs_confirmation && !request.confirm_overwrite {
            log::info!("[QuickSetup] waiting for overwrite confirmation");
            return Ok(CompanyKeySetupResult {
                status: CompanySetupStatus::NeedsConfirmation,
                existing_configs,
                app_results: apps
                    .iter()
                    .map(|app| AppSetupResult {
                        app: app.as_str().to_string(),
                        status: CompanyAppSetupStatus::Pending,
                        message: "Waiting for confirmation".to_string(),
                        rollback_status: None,
                    })
                    .collect(),
                warnings: Vec::new(),
                backup_path: None,
                restart_required_apps: Vec::new(),
            });
        }

        log::info!("[QuickSetup] capturing database snapshot");
        let db_snapshot = Self::capture_db_snapshot(state)?;
        log::info!("[QuickSetup] backing up live config files");
        let backup_snapshot = Self::backup_live_files(&apps)?;
        let backup_path = Some(backup_snapshot.dir.to_string_lossy().to_string());
        log::info!("[QuickSetup] backup created at {:?}", backup_path);

        let mut warnings = Vec::new();
        if request.resolve_user_env_conflicts {
            log::info!("[QuickSetup] resolving user env conflicts");
            match Self::delete_resolvable_env_conflicts() {
                Ok(Some(path)) => {
                    log::info!("[QuickSetup] env conflicts removed backup={path}");
                    warnings.push(format!("env_backup:{path}"));
                }
                Ok(None) => log::info!("[QuickSetup] no resolvable env conflicts found"),
                Err(err) => {
                    log::warn!("[QuickSetup] env cleanup failed: {err}");
                    warnings.push(format!("env_cleanup_failed:{}", err));
                }
            }
        }

        log::info!("[QuickSetup] applying providers");
        let apply_result = Self::apply_company_providers(state, &apps, &api_key, &base_url, &model);
        match apply_result {
            Ok(mut app_results) => {
                for result in &mut app_results {
                    result.message = Self::sanitize_message(&result.message, &api_key);
                }
                log::info!(
                    "[QuickSetup] configured successfully apps={:?}",
                    apps.iter().map(|app| app.as_str()).collect::<Vec<_>>()
                );
                Ok(CompanyKeySetupResult {
                    status: CompanySetupStatus::Configured,
                    existing_configs,
                    app_results,
                    warnings,
                    backup_path,
                    restart_required_apps: apps
                        .iter()
                        .map(|app| app.as_str().to_string())
                        .collect(),
                })
            }
            Err(err) => {
                let sanitized_error = Self::sanitize_message(&err.to_string(), &api_key);
                log::error!("[QuickSetup] apply failed: {sanitized_error}");
                let file_rollback = Self::restore_live_files(&backup_snapshot.files);
                let db_rollback = Self::restore_db_snapshot(state, db_snapshot);
                let rollback_status = match (file_rollback, db_rollback) {
                    (Ok(()), Ok(())) => "rolledBack".to_string(),
                    (file, db) => format!(
                        "rollbackFailed:file={};db={}",
                        file.err()
                            .map(|e| Self::sanitize_message(&e.to_string(), &api_key))
                            .unwrap_or_else(|| "ok".to_string()),
                        db.err()
                            .map(|e| Self::sanitize_message(&e.to_string(), &api_key))
                            .unwrap_or_else(|| "ok".to_string())
                    ),
                };
                log::warn!("[QuickSetup] rollback status={rollback_status}");
                Ok(CompanyKeySetupResult {
                    status: CompanySetupStatus::Failed,
                    existing_configs,
                    app_results: vec![AppSetupResult {
                        app: "quick_setup".to_string(),
                        status: CompanyAppSetupStatus::Failed,
                        message: sanitized_error,
                        rollback_status: Some(rollback_status),
                    }],
                    warnings,
                    backup_path,
                    restart_required_apps: Vec::new(),
                })
            }
        }
    }

    fn resolve_apps(apps: Option<Vec<AppType>>) -> Result<Vec<AppType>, String> {
        let apps = apps.unwrap_or_else(|| vec![AppType::Codex, AppType::OpenCode]);
        if apps.is_empty() {
            return Err("At least one app must be selected".to_string());
        }
        for app in &apps {
            if !matches!(app, AppType::Codex | AppType::OpenCode) {
                return Err(format!(
                    "Quick setup currently supports codex and opencode only, got {}",
                    app.as_str()
                ));
            }
        }
        let mut deduped = Vec::new();
        for app in apps {
            if !deduped.contains(&app) {
                deduped.push(app);
            }
        }
        Ok(deduped)
    }

    async fn validate_company_key(
        api_key: &str,
        base_url: &str,
        model: &str,
    ) -> Result<(), AppError> {
        let provider = Self::build_codex_provider(api_key, base_url, model);
        let config = StreamCheckConfig {
            timeout_secs: 20,
            max_retries: 0,
            degraded_threshold_ms: 6000,
            claude_model: model.to_string(),
            codex_model: model.to_string(),
            gemini_model: model.to_string(),
            test_prompt: "Reply OK".to_string(),
        };
        let result = StreamCheckService::check_with_retry(
            &AppType::Codex,
            &provider,
            &config,
            Some(AuthInfo::new(api_key.to_string(), AuthStrategy::Bearer)),
            Some(base_url.to_string()),
            None,
        )
        .await?;
        if result.success {
            Ok(())
        } else {
            Err(AppError::Message(result.message))
        }
    }

    fn detect_existing_configs(
        state: &AppState,
        apps: &[AppType],
    ) -> Result<Vec<ExistingConfig>, AppError> {
        let mut configs = Vec::new();
        if apps.contains(&AppType::Codex) {
            let auth_path = get_codex_auth_path();
            let config_path = get_codex_config_path();
            if auth_path.exists() {
                configs.push(ExistingConfig {
                    app: "codex".to_string(),
                    kind: "file".to_string(),
                    label: "Codex auth.json exists".to_string(),
                    action: "backupAndOverwrite".to_string(),
                    source: Some(auth_path.to_string_lossy().to_string()),
                    resolvable: true,
                });
            }
            if config_path.exists() {
                configs.push(ExistingConfig {
                    app: "codex".to_string(),
                    kind: "file".to_string(),
                    label: "Codex config.toml exists".to_string(),
                    action: "backupAndOverwrite".to_string(),
                    source: Some(config_path.to_string_lossy().to_string()),
                    resolvable: true,
                });
            }
            for conflict in env_checker::check_env_conflicts("codex")
                .map_err(AppError::Message)?
                .into_iter()
                .filter(|conflict| conflict.var_name == "OPENAI_API_KEY")
            {
                configs.push(ExistingConfig {
                    app: "codex".to_string(),
                    kind: "env".to_string(),
                    label: "OPENAI_API_KEY environment variable exists".to_string(),
                    action: if conflict.source_path.contains("HKEY_CURRENT_USER") {
                        "backupAndRemoveIfConfirmed".to_string()
                    } else {
                        "warnOnly".to_string()
                    },
                    source: Some(conflict.source_path),
                    resolvable: true,
                });
            }
        }

        if apps.contains(&AppType::OpenCode) {
            let live_exists = opencode_config::get_providers()
                .map(|providers| providers.contains_key(COMPANY_PROVIDER_ID_OPENCODE))
                .unwrap_or(false);
            let db_exists = state
                .db
                .get_provider_by_id(COMPANY_PROVIDER_ID_OPENCODE, AppType::OpenCode.as_str())?
                .is_some();
            if live_exists || db_exists {
                configs.push(ExistingConfig {
                    app: "opencode".to_string(),
                    kind: "provider".to_string(),
                    label: "OpenCode quick-setup-gateway provider exists".to_string(),
                    action: "backupAndOverwrite".to_string(),
                    source: None,
                    resolvable: true,
                });
            }
        }

        Ok(configs)
    }

    fn delete_resolvable_env_conflicts() -> Result<Option<String>, String> {
        let conflicts = env_checker::check_env_conflicts("codex")?;
        let conflicts: Vec<_> = conflicts
            .into_iter()
            .filter(|conflict| {
                conflict.var_name == "OPENAI_API_KEY"
                    && conflict.source_path.contains("HKEY_CURRENT_USER")
            })
            .collect();
        if conflicts.is_empty() {
            return Ok(None);
        }
        let backup = env_manager::delete_env_vars(conflicts)?;
        Ok(Some(backup.backup_path))
    }

    fn capture_db_snapshot(state: &AppState) -> Result<DbSnapshot, AppError> {
        Ok(DbSnapshot {
            codex_provider: state
                .db
                .get_provider_by_id(COMPANY_PROVIDER_ID_CODEX, AppType::Codex.as_str())?,
            opencode_provider: state
                .db
                .get_provider_by_id(COMPANY_PROVIDER_ID_OPENCODE, AppType::OpenCode.as_str())?,
            codex_current: crate::settings::get_effective_current_provider(
                &state.db,
                &AppType::Codex,
            )?,
        })
    }

    fn backup_live_files(apps: &[AppType]) -> Result<BackupSnapshot, AppError> {
        let backup_dir = get_app_config_dir()
            .join("backups")
            .join("quick-setup")
            .join(chrono::Utc::now().format("%Y%m%d%H%M%S%3f").to_string());
        fs::create_dir_all(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))?;

        let mut targets = Vec::new();
        if apps.contains(&AppType::Codex) {
            targets.push(("codex-auth.json", get_codex_auth_path()));
            targets.push(("codex-config.toml", get_codex_config_path()));
        }
        if apps.contains(&AppType::OpenCode) {
            targets.push(("opencode.json", opencode_config::get_opencode_config_path()));
        }

        let mut snapshots = Vec::new();
        let mut manifest = Vec::new();
        for (name, target) in targets {
            if target.exists() {
                let backup = backup_dir.join(name);
                fs::copy(&target, &backup).map_err(|e| AppError::IoContext {
                    context: format!(
                        "Backup failed: {} -> {}",
                        target.display(),
                        backup.display()
                    ),
                    source: e,
                })?;
                manifest.push(json!({
                    "target": target.to_string_lossy(),
                    "backup": backup.to_string_lossy(),
                    "existed": true
                }));
                snapshots.push(FileSnapshot {
                    target,
                    backup: Some(backup),
                });
            } else {
                manifest.push(json!({
                    "target": target.to_string_lossy(),
                    "existed": false
                }));
                snapshots.push(FileSnapshot {
                    target,
                    backup: None,
                });
            }
        }

        fs::write(
            backup_dir.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)
                .map_err(|e| AppError::JsonSerialize { source: e })?,
        )
        .map_err(|e| AppError::io(&backup_dir.join("manifest.json"), e))?;

        Ok(BackupSnapshot {
            dir: backup_dir,
            files: snapshots,
        })
    }

    fn apply_company_providers(
        state: &AppState,
        apps: &[AppType],
        api_key: &str,
        base_url: &str,
        model: &str,
    ) -> Result<Vec<AppSetupResult>, AppError> {
        let mut results = Vec::new();
        if apps.contains(&AppType::Codex) {
            let mut provider = Self::build_codex_provider(api_key, base_url, model);
            Self::preserve_codex_common_config(state, &mut provider)?;
            ProviderService::add(state, AppType::Codex, provider, true)?;
            ProviderService::switch(state, AppType::Codex, COMPANY_PROVIDER_ID_CODEX)?;
            results.push(AppSetupResult {
                app: "codex".to_string(),
                status: CompanyAppSetupStatus::Success,
                message: "Codex configured".to_string(),
                rollback_status: None,
            });
        }

        if apps.contains(&AppType::OpenCode) {
            let provider = Self::build_opencode_provider(api_key, base_url, model);
            ProviderService::add(state, AppType::OpenCode, provider, true)?;
            results.push(AppSetupResult {
                app: "opencode".to_string(),
                status: CompanyAppSetupStatus::Success,
                message: "OpenCode configured".to_string(),
                rollback_status: None,
            });
        }
        Ok(results)
    }

    fn preserve_codex_common_config(
        state: &AppState,
        provider: &mut Provider,
    ) -> Result<(), AppError> {
        let snippet = match state.db.get_config_snippet(AppType::Codex.as_str())? {
            Some(snippet) if Self::is_meaningful_common_config(&snippet) => Some(snippet),
            _ if state
                .db
                .should_auto_extract_config_snippet(AppType::Codex.as_str())? =>
            {
                match read_live_settings(AppType::Codex).and_then(|settings| {
                    ProviderService::extract_common_config_snippet_from_settings(
                        AppType::Codex,
                        &settings,
                    )
                }) {
                    Ok(snippet) if Self::is_meaningful_common_config(&snippet) => {
                        state
                            .db
                            .set_config_snippet(AppType::Codex.as_str(), Some(snippet.clone()))?;
                        state
                            .db
                            .set_config_snippet_cleared(AppType::Codex.as_str(), false)?;
                        Some(snippet)
                    }
                    Ok(_) => None,
                    Err(err) => {
                        log::warn!(
                            "[QuickSetup] failed to extract existing Codex common config: {err}"
                        );
                        None
                    }
                }
            }
            _ => None,
        };

        if snippet.is_some() {
            provider
                .meta
                .get_or_insert_with(ProviderMeta::default)
                .common_config_enabled = Some(true);
        }

        Ok(())
    }

    fn is_meaningful_common_config(snippet: &str) -> bool {
        let trimmed = snippet.trim();
        !trimmed.is_empty() && trimmed != "{}"
    }

    fn restore_live_files(snapshots: &[FileSnapshot]) -> Result<(), AppError> {
        for snapshot in snapshots {
            match &snapshot.backup {
                Some(backup) => {
                    if let Some(parent) = snapshot.target.parent() {
                        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
                    }
                    fs::copy(backup, &snapshot.target).map_err(|e| AppError::IoContext {
                        context: format!(
                            "Restore failed: {} -> {}",
                            backup.display(),
                            snapshot.target.display()
                        ),
                        source: e,
                    })?;
                }
                None => {
                    if snapshot.target.exists() {
                        fs::remove_file(&snapshot.target)
                            .map_err(|e| AppError::io(&snapshot.target, e))?;
                    }
                }
            }
        }
        Ok(())
    }

    fn restore_db_snapshot(state: &AppState, snapshot: DbSnapshot) -> Result<(), AppError> {
        match snapshot.codex_provider {
            Some(provider) => state.db.save_provider(AppType::Codex.as_str(), &provider)?,
            None => state
                .db
                .delete_provider(AppType::Codex.as_str(), COMPANY_PROVIDER_ID_CODEX)?,
        }
        match snapshot.opencode_provider {
            Some(provider) => state
                .db
                .save_provider(AppType::OpenCode.as_str(), &provider)?,
            None => state
                .db
                .delete_provider(AppType::OpenCode.as_str(), COMPANY_PROVIDER_ID_OPENCODE)?,
        }
        match snapshot.codex_current {
            Some(current) => {
                state
                    .db
                    .set_current_provider(AppType::Codex.as_str(), &current)?;
                crate::settings::set_current_provider(&AppType::Codex, Some(&current))?;
            }
            None => {
                state.db.clear_current_provider(AppType::Codex.as_str())?;
                crate::settings::set_current_provider(&AppType::Codex, None)?;
            }
        }
        Ok(())
    }

    fn build_codex_provider(api_key: &str, base_url: &str, model: &str) -> Provider {
        let config = format!(
            r#"model = "{model}"
model_provider = "{CODEX_MODEL_PROVIDER_ID}"

[model_providers.{CODEX_MODEL_PROVIDER_ID}]
name = "Quick Setup Gateway"
base_url = "{base_url}"
wire_api = "responses"
requires_openai_auth = true
"#
        );
        let mut provider = Provider::with_id(
            COMPANY_PROVIDER_ID_CODEX.to_string(),
            COMPANY_PROVIDER_NAME.to_string(),
            json!({
                "auth": { "OPENAI_API_KEY": api_key },
                "config": config
            }),
            Some(base_url.to_string()),
        );
        provider.category = Some("custom".to_string());
        provider.icon = Some("openai".to_string());
        provider.meta = Some(ProviderMeta {
            api_format: Some("openai_responses".to_string()),
            ..ProviderMeta::default()
        });
        provider
    }

    fn build_opencode_provider(api_key: &str, base_url: &str, model: &str) -> Provider {
        let mut models = HashMap::new();
        models.insert(
            model.to_string(),
            OpenCodeModel {
                name: model.to_string(),
                limit: None,
                options: None,
                extra: HashMap::new(),
            },
        );
        let config = OpenCodeProviderConfig {
            npm: "@ai-sdk/openai-compatible".to_string(),
            name: Some(COMPANY_PROVIDER_NAME.to_string()),
            options: OpenCodeProviderOptions {
                base_url: Some(base_url.to_string()),
                api_key: Some(api_key.to_string()),
                headers: None,
                extra: HashMap::new(),
            },
            models,
        };
        let mut provider = Provider::with_id(
            COMPANY_PROVIDER_ID_OPENCODE.to_string(),
            COMPANY_PROVIDER_NAME.to_string(),
            serde_json::to_value(config).unwrap_or_else(|_| json!({})),
            Some(base_url.to_string()),
        );
        provider.category = Some("custom".to_string());
        provider.icon = Some("openai".to_string());
        provider.meta = Some(ProviderMeta {
            live_config_managed: Some(true),
            ..ProviderMeta::default()
        });
        provider
    }

    fn sanitize_message(message: &str, api_key: &str) -> String {
        let mut sanitized = message.replace(api_key, "***");
        if let Some(prefix) = api_key.get(..api_key.len().min(8)) {
            sanitized = sanitized.replace(prefix, "***");
        }
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::services::provider::build_effective_settings_with_common_config;
    use crate::store::AppState;
    use std::sync::Arc;

    #[test]
    fn normalizes_gateway_to_v1() {
        assert_eq!(
            CompanyQuickSetupService::normalize_base_url(Some("https://catcatcode.com/")).unwrap(),
            "https://catcatcode.com/v1"
        );
        assert_eq!(
            CompanyQuickSetupService::normalize_base_url(Some("https://catcatcode.com")).unwrap(),
            "https://catcatcode.com/v1"
        );
        assert_eq!(
            CompanyQuickSetupService::normalize_base_url(Some("https://catcatcode.com/v1"))
                .unwrap(),
            "https://catcatcode.com/v1"
        );
    }

    #[test]
    fn codex_provider_uses_quick_setup_defaults() {
        let provider = CompanyQuickSetupService::build_codex_provider(
            "sk-secret",
            "https://catcatcode.com/v1",
            DEFAULT_MODEL,
        );
        let config = provider
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
            .expect("config text");

        crate::codex_config::validate_config_toml(config).expect("valid toml");
        assert!(config.contains("model = \"gpt-5.5\""));
        assert!(config.contains("base_url = \"https://catcatcode.com/v1\""));
        assert_eq!(
            provider
                .settings_config
                .pointer("/auth/OPENAI_API_KEY")
                .and_then(|value| value.as_str()),
            Some("sk-secret")
        );
    }

    #[test]
    fn codex_quick_setup_provider_reuses_existing_common_config() {
        let state = AppState::new(Arc::new(Database::memory().expect("memory db")));
        state
            .db
            .set_config_snippet(
                AppType::Codex.as_str(),
                Some("[shared]\nreasoning = \"medium\"\n".to_string()),
            )
            .expect("set common config");

        let mut provider = CompanyQuickSetupService::build_codex_provider(
            "sk-secret",
            "https://catcatcode.com/v1",
            DEFAULT_MODEL,
        );

        CompanyQuickSetupService::preserve_codex_common_config(&state, &mut provider)
            .expect("preserve common config");

        assert_eq!(
            provider
                .meta
                .as_ref()
                .and_then(|meta| meta.common_config_enabled),
            Some(true)
        );

        let effective = build_effective_settings_with_common_config(
            state.db.as_ref(),
            &AppType::Codex,
            &provider,
        )
        .expect("build effective settings");
        let config = effective
            .get("config")
            .and_then(|value| value.as_str())
            .expect("config text");
        assert!(config.contains("[shared]"));
        assert!(config.contains("reasoning = \"medium\""));
        assert!(config.contains("model_provider = \"quick_setup_gateway\""));
    }

    #[test]
    fn opencode_provider_deserializes() {
        let provider = CompanyQuickSetupService::build_opencode_provider(
            "sk-secret",
            "https://catcatcode.com/v1",
            DEFAULT_MODEL,
        );
        let config: OpenCodeProviderConfig =
            serde_json::from_value(provider.settings_config).expect("opencode config");

        assert_eq!(config.npm, "@ai-sdk/openai-compatible");
        assert_eq!(
            config.options.base_url.as_deref(),
            Some("https://catcatcode.com/v1")
        );
        assert!(config.models.contains_key("gpt-5.5"));
    }

    #[test]
    fn sanitize_message_removes_api_key() {
        let message = "request failed for sk-very-secret-token";
        let sanitized = CompanyQuickSetupService::sanitize_message(message, "sk-very-secret-token");
        assert!(!sanitized.contains("sk-very-secret-token"));
        assert!(sanitized.contains("***"));
    }
}
