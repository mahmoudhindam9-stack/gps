-- ============================================================================
-- Migration 003: Customer Device Guard Trigger, Full RLS Enforcement & Schema Registry
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

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

-- Policies for `bootstrap_state`
DROP POLICY IF EXISTS rls_bootstrap_state_admin ON public.bootstrap_state;
CREATE POLICY rls_bootstrap_state_admin ON public.bootstrap_state
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `device_profiles`
DROP POLICY IF EXISTS rls_device_profiles_select ON public.device_profiles;
CREATE POLICY rls_device_profiles_select ON public.device_profiles
    FOR SELECT
    USING (public.request_user_id() IS NOT NULL);

DROP POLICY IF EXISTS rls_device_profiles_admin_write ON public.device_profiles;
CREATE POLICY rls_device_profiles_admin_write ON public.device_profiles
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

-- Policies for `devices`
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

-- Forward-Only Schema Migration Registry
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_schema_migrations_admin_select ON public.schema_migrations;
DROP POLICY IF EXISTS rls_schema_migrations_admin_all ON public.schema_migrations;
CREATE POLICY rls_schema_migrations_admin_all ON public.schema_migrations
    FOR ALL
    USING (public.request_user_role() = 'ADMIN')
    WITH CHECK (public.request_user_role() = 'ADMIN');

GRANT SELECT, INSERT, UPDATE ON TABLE public.schema_migrations TO authenticated, service_role;
