-- ============================================================================
-- VeloTrack GPS — Supabase PostgreSQL Business Schema & RLS Policies
-- Linked to Supabase Auth (`auth.users`) and strictly separated from Traccar (`tc_*`).
-- Additive, forward-only migrations preserving all existing production records.
-- ============================================================================

-- Supabase owns the `auth` schema and its users table. Never create, alter, or grant
-- application access to `auth.users`; only reference its primary key from public profiles.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

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
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(32) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive migrations for existing `public.users_profile` installations
ALTER TABLE public.users_profile ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users_profile ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.users_profile ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_profile_username ON public.users_profile (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_profile_email ON public.users_profile (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_profile_phone_active
    ON public.users_profile (phone)
    WHERE deleted_at IS NULL AND phone <> '';

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
    supported_commands JSONB NOT NULL DEFAULT '["positionSingle","engineStop","engineResume","custom"]'::jsonb,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (manufacturer, model, firmware_version)
);

ALTER TABLE public.device_profiles
    ADD COLUMN IF NOT EXISTS supported_commands JSONB NOT NULL DEFAULT '["positionSingle","engineStop","engineResume","custom"]'::jsonb;

-- 4. Devices Table (Correlated to Traccar by IMEI and traccar_device_id)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imei VARCHAR(15) NOT NULL UNIQUE CHECK (imei ~ '^[0-9]{15}$'),
    serial_number VARCHAR(64),
    traccar_device_id BIGINT NOT NULL UNIQUE,
    profile_id UUID NOT NULL REFERENCES public.device_profiles(id) ON DELETE RESTRICT,
    current_customer_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    vehicle_name VARCHAR(120) NOT NULL,
    vehicle_type VARCHAR(32) NOT NULL DEFAULT 'CAR'
        CHECK (vehicle_type IN ('CAR', 'MOTORCYCLE', 'TRUCK', 'BUS', 'VAN', 'EQUIPMENT', 'OTHER')),
    vehicle_icon VARCHAR(32) NOT NULL DEFAULT 'car'
        CHECK (vehicle_icon IN ('car', 'suv', 'motorcycle', 'truck', 'bus', 'van', 'pickup', 'tractor')),
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive migrations for existing `public.devices` installations
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(64);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(32) NOT NULL DEFAULT 'CAR';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS vehicle_icon VARCHAR(32) NOT NULL DEFAULT 'car';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_devices_customer ON public.devices(current_customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_traccar_id ON public.devices(traccar_device_id);
CREATE INDEX IF NOT EXISTS idx_devices_serial ON public.devices(serial_number) WHERE serial_number IS NOT NULL;

-- 5. Activation SMS Audit Logs
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

ALTER TABLE public.activation_sms_logs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_logs_idempotency
    ON public.activation_sms_logs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
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
        CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'RESUMED', 'EXPIRED')),
    plan_duration VARCHAR(16) NOT NULL,
    actor_user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure existing constraint allows RESUMED
ALTER TABLE public.subscription_history DROP CONSTRAINT IF EXISTS subscription_history_action_type_check;
ALTER TABLE public.subscription_history ADD CONSTRAINT subscription_history_action_type_check
    CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'RESUMED', 'EXPIRED'));

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

-- 9. Audited Device Commands Table (Real Traccar Command Execution Records)
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

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands FORCE ROW LEVEL SECURITY;

-- Policies for `users_profile`
DROP POLICY IF EXISTS rls_users_profile_select ON public.users_profile;
CREATE POLICY rls_users_profile_select ON public.users_profile
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR id = public.request_user_id()
    );

DROP POLICY IF EXISTS rls_users_profile_modify ON public.users_profile;
DROP POLICY IF EXISTS rls_users_profile_admin_modify ON public.users_profile;
CREATE POLICY rls_users_profile_admin_modify ON public.users_profile
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

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
DROP POLICY IF EXISTS rls_devices_write ON public.devices;
DROP POLICY IF EXISTS rls_devices_admin_all ON public.devices;
DROP POLICY IF EXISTS rls_devices_customer_update ON public.devices;

CREATE POLICY rls_devices_admin_all ON public.devices
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Customers may update only their own presentation fields. The trigger below
-- prevents changing IMEI, ownership, Traccar IDs, SIM, profile, activation, or telemetry.
CREATE POLICY rls_devices_customer_update ON public.devices
    FOR UPDATE
    USING (current_customer_id = public.request_user_id())
    WITH CHECK (current_customer_id = public.request_user_id());

CREATE OR REPLACE FUNCTION public.guard_customer_device_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $guard$
BEGIN
    IF public.request_user_role() <> 'ADMIN' AND (
        NEW.imei IS DISTINCT FROM OLD.imei OR
        NEW.serial_number IS DISTINCT FROM OLD.serial_number OR
        NEW.traccar_device_id IS DISTINCT FROM OLD.traccar_device_id OR
        NEW.profile_id IS DISTINCT FROM OLD.profile_id OR
        NEW.current_customer_id IS DISTINCT FROM OLD.current_customer_id OR
        NEW.sim_local_number IS DISTINCT FROM OLD.sim_local_number OR
        NEW.sim_e164_number IS DISTINCT FROM OLD.sim_e164_number OR
        NEW.activation_status IS DISTINCT FROM OLD.activation_status OR
        NEW.connection_state IS DISTINCT FROM OLD.connection_state OR
        NEW.has_valid_fix IS DISTINCT FROM OLD.has_valid_fix OR
        NEW.last_lat IS DISTINCT FROM OLD.last_lat OR
        NEW.last_lng IS DISTINCT FROM OLD.last_lng OR
        NEW.last_speed_kmh IS DISTINCT FROM OLD.last_speed_kmh OR
        NEW.last_heading IS DISTINCT FROM OLD.last_heading OR
        NEW.ignition_on IS DISTINCT FROM OLD.ignition_on OR
        NEW.first_connected_at IS DISTINCT FROM OLD.first_connected_at OR
        NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'CUSTOMER_DEVICE_PROTECTED_FIELD_UPDATE'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guard_customer_device_updates ON public.devices;
CREATE TRIGGER trg_guard_customer_device_updates
    BEFORE UPDATE ON public.devices
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_customer_device_updates();

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

-- Policies for `device_commands`
DROP POLICY IF EXISTS rls_device_commands_select ON public.device_commands;
CREATE POLICY rls_device_commands_select ON public.device_commands
    FOR SELECT
    USING (
        public.request_user_role() = 'ADMIN'
        OR EXISTS (
            SELECT 1 FROM public.devices d
            WHERE d.id = device_commands.device_id
              AND d.current_customer_id = public.request_user_id()
        )
    );

DROP POLICY IF EXISTS rls_device_commands_insert ON public.device_commands;
CREATE POLICY rls_device_commands_insert ON public.device_commands
    FOR INSERT
    WITH CHECK (
        public.request_user_role() = 'ADMIN'
        OR (
            actor_user_id = public.request_user_id()
            AND EXISTS (
                SELECT 1 FROM public.devices d
                WHERE d.id = device_commands.device_id
                  AND d.current_customer_id = public.request_user_id()
            )
        )
    );
