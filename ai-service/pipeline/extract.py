"""Training-data extraction from Postgres. Rows flagged is_test_data (seeded accounts, simulated rides) are EXCLUDED:
their timings are not real-world observations."""
from __future__ import annotations

from typing import Any

import pandas as pd

AVG_PICKUP_SPEED_MPS = 6  # must match backend matching.service.ts (provider pickup ETA = distance*1.3/6 + 30)


def _conn(url: str):
    import psycopg

    return psycopg.connect(url, connect_timeout=5)


def _query(url: str, sql: str, params: tuple = ()) -> pd.DataFrame:
    with _conn(url) as conn:
        cur = conn.execute(sql, params)
        cols = [c.name for c in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def extract_eta(url: str) -> pd.DataFrame:
    trips = _query(
        url,
        """SELECT r.started_at AS ts, 'TRIP' AS kind, r.product_code AS vehicle_class, r.est_distance_m::float AS distance_m,
                  r.est_duration_s::float AS provider_duration_s,
                  EXTRACT(EPOCH FROM (r.completed_at - r.started_at))::float AS actual_s
             FROM rides r
            WHERE r.status = 'COMPLETED' AND NOT r.is_test_data AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL""",
    )
    pickups = _query(
        url,
        """SELECT r.assigned_at AS ts, 'PICKUP' AS kind, r.product_code AS vehicle_class, (rq.pickup_distance_m * 1.3)::float AS distance_m,
                  EXTRACT(EPOCH FROM (r.arrived_at - r.assigned_at))::float AS actual_s, rq.pickup_distance_m::float AS pd
             FROM rides r JOIN ride_requests rq ON rq.ride_id = r.id AND rq.driver_id = r.driver_id AND rq.status = 'ACCEPTED'
            WHERE NOT r.is_test_data AND r.assigned_at IS NOT NULL AND r.arrived_at IS NOT NULL AND r.status IN ('DRIVER_ARRIVED','IN_PROGRESS','COMPLETED')""",
    )
    if len(pickups):
        pickups["provider_duration_s"] = (pickups["distance_m"] / AVG_PICKUP_SPEED_MPS).round() + 30
        pickups = pickups.drop(columns=["pd"])
    df = pd.concat([trips, pickups], ignore_index=True)
    if df.empty:
        return df
    local = pd.to_datetime(df["ts"], utc=True).dt.tz_convert("Asia/Karachi")
    df["hour"] = local.dt.hour
    df["weekday"] = local.dt.dayofweek + 1
    df["ts"] = local.dt.tz_localize(None)
    return df.sort_values("ts").reset_index(drop=True)


def extract_demand(url: str) -> pd.DataFrame:
    df = _query(
        url,
        """SELECT z.code AS zone_code, date_trunc('hour', s.bucket_start AT TIME ZONE 'Asia/Karachi') AS ts,
                  SUM(s.requests)::int AS requests, GREATEST(1, ROUND(AVG(s.online_drivers)))::int AS online_drivers
             FROM demand_snapshots s JOIN demand_zones z ON z.id = s.zone_id
            GROUP BY 1, 2 ORDER BY 2""",
    )
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"])
    df["weekday"] = df["ts"].dt.dayofweek
    df["hour"] = df["ts"].dt.hour
    return df


def extract_cancellation(url: str) -> pd.DataFrame:
    """One row per accepted offer, with the driver's history *before* that offer (no leakage)."""
    df = _query(
        url,
        """SELECT rq.id, rq.driver_id, rq.sent_at AS ts, rq.status, rq.pickup_distance_m::float AS pickup_distance_m, rq.pickup_eta_s::float AS pickup_eta_s,
                  r.est_distance_m::float AS trip_distance_m,
                  EXISTS (SELECT 1 FROM ride_events e WHERE e.ride_id = rq.ride_id AND e.type = 'driver_cancelled' AND e.actor_id = rq.driver_id
                             AND e.created_at > rq.responded_at) AS cancelled
             FROM ride_requests rq JOIN rides r ON r.id = rq.ride_id
            WHERE NOT r.is_test_data ORDER BY rq.driver_id, rq.sent_at""",
    )
    if df.empty:
        return df
    df["accepted"] = (df["status"] == "ACCEPTED").astype(int)
    g = df.groupby("driver_id", sort=False)
    df["offers_received"] = g.cumcount()
    df["offers_accepted"] = g["accepted"].cumsum() - df["accepted"]
    df["trips_assigned"] = df["offers_accepted"]
    cancelled_accepted = (df["cancelled"] & (df["accepted"] == 1)).astype(int)
    df["driver_cancellations"] = cancelled_accepted.groupby(df["driver_id"], sort=False).cumsum() - cancelled_accepted
    local = pd.to_datetime(df["ts"], utc=True).dt.tz_convert("Asia/Karachi")
    df["hour"] = local.dt.hour
    df["ts"] = local.dt.tz_localize(None)
    out = df[df["accepted"] == 1].copy()
    out["cancelled"] = out["cancelled"].astype(int)
    return out.sort_values("ts").reset_index(drop=True)


EXTRACTORS: dict[str, Any] = {"eta": extract_eta, "demand": extract_demand, "cancellation": extract_cancellation}
