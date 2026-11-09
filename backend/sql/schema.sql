-- ============================================================================
-- VeloTrack GPS — Business Database Schema (PostgreSQL)
-- Strictly separated from Traccar's internal database (tc_* tables).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versioned SMS Server Activation Profile Registry
-- Rules:
--   1. Zero APN fields or commands.
--   2. Zero automatic TIMER modification during activation.
--   3. Profiles default to is_verified = FALSE until tested on physical hardware.
CREATE TABLE IF NOT EXISTS device_profiles (
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
    server_command_template TEXT NOT NULL,
    gprson_command_template TEXT,
    optional_timer_command_template TEXT,
    expected_reply_pattern TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (manufacturer, model, firmware_version)
);

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imei VARCHAR(15) NOT NULL UNIQUE CHECK (imei ~ '^[0-9]{15}$'),
    traccar_device_id BIGINT NOT NULL UNIQUE,
    profile_id UUID NOT NULL REFERENCES device_profiles(id),
    current_customer_id UUID NOT NULL REFERENCES users(id),
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

CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(current_customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_traccar_id ON devices(traccar_device_id);

CREATE TABLE IF NOT EXISTS activation_sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
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

CREATE INDEX IF NOT EXISTS idx_sms_logs_device ON activation_sms_logs(device_id, step_order);
CREATE INDEX IF NOT EXISTS idx_sms_logs_gateway_msg ON activation_sms_logs(gateway_message_id);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id),
    plan_duration VARCHAR(16) NOT NULL
        CHECK (plan_duration IN ('MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12', 'LIFETIME')),
    status VARCHAR(32) NOT NULL DEFAULT 'AWAITING_FIRST_CONNECTION'
        CHECK (status IN ('AWAITING_FIRST_CONNECTION', 'ACTIVE', 'EXPIRED', 'SUSPENDED')),
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    admin_override_by UUID REFERENCES users(id),
    admin_override_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id),
    action_type VARCHAR(32) NOT NULL
        CHECK (action_type IN ('PROVISIONED', 'STARTED_ON_1ST_CONNECTION', 'RENEWED', 'ADMIN_OVERRIDE', 'SUSPENDED', 'EXPIRED')),
    plan_duration VARCHAR(16) NOT NULL,
    actor_user_id UUID REFERENCES users(id),
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_history_device ON subscription_history(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS device_ownership_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    previous_customer_id UUID REFERENCES users(id),
    new_customer_id UUID NOT NULL REFERENCES users(id),
    reassigned_by_admin_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    reassigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_history_device ON device_ownership_history(device_id, reassigned_at DESC);

-- Row-Level Security (Defense-in-Depth alongside Backend Token Guards)
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_device_isolation ON devices
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) = 'ADMIN'
        OR current_customer_id::text = current_setting('app.current_user_id', true)
    );

CREATE POLICY tenant_subscription_isolation ON subscriptions
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) = 'ADMIN'
        OR customer_id::text = current_setting('app.current_user_id', true)
    );
