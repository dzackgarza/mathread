/**
 * Standalone DOM harness for component unit tests: imported FIRST so the
 * happy-dom globals exist before @testing-library binds to the document.
 * Registration is once-per-process and never torn down — unit test files
 * share a process, and an unregister in one file's afterAll would strand
 * the next file with a cached, side-effect-spent import and no DOM.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
