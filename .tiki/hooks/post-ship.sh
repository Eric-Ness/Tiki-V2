#!/bin/bash
# Sample Tiki lifecycle hook: post-ship (Git Bash / POSIX shell variant).
#
# This is a DISABLED sample (see ../hooks.json — "post-ship".enabled is false),
# so it does NOT run during the release that ships the hook system itself.
# Enable it by setting "enabled": true for "post-ship" in hooks.json.
#
# Env vars available to post-ship (see docs/HOOKS.md):
#   TIKI_ISSUE       the issue number that was shipped
#   TIKI_COMMIT_SHA  the commit SHA produced by /tiki:ship
#
# post-ship is a non-blocking (WARN-only) hook: a non-zero exit here is logged
# as a warning by run-hook.mjs and does not stop the pipeline.

echo "post-ship hook: issue #$TIKI_ISSUE commit $TIKI_COMMIT_SHA"
