#!/bin/bash
# Deterministic security fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" security
