DELETE FROM push_subscription WHERE platform = 'oppo';

ALTER TABLE push_subscription DROP CONSTRAINT IF EXISTS push_subscription_platform_check;

ALTER TABLE push_subscription ADD CONSTRAINT push_subscription_platform_check
    CHECK (platform IN ('webpush', 'jpush'));
