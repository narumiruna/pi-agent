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

  status(): WebProjectTrust {
    const state = this.resolve();
    if (!state.required) return state;
    return {
      ...state,
      trusted: state.trusted && this.settings.isProjectTrusted(),
    };
  }

  persist(trusted: boolean): void {
    this.trustStore.set(this.workspace, trusted);
  }
}
