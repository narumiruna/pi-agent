import type { Skill } from "@earendil-works/pi-coding-agent";
import type {
  WebProjectTrust,
  WebSkillWriteScope,
} from "../../shared/contracts.js";
import { SkillManager } from "./skill-manager.js";
import { type NativeSkillSnapshot, SkillViewer } from "./skill-viewer.js";

export interface NativeSkillRuntime {
  mutateResources<T>(operation: () => Promise<T>): Promise<T>;
  projectTrust(): WebProjectTrust;
  skillCommandsEnabled(): boolean;
  skillSnapshot(): NativeSkillSnapshot;
}

/** Coordinates Web skill operations through Pi's native snapshots and reload lifecycle. */
export class SkillResourceService {
  private readonly manager: SkillManager;
  private readonly viewer: SkillViewer;

  constructor(
    agentDir: string,
    workspace: string,
    private readonly runtime: NativeSkillRuntime,
  ) {
    this.manager = new SkillManager(agentDir, workspace);
    this.viewer = new SkillViewer(agentDir, workspace);
  }

  async inventory() {
    const snapshot = this.runtime.skillSnapshot();
    const trust = this.runtime.projectTrust();
    return this.viewer.inventory(
      snapshot,
      trust,
      this.runtime.skillCommandsEnabled(),
      (skill: Skill) => this.manager.permissions(snapshot, trust, skill),
    );
  }

  async readFile(id: string, path: string) {
    return this.viewer.readFile(this.runtime.skillSnapshot(), id, path);
  }

  async create(
    scope: WebSkillWriteScope,
    name: string,
    description: string,
  ): Promise<void> {
    await this.runtime.mutateResources(() =>
      this.manager.create(
        this.runtime.skillSnapshot(),
        this.runtime.projectTrust(),
        scope,
        name,
        description,
      ),
    );
  }

  async update(id: string, content: string): Promise<void> {
    await this.runtime.mutateResources(() =>
      this.manager.update(
        this.runtime.skillSnapshot(),
        this.runtime.projectTrust(),
        id,
        content,
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await this.runtime.mutateResources(() =>
      this.manager.delete(
        this.runtime.skillSnapshot(),
        this.runtime.projectTrust(),
        id,
      ),
    );
  }
}
