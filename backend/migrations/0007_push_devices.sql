-- Device push tokens (FCM/APNs via FCM). One row per token; a token moves to whichever user registered it last.
CREATE TABLE push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('android','ios','web')),
  token        text NOT NULL UNIQUE,
  device_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_devices_user ON push_devices (user_id);
