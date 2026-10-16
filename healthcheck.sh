#!/bin/bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# Managed Modules intentionally do not mount a legacy .config/default.yml.
# The Runtime Provider injects PORT; standalone keeps the historical behavior.
if [ -n "${MANAFIELD_MODULE_ID:-}" ] || [ "${MANAFIELD_MANAGED:-}" = "1" ]; then
    PORT="${PORT:-8080}"
else
    PORT=$(grep '^port:' /misskey/.config/default.yml | awk 'NR==1{print $2; exit}')
fi
curl -Sfso/dev/null "http://localhost:${PORT}/healthz"
