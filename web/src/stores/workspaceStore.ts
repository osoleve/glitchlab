import { create } from "zustand";
import type { LoomSummary, LoomTemplateSummary } from "../types";
import type { GraphTab } from "./types";

export const MAIN_TAB_ID = "main";

interface WorkspaceState {
  tabs: GraphTab[];
  activeTabId: string;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  looms: LoomSummary[];
  loomTemplates: LoomTemplateSummary[];
  paletteWidth?: number;
  inspectorWidth?: number;
  setTabs: (tabs: GraphTab[] | ((current: GraphTab[]) => GraphTab[])) => void;
  setActiveTabId: (activeTabId: string) => void;
  setPaletteOpen: (paletteOpen: boolean) => void;
  setInspectorOpen: (inspectorOpen: boolean) => void;
  setLooms: (looms: LoomSummary[] | ((current: LoomSummary[]) => LoomSummary[])) => void;
  setLoomTemplates: (
    loomTemplates:
      | LoomTemplateSummary[]
      | ((current: LoomTemplateSummary[]) => LoomTemplateSummary[]),
  ) => void;
  setPaletteWidth: (paletteWidth?: number) => void;
  setInspectorWidth: (inspectorWidth?: number) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [
    {
      id: MAIN_TAB_ID,
      type: "loom",
      snapshot: {
        nodes: [],
        edges: [],
        loomName: "Talkie perturbation pair",
        isDirty: false,
      },
    },
  ],
  activeTabId: MAIN_TAB_ID,
  paletteOpen: true,
  inspectorOpen: false,
  looms: [],
  loomTemplates: [],
  setTabs: (tabs) =>
    set((state) => ({ tabs: typeof tabs === "function" ? tabs(state.tabs) : tabs })),
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setLooms: (looms) =>
    set((state) => ({ looms: typeof looms === "function" ? looms(state.looms) : looms })),
  setLoomTemplates: (loomTemplates) =>
    set((state) => ({
      loomTemplates:
        typeof loomTemplates === "function" ? loomTemplates(state.loomTemplates) : loomTemplates,
    })),
  setPaletteWidth: (paletteWidth) => set({ paletteWidth }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
}));
