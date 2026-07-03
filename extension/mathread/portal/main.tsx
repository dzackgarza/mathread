import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("portal/index.html must declare #root");
}
createRoot(root).render(<App />);
