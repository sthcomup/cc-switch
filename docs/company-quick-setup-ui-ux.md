# 公司密钥一键配置 UI/UX 方案

## 核心原则

默认界面只做一件事：输入公司 API Key。

用户输入密钥后，系统自动完成：

- 验证密钥
- 判断本地是否已有配置
- 没有配置时直接写入默认配置
- 已有配置时先让用户确认
- 初版默认配置 GPT/Codex 和 OpenCode
- 写入前备份，失败后回滚

静态原型见：`docs/company-quick-setup-ui-ux.html`

## 展示方式

这不是网页落地页，而是桌面端 App 流程。原型在同一个 HTML 中用多张卡片展示不同页面/状态：

1. 初始页
2. 验证页
3. 已有配置确认页
4. 自定义配置页
5. 写入进度页
6. 完成页
7. 失败页与确认弹窗

每张卡片都包含一个简化的桌面端内容面板：顶部标题栏、主体玻璃感卡片、页面状态、底部或右下角提示。不要在流程原型里放左侧导航栏，因为实际入口更接近 CC Switch 的全屏面板 / 对话面板，而不是独立应用导航页面。

视觉语言应贴近现有 CC Switch：

- 使用 `bg-background` / `text-foreground` 的白底或深色自适应结构
- 主容器接近现有 `glass` / `glass-card`
- 圆角使用现有 `rounded-xl` 风格
- 主操作使用蓝色 `primary`
- 状态提示使用轻量底色：蓝、绿、黄、红
- 不使用大面积深色侧栏
- 不使用营销页式大标题或装饰图形

## 默认主流程

### 1. 初始页

页面主体只展示：

- 一个输入框：`粘贴公司 API Key`
- 一个主按钮：`验证并配置`
- 一行说明：默认会配置哪些命令行工具
- 一个折叠入口：`自定义配置`

不在初始界面展示：

- 应用选择列表
- 逐项检测步骤
- 端点、模型、API 格式
- JSON / TOML / env 编辑器
- 多步骤 stepper

交互：

- 输入框为空点击按钮：聚焦输入框，显示轻提示
- 输入后点击按钮：进入验证页
- 自定义配置：默认折叠，点击后进入高级路径

### 2. 验证页

触发条件：用户点击 `验证并配置`。

界面状态：

- 输入框保留
- 主区域显示 `正在验证密钥`
- 按钮进入 loading / disabled

后端行为：

- 调用公司网关验证 API Key
- 验证至少覆盖一个轻量模型列表或健康检查接口
- 不把 API Key 写入日志、toast、错误详情

失败态：

- 显示 `密钥验证失败`
- 提供 `重新输入`
- 不继续写本地配置

交互：

- 验证中禁用主按钮
- 允许取消返回初始页
- 成功后按检测结果跳转：无冲突进入写入页，有已有配置进入确认页

### 3. 没有本地配置时

如果本机没有相关公司配置，也没有需要用户确认的覆盖项：

直接进入写入状态。

初版默认配置范围：

- GPT / Codex
- OpenCode

可按公司策略扩展：

- Claude Code
- Gemini CLI
- OpenClaw
- Hermes
- Claude Desktop

### 4. 已有配置确认页

如果检测到已有配置，才展示确认区。

确认区包含：

- 哪些应用已有配置
- 会执行什么动作
- `确认改为公司配置`
- `选择要修改的应用`
- `取消`

示例：

- Codex：已有 `auth.json` / `config.toml`，将备份后写入
- OpenCode：没有公司供应商，将直接追加

重要点：

- 不默认静默覆盖用户已有配置
- 不要求用户逐个确认所有文件
- 默认按钮仍然是一个确认动作

交互：

- 主按钮：`确认改为公司配置`
- 次按钮：`选择要修改的应用`，进入自定义页
- toast：解释“旧配置会备份，不会删除旧供应商”
- 用户取消：回到初始页或关闭面板

### 5. 自定义配置页

从两个地方进入：

- 初始页底部 `自定义配置`
- 确认页 `选择要修改的应用`

展示：

- 应用复选框
- 公司网关地址
- 默认模型
- Windows 环境变量冲突项
- 是否备份后移除用户级环境变量

仍然不展示：

- 完整 JSON 编辑器
- 完整 TOML 编辑器
- 内部 provider meta 字段

### 6. 写入本地配置页

写入期间展示应用级进度：

- GPT / Codex：写入 `auth.json` 和 `config.toml`
- OpenCode：追加 provider

状态只需要：

- 等待
- 进行中
- 完成
- 失败并已回滚

交互：

- 可最小化窗口
- 不建议允许用户中途关闭任务；如果关闭，应后台继续或弹确认
- 任一步失败停止后续写入并进入失败页

### 7. 完成页

完成态展示：

- 配置完成
- 哪些工具立即生效
- 哪些工具需要打开新终端
- `打开终端`
- `查看配置目录`
- `重新配置`

文案示例：

`公司供应商已配置到 GPT/Codex 和 OpenCode。请打开新终端后使用。`

交互：

- 主按钮：`打开终端`
- 次按钮：`查看配置目录`
- 轻操作：`重新配置`
- toast：提示托盘菜单已更新、哪些应用需要新终端

### 8. 失败页

失败页必须回答三件事：

- 哪个应用失败
- 已写入的内容是否回滚
- 用户下一步该做什么

示例：

`Codex 配置写入失败。目标文件被其它程序占用。已恢复修改前的 auth.json；OpenCode 尚未写入。`

失败页按钮：

- `重试`
- `打开备份目录`
- `返回`

## 交互组件设计

### Toast

用于轻提示，不阻断流程。

示例：

- `已更新托盘菜单。Codex / OpenCode 请打开新终端后使用。`
- `旧配置会保留在备份目录，不会删除旧供应商。`

### 确认弹窗

只在阻碍默认成功路径时出现。

场景：

- 已有配置会被替换
- Windows 用户级环境变量冲突
- 用户试图关闭正在写入的任务

### Inline Note

用于解释当前页局部风险。

示例：

- `Windows 检测：发现用户级 OPENAI_API_KEY，可能覆盖 Codex 配置。`
- `验证失败不会写入任何本地配置。`

### Progress Row

写入页使用应用级进度，不展示底层文件 diff。

每行包含：

- 动作名称
- 进度条
- 状态 badge

## Windows 体验要求

默认界面不暴露 Windows 复杂度，只在需要确认时出现。

必须做到：

- 不使用 `HOME` 推断用户目录
- 使用真实用户目录，例如 `C:\Users\Alice`
- 用户名包含中文或空格时路径正常
- 写入前备份旧文件
- 文件被占用时提示具体应用，并回滚已写入部分
- 用户级环境变量冲突可提示备份后移除
- 系统级环境变量冲突只提示，不默认删除

Windows 可能显示的确认：

`检测到 OPENAI_API_KEY 环境变量，可能覆盖 Codex 配置。是否备份后移除用户级环境变量？`

## 后端行为设计

新增一个主命令：

```rust
quick_setup_company_key(request: CompanyKeySetupRequest)
  -> Result<CompanyKeySetupResult, String>
```

请求：

```ts
type CompanyKeySetupRequest = {
  apiKey: string;
  mode: "default" | "custom";
  apps?: Array<"claude" | "codex" | "opencode" | "gemini" | "openclaw" | "hermes">;
  baseUrl?: string;
  model?: string;
  confirmOverwrite?: boolean;
  resolveUserEnvConflicts?: boolean;
};
```

返回：

```ts
type CompanyKeySetupResult = {
  status: "needsConfirmation" | "configured" | "failed";
  existingConfigs: ExistingConfig[];
  appResults: AppSetupResult[];
  backupPath?: string;
  restartRequiredApps: string[];
};
```

主流程：

1. 验证 API Key
2. 生成公司供应商配置
3. 检测已有配置
4. 如果需要确认且未确认，返回 `needsConfirmation`
5. 创建备份
6. 写入数据库 provider
7. 写入各应用 live config
8. 设置当前供应商
9. 同步 MCP / Skills
10. 更新托盘菜单

## 和现有代码的关系

复用：

- `ProviderService::add`
- `ProviderService::switch`
- `write_live_with_common_config`
- `check_env_conflicts`
- `delete_env_vars`
- 现有 provider preset 生成逻辑

新增：

- 公司供应商预设
- 单输入框配置面板
- 一键配置 Tauri command
- 应用级结果模型
- 备份与回滚编排

建议新增前端文件：

- `src/components/quick-setup/CompanyKeySetupPanel.tsx`
- `src/components/quick-setup/CompanyKeyInput.tsx`
- `src/components/quick-setup/CompanyExistingConfigConfirm.tsx`
- `src/components/quick-setup/CompanySetupProgress.tsx`
- `src/components/quick-setup/CompanySetupResult.tsx`
- `src/components/quick-setup/CompanyCustomConfig.tsx`

## 验收清单

- 初始界面只有一个 API Key 输入框和一个主按钮
- 输入无效密钥不会改任何本地配置
- 没有本地配置时自动完成所有默认应用配置
- 有本地配置时先确认
- 自定义配置默认折叠
- 可以只配置某些应用
- Windows 下不会被 Git Bash 的 `HOME` 干扰
- 写入失败会回滚
- API Key 不出现在日志、错误、toast、导出文件中
