-- Serves "which devices should this inbox item go to".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscription_user
    ON push_subscription (user_id);
