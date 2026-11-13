#!/bin/bash
# Deterministic orchestration fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" orchestration
