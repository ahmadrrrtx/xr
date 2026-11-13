#!/bin/bash
# Deterministic ecosystem fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" ecosystem
