-- ============================================================================
-- Migration 001: Initial Supabase PostgreSQL Business Schema & Tenant RLS
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    );
$$;

CREATE OR REPLACE FUNCTION public.request_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN current_user = 'service_role' THEN 'ADMIN'
        ELSE COALESCE(
            NULLIF(current_setting('request.jwt.claim.role', true), ''),
            (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_role'),
            'CUSTOMER'
        )
    END;
$$;

CREATE TABLE IF NOT EXISTS public.users_profile (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(64) UNIQUE,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(32) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bootstrap_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    admin_bootstrapped BOOLEAN NOT NULL DEFAULT FALSE,
    admin_user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    bootstrapped_at TIMESTAMPTZ
);

INSERT INTO public.bootstrap_state (id, admin_bootstrapped)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.device_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    firmware_version VARCHAR(64) NOT NULL,
    traccar_protocol VARCHAR(32) NOT NULL DEFAULT 'gt06',
    server_host VARCHAR(255) NOT NULL,
    server_port INTEGER NOT NULL DEFAULT 5023 CHECK (server_port BETWEEN 1 AND 65535),
    transport VARCHAR(8) NOT NULL DEFAULT 'TCP' CHECK (transport IN ('TCP', 'UDP')),
    server_mode VARCHAR(16) NOT NULL CHECK (server_mode IN ('DOMAIN', 'IP')),
    requires_device_password BOOLEAN NOT NULL DEFAULT FALSE,
    default_device_password VARCHAR(32),
    requires_gprson_command BOOLEAN NOT NULL DEFAULT FALSE,
    server_command_template TEXT NOT NULL CHECK (
        server_command_template !~* 'APN' AND server_command_template !~* 'TIMER'
    ),
    gprson_command_template TEXT,
    optional_timer_command_template TEXT,
    expected_reply_pattern TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (manufacturer, model, firmware_version)
);

CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imei VARCHAR(15) NOT NULL UNIQUE CHECK (imei ~ '^[0-9]{15}$'),
    traccar_device_id BIGINT NOT NULL UNIQUE,
    profile_id UUID NOT NULL REFERENCES public.device_profiles(id) ON DELETE RESTRICT,
    current_customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    vehicle_name VARCHAR(120) NOT NULL,
    plate_number VARCHAR(32) NOT NULL DEFAULT '',
    sim_local_number VARCHAR(11) NOT NULL,
    sim_e164_number VARCHAR(15) NOT NULL,
    activation_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (activation_status IN ('PENDING', 'SMS_SENT', 'WAITING_FOR_DEVICE', 'ACTIVATED', 'FAILED')),
    connection_state VARCHAR(24) NOT NULL DEFAULT 'OFFLINE'
        CHECK (connection_state IN ('OFFLINE', 'ONLINE_NO_FIX', 'ONLINE_GPS_FIX')),
    has_valid_fix BOOLEAN NOT NULL DEFAULT FALSE,
    last_lat DOUBLE PRECISION,
    last_lng DOUBLE PRECISION,
    last_speed_kmh REAL,
    last_heading REAL,
    ignition_on BOOLEAN,
    first_connected_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_customer ON public.devices(current_customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_traccar_id ON public.devices(traccar_device_id);

CREATE TABLE IF NOT EXISTS public.activation_sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    step_order SMALLINT NOT NULL,
    command_key VARCHAR(32) NOT NULL CHECK (command_key IN ('SERVER', 'GPRSON', 'OPTIONAL_TIMER')),
    command_text TEXT NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    gateway_message_id VARCHAR(128),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'REPLIED', 'FAILED', 'TIMED_OUT')),
    device_reply TEXT,
    failure_reason TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL UNIQUE REFERENCES public.devices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    plan_duration VARCHAR(16) NOT NULL
        CHECK (plan_duration IN ('MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12', 'LIFETIME')),
    status VARCHAR(32) NOT NULL DEFAULT 'AWAITING_FIRST_CONNECTION'
        CHECK (status IN ('AWAITING_FIRST_CONNECTION', 'ACTIVE', 'EXPIRED', 'SUSPENDED')),
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    admin_override_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    admin_override_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON public.subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS public.subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    action_type VARCHAR(32) NOT NULL
        CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'RESUMED', 'EXPIRED')),
    plan_duration VARCHAR(16) NOT NULL,
    actor_user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_history_device ON public.subscription_history(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.device_ownership_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    previous_customer_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    new_customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    reassigned_by_admin_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    reassigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_history_device ON public.device_ownership_history(device_id, reassigned_at DESC);
