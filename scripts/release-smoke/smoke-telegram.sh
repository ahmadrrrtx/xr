#!/bin/bash
# Deterministic telegram fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" telegram
