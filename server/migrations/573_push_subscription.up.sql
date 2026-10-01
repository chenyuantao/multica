-- Devices that receive inbox notifications while no Multica client is
-- connected. Account-level: one device serves every workspace of its user.
--
-- `token` is the provider's address for the device: the Web Push endpoint URL
-- for 'webpush', the registration id for 'jpush'. Web Push additionally needs
-- the subscription's encryption keys.
--
-- No foreign key to user: subscriptions are removed by their owner or when
-- the push provider reports them gone.
CREATE TABLE IF NOT EXISTS push_subscription (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL,
    platform     TEXT        NOT NULL CHECK (platform IN ('webpush', 'jpush')),
    token        TEXT        NOT NULL,
    p256dh       TEXT        NOT NULL DEFAULT '',
    auth         TEXT        NOT NULL DEFAULT '',
    user_agent   TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
