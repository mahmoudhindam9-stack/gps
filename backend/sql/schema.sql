-- ============================================================================
-- VeloTrack GPS — Supabase PostgreSQL Business Schema & RLS Policies
-- Linked to Supabase Auth (`auth.users`) and strictly separated from Traccar (`tc_*`).
-- ============================================================================

-- Built-in gen_random_uuid() is native in PostgreSQL 13+ / Supabase PostgreSQL

-- Ensure `auth.users` and `authenticated` role exist for standalone migration validation
-- (No-op on a live Supabase PostgreSQL instance where `auth.users` and `authenticated` exist)
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    encrypted_password TEXT,
    email_confirmed_at TIMESTAMPTZ,
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT SELECT, REFERENCES ON TABLE auth.users TO authenticated;
GRANT ALL PRIVILEGES ON TABLE auth.users TO service_role;

-- Helper functions reading per-transaction JWT claims set by Supabase / VeloTrack Backend
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

-- 1. Permanent User Profile Table linked to Supabase `auth.users`
CREATE TABLE IF NOT EXISTS public.users_profile (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(64) UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_profile_username ON public.users_profile (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_profile_email ON public.users_profile (LOWER(email));

-- 2. One-Time Administrator Bootstrap State Lock
CREATE TABLE IF NOT EXISTS public.bootstrap_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    admin_bootstrapped BOOLEAN NOT NULL DEFAULT FALSE,
    admin_user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    bootstrapped_at TIMESTAMPTZ
);

INSERT INTO public.bootstrap_state (id, admin_bootstrapped)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 3. Versioned SMS Server Activation Profile Registry
-- Rules:
--   - Zero APN fields or commands.
--   - Zero automatic TIMER modification during activation.
--   - Profiles default to is_verified = FALSE until tested on physical hardware.
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

-- 4. Devices Table (Correlated to Traccar by IMEI and traccar_device_id)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imei VARCHAR(15) NOT NULL UNIQUE CHECK (imei ~ '^[0-9]{15}$'),
    traccar_device_id BIGINT NOT NULL UNIQUE,
    profile_id UUID NOT NULL REFERENCES public.device_profiles(id) ON DELETE RESTRICT,
    current_customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    vehicle_name VARCHAR(120) NOT NULL,
    plate_number VARCHAR(32) NOT NULL,
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

-- 5. Activation SMS Audit Logs
CREATE TABLE IF NOT EXISTS public.activation_sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    step_order SMALLINT NOT NULL,
    command_key VARCHAR(32) NOT NULL CHECK (command_key IN ('SERVER', 'GPRSON', 'OPTIONAL_TIMER')),
    command_text TEXT NOT NULL,
    gateway_message_id VARCHAR(128),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'REPLIED', 'FAILED', 'TIMED_OUT')),
    device_reply TEXT,
    failure_reason TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_device ON public.activation_sms_logs(device_id, step_order);
CREATE INDEX IF NOT EXISTS idx_sms_logs_gateway_msg ON public.activation_sms_logs(gateway_message_id);

-- 6. Per-Device Subscriptions
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

-- 7. Subscription Audit History
CREATE TABLE IF NOT EXISTS public.subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    action_type VARCHAR(32) NOT NULL
        CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'EXPIRED')),
    plan_duration VARCHAR(16) NOT NULL,
    actor_user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_history_device ON public.subscription_history(device_id, created_at DESC);

-- 8. Device Ownership Reassignment History
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

-- Grant table permissions to `authenticated` and `service_role` (governed by RLS below)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- ============================================================================
-- Row-Level Security (RLS) Policies across ALL Business Tables
-- ============================================================================

ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users_profile FORCE ROW LEVEL SECURITY;

ALTER TABLE public.bootstrap_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootstrap_state FORCE ROW LEVEL SECURITY;

ALTER TABLE public.device_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.activation_sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_sms_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history FORCE ROW LEVEL SECURITY;

ALTER TABLE public.device_ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_ownership_history FORCE ROW LEVEL SECURITY;

-- Policies for `users_profile`
DROP POLICY IF EXISTS rls_users_profile_select ON public.users_profile;
CREATE POLICY rls_users_profile_select ON public.users_profile
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_users_profile_modify ON public.users_profile;
CREATE POLICY rls_users_profile_modify ON public.users_profile
    FOR ALL
    USING (
        public.request_user_role() = 'ADMIN'
        OR id = public.request_user_id()
    )
    WITH CHECK (
        public.request_user_role() = 'ADMIN'
        OR id = public.request_user_id()
    );

-- Policies for `bootstrap_state` (Admin only)
DROP POLICY IF EXISTS rls_bootstrap_state_admin ON public.bootstrap_state;
CREATE POLICY rls_bootstrap_state_admin ON public.bootstrap_state
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `device_profiles` (Readable by authenticated users, writable by ADMIN only)
DROP POLICY IF EXISTS rls_device_profiles_select ON public.device_profiles;
CREATE POLICY rls_device_profiles_select ON public.device_profiles
    FOR SELECT
    USING (public.request_user_id() IS NOT NULL);

DROP POLICY IF EXISTS rls_device_profiles_admin_write ON public.device_profiles;
CREATE POLICY rls_device_profiles_admin_write ON public.device_profiles
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `devices` (Strict tenant isolation for CUSTOMER, full access for ADMIN)
DROP POLICY IF EXISTS rls_devices_select ON public.devices;
CREATE POLICY rls_devices_select ON public.devices
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR current_customer_id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_devices_admin_write ON public.devices;
CREATE POLICY rls_devices_admin_write ON public.devices
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `activation_sms_logs`
DROP POLICY IF EXISTS rls_sms_logs_select ON public.activation_sms_logs;
CREATE POLICY rls_sms_logs_select ON public.activation_sms_logs
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR EXISTS (
            SELECT 1 FROM public.devices d
            WHERE d.id = activation_sms_logs.device_id
              AND d.current_customer_id = public.request_user_id()
        )
    );

DROP POLICY IF EXISTS rls_sms_logs_admin_write ON public.activation_sms_logs;
CREATE POLICY rls_sms_logs_admin_write ON public.activation_sms_logs
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `subscriptions`
DROP POLICY IF EXISTS rls_subscriptions_select ON public.subscriptions;
CREATE POLICY rls_subscriptions_select ON public.subscriptions
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR customer_id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_subscriptions_admin_write ON public.subscriptions;
CREATE POLICY rls_subscriptions_admin_write ON public.subscriptions
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `subscription_history`
DROP POLICY IF EXISTS rls_sub_history_select ON public.subscription_history;
CREATE POLICY rls_sub_history_select ON public.subscription_history
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR customer_id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_sub_history_admin_write ON public.subscription_history;
CREATE POLICY rls_sub_history_admin_write ON public.subscription_history
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `device_ownership_history`
DROP POLICY IF EXISTS rls_ownership_history_select ON public.device_ownership_history;
CREATE POLICY rls_ownership_history_select ON public.device_ownership_history
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR new_customer_id = public.request_user_id()
        OR previous_customer_id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_ownership_history_admin_write ON public.device_ownership_history;
CREATE POLICY rls_ownership_history_admin_write ON public.device_ownership_history
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- ============================================================================
-- Surgical Data Cleanup of Known Demo / Seeded Artifacts
-- Removes only known fake prototype records while preserving legitimate data.
-- ============================================================================
DELETE FROM public.activation_sms_logs
WHERE gateway_message_id LIKE 'GSM-EG-%';
