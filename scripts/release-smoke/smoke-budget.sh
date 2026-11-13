#!/bin/bash
# Deterministic budget fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" budget
