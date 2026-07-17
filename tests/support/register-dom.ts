/**
 * Standalone DOM harness for component unit tests: imported FIRST so the
 * happy-dom globals exist before @testing-library binds to the document.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
