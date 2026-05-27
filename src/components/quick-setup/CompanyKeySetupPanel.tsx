import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import {
  companyQuickSetupApi,
  type CompanyKeySetupResult,
  type ExistingConfig,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface CompanyKeySetupPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured?: () => void;
  mode?: "panel" | "onboarding";
  onSkip?: () => void;
  onDone?: () => void;
}

const DEFAULT_BASE_URL = "https://catcatcode.com/";
const DEFAULT_MODEL = "gpt-5.5";

type Step = "input" | "applying" | "needsConfirmation" | "success" | "failed";

const describeApiKey = (value: string) => {
  const trimmed = value.trim();
  return {
    length: trimmed.length,
    suffix: trimmed.length > 4 ? trimmed.slice(-4) : "",
  };
};

export function CompanyKeySetupPanel({
  open,
  onOpenChange,
  onConfigured,
  mode = "panel",
  onSkip,
  onDone,
}: CompanyKeySetupPanelProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [includeCodex, setIncludeCodex] = useState(true);
  const [includeOpenCode, setIncludeOpenCode] = useState(true);
  const [customOpen, setCustomOpen] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [result, setResult] = useState<CompanyKeySetupResult | null>(null);
  const wasOpenRef = useRef(open);

  const resetSession = () => {
    console.info("[QuickSetup][Panel] reset session", { mode });
    setApiKey("");
    setBaseUrl(DEFAULT_BASE_URL);
    setModel(DEFAULT_MODEL);
    setIncludeCodex(true);
    setIncludeOpenCode(true);
    setCustomOpen(false);
    setStep("input");
    setResult(null);
  };

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen && open) {
      resetSession();
    }
  }, [open]);

  const selectedApps = useMemo(() => {
    const apps: Array<"codex" | "opencode"> = [];
    if (includeCodex) apps.push("codex");
    if (includeOpenCode) apps.push("opencode");
    return apps;
  }, [includeCodex, includeOpenCode]);

  const closePanel = () => {
    console.info("[QuickSetup][Panel] close requested", { mode, step });
    if (step === "applying") {
      const shouldClose = window.confirm(
        t("companyQuickSetup.closeWhileApplying", {
          defaultValue: "配置仍在进行中，确定要关闭吗？",
        }),
      );
      if (!shouldClose) return;
    }
    if (mode === "onboarding" && onSkip) {
      console.info("[QuickSetup][Panel] onboarding skipped");
      onSkip();
      return;
    }
    onOpenChange(false);
  };

  const resetForRetry = () => {
    console.info("[QuickSetup][Panel] reset for retry");
    setStep("input");
    setResult(null);
  };

  const submit = async (confirmOverwrite = false) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      toast.error(
        t("companyQuickSetup.apiKeyRequired", {
          defaultValue: "请先粘贴 API Key",
        }),
      );
      return;
    }
    if (selectedApps.length === 0) {
      toast.error(
        t("companyQuickSetup.appRequired", {
          defaultValue: "请至少选择 Codex 或 OpenCode",
        }),
      );
      return;
    }

    console.info("[QuickSetup][Panel] submit", {
      mode,
      confirmOverwrite,
      setupMode: customOpen ? "custom" : "default",
      apps: selectedApps,
      baseUrl: customOpen ? baseUrl : DEFAULT_BASE_URL,
      model: customOpen ? model : DEFAULT_MODEL,
      apiKey: describeApiKey(trimmedKey),
    });
    setStep("applying");
    setResult(null);
    try {
      const response = await companyQuickSetupApi.quickSetup({
        apiKey: trimmedKey,
        mode: customOpen ? "custom" : "default",
        apps: selectedApps,
        baseUrl: customOpen ? baseUrl : undefined,
        model: customOpen ? model : undefined,
        confirmOverwrite,
        resolveUserEnvConflicts: false,
      });
      console.info("[QuickSetup][Panel] response", {
        status: response.status,
        appResults: response.appResults.map((item) => ({
          app: item.app,
          status: item.status,
          message: item.message,
          rollbackStatus: item.rollbackStatus,
        })),
        existingConfigs: response.existingConfigs.length,
        warnings: response.warnings,
        backupPath: response.backupPath,
        restartRequiredApps: response.restartRequiredApps,
      });
      setResult(response);
      if (response.status === "needsConfirmation") {
        console.info("[QuickSetup][Panel] needs confirmation", {
          existingConfigs: response.existingConfigs,
        });
        setStep("needsConfirmation");
      } else if (response.status === "configured") {
        console.info("[QuickSetup][Panel] configured successfully");
        setStep("success");
        toast.success(
          t("companyQuickSetup.successToast", {
            defaultValue: "供应商已配置，请打开新终端后使用。",
          }),
        );
        onConfigured?.();
      } else {
        console.warn("[QuickSetup][Panel] setup failed", response);
        setStep("failed");
      }
    } catch (error) {
      console.error("[QuickSetup][Panel] invoke failed", error);
      setResult({
        status: "failed",
        existingConfigs: [],
        appResults: [
          {
            app: "quick_setup",
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        warnings: [],
        restartRequiredApps: [],
      });
      setStep("failed");
    }
  };

  const footer = (
    <>
      {step === "input" && (
        <Button onClick={() => void submit(false)} disabled={!apiKey.trim()}>
          <KeyRound className="mr-2 h-4 w-4" />
          {t("companyQuickSetup.primary", {
            defaultValue: "验证并配置",
          })}
        </Button>
      )}
      {step === "needsConfirmation" && (
        <>
          <Button variant="outline" onClick={resetForRetry}>
            {t("common.cancel", { defaultValue: "取消" })}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCustomOpen(true);
              setStep("input");
            }}
          >
            {t("companyQuickSetup.chooseApps", {
              defaultValue: "选择要修改的应用",
            })}
          </Button>
          <Button onClick={() => void submit(true)}>
            {t("companyQuickSetup.confirm", {
              defaultValue: "确认改为一键配置",
            })}
          </Button>
        </>
      )}
      {step === "failed" && (
        <>
          <Button variant="outline" onClick={resetForRetry}>
            {t("companyQuickSetup.back", { defaultValue: "返回" })}
          </Button>
          <Button
            onClick={() =>
              void submit(result?.existingConfigs?.length ? true : false)
            }
          >
            {t("companyQuickSetup.retry", { defaultValue: "重试" })}
          </Button>
        </>
      )}
      {step === "success" && (
        <Button onClick={() => (onDone ? onDone() : onOpenChange(false))}>
          {mode === "onboarding"
            ? t("companyQuickSetup.enterApp", {
                defaultValue: "进入配置管理",
              })
            : t("common.done", { defaultValue: "完成" })}
        </Button>
      )}
    </>
  );

  const actions =
    mode === "onboarding" ? (
      <Button variant="secondary" onClick={closePanel}>
        {t("companyQuickSetup.skip", { defaultValue: "跳过" })}
      </Button>
    ) : undefined;

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("companyQuickSetup.title", {
        defaultValue: "一键配置",
      })}
      onClose={closePanel}
      footer={footer}
      actions={actions}
      showBackButton={mode !== "onboarding"}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {step === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : step === "failed" ? (
                <AlertCircle className="h-5 w-5" />
              ) : step === "applying" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <KeyRound className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold">{stepTitle(step, t)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {stepDescription(step, t)}
              </p>
            </div>
          </div>

          {step === "input" && (
            <div className="mt-5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-muted-foreground">
              {t("companyQuickSetup.defaultScope", {
                defaultValue:
                  "默认会验证密钥，并为 Codex 和 OpenCode 写入公司供应商配置。",
              })}
            </div>
          )}

          {(step === "input" || step === "applying") && (
            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quick-setup-api-key">
                  {t("companyQuickSetup.apiKeyLabel", {
                    defaultValue: "API Key",
                  })}
                </Label>
                <Input
                  id="quick-setup-api-key"
                  type="password"
                  value={apiKey}
                  disabled={step === "applying"}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={t("companyQuickSetup.apiKeyPlaceholder", {
                    defaultValue: "粘贴 API Key",
                  })}
                />
              </div>

              <button
                type="button"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
                onClick={() => setCustomOpen((value) => !value)}
                disabled={step === "applying"}
              >
                <Settings2 className="h-4 w-4" />
                {t("companyQuickSetup.custom", {
                  defaultValue: "自定义配置",
                })}
              </button>

              {customOpen && step === "input" && (
                <div className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={includeCodex}
                      onCheckedChange={(checked) =>
                        setIncludeCodex(Boolean(checked))
                      }
                    />
                    Codex
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={includeOpenCode}
                      onCheckedChange={(checked) =>
                        setIncludeOpenCode(Boolean(checked))
                      }
                    />
                    OpenCode
                  </label>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="quick-setup-base-url">
                      {t("companyQuickSetup.baseUrl", {
                        defaultValue: "网关地址",
                      })}
                    </Label>
                    <Input
                      id="quick-setup-base-url"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-setup-model">
                      {t("companyQuickSetup.model", {
                        defaultValue: "默认模型",
                      })}
                    </Label>
                    <Input
                      id="quick-setup-model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    />
                  </div>
                </div>
              )}

              {step === "applying" && <SetupProgressPreview />}
            </div>
          )}

          {step === "needsConfirmation" && result && (
            <ExistingConfigList configs={result.existingConfigs} />
          )}

          {(step === "success" || step === "failed") && result && (
            <ResultBlock result={result} />
          )}
        </section>
      </div>
    </FullScreenPanel>
  );
}

function SetupProgressPreview() {
  const rows = [
    "验证 API Key",
    "备份已有配置",
    "写入 Codex / OpenCode",
  ];

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      {rows.map((label, index) => (
        <div
          key={label}
          className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
        >
          <span>{label}</span>
          {index === 0 ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              进行中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
              等待
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ExistingConfigList({ configs }: { configs: ExistingConfig[] }) {
  return (
    <div className="mt-5 space-y-2">
      {configs.map((config, index) => (
        <div
          key={`${config.app}-${config.kind}-${index}`}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <div className="font-medium">{config.label}</div>
          {config.source && (
            <div className="mt-1 break-all text-xs text-muted-foreground">
              {config.source}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResultBlock({ result }: { result: CompanyKeySetupResult }) {
  return (
    <div className="mt-5 space-y-3">
      {result.appResults.map((item, index) => (
        <div
          key={`${item.app}-${index}`}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            item.status === "success"
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-destructive/30 bg-destructive/10",
          )}
        >
          <div className="font-medium">{item.app}</div>
          <div className="mt-1 text-muted-foreground">{item.message}</div>
          {item.rollbackStatus && (
            <div className="mt-1 text-xs text-muted-foreground">
              {item.rollbackStatus}
            </div>
          )}
        </div>
      ))}
      {result.backupPath && (
        <div className="break-all rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {result.backupPath}
        </div>
      )}
    </div>
  );
}

function stepTitle(step: Step, t: ReturnType<typeof useTranslation>["t"]) {
  switch (step) {
    case "applying":
      return t("companyQuickSetup.applyingTitle", {
        defaultValue: "正在验证并写入配置",
      });
    case "needsConfirmation":
      return t("companyQuickSetup.confirmTitle", {
        defaultValue: "发现已有配置",
      });
    case "success":
      return t("companyQuickSetup.successTitle", {
        defaultValue: "配置完成",
      });
    case "failed":
      return t("companyQuickSetup.failedTitle", {
        defaultValue: "配置失败",
      });
    default:
      return t("companyQuickSetup.inputTitle", {
        defaultValue: "粘贴 API Key",
      });
  }
}

function stepDescription(
  step: Step,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (step) {
    case "applying":
      return t("companyQuickSetup.applyingDescription", {
        defaultValue:
          "会先验证密钥，再配置 Codex 和 OpenCode。验证失败不会修改本地配置。",
      });
    case "needsConfirmation":
      return t("companyQuickSetup.confirmDescription", {
        defaultValue: "确认后会先备份旧配置，再写入一键配置。",
      });
    case "success":
      return t("companyQuickSetup.successDescription", {
        defaultValue: "供应商已配置到 Codex 和 OpenCode，请打开新终端后使用。",
      });
    case "failed":
      return t("companyQuickSetup.failedDescription", {
        defaultValue: "请检查失败原因。已写入的内容会尽量回滚。",
      });
    default:
      return t("companyQuickSetup.inputDescription", {
        defaultValue: "默认配置 Codex 和 OpenCode，模型为 gpt-5.5。",
      });
  }
}
