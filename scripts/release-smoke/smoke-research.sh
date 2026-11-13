#!/bin/bash
# Deterministic research fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" research
