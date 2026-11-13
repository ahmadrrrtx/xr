#!/bin/bash
# Deterministic local fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" local
