---
title: Company Quick Setup Development Plan
status: active
created: 2026-05-25
origin:
  - docs/company-quick-setup-ui-ux.md
  - docs/company-quick-setup-ui-ux.html
---

# 公司密钥一键配置开发计划

## 1. 项目现状

CC Switch 当前是 Tauri 2 + React + TypeScript 的桌面应用。前端使用 Tailwind、Radix/shadcn 风格组件、TanStack Query、Framer Motion，主要界面形态是 `FullScreenPanel` 全屏面板、`glass` / `glass-card` 容器、蓝色 primary 主按钮和轻量状态提示。

现有供应商配置体系已经比较完整：

- `src/components/providers/AddProviderDialog.tsx` 负责新增供应商入口。
- `src/components/providers/forms/ProviderForm.tsx` 负责多应用供应商表单，包括 Claude、Codex、Gemini、OpenCode、OpenClaw、Hermes。
- `src/components/providers/ProviderList.tsx` 负责供应商列表、导入 live config、空状态。
- `src/hooks/useProviderActions.ts` 封装新增、更新、删除、切换供应商的前端动作。
- `src/lib/api/providers.ts` 封装 `get_providers`、`add_provider`、`switch_provider`、`import_default_config` 等 Tauri provider API。
- `src/lib/api/env.ts` 封装环境变量冲突检测和备份删除 API。

后端供应商写入和切换链路集中在 Rust：

- `src-tauri/src/commands/provider.rs` 暴露 provider 相关 Tauri command。
- `src-tauri/src/services/provider/mod.rs` 实现 `ProviderService::add`、`ProviderService::switch`、校验、同步等业务逻辑。
- `src-tauri/src/services/provider/live.rs` 实现 live config 读写，包括 Codex、OpenCode、OpenClaw、Gemini、Hermes 等。
- `src-tauri/src/codex_config.rs` 负责 Codex `auth.json` 和 `config.toml` 的写入、TOML 校验和回滚。
- `src-tauri/src/opencode_config.rs` 负责 OpenCode `opencode.json` 的读取、provider 追加和写入。
- `src-tauri/src/config.rs` 负责跨平台 home 目录、app config 目录、原子写入等基础能力。
- `src-tauri/src/services/env_checker.rs` 和 `src-tauri/src/services/env_manager.rs` 已支持环境变量冲突检测、备份删除和恢复。

平台兼容性现状：

- Windows 下 `src-tauri/src/config.rs` 已避免直接使用 `HOME`，优先通过 `dirs::home_dir()` 获取真实用户目录，并保留 `CC_SWITCH_TEST_HOME` 供测试隔离。
- Windows 环境变量检测已覆盖 `HKEY_CURRENT_USER\Environment` 和 `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`。
- Windows 原子写入目前是先删除目标文件再 rename，需要在本功能中用备份和回滚兜住文件占用、杀软、同步盘等失败情况。
- macOS 主要依赖标准 home 目录路径和 Tauri 打包后的沙盒/权限表现，需要通过 `.dmg` 包验证。

当前缺口：

- 用户仍需理解“选择供应商预设、填写 endpoint、填写 model、写入 live config、切换当前供应商”等概念。
- 没有一个只输入 API Key 的公司配置入口。
- 没有一个后端原子编排命令来统一完成“验证密钥 -> 诊断 -> 确认 -> 备份 -> 写 Codex + OpenCode -> 返回结果”。
- 现有环境变量冲突能力是通用工具，没有和公司一键配置的确认流程绑定。

现有连接检查能力：

- `SpeedtestService::test_endpoints` 只对 URL 做 GET 请求，返回延迟、HTTP status 和网络错误；它只能说明 endpoint 可达，不能证明 API Key、模型和协议可用。
- `model_fetch.rs` 通过 OpenAI 兼容的 `/v1/models` 获取模型列表，可以验证部分鉴权和模型列表接口，但仍不等于一次真实对话可用。
- `StreamCheckService` 会发送流式模型请求，并在收到首个 chunk 后判定成功；它才是当前项目里最接近“短对话可用性验证”的能力。

## 2. 开发目标

实现一个公司密钥一键配置流程。初版默认只配置：

- GPT / Codex
- OpenCode

初版默认模型：

- `gpt-5.5`

默认不配置：

- Claude Code
- Gemini CLI
- OpenClaw
- Hermes
- Claude Desktop

这些应用不进入本轮开发范围，后续再扩展。初版自定义配置也只围绕 Codex 和 OpenCode 调整公司网关地址、模型和环境变量处理，避免为了跑通一键配置引入多应用差异。

公司网关默认值：

- 用户可见默认地址：`https://catcatcode.com/`。
- 后端实际写入 OpenAI-compatible 配置前统一归一化为 `https://catcatcode.com/v1`。
- 归一化规则：trim 空白和结尾 `/`，如果路径不是 `/v1` 且不以 `/v1/` 开头，则追加 `/v1`。
- 2026-05-25 抽查结果：`https://catcatcode.com/` 返回 HTML，`https://catcatcode.com/v1/models` 不带密钥返回 401，说明 `/v1` 是正确 API 前缀。

核心体验：

1. 用户进入公司配置入口。
2. 初始界面只看到 API Key 输入框和 `验证并配置` 按钮。
3. 点击后自动验证密钥。
4. 如果没有已有配置或冲突，直接写入 Codex 和 OpenCode。
5. 如果检测到已有配置，展示确认页。
6. 确认后先备份，再写入。
7. 成功页明确提示需要打开新终端。
8. 失败页明确展示失败应用、回滚状态和备份位置。

成功标准：

- 新员工只粘贴 API Key 就能配置 Codex 和 OpenCode。
- 无效 API Key 不修改本地配置。
- 已有配置不会被静默覆盖。
- Windows 和 macOS 都能通过正式安装包验证。
- API Key 不出现在日志、toast、错误详情、前端返回结果和测试快照中。
- 本轮不改造全局 SQL 导出脱敏。公司供应商仍复用现有 provider 存储模型，导出文件是否包含 provider 密钥作为后续安全项单独处理，避免阻塞一键配置跑通。

## 3. 产品与 UX 决策

### 3.1 默认路径

默认路径不显示应用选择、不显示模型、不显示 endpoint、不显示 JSON/TOML 编辑器。

默认流程页面：

1. 输入密钥
2. 验证密钥
3. 已有配置确认（仅需要时）
4. 写入进度
5. 完成 / 失败

### 3.2 自定义路径

自定义配置只在用户主动点击时出现。

自定义配置包含：

- 应用选择：仅 Codex、OpenCode，默认都选中。
- 公司网关地址。
- 默认模型，默认 `gpt-5.5`。
- Windows 用户级环境变量冲突处理。

### 3.3 确认策略

以下情况需要确认：

- Codex 已存在 `auth.json` 或 `config.toml`。
- OpenCode 已存在同名 provider。
- 检测到用户级 `OPENAI_API_KEY` 可能覆盖 Codex 配置。
- 写入过程中用户尝试关闭面板。

以下情况只提示，不默认修改：

- Windows 系统级环境变量冲突。
- 非本轮支持应用的已有配置不检测、不提示。

## 4. 技术方案

### 4.1 前端架构

新增公司配置面板，使用现有 `FullScreenPanel`，保持 CC Switch 现有视觉语言。

新增文件：

- `src/components/quick-setup/CompanyKeySetupPanel.tsx`
- `src/components/quick-setup/CompanyKeyInputStep.tsx`
- `src/components/quick-setup/CompanyKeyValidatingStep.tsx`
- `src/components/quick-setup/CompanyExistingConfigConfirmStep.tsx`
- `src/components/quick-setup/CompanyCustomConfigStep.tsx`
- `src/components/quick-setup/CompanySetupProgressStep.tsx`
- `src/components/quick-setup/CompanySetupResultStep.tsx`
- `src/components/quick-setup/types.ts`
- `src/components/quick-setup/companyQuickSetupUtils.ts`

接入点：

- `src/App.tsx`
- `src/components/providers/ProviderEmptyState.tsx`
- `src/components/providers/ProviderList.tsx`

前端状态机：

```ts
type CompanySetupStep =
  | "input"
  | "validating"
  | "needsConfirmation"
  | "custom"
  | "applying"
  | "success"
  | "failed";
```

前端 API 封装：

- 在 `src/lib/api/providers.ts` 或新增 `src/lib/api/companyQuickSetup.ts` 中封装 `quick_setup_company_key`。
- 建议新增独立 `src/lib/api/companyQuickSetup.ts`，避免 provider API 文件继续膨胀。

### 4.2 后端架构

新增 Rust service 统一编排，避免前端连续调用 `add_provider`、`switch_provider`、`delete_env_vars` 导致部分成功无法可靠回滚。

新增文件：

- `src-tauri/src/commands/company_quick_setup.rs`
- `src-tauri/src/services/company_quick_setup.rs`

注册点：

- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/lib.rs`

新增 Tauri command：

```rust
quick_setup_company_key(request: CompanyKeySetupRequest)
  -> Result<CompanyKeySetupResult, String>
```

请求结构：

```rust
pub struct CompanyKeySetupRequest {
    pub api_key: String,
    pub mode: CompanySetupMode,
    pub apps: Option<Vec<AppType>>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub confirm_overwrite: bool,
    pub resolve_user_env_conflicts: bool,
}
```

序列化约定：

- 请求和响应结构使用 `#[serde(rename_all = "camelCase")]`，前端传 `apiKey`、`baseUrl`、`confirmOverwrite`、`resolveUserEnvConflicts`。
- `CompanySetupStatus` 序列化为 `needsConfirmation`、`configured`、`failed`。
- `apps` 初版只接受 `codex`、`opencode`；传入其它应用返回 `failed` 状态和可读错误，不进入写入流程。
- command 级 `Err(String)` 只用于 Tauri 调用失败、序列化失败等不可恢复错误；业务失败返回 `CompanyKeySetupResult { status: "failed", ... }`。

返回结构：

```rust
pub struct CompanyKeySetupResult {
    pub status: CompanySetupStatus,
    pub existing_configs: Vec<ExistingConfig>,
    pub app_results: Vec<AppSetupResult>,
    pub warnings: Vec<String>,
    pub backup_path: Option<String>,
    pub restart_required_apps: Vec<String>,
}
```

### 4.3 公司供应商配置生成

Codex 配置：

- `auth.json` 写入 `OPENAI_API_KEY`。
- `config.toml` 使用 `model = "gpt-5.5"`。
- `model_provider` 使用稳定 id，例如 `company_gateway`。
- `base_url` 使用归一化后的公司网关 API 地址，默认 `https://catcatcode.com/v1`。
- `wire_api = "responses"`。
- `requires_openai_auth = true`。

OpenCode 配置：

- provider id：`company-gateway`。
- `npm`：优先使用 `@ai-sdk/openai-compatible`，除非公司网关明确要求 `@ai-sdk/openai`。
- `options.baseURL`：归一化后的公司网关 API 地址，默认 `https://catcatcode.com/v1`。
- `options.apiKey`：用户输入的 API Key。
- `models`：至少包含 `gpt-5.5`。

公司默认值集中定义，避免散落在 UI 和 service：

- 前端展示默认值可以从共享常量映射。
- 后端以自身默认值为准，不能信任前端传入的默认模型。

建议新增：

- `src/config/companyQuickSetup.ts`
- `src-tauri/src/services/company_quick_setup.rs` 内部常量

实现原则：

- 不新增一套通用 provider 写入框架。
- 公司配置 service 只负责生成 Codex/OpenCode provider、诊断、确认、备份和编排。
- 实际 provider 校验、保存、live config 写入和切换优先复用 `ProviderService::add`、`ProviderService::update`、`ProviderService::switch`、`write_live_with_common_config`、`write_codex_live_atomic_with_stable_provider`、`opencode_config::set_typed_provider` 等现有实现。
- 只有现有实现无法保证“无效密钥不写入、失败可恢复、结果脱敏”时，才在 quick setup service 外层加补偿逻辑。

### 4.4 API Key 验证策略

公司一键配置的密钥验证不能只使用 URL 可达性测试。

推荐顺序：

1. 校验 base URL 格式并做短超时网络预检，只用于区分“地址明显不可达”。
2. 如公司网关支持 `/v1/models`，先做模型列表预检，确认 API Key 基本有效且能看到 `gpt-5.5` 或兼容模型。
3. 必须再发起一次最小模型请求，默认使用 `gpt-5.5`，提示词使用极短内容，例如 `Reply OK`，成功标准为 HTTP 2xx 且收到首个有效响应 chunk 或完整响应。

实现建议：

- 复用 `StreamCheckService` 的短对话/首包判定逻辑，但新增一个可接收临时 provider 配置的 helper，避免为了验证而先写入数据库或本地配置文件。
- 复用时必须显式传入 `gpt-5.5` 和 `https://catcatcode.com/v1`，不能使用 `StreamCheckConfig::default()` 里的 Codex 默认测试模型。
- 验证成功前不得修改 Codex、OpenCode 或环境变量。
- 超时建议控制在 15 到 30 秒；错误分类至少覆盖 URL 不可达、401/403、模型不存在、quota/rate limit、网关 5xx。
- 日志、toast、错误结果中都不能包含 API Key 原文。

## 5. 实施拆分

### Unit 1：数据契约与 API 封装

目标：

- 定义前后端请求、响应、状态、应用结果类型。
- 前端能调用 `quick_setup_company_key`。

文件：

- `src/lib/api/companyQuickSetup.ts`
- `src/components/quick-setup/types.ts`
- `src-tauri/src/commands/company_quick_setup.rs`
- `src-tauri/src/services/company_quick_setup.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/lib.rs`

测试：

- `tests/lib/companyQuickSetupApi.test.ts`
- `src-tauri/tests/company_quick_setup.rs`

测试场景：

- 前端 API 传参字段名符合 camelCase / snake_case 预期。
- command 能返回 `needsConfirmation`、`configured`、`failed` 三种状态。
- API Key 在错误信息中被脱敏。

### Unit 2：公司供应商配置生成器

目标：

- 从 API Key、base URL、model 生成 Codex 和 OpenCode provider 配置。
- 默认 model 固定为 `gpt-5.5`。
- 默认 base URL 固定为 `https://catcatcode.com/v1`，由后端归一化生成。

文件：

- `src/config/companyQuickSetup.ts`
- `src-tauri/src/services/company_quick_setup.rs`
- `src-tauri/src/codex_config.rs`（仅在需要复用/暴露 helper 时改）
- `src-tauri/src/opencode_config.rs`（仅在需要复用/暴露 helper 时改）

测试：

- `tests/config/companyQuickSetup.test.ts`
- `src-tauri/tests/company_quick_setup.rs`

测试场景：

- Codex TOML 可被现有 `validate_config_toml` 解析。
- OpenCode provider JSON 可反序列化为 `OpenCodeProviderConfig`。
- 默认模型为 `gpt-5.5`。
- `https://catcatcode.com/`、`https://catcatcode.com` 都归一化为 `https://catcatcode.com/v1`。
- 已经带 `/v1` 的自定义地址不会重复追加 `/v1`。
- provider id 稳定，不随 provider name 或 API Key 变化。

### Unit 3：诊断与确认逻辑

目标：

- 判断是否需要用户确认。
- 检测 Codex live 文件、OpenCode 同名 provider、用户级环境变量冲突。
- 环境变量冲突返回给前端前必须脱敏，不返回 `var_value` 原文。

文件：

- `src-tauri/src/services/company_quick_setup.rs`
- `src-tauri/src/services/env_checker.rs`
- `src/lib/api/companyQuickSetup.ts`

测试：

- `src-tauri/tests/company_quick_setup.rs`
- `tests/components/CompanyExistingConfigConfirmStep.test.tsx`

测试场景：

- 无 Codex/OpenCode 配置时直接返回可配置。
- 已有 Codex `auth.json` 或 `config.toml` 时返回 `needsConfirmation`。
- OpenCode 已有 `company-gateway` provider 时返回 `needsConfirmation`。
- Windows 用户级 `OPENAI_API_KEY` 返回可处理冲突。
- Windows 系统级 `OPENAI_API_KEY` 只作为 warning，不默认删除。
- env conflict result 不包含任何环境变量值。

### Unit 4：备份与回滚编排

目标：

- 写入前备份 Codex 和 OpenCode 目标文件。
- 写入失败时回滚已写入文件。
- 写入失败时补偿回滚 quick setup 本轮创建/修改的数据库 provider 和 current provider 标记。
- 返回清晰失败结果。

文件：

- `src-tauri/src/services/company_quick_setup.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/codex_config.rs`
- `src-tauri/src/opencode_config.rs`

测试：

- `src-tauri/tests/company_quick_setup.rs`

测试场景：

- Codex auth 写入成功、config 写入失败时回滚 auth。
- Codex config 写入失败时不能丢失原 `config.toml`。
- Codex 成功、OpenCode 失败时回滚 Codex。
- DB provider 创建成功、live 写入失败时删除本轮新建 provider；如果是覆盖已有 company provider，则恢复旧 provider 内容。
- Codex current provider 被切换后失败时恢复原 current provider。
- 备份目录路径在 `get_app_config_dir()/backups/company-quick-setup/...` 下。
- 文件不存在时备份 manifest 记录为 absent，回滚时删除新建文件。
- 文件被占用或 rename 失败时返回失败应用和回滚状态。

说明：

- 不新建通用事务框架；quick setup service 内部记录本轮操作前的最小快照，并在失败时按相反顺序补偿。
- OpenCode 是 additive mode，没有 current provider 概念，只需要恢复 `opencode.json` 和本轮 upsert 的 provider 记录。

### Unit 5：后端主流程

目标：

- `quick_setup_company_key` 完成验证、诊断、确认、备份、写入、结果返回。

文件：

- `src-tauri/src/commands/company_quick_setup.rs`
- `src-tauri/src/services/company_quick_setup.rs`
- `src-tauri/src/lib.rs`

测试：

- `src-tauri/tests/company_quick_setup.rs`

测试场景：

- 无效 API Key 不写入任何文件。
- 有效 API Key + 无已有配置，写入 Codex 和 OpenCode。
- 有效 API Key + 已有配置 + 未确认，返回 `needsConfirmation`。
- 有效 API Key + 已确认，备份后写入。
- API Key 不出现在 log、错误文本、result warnings 中。
- 重复运行不会产生重复 OpenCode provider，稳定覆盖 `company-gateway`。

说明：

- 公司网关 API 地址默认按 `https://catcatcode.com/v1` 处理。实现前可先抽象为 `validate_company_key` helper，测试中 mock。
- 即使 URL 可达或 `/v1/models` 成功，也不能直接视为配置可用；默认路径必须完成一次最小模型请求或流式首包检查。
- 最低实现为轻量 chat / stream 请求，并明确超时和错误映射。

### Unit 6：前端面板与状态流

目标：

- 实现与原型一致的全屏面板流程。
- 默认只输入 API Key。
- 自定义配置默认折叠/次级入口。

文件：

- `src/components/quick-setup/CompanyKeySetupPanel.tsx`
- `src/components/quick-setup/CompanyKeyInputStep.tsx`
- `src/components/quick-setup/CompanyKeyValidatingStep.tsx`
- `src/components/quick-setup/CompanyExistingConfigConfirmStep.tsx`
- `src/components/quick-setup/CompanyCustomConfigStep.tsx`
- `src/components/quick-setup/CompanySetupProgressStep.tsx`
- `src/components/quick-setup/CompanySetupResultStep.tsx`
- `src/components/quick-setup/companyQuickSetupUtils.ts`
- `src/App.tsx`
- `src/components/providers/ProviderEmptyState.tsx`

测试：

- `tests/components/CompanyKeySetupPanel.test.tsx`
- `tests/components/CompanyExistingConfigConfirmStep.test.tsx`
- `tests/components/CompanyCustomConfigStep.test.tsx`
- `tests/integration/App.test.tsx`

测试场景：

- 初始界面只显示 API Key 输入和主按钮。
- 默认应用范围为 Codex + OpenCode。
- 自定义配置只展示 Codex/OpenCode、公司网关地址、默认模型和环境变量处理。
- `needsConfirmation` 结果展示确认页。
- `configured` 结果展示完成页。
- `failed` 结果展示失败页。
- 关闭写入中的面板会弹确认，不静默取消。

### Unit 7：入口与现有功能集成

目标：

- 在适当位置露出公司配置入口，但不打扰现有手动配置路径。

入口：

- Provider 空状态：新增主按钮 `使用公司 API Key 配置`。
- Provider 页面顶部：新增 `公司一键配置` 次主按钮。
- Settings 可选增加“公司配置”入口，作为重配入口。

文件：

- `src/App.tsx`
- `src/components/providers/ProviderEmptyState.tsx`
- `src/components/providers/ProviderList.tsx`
- `src/components/settings/SettingsPage.tsx`（如果加入设置入口）

测试：

- `tests/components/ProviderList.test.tsx`
- `tests/components/ProviderEmptyState.test.tsx`
- `tests/integration/App.test.tsx`

测试场景：

- 空状态可打开公司配置面板。
- 手动添加供应商入口仍可用。
- 完成配置后 provider query 被 invalidate。
- 托盘菜单更新失败只提示 warning，不影响配置成功结果。

### Unit 8：文案与 i18n

目标：

- 新增中文、英文、日文文案。

文件：

- `src/i18n/locales/zh.json`
- `src/i18n/locales/en.json`
- `src/i18n/locales/ja.json`

测试：

- `tests/components/CompanyKeySetupPanel.test.tsx`

测试场景：

- 缺省语言不出现 key 原文。
- 失败原因包含应用名，但不包含 API Key。

### Unit 9：平台与打包验证

目标：

- 用正式包验证 Windows 和 macOS，而不是只依赖 dev mode。

命令：

- Windows：`pnpm tauri build` 生成 Windows 安装包 / `.exe`。
- macOS：`pnpm tauri build` 生成 `.dmg` / `.app`。

验收环境：

- Windows 11 普通用户权限。
- Windows 用户目录含空格。
- Windows 用户目录含中文。
- macOS Apple Silicon。
- macOS Intel（如果仍支持或需要分发）。

手动验收场景：

- 新用户无 Codex/OpenCode 配置。
- 已有 Codex 配置。
- 已有 OpenCode provider。
- Windows 存在 HKCU `OPENAI_API_KEY`。
- Windows 存在 HKLM `OPENAI_API_KEY`。
- Codex config 文件被占用。
- 无效 API Key。
- 有效 API Key 但公司网关超时。
- 重复运行公司配置，应该是可重复、可确认、不会产生重复 provider。

## 6. 风险与处理

### 风险 1：公司网关验证行为与 OpenAI-compatible 协议存在差异

处理：

- 将验证逻辑封装为独立 helper。
- 支持超时、401/403、网络错误、模型不可用四类错误。
- 默认使用 `https://catcatcode.com/v1` 做 `/models` 预检和轻量模型请求。
- 如果网关对 `gpt-5.5` 的 responses/chat 协议有特殊要求，只改验证 helper 和 provider 生成常量，不扩散到 UI。

### 风险 2：Windows 文件占用导致回滚失败

处理：

- 备份 manifest 记录每个文件写入前状态。
- 写入失败后尽最大努力回滚。
- 如果回滚失败，结果中明确展示未回滚文件和备份路径。
- Windows 原子写可以加入短重试和 backoff。

### 风险 3：环境变量覆盖配置

处理：

- 默认检测 Codex 相关 `OPENAI` 环境变量。
- HKCU 允许用户确认后备份删除。
- HKLM 只提示，不默认删除。
- macOS/Linux shell 文件冲突只在自定义路径中提示，避免默认流程过重。

### 风险 4：前端多步状态和后端编排状态不一致

处理：

- 后端返回 authoritative result。
- 前端只根据 result 渲染，不自行推断部分成功状态。
- 写入中状态可以先用单次 command loading 实现；后续如需实时进度，再扩展 event streaming。

## 7. 执行顺序

1. Unit 1：数据契约与 API 封装。
2. Unit 2：公司供应商配置生成器。
3. Unit 3：诊断与确认逻辑。
4. Unit 4：备份与回滚编排。
5. Unit 5：后端主流程。
6. Unit 6：前端面板与状态流。
7. Unit 7：入口与现有功能集成。
8. Unit 8：i18n。
9. Unit 9：平台打包验证。

建议先完成后端主流程的测试闭环，再接前端 UI。这样能先把跨平台风险和回滚风险压住。

## 8. 完成定义

功能完成需满足：

- `pnpm test:unit` 通过。
- `pnpm build:renderer` 或等价前端构建通过。
- `cargo test` 或项目 Rust 测试通过。
- Windows 正式包安装后完成手动验收。
- macOS `.dmg` 安装后完成手动验收。
- 文档 `docs/company-quick-setup-ui-ux.md` 与实际 UI 不冲突。
- API Key 未出现在日志、错误、toast、前端返回结果和测试快照中。
- 全局 SQL 导出脱敏不作为本轮完成条件，另列后续安全项。
