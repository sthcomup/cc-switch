import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
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
}

const DEFAULT_BASE_URL = "https://catcatcode.com/";
const DEFAULT_MODEL = "gpt-5.5";

type Step = "input" | "applying" | "needsConfirmation" | "success" | "failed";

export function CompanyKeySetupPanel({
  open,
  onOpenChange,
  onConfigured,
}: CompanyKeySetupPanelProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [includeCodex, setIncludeCodex] = useState(true);
  const [includeOpenCode, setIncludeOpenCode] = useState(true);
  const [resolveUserEnvConflicts, setResolveUserEnvConflicts] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [result, setResult] = useState<CompanyKeySetupResult | null>(null);

  const selectedApps = useMemo(() => {
    const apps: Array<"codex" | "opencode"> = [];
    if (includeCodex) apps.push("codex");
    if (includeOpenCode) apps.push("opencode");
    return apps;
  }, [includeCodex, includeOpenCode]);

  const closePanel = () => {
    if (step === "applying") {
      const shouldClose = window.confirm(
        t("companyQuickSetup.closeWhileApplying", {
          defaultValue: "配置仍在进行中，确定要关闭吗？",
        }),
      );
      if (!shouldClose) return;
    }
    onOpenChange(false);
  };

  const resetForRetry = () => {
    setStep("input");
    setResult(null);
  };

  const submit = async (confirmOverwrite = false) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      toast.error(
        t("companyQuickSetup.apiKeyRequired", {
          defaultValue: "请先粘贴公司 API Key",
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
        resolveUserEnvConflicts,
      });
      setResult(response);
      if (response.status === "needsConfirmation") {
        setStep("needsConfirmation");
      } else if (response.status === "configured") {
        setStep("success");
        toast.success(
          t("companyQuickSetup.successToast", {
            defaultValue: "公司供应商已配置，请打开新终端后使用。",
          }),
        );
        onConfigured?.();
      } else {
        setStep("failed");
      }
    } catch (error) {
      setResult({
        status: "failed",
        existingConfigs: [],
        appResults: [
          {
            app: "company",
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
          <Button onClick={() => void submit(true)}>
            {t("companyQuickSetup.confirm", {
              defaultValue: "确认改为公司配置",
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
        <Button onClick={() => onOpenChange(false)}>
          {t("common.done", { defaultValue: "完成" })}
        </Button>
      )}
    </>
  );

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("companyQuickSetup.title", {
        defaultValue: "公司一键配置",
      })}
      onClose={closePanel}
      footer={footer}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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

          {(step === "input" || step === "applying") && (
            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company-api-key">
                  {t("companyQuickSetup.apiKeyLabel", {
                    defaultValue: "公司 API Key",
                  })}
                </Label>
                <Input
                  id="company-api-key"
                  type="password"
                  value={apiKey}
                  disabled={step === "applying"}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={t("companyQuickSetup.apiKeyPlaceholder", {
                    defaultValue: "粘贴公司 API Key",
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

              {customOpen && (
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
                    <Label htmlFor="company-base-url">
                      {t("companyQuickSetup.baseUrl", {
                        defaultValue: "公司网关地址",
                      })}
                    </Label>
                    <Input
                      id="company-base-url"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-model">
                      {t("companyQuickSetup.model", {
                        defaultValue: "默认模型",
                      })}
                    </Label>
                    <Input
                      id="company-model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <Checkbox
                      checked={resolveUserEnvConflicts}
                      onCheckedChange={(checked) =>
                        setResolveUserEnvConflicts(Boolean(checked))
                      }
                    />
                    {t("companyQuickSetup.resolveEnv", {
                      defaultValue:
                        "确认后备份并移除用户级 OPENAI_API_KEY 冲突",
                    })}
                  </label>
                </div>
              )}
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
        defaultValue: "粘贴公司 API Key",
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
        defaultValue: "确认后会先备份旧配置，再写入公司配置。",
      });
    case "success":
      return t("companyQuickSetup.successDescription", {
        defaultValue:
          "公司供应商已配置到 Codex 和 OpenCode，请打开新终端后使用。",
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
