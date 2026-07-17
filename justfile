# MathRead — local provenance-first PDF capture tooling.
#
# Python owns the local capture service. Bun owns the browser capture shim.
# Generic validation delegates to the global QC recipes for each language.

# Show available recipes
# ai-review-ci contract variables consumed by doctor and workflow installers.
ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun-python"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

# List the available recipes
default:
    @just --list

# Build the unpacked browser extension
build:
    @bun run build

# Build the Chrome Web Store ZIP package
package:
    @bun run package

# Run immediate commit-tier QC
test-commit:
    @just -f ~/ai-review-ci/justfiles/python.just -d . test-commit
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

# Run the full Python and Bun suites before pushing
test-push:
    @just -f ~/ai-review-ci/justfiles/python.just -d . test-push
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

# Run CI acceptance QC
test-ci:
    @just -f ~/ai-review-ci/justfiles/python.just -d . test-ci
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci

# Run the command-line tool
run *args:
    @uv run mathread {{args}}

# Run the local capture service
serve:
    @uv run mathread serve --host 127.0.0.1 --port 8765 --root ~/math-reading

# Watch extension source and rebuild on change (load dist/extension/ as unpacked in Chrome)
dev:
    @bun run dev
