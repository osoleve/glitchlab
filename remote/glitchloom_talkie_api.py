"""OpenAI-compatible text-completion service for the two Talkie base models.

This module is deployed beside ``mechinterp-play`` and intentionally reuses its
memory-efficient native Talkie loader and cached autoregressive generation path.
It does not load Jacobian lenses or apply chat templates.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import time
import uuid
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from happy_life.generation import GenerationConfig, generate
from pydantic import BaseModel, Field
from talkie.download import get_model_files
from talkie_lens_ui.runtime import (
    TalkieGenerationState,
    TalkieTokenizerAdapter,
    forward_with_cache,
    load_talkie_memory_efficient,
)

LOGGER = logging.getLogger(__name__)
MODEL_IDS = {
    "vintage": "talkie-1930-13b-base",
    "web": "talkie-web-13b-base",
}
MODEL_KEYS = {model_id: key for key, model_id in MODEL_IDS.items()}
MAX_CONTEXT_CHARS = 48_000


class TalkieCompletionRuntime:
    """The subset of the shared generation protocol needed for base decoding."""

    def __init__(self, talkie: Any, *, revision: str) -> None:
        self.talkie = talkie
        self.native_model = talkie.model
        self.tokenizer = TalkieTokenizerAdapter(talkie.tokenizer)
        self.device = talkie.device
        self.eos_token_ids = {self.tokenizer.eos_token_id}
        self.revision = revision

    @classmethod
    def load(
        cls,
        model_id: str,
        *,
        cache_dir: str | None = None,
    ) -> TalkieCompletionRuntime:
        checkpoint_path, _ = get_model_files(model_id, cache_dir=cache_dir)
        talkie = load_talkie_memory_efficient(
            model_id,
            device="cuda",
            cache_dir=cache_dir,
        )
        return cls(talkie, revision=checkpoint_path.parent.name)

    def encode_prompt(self, prompt: str, *, chat: bool = False) -> torch.Tensor:
        del chat
        token_ids = self.tokenizer.encode(prompt)
        if not token_ids:
            raise ValueError("prompt produced no tokens")
        return torch.tensor([token_ids], dtype=torch.long, device=self.device)

    @torch.inference_mode()
    def begin_generation(
        self,
        prompt: str,
        *,
        chat: bool = False,
    ) -> TalkieGenerationState:
        input_ids = self.encode_prompt(prompt, chat=chat)
        logits, cache, _ = forward_with_cache(self.native_model, input_ids)
        return TalkieGenerationState(cache=cache, next_logits=logits[0])

    @torch.inference_mode()
    def advance_generation(
        self,
        state: TalkieGenerationState,
        token_id: int,
    ) -> None:
        token = torch.tensor([[token_id]], dtype=torch.long, device=self.device)
        logits, cache, _ = forward_with_cache(self.native_model, token, state.cache)
        state.cache = cache
        state.next_logits = logits[0]


class CompletionRequest(BaseModel):
    """Supported subset of the OpenAI legacy completions request."""

    model: str
    prompt: str | list[str]
    max_tokens: int = Field(default=16, ge=1, le=512)
    temperature: float = Field(default=0.8, gt=0, le=2.0)
    top_p: float = Field(default=0.95, gt=0, le=1.0)
    top_k: int = Field(default=40, ge=1, le=256)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    seed: int = Field(default=7, ge=0, le=2**63 - 1)
    stop: str | list[str] | None = None
    n: int = Field(default=1, ge=1, le=8)
    echo: bool = False
    stream: bool = False
    logprobs: int | None = Field(default=None, ge=0, le=20)


app = FastAPI(
    title="Glitchloom Talkie Completions",
    version="0.1.1",
    description="OpenAI-compatible raw completions for vintage and web Talkie.",
)
_runtimes: dict[str, TalkieCompletionRuntime] = {}
_load_lock = asyncio.Lock()
_generation_lock = asyncio.Lock()


def _resolve_model(value: str) -> tuple[str, str]:
    if value in MODEL_IDS:
        return value, MODEL_IDS[value]
    if value in MODEL_KEYS:
        return MODEL_KEYS[value], value
    choices = ", ".join([*MODEL_IDS, *MODEL_KEYS])
    raise HTTPException(status_code=404, detail=f"Unknown model {value!r}; choose from {choices}.")


def _load_runtime_sync(key: str) -> TalkieCompletionRuntime:
    model_id = MODEL_IDS[key]
    LOGGER.info("loading %s (%s)", key, model_id)
    runtime = TalkieCompletionRuntime.load(
        model_id,
        cache_dir=os.getenv("TALKIE_CACHE_DIR"),
    )
    gc.collect()
    torch.cuda.empty_cache()
    LOGGER.info(
        "%s ready; %.2f GiB allocated",
        key,
        torch.cuda.memory_allocated() / 2**30,
    )
    return runtime


async def runtime_for(key: str) -> TalkieCompletionRuntime:
    if key in _runtimes:
        return _runtimes[key]
    async with _load_lock:
        if key not in _runtimes:
            _runtimes[key] = await asyncio.to_thread(_load_runtime_sync, key)
    return _runtimes[key]


def _stop_strings(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    values = [value] if isinstance(value, str) else value
    return [item for item in values if item]


def _truncate_at_stop(text: str, stops: list[str]) -> tuple[str, bool]:
    matches = [text.find(stop) for stop in stops if stop in text]
    if not matches:
        return text, False
    return text[: min(matches)], True


def _validate_request(request: CompletionRequest) -> None:
    prompts = [request.prompt] if isinstance(request.prompt, str) else request.prompt
    if not prompts:
        raise HTTPException(status_code=422, detail="prompt list cannot be empty")
    if any(not prompt for prompt in prompts):
        raise HTTPException(status_code=422, detail="prompts cannot be empty")
    if any(len(prompt) > MAX_CONTEXT_CHARS for prompt in prompts):
        raise HTTPException(
            status_code=422,
            detail=f"prompts are limited to {MAX_CONTEXT_CHARS} characters",
        )
    if request.stream:
        raise HTTPException(status_code=400, detail="streaming is not implemented")
    if request.logprobs is not None:
        raise HTTPException(status_code=400, detail="logprobs are not implemented")
    if request.frequency_penalty:
        raise HTTPException(status_code=400, detail="frequency_penalty is not implemented")


@app.get("/")
def index() -> dict[str, Any]:
    return {
        "name": "Glitchloom Talkie Completions",
        "models": list(MODEL_IDS.values()),
        "routes": ["/v1/models", "/v1/completions", "/health"],
    }


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "loaded": sorted(_runtimes),
        "expected": sorted(MODEL_IDS),
        "cuda_allocated_gib": round(torch.cuda.memory_allocated() / 2**30, 3),
        "revisions": {
            key: runtime.revision for key, runtime in sorted(_runtimes.items())
        },
        "mode": "base-completions",
    }


@app.get("/v1/models")
def models() -> dict[str, Any]:
    created = int(time.time())
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": created,
                "owned_by": "talkie",
                "loaded": key in _runtimes,
                "aliases": [key],
                "revision": _runtimes[key].revision if key in _runtimes else None,
            }
            for key, model_id in MODEL_IDS.items()
        ],
    }


@app.post("/v1/completions")
async def completions(request: CompletionRequest) -> dict[str, Any]:
    _validate_request(request)
    key, model_id = _resolve_model(request.model)
    runtime = await runtime_for(key)
    prompts = [request.prompt] if isinstance(request.prompt, str) else request.prompt
    stops = _stop_strings(request.stop)
    config_base = {
        "max_new_tokens": request.max_tokens,
        "attempts": 1,
        "temperature": request.temperature,
        "top_k": request.top_k,
        "top_p": request.top_p,
        "presence_penalty": request.presence_penalty,
        "ban_anchor_words": False,
        "use_cache": True,
    }

    choices: list[dict[str, Any]] = []
    prompt_tokens = 0
    completion_tokens = 0
    started = time.perf_counter()
    async with _generation_lock:
        for prompt_index, prompt in enumerate(prompts):
            prompt_token_count = len(runtime.tokenizer.encode(prompt))
            for sample_index in range(request.n):
                seed = (request.seed + prompt_index * request.n + sample_index) & (
                    (1 << 63) - 1
                )
                config = GenerationConfig(seed=seed, **config_base)
                result = await asyncio.to_thread(
                    generate,
                    runtime,
                    prompt,
                    config,
                    conditioned=False,
                    chat=False,
                )
                completion, hit_stop = _truncate_at_stop(result.text, stops)
                hit_eos = bool(
                    result.steps
                    and result.steps[-1].chosen_token_id in runtime.eos_token_ids
                )
                choices.append(
                    {
                        "text": f"{prompt}{completion}" if request.echo else completion,
                        "index": len(choices),
                        "logprobs": None,
                        "finish_reason": "stop" if hit_stop or hit_eos else "length",
                        "prompt_index": prompt_index,
                        "seed": seed,
                    }
                )
                prompt_tokens += prompt_token_count
                completion_tokens += len(result.steps)

    return {
        "id": f"cmpl-{uuid.uuid4().hex}",
        "object": "text_completion",
        "created": int(time.time()),
        "model": model_id,
        "model_revision": runtime.revision,
        "choices": choices,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        "system_fingerprint": f"talkie-native-base-{runtime.revision[:12]}",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
