import {
  hasTrustRequiringProjectResources,
  type LoadExtensionsResult,
  type ProjectTrustContext,
  type ProjectTrustHandler,
  ProjectTrustStore,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { WebProjectTrust } from "../../shared/contracts.js";

export class ProjectTrustDeniedError extends Error {}

interface ProjectTrustStoreLike {
  get(cwd: string): boolean | null;
  set(cwd: string, decision: boolean | null): void;
}

interface RuntimeTrustSettings {
  isProjectTrusted(): boolean;
  setProjectTrusted(trusted: boolean): void;
}

export async function withProjectTrustRollback<T>(
  settings: RuntimeTrustSettings,
  apply: () => Promise<void> | void,
  operation: (changed: boolean) => Promise<T>,
  rollback: () => Promise<void>,
): Promise<T> {
  const previous = settings.isProjectTrusted();
  let changed = false;
  try {
    await apply();
    changed = previous !== settings.isProjectTrusted();
    return await operation(changed);
  } catch (error) {
    changed = changed || previous !== settings.isProjectTrusted();
    if (changed) {
      settings.setProjectTrusted(previous);
      await rollback().catch(() => undefined);
    }
    throw error;
  }
}

export class ProjectTrustPolicy {
  private readonly trustStore: ProjectTrustStoreLike;
  private rememberedDecision: boolean | undefined;
  private resolutionOverride: boolean | undefined;

  constructor(
    private readonly workspace: string,
    agentDir: string,
    private readonly settings: SettingsManager,
    trustStore: ProjectTrustStoreLike = new ProjectTrustStore(agentDir),
    private readonly requiresTrust: (
      cwd: string,
    ) => boolean = hasTrustRequiringProjectResources,
    private readonly onExtensionError: (message: string) => void = () =>
      undefined,
  ) {
    this.trustStore = trustStore;
  }

  private resolve(): WebProjectTrust {
    const required = this.requiresTrust(this.workspace);
    try {
      const saved = this.trustStore.get(this.workspace);
      return {
        required,
        trusted: saved ?? this.settings.getDefaultProjectTrust() === "always",
      };
    } catch {
      return { required, trusted: false };
    }
  }

  initialize(): WebProjectTrust {
    this.rememberedDecision = undefined;
    const state = this.resolve();
    this.settings.setProjectTrusted(state.trusted);
    return state;
  }

  private async extensionDecision(
    extensionsResult: LoadExtensionsResult,
    evaluateCleanProject = false,
  ): Promise<boolean | undefined> {
    if (!evaluateCleanProject && !this.requiresTrust(this.workspace))
      return undefined;
    const context: ProjectTrustContext = {
      cwd: this.workspace,
      mode: "rpc",
      hasUI: false,
      ui: {
        select: async () => undefined,
        confirm: async () => false,
        input: async () => undefined,
        notify: () => undefined,
      },
    };
    for (const extension of extensionsResult.extensions) {
      if (extension.sourceInfo.scope === "project") continue;
      const handlers = extension.handlers.get("project_trust") ?? [];
      for (const registered of handlers) {
        try {
          const result = await (registered as ProjectTrustHandler)(
            { type: "project_trust", cwd: this.workspace },
            context,
          );
          if (!result || result.trusted === "undecided") continue;
          const trusted = result.trusted === "yes";
          if (result.remember === true) this.rememberedDecision = trusted;
          return trusted;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const rawLabel =
            extension.path.replaceAll("\\", "/").split("/").at(-1) ||
            "extension";
          const label =
            [...rawLabel]
              .filter((character) => {
                const code = character.charCodeAt(0);
                return code >= 32 && code !== 127;
              })
              .join("") || "extension";
          try {
            this.onExtensionError(
              `Extension "${label}" project_trust error: ${message}`,
            );
          } catch {
            // Reporting must not suppress later trust handlers.
          }
        }
      }
    }
    return undefined;
  }

  async resolveForLoader(
    extensionsResult: LoadExtensionsResult,
  ): Promise<boolean> {
    this.rememberedDecision = undefined;
    if (this.resolutionOverride !== undefined) return this.resolutionOverride;
    return (
      (await this.extensionDecision(extensionsResult)) ?? this.resolve().trusted
    );
  }

  setResolutionOverride(trusted: boolean): void {
    this.resolutionOverride = trusted;
  }

  clearResolutionOverride(): void {
    this.resolutionOverride = undefined;
  }

  async assertCanEnable(extensionsResult: LoadExtensionsResult): Promise<void> {
    this.rememberedDecision = undefined;
    if ((await this.extensionDecision(extensionsResult, true)) === false) {
      this.commitRememberedDecision();
      throw new ProjectTrustDeniedError(
        "Project trust was denied by an extension policy",
      );
    }
  }

  async refresh(
    extensionsResult?: LoadExtensionsResult,
  ): Promise<WebProjectTrust> {
    this.rememberedDecision = undefined;
    await this.settings.reload();
    const state = this.resolve();
    const trusted = extensionsResult
      ? ((await this.extensionDecision(extensionsResult)) ?? state.trusted)
      : state.trusted;
    this.settings.setProjectTrusted(trusted);
    return { required: state.required, trusted };
  }

  commitRememberedDecision(): void {
    if (this.rememberedDecision !== undefined)
      this.persist(this.rememberedDecision);
    this.rememberedDecision = undefined;
  }

  discardRememberedDecision(): void {
    this.rememberedDecision = undefined;
  }

  status(): WebProjectTrust {
    return {
      required: this.requiresTrust(this.workspace),
      trusted: this.settings.isProjectTrusted(),
    };
  }

  persist(trusted: boolean): void {
    this.trustStore.set(this.workspace, trusted);
  }
}
