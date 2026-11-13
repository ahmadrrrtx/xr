#!/bin/bash
# Deterministic control fixture smoke.
exec bash "$(dirname "$0")/smoke-feature.sh" control
