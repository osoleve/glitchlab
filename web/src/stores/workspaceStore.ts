import { create } from "zustand";
import type { GraphDocumentSummary, GraphTemplateSummary } from "../types";
import type { GraphTab } from "./types";

export const MAIN_TAB_ID = "main";

interface WorkspaceState {
  tabs: GraphTab[];
  activeTabId: string;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  graphs: GraphDocumentSummary[];
  graphTemplates: GraphTemplateSummary[];
  paletteWidth?: number;
  inspectorWidth?: number;
  setTabs: (tabs: GraphTab[] | ((current: GraphTab[]) => GraphTab[])) => void;
  setActiveTabId: (activeTabId: string) => void;
  setPaletteOpen: (paletteOpen: boolean) => void;
  setInspectorOpen: (inspectorOpen: boolean) => void;
  setGraphs: (
    graphs: GraphDocumentSummary[] | ((current: GraphDocumentSummary[]) => GraphDocumentSummary[]),
  ) => void;
  setGraphTemplates: (
    graphTemplates:
      | GraphTemplateSummary[]
      | ((current: GraphTemplateSummary[]) => GraphTemplateSummary[]),
  ) => void;
  setPaletteWidth: (paletteWidth?: number) => void;
  setInspectorWidth: (inspectorWidth?: number) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [
    {
      id: MAIN_TAB_ID,
      type: "graph",
      snapshot: {
        nodes: [],
        edges: [],
        graphName: "Loom workshop",
        isDirty: false,
      },
    },
  ],
  activeTabId: MAIN_TAB_ID,
  paletteOpen: true,
  inspectorOpen: false,
  graphs: [],
  graphTemplates: [],
  setTabs: (tabs) =>
    set((state) => ({ tabs: typeof tabs === "function" ? tabs(state.tabs) : tabs })),
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setGraphs: (graphs) =>
    set((state) => ({ graphs: typeof graphs === "function" ? graphs(state.graphs) : graphs })),
  setGraphTemplates: (graphTemplates) =>
    set((state) => ({
      graphTemplates:
        typeof graphTemplates === "function"
          ? graphTemplates(state.graphTemplates)
          : graphTemplates,
    })),
  setPaletteWidth: (paletteWidth) => set({ paletteWidth }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
}));
