import type { WorkspaceStore } from "../workspace-store.ts";
export class SkillRepo {
  constructor(public readonly store: WorkspaceStore) {}
  latestSkillVersion(...a:Parameters<WorkspaceStore["latestSkillVersion"]>){return this.store.latestSkillVersion(...a)}
  insertSkill(...a:Parameters<WorkspaceStore["insertSkill"]>){return this.store.insertSkill(...a)}
  setActiveSkillVersion(...a:Parameters<WorkspaceStore["setActiveSkillVersion"]>){return this.store.setActiveSkillVersion(...a)}
  freezeBaseline(...a:Parameters<WorkspaceStore["freezeBaseline"]>){return this.store.freezeBaseline(...a)}
  addRegressionCase(...a:Parameters<WorkspaceStore["addRegressionCase"]>){return this.store.addRegressionCase(...a)}
  regressionCasesFor(...a:Parameters<WorkspaceStore["regressionCasesFor"]>){return this.store.regressionCasesFor(...a)}
  markRegression(...a:Parameters<WorkspaceStore["markRegression"]>){return this.store.markRegression(...a)}
  frozenBaseline(...a:Parameters<WorkspaceStore["frozenBaseline"]>){return this.store.frozenBaseline(...a)}
  count(){return this.store.skillCount()}
  frozenCount(){return this.store.frozenCount()}
}
