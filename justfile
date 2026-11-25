ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun-python"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

[doc("List the available recipes")]
default:
    @just --list

[doc("Build the unpacked browser extension")]
build:
    @bun run build

[doc("Build the Chrome Web Store ZIP package")]
package:
    @bun run package

[doc("Run immediate commit-tier QC")]
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun-python.just -d . test-commit

[doc("Run the full Python and Bun suites before pushing")]
test-push:
    @just -f ~/ai-review-ci/justfiles/bun-python.just -d . test-push

[doc("Run CI acceptance QC")]
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun-python.just -d . test-ci

[doc("Run the command-line tool")]
run *args:
    @uv run mathread {{args}}

[doc("Run the local capture service")]
serve:
    @uv run mathread serve --host 127.0.0.1 --port 8765 --root ~/math-reading

[doc("Watch extension source and rebuild on change (load dist/extension/ as unpacked in Chrome)")]
dev:
    @bun run dev
