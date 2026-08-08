# Optional Talkie completion service

This directory contains the reference OpenAI-compatible service used to connect
Glitchloom to the two Talkie base models. The implementation depends on the
Talkie and `mechinterp-play` runtime code and requires a CUDA-capable host; it is
not part of the default local Glitchloom install.

The API has no authentication or tenant isolation. The checked-in systemd unit
binds to loopback by default. Prefer an SSH tunnel or authenticated reverse proxy;
do not expose the service directly to an untrusted network.

## API surface

The two base models are exposed through an OpenAI-compatible legacy completion
API:

```text
http://<talkie-host>:8790/v1/models
http://<talkie-host>:8790/v1/completions
http://<talkie-host>:8790/health
```

Accepted model IDs and aliases:

| Alias | Model ID |
|---|---|
| `vintage` | `talkie-1930-13b-base` |
| `web` | `talkie-web-13b-base` |

The cached Hugging Face snapshot revisions verified on 2026-08-03 were:

| Model ID | Snapshot revision |
|---|---|
| `talkie-1930-13b-base` | `b7c97680791f7fca4262c3c80b36ff7d666faab0` |
| `talkie-web-13b-base` | `1e5b771c9d38d44f54d35e722c5c0d73da418dd8` |

The service resolves and reports the actual loaded revision in both
`/v1/models` and completion responses.

The service loads each model lazily and keeps it resident. With both loaded, the
process reported 49.565 GiB allocated.

## Deployment template

The checked-in unit assumes a `mechinterp-play` checkout and virtual environment
under the service user's home directory:

```text
systemd user unit:  ~/.config/systemd/user/talkie-openai.service
remote module:      ~/mechinterp-play/glitchloom_talkie_api.py
local source:       remote/glitchloom_talkie_api.py
Python environment: ~/mechinterp-play/.venv
```

Adjust `WorkingDirectory` and `ExecStart` in the unit if your runtime lives
elsewhere. Copy the module and unit, then reload and start the user service:

```bash
install -Dm644 remote/glitchloom_talkie_api.py ~/mechinterp-play/glitchloom_talkie_api.py
install -Dm644 remote/talkie-openai.service ~/.config/systemd/user/talkie-openai.service
systemctl --user daemon-reload
systemctl --user enable --now talkie-openai.service
```

Optional settings belong in `~/.config/glitchloom/talkie-openai.env`:

```text
TALKIE_CACHE_DIR=/path/to/huggingface/cache
TALKIE_BIND_HOST=127.0.0.1
```

Set `TALKIE_BIND_HOST=0.0.0.0` only on a trusted, firewalled network or behind an
authenticated proxy.

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

## Optional rollback unit

If a deployment retains an older `talkie-jlens.service`, switch between the two
units explicitly:

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

Start by checking the service itself:

```bash
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/v1/models
```

Then submit `examples/talkie-smoke.json` to a local Glitchloom `/api/runs`
endpoint. The 2026-08-03 reference deployment completed with graph digest:

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
