-- ============================================================================
-- Migration 002: Extended User Management, Vehicle Metadata & Device Commands
-- ============================================================================

ALTER TABLE public.users_profile ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users_profile ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.users_profile ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_profile_username ON public.users_profile (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_profile_email ON public.users_profile (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_profile_phone_active
    ON public.users_profile (phone)
    WHERE deleted_at IS NULL AND phone <> '';

ALTER TABLE public.device_profiles
    ADD COLUMN IF NOT EXISTS supported_commands JSONB NOT NULL DEFAULT '["positionSingle","engineStop","engineResume","custom"]'::jsonb;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(64);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(32) NOT NULL DEFAULT 'CAR';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS vehicle_icon VARCHAR(32) NOT NULL DEFAULT 'car';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_devices_serial ON public.devices(serial_number) WHERE serial_number IS NOT NULL;

ALTER TABLE public.activation_sms_logs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_logs_idempotency
    ON public.activation_sms_logs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_logs_device ON public.activation_sms_logs(device_id, step_order);
CREATE INDEX IF NOT EXISTS idx_sms_logs_gateway_msg ON public.activation_sms_logs(gateway_message_id);

ALTER TABLE public.subscription_history DROP CONSTRAINT IF EXISTS subscription_history_action_type_check;
ALTER TABLE public.subscription_history ADD CONSTRAINT subscription_history_action_type_check
    CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'RESUMED', 'EXPIRED'));

CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    traccar_device_id BIGINT NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    actor_role VARCHAR(16) NOT NULL CHECK (actor_role IN ('ADMIN', 'CUSTOMER')),
    command_type VARCHAR(64) NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    confirmed_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    traccar_response JSONB,
    status VARCHAR(24) NOT NULL CHECK (status IN ('SENT', 'QUEUED', 'DELIVERED', 'FAILED')),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_commands_device ON public.device_commands(device_id, created_at DESC);
