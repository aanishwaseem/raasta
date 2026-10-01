# Raasta AI service

FastAPI service used by the NestJS backend. The backend works without it (every call has a timeout and a local fallback);
this service adds learned corrections and the multilingual assistant NLU.

| Endpoint | What it does | Needs a trained model? |
|---|---|---|
| `POST /v1/eta/predict` | ETA correction on the routing provider's estimate | No. With no model it returns the provider ETA, flagged `fallback: true` |
| `POST /v1/matching/rank` | Explainable driver scoring (parity-tested against the TypeScript scorer) | No. A cancellation model, if active, refines one component |
| `POST /v1/demand/forecast` | Next-hour requests per zone + HIGH/MEDIUM/LOW | No. Persistence, then seasonal, then model |
| `POST /v1/nlu/parse` | Intent + slots for English / Roman Urdu / Urdu script | No (rules). Optional Claude path |
| `POST /v1/fraud/score` | Rule-based risk level, internal only | No (rules) |
| `GET /v1/models`, `POST /v1/models/reload`, `POST /v1/training/run` | Registry and training | - |

All `/v1/*` calls need the `x-internal-token` header (`AI_INTERNAL_TOKEN`; required in production).

## Run
```bash
pip install -r requirements.txt
AI_INTERNAL_TOKEN=change-me uvicorn app.main:app --port 8000
python -m pytest            # 60 tests
```

## Training
```bash
DATABASE_URL=postgres://... python -m pipeline.run                # real data only; skips a model if there is too little
DATABASE_URL=... python -m pipeline.run --synthetic               # DEV ONLY: simulated data, registered with trained_on_synthetic=true
```
* Rides flagged `is_test_data` are excluded from every extractor.
* Time-based split (last 20% held out). Metrics are computed on the holdout and compared with the baseline on the same rows.
* A model is registered `CANDIDATE` only if it beats the baseline by >= 1% on its primary metric, otherwise `REJECTED`.
  Nothing is ever activated automatically; an admin activates a version in the dashboard, which calls `/v1/models/reload`.
* `--synthetic` is refused when `NODE_ENV=production`.

## Optional LLM for NLU
`LLM_NLU_ENABLED=true` and `ANTHROPIC_API_KEY=...` make Claude parse requests through a forced tool call with a strict schema.
Output that fails validation, errors, or times out (3.5 s) falls back to the rules. **The live API path is untested here
(no key was available); only its validation and fallback logic has tests.**

## What the NLU numbers mean
`tests/data/nlu_cases.json` is a regression suite written by the same author as the rules, so its accuracy measures
consistency, not real-world performance. Before the 24 "unseen" phrasings were added to it, the parser fully matched
17 of them (intent + pickup + dropoff), about 71%. Expect real users to hit gaps; treat low-confidence parses as "ask again".
