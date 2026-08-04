# Talkie serving on elsie-1

Verified 2026-08-03.

## Active service

The two base models are exposed through an OpenAI-compatible legacy completion
API:

```text
http://elsie-1:8790/v1/models
http://elsie-1:8790/v1/completions
http://elsie-1:8790/health
```

Accepted model IDs and aliases:

| Alias | Model ID |
|---|---|
| `vintage` | `talkie-1930-13b-base` |
| `web` | `talkie-web-13b-base` |

The verified cached Hugging Face snapshot revisions are:

| Model ID | Snapshot revision |
|---|---|
| `talkie-1930-13b-base` | `b7c97680791f7fca4262c3c80b36ff7d666faab0` |
| `talkie-web-13b-base` | `1e5b771c9d38d44f54d35e722c5c0d73da418dd8` |

The service resolves and reports the actual loaded revision in both
`/v1/models` and completion responses.

The service loads each model lazily and keeps it resident. With both loaded, the
process reported 49.565 GiB allocated.

The deployment is:

```text
systemd user unit:  ~/.config/systemd/user/talkie-openai.service
remote module:      /home/osoleve/mechinterp-play/glitchloom_talkie_api.py
local source:       remote/glitchloom_talkie_api.py
Python environment: /home/osoleve/gpu-art/triangle-lab/.venv
```

The service uses the native Talkie loader and cached autoregressive path from
`mechinterp-play`. It does not load Jacobian lenses and does not apply a chat
template.

## Protocol surface

Implemented request fields:

- `model`
- `prompt` as a string or list of strings
- `max_tokens`
- `temperature`
- `top_p`
- `top_k`
- `presence_penalty`
- `seed`
- `stop`
- `n`
- `echo`
- `logprobs` from `0` through `20`, returned in the legacy completion shape;
  requested top-token rows use the raw base-model distribution

`stream` and non-zero `frequency_penalty` are rejected explicitly instead of
being silently ignored.

## Prior J-Lens service and rollback

The original `talkie-jlens.service` unit and its source remain intact. It is
disabled and inactive. To restore it:

```bash
systemctl --user disable --now talkie-openai.service
systemctl --user enable --now talkie-jlens.service
```

To return to the completion service:

```bash
systemctl --user disable --now talkie-jlens.service
systemctl --user enable --now talkie-openai.service
```

Both services bind port 8790, so they must not run simultaneously.

## Verification

The checked-in `examples/talkie-smoke.json` graph was submitted to the local
Glitchloom `/api/runs` endpoint. It completed with graph digest:

```text
9567f589f7f9cfdda8428c8cbf47f9b8afeb36292196819fd47939c43c5d1cc9
```

Observed four-token completions at seed 151:

```text
talkie-1930-13b-base → " come, and the"
talkie-web-13b-base  → " be a thing of"
```

Two additional warm vintage requests with the same prompt, decoding parameters,
and seed 151 returned the identical completion. The second request completed in
0.53 seconds.
