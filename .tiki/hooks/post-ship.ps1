# Sample Tiki lifecycle hook: post-ship (PowerShell variant for Windows).
#
# This is a DISABLED sample (see ..\hooks.json — "post-ship".enabled is false),
# so it does NOT run during the release that ships the hook system itself.
# Enable it by setting "enabled": true for "post-ship" in hooks.json.
#
# On Windows, run-hook.mjs prefers this .ps1 over the .sh sibling.
#
# Env vars available to post-ship (see docs/HOOKS.md):
#   TIKI_ISSUE       the issue number that was shipped
#   TIKI_COMMIT_SHA  the commit SHA produced by /tiki:ship
#
# post-ship is a non-blocking (WARN-only) hook: a non-zero exit here is logged
# as a warning by run-hook.mjs and does not stop the pipeline.

Write-Output "post-ship hook: issue #$env:TIKI_ISSUE commit $env:TIKI_COMMIT_SHA"
