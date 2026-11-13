#!/bin/bash
# Deterministic mobile fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" mobile
