import { ReactFlowProvider } from "@xyflow/react";
import { GlitchloomWorkbench } from "./GlitchloomWorkbench";

export default function App() {
  return (
    <ReactFlowProvider>
      <GlitchloomWorkbench />
    </ReactFlowProvider>
  );
}
