import { ReactFlowProvider } from "@xyflow/react";
import { GlitchlabWorkbench } from "./GlitchlabWorkbench";

export default function App() {
  return (
    <ReactFlowProvider>
      <GlitchlabWorkbench />
    </ReactFlowProvider>
  );
}
