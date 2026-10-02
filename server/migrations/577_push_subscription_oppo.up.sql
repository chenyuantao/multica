-- Allow OPPO Quick App push registrations alongside webpush / jpush.
ALTER TABLE push_subscription DROP CONSTRAINT IF EXISTS push_subscription_platform_check;

ALTER TABLE push_subscription ADD CONSTRAINT push_subscription_platform_check
    CHECK (platform IN ('webpush', 'jpush', 'oppo'));
