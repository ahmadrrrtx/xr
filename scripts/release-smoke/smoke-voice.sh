#!/bin/bash
# Deterministic voice fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" voice
