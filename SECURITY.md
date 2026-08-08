# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use **Report a
vulnerability** in this repository's **Security** tab to share details privately.
If that option is unavailable, contact the maintainer through their GitHub profile
before sending sensitive information.

Include the affected commit or version, reproduction steps, expected impact, and
any suggested mitigation. You should receive an acknowledgement within seven days.

## Security boundaries

Glitchlab is local-first research software, not a hardened multi-user service.
By default it binds to loopback and restricts file nodes to `GLITCHLAB_WORKSPACE`.
Do not expose Glitchlab directly to an untrusted network. It does not provide
authentication or tenant isolation.

Provider credentials must be supplied through environment variables. Saved graphs
may contain prompts, model outputs, source paths, endpoint URLs, and experiment
provenance, so review those artifacts before sharing them.

Only the latest commit on `main` receives security fixes while the project is in alpha.
