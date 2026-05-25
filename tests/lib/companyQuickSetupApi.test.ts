import { describe, expect, it } from "vitest";
import { companyQuickSetupApi } from "@/lib/api";

describe("companyQuickSetupApi", () => {
  it("returns confirmation result before overwriting existing Codex config", async () => {
    const result = await companyQuickSetupApi.quickSetup({
      apiKey: "sk-test-secret",
      mode: "default",
    });

    expect(result.status).toBe("needsConfirmation");
    expect(result.existingConfigs[0]).toMatchObject({
      app: "codex",
      kind: "file",
    });
  });

  it("configures Codex and OpenCode after confirmation", async () => {
    const result = await companyQuickSetupApi.quickSetup({
      apiKey: "sk-test-secret",
      mode: "default",
      confirmOverwrite: true,
    });

    expect(result.status).toBe("configured");
    expect(result.appResults.map((item) => item.app)).toEqual([
      "codex",
      "opencode",
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});
