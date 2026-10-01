-- A device belongs to one account at a time; re-registering it under another
-- user moves it.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_push_subscription_platform_token
    ON push_subscription (platform, token);
