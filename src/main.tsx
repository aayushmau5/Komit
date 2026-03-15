import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <WorkerPoolContextProvider
    poolOptions={{
      workerFactory: () =>
        new Worker(
          new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url),
          { type: "module" }
        ),
      poolSize: 4,
    }}
    highlighterOptions={{}}
  >
    <App />
  </WorkerPoolContextProvider>,
);
