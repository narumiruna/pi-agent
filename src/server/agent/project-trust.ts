import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { WebProjectTrust } from "../../shared/contracts.js";

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

  constructor(
    private readonly workspace: string,
    agentDir: string,
    private readonly settings: SettingsManager,
    trustStore: ProjectTrustStoreLike = new ProjectTrustStore(agentDir),
    private readonly requiresTrust: (
      cwd: string,
    ) => boolean = hasTrustRequiringProjectResources,
  ) {
    this.trustStore = trustStore;
  }

  private resolve(): WebProjectTrust {
    const required = this.requiresTrust(this.workspace);
    if (!required) return { required, trusted: true };
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
    const state = this.resolve();
    this.settings.setProjectTrusted(state.required && state.trusted);
    return state;
  }

  async refresh(): Promise<WebProjectTrust> {
    await this.settings.reload();
    return this.initialize();
  }

  status(): WebProjectTrust {
    const resourceRequired = this.requiresTrust(this.workspace);
    const runtimeTrusted = this.settings.isProjectTrusted();
    return {
      required: resourceRequired || runtimeTrusted,
      trusted: !resourceRequired || runtimeTrusted,
    };
  }

  persist(trusted: boolean): void {
    this.trustStore.set(this.workspace, trusted);
  }
}
