# AI / ML Architecture

## 1. Principle: the right tool per problem

| Problem | Technique | Where |
|---|---|---|
| Conversational assistant, voice intent extraction, support triage | Rule-based multilingual NLU; **optional** LLM (Claude) for NLU only. Replies are rendered from templates filled with **verified backend data**. | `ai-service/app/nlu`, `backend/modules/ai/assistant` |
| ETA prediction | Statistical baseline → gradient boosting regressor | `ai-service/app/models/eta.py` |
| Demand prediction | Seasonal (zone × hour-of-week) smoothed baseline → gradient boosting | `ai-service/app/models/demand.py` |
| Cancellation prediction | Bayesian-smoothed driver rate → logistic regression | `ai-service/app/models/cancellation.py` |
| Matching | Explainable weighted scoring (components can be swapped for ML) | `ai-service/app/models/matching.py` + TS mirror |
| Fraud | Deterministic rules → (later) gradient boosting | `backend/modules/fraud`, `ai-service/app/models/fraud.py` |
| Route deviation, proximity, geofencing, carpool compatibility | Geospatial algorithms (point-to-polyline distance, bearings, detour ratio) | `backend/src/common/geo`, `modules/safety`, `modules/carpool` |
| Safety triggers, auth, payment validation, compliance | Rules | backend modules |

No deep learning is used. Nothing here needs it yet, and the data does not exist yet.

## 2. Cold start (the platform launches with no history)

| Phase | Behaviour |
|---|---|
| 1. Launch | Every predictor serves its **baseline** (rules/statistics). The AI service works with no model artifacts. |
| 2. Collect | Every prediction is logged to `ai_predictions` with features, and the **actual** is attached when known (pickup arrival, trip completion, offer response). |
| 3. Train | `POST /admin/ai/train` (or `python -m pipeline.run`) extracts → validates → builds features → trains → evaluates on a time-based holdout **against the baseline** → registers a version. |
| 4. Promote / A/B | A version becomes `ACTIVE` only if it beats the baseline on the holdout metric **and** an admin activates it. (A/B routing of a traffic share to a candidate is **not implemented**; online error of the active model is compared through `ai_predictions`.) |

The development seed creates synthetic historical rides so the pipeline can be exercised end to end. Models trained
on that data are registered with `trained_on_synthetic = true`, and the admin UI labels them so. **Their metrics say
nothing about real-world accuracy and must not be quoted as such.**

## 3. Feature cards

### ETA prediction (pickup and trip)
| | |
|---|---|
| Input | provider (routing) duration, distance, hour, weekday, city, pickup zone, product/vehicle class, kind (PICKUP/TRIP) |
| Output | `eta_s`, model name/version, `fallback` flag |
| Metric | MAE (seconds), MAPE. Tracked online from `ai_predictions` (predicted vs actual). |
| Baseline | provider duration × learned hour-of-week congestion ratio (median actual/provider per hour bucket, shrunk toward 1.0 with few samples). With zero data the ratio is 1.0, which means the provider ETA. |
| Model | `GradientBoostingRegressor` on the residual ratio |
| Fallback | baseline, and if the AI service is unreachable, provider ETA in the backend |

### Demand prediction
| | |
|---|---|
| Input | zone, target hour-of-week, recent requests (last 1 h), recent online drivers, city |
| Output | expected requests next hour, level HIGH/MEDIUM/LOW (relative to the city's zone distribution), supply gap |
| Metric | MAE on hourly zone counts, plus level accuracy |
| Baseline | smoothed seasonal mean (zone × hour-of-week), blended with recent-hour persistence. With no history it uses persistence only. |
| Model | `HistGradientBoostingRegressor` (Poisson loss) on lagged/seasonal features |
| Fallback | persistence of the last hour's request count |

### Cancellation probability (driver-side, per candidate)
| | |
|---|---|
| Input | driver offers/accepts/assigned/cancellations, pickup distance, pickup ETA, hour, product, trip distance |
| Output | probability the driver cancels after accepting |
| Metric | log-loss, AUC, calibration |
| Baseline | Beta(2, 18) smoothed driver cancellation rate (prior mean 10%), adjusted by pickup distance |
| Model | Logistic regression |
| Fallback | baseline (also mirrored in TypeScript) |

### Matching rank
| | |
|---|---|
| Input | candidates with distance, pickup ETA, acceptance rate, completion rate, cancellation probability, rating, route compatibility, preference matches, vehicle fit |
| Output | ordered candidates with score in [0,1], per-component contribution, and human-readable reasons |
| Metric | offline: accept-after-offer rate and completion rate of the top-ranked candidate. Online: match rate, time-to-match, post-accept cancellation. |
| Baseline | nearest-driver ranking. We compare against it in replay. |
| Model | weighted sum of normalized components. Weights come from `matching_weights.json` (versioned) and can be A/B tested. Each component can be replaced by a learned model (cancellation already is). |
| Fallback | identical TypeScript implementation inside the backend |

Default weights: pickup ETA 0.30 · reliability (1 − cancel prob) 0.25 · acceptance 0.10 · completion 0.10 · rating 0.10 ·
route/destination compatibility 0.05 · preference match 0.05 · distance 0.05. With the prompt's example
(A: 1 km, 4 min, 15% cancel · B: 1.6 km, 5 min, 2% cancel), B wins. A unit test asserts this.

### Fare intelligence (backend, statistical)
| | |
|---|---|
| Input | distance, duration, product pricing config, hour, zone demand (live requests vs online supply in Redis + forecast), historical accepted fares for the zone/product, fuel cost per km |
| Output | `estimated` (config formula), `recommended` (with capped, disclosed demand adjustment), `minimumReasonable` (floor that still covers the driver's fuel cost and has a historical acceptance chance), `low/high` range, `expectedMatchSeconds` for recommended vs minimum, explanation strings |
| Metric | offer acceptance rate by offer/recommended ratio, time-to-match |
| Baseline | config formula × demand adjustment clamp(1 + 0.25·(demand/supply − 1), 1, max_surge) |
| Fallback | config formula without adjustment |
| Guardrails | multiplier capped per city config. The explanation is always returned. There are no hidden fees, and the final fare equals the agreed fare minus discounts. |

### Fraud risk (internal only)
| | |
|---|---|
| Input | account age, device reuse across accounts, cancellations 24 h, promo/referral redemptions sharing a device, payment failures 24 h, GPS-jump count |
| Output | LOW/MEDIUM/HIGH + score + reasons, written to `fraud_events` for admin review |
| Metric | precision of admin-actioned events (actioned / reviewed) |
| Baseline/Model | deterministic weighted rules now. A gradient boosting model is planned once labelled reviews exist. |
| Fallback | backend-side rules (the AI call is only for aggregation) |
| Guardrail | Never shown to users. Never auto-suspends: an admin must action it. |

### Voice / assistant NLU
| | |
|---|---|
| Input | transcript (device speech-to-text or typed), locale, current time + timezone, known places |
| Output | intent (`BOOK_RIDE`, `SCHEDULE_RIDE`, `BOOK_USUAL`, `QUOTE`, `CHEAPEST`, `FASTEST`, `RIDE_STATUS`, `WHY_FARE`, `CANCEL_RIDE`, `RIDE_HISTORY`, `SAFETY_HELP`, `SUPPORT`, `UNKNOWN`), slots, language (en/ur/roman-ur), confidence, missing slots |
| Metric | intent accuracy and slot F1 on the labelled test set in `ai-service/tests/data/nlu_cases.json` |
| Baseline | rule/lexicon parser (Roman Urdu: *se … jana hai*, *kal subah 8 baje*, and similar. Urdu script: *سے … جانا ہے*, *کل صبح ۸ بجے*.) |
| Model | optional LLM (Anthropic Claude via `ANTHROPIC_API_KEY`) with a strict JSON schema. The output is validated, and on any failure the rules are used. |
| Guardrail | The NLU never books anything. The backend turns a parse into a **pending action** that needs explicit confirmation. Ambiguous or missing slots make the system ask a question, never guess. |

### Predictive booking (routine mining, backend)
Rides from the last 8 weeks are clustered by (pickup ~250 m grid, dropoff ~250 m grid, weekday class, 30-min time bucket).
A cluster with ≥ 3 occurrences on ≥ 2 distinct days becomes a routine with a confidence and a next occurrence. It is shown as
"Your usual trip to University? Book for 7:30 AM", and the button only opens a pre-filled quote. It respects
`personalization_enabled`, and `DELETE /me/personalization` wipes the profile.

## 4. Data pipeline

```
raw events (rides, ride_events, ride_requests, ride_locations, ai_predictions, demand_snapshots)
  → extract.py      (SQL, time-windowed, excludes cancelled-before-match noise)
  → validate.py     (schema, ranges, null rates, leakage checks; fails loudly)
  → features.py     (deterministic, shared with online inference)
  → train.py        (time-based split: last 20% as holdout)
  → evaluate.py     (model vs baseline on the same holdout)
  → registry.py     (artifact joblib + metadata json; row in model_versions)
  → serve           (AI service loads ACTIVE versions at startup / on /v1/models/reload)
  → monitor         (backend /admin/ai/monitoring: online MAE, latency p50/p95, fallback rate, usage by version)
```

Model metadata stored: `model_name, version, algorithm, training_date, features, metrics, baseline_metrics,
dataset_version (hash of extract query + row ids range), dataset_rows, trained_on_synthetic, status, artifact_uri`.

## 5. Explainability & human override
- Matching stores the full per-component breakdown in `ride_requests.score_breakdown`, visible to admins.
- The fare quote returns `explanation[]` (for example "Demand near Gulberg is higher than usual (+12%)").
- Copilot recommendations cite their inputs ("Forecast: ~14 requests next hour in Gulberg vs 5 drivers nearby").
- Passenger-facing driver info uses factual badges only (Verified, High completion reliability ≥ 95% over ≥ 20 trips,
  Consistently rated ≥ 4.7 over ≥ 20 ratings). The internal reliability score is never exposed.
- Humans stay in control: bookings need confirmation, fraud only produces review items, safety anomalies ask the passenger, and admins
  can cancel rides, resolve safety events, and suspend or reinstate users. All of this is audited.
