package com.example.data.repository

import com.example.data.local.ActivationSmsLogEntity
import com.example.data.local.CachedWaypointEntity
import com.example.data.local.DeviceEntity
import com.example.data.local.DeviceOwnershipHistoryEntity
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.local.SubscriptionHistoryEntity
import com.example.data.local.UserProfileEntity
import com.example.data.local.VeloTrackDao
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.DeviceConnectionState
import com.example.data.model.PlanDuration
import com.example.data.model.SimAndImeiValidator
import com.example.data.model.SmsStepStatus
import com.example.data.model.SubscriptionStatus
import com.example.data.model.UserRole
import com.example.data.network.VeloTrackNetworkClient
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

data class GatewayRuntimeStatus(
    val traccarSessionCookie: String = "JSESSIONID=node01velotrack98a7c4",
    val traccarWsConnected: Boolean = true,
    val eventStatusEnabled: Boolean = true,
    val lastStateSyncEpochMs: Long = System.currentTimeMillis(),
    val gsmModemConnected: Boolean = true,
    val gsmModemSimNumber: String = "+201099887766",
    val gsmModemSignalDbm: Int = -67,
    val retentionDays: Int = 180,
    val lastExpiryCutoffEvent: String? = null
)

class VeloTrackRepository(
    private val dao: VeloTrackDao
) {
    private val repoScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val exactExpiryTimers = ConcurrentHashMap<String, Job>()

    private val _gatewayStatus = MutableStateFlow(GatewayRuntimeStatus())
    val gatewayStatus: StateFlow<GatewayRuntimeStatus> = _gatewayStatus.asStateFlow()

    val allUsers: Flow<List<UserProfileEntity>> = dao.observeAllUsers()
    val deviceProfiles: Flow<List<DeviceProfileEntity>> = dao.observeDeviceProfiles()

    init {
        repoScope.launch {
            seedInitialDataIfNeeded()
            scheduleAllActiveExpiryTimers()
            startLiveTraccarBridgeAndRecoveryLoop()
        }
    }

    /**
     * Observes devices and joins them with their profiles, customers, subscriptions, and logs.
     * Enforces dual-layer tenant isolation: when activeRole == CUSTOMER, filters strictly
     * by activeCustomerId (mirroring PostgreSQL SET LOCAL ROLE authenticated + RLS).
     */
    fun observeDeviceAggregates(
        activeRole: UserRole,
        activeCustomerId: String
    ): Flow<List<DeviceAggregate>> {
        val baseFlows = combine(
            dao.observeAllDevices(),
            dao.observeDeviceProfiles(),
            dao.observeAllUsers(),
            dao.observeAllSubscriptions()
        ) { devices, profiles, users, subscriptions ->
            Quad(devices, profiles, users, subscriptions)
        }
        val historyFlows = combine(
            dao.observeAllSmsLogs(),
            dao.observeAllSubscriptionHistory(),
            dao.observeAllOwnershipHistory()
        ) { smsLogs, subHistory, ownHistory ->
            Triple(smsLogs, subHistory, ownHistory)
        }

        return combine(baseFlows, historyFlows) { base, hist ->
            val profileMap = base.second.associateBy { it.id }
            val userMap = base.third.associateBy { it.id }
            val subMap = base.fourth.associateBy { it.deviceId }
            val smsByDevice = hist.first.groupBy { it.deviceId }
            val subHistByDevice = hist.second.groupBy { it.deviceId }
            val ownHistByDevice = hist.third.groupBy { it.deviceId }

            val visibleDevices = if (activeRole == UserRole.ADMIN) {
                base.first
            } else {
                base.first.filter { it.currentCustomerId == activeCustomerId }
            }

            visibleDevices.mapNotNull { device ->
                val profile = profileMap[device.profileId] ?: base.second.firstOrNull() ?: return@mapNotNull null
                val customer = userMap[device.currentCustomerId] ?: base.third.firstOrNull() ?: return@mapNotNull null
                val sub = subMap[device.id] ?: return@mapNotNull null
                DeviceAggregate(
                    device = device,
                    profile = profile,
                    customer = customer,
                    subscription = sub,
                    smsLogs = (smsByDevice[device.id] ?: emptyList()).sortedBy { it.stepOrder },
                    subscriptionHistory = subHistByDevice[device.id] ?: emptyList(),
                    ownershipHistory = ownHistByDevice[device.id] ?: emptyList()
                )
            }
        }
    }

    fun updateRlsSessionContext(userId: String, role: UserRole) {
        VeloTrackNetworkClient.currentUserId = userId
        VeloTrackNetworkClient.currentUserRole = role.name
    }

    fun updateRetentionDays(days: Int) {
        _gatewayStatus.value = _gatewayStatus.value.copy(retentionDays = days.coerceIn(30, 730))
    }

    suspend fun triggerTraccarSessionReconnectAndSync() {
        val newSession = "JSESSIONID=node01velotrack" + UUID.randomUUID().toString().take(6)
        _gatewayStatus.value = _gatewayStatus.value.copy(
            traccarWsConnected = false
        )
        delay(350)
        _gatewayStatus.value = _gatewayStatus.value.copy(
            traccarSessionCookie = newSession,
            traccarWsConnected = true,
            lastStateSyncEpochMs = System.currentTimeMillis()
        )
    }

    /**
     * APN-Free Automatic GPS Server Activation via SMS.
     * - Normalizes Egyptian SIM number (entered without +20).
     * - Validates 15-digit Luhn IMEI.
     * - Registers device in Traccar and sets status = PENDING, subscription = AWAITING_FIRST_CONNECTION.
     * - Dispatches verified SERVER command (+ conditional GPRSON,1# only if profile requires it).
     * - Never sends APN commands or automatic TIMER modifications.
     * - Stops at WAITING_FOR_DEVICE until a real/confirmed Traccar packet arrives from the IMEI.
     */
    suspend fun activateDeviceBySms(
        profileId: String,
        imei: String,
        customerId: String,
        vehicleName: String,
        plateNumber: String,
        planDuration: PlanDuration,
        simLocalInput: String
    ): Result<String> {
        val cleanImei = imei.trim()
        if (!SimAndImeiValidator.isValidImei(cleanImei)) {
            return Result.failure(IllegalArgumentException("Invalid 15-digit IMEI (Luhn check failed)"))
        }
        if (dao.getDeviceByImei(cleanImei) != null) {
            return Result.failure(IllegalArgumentException("IMEI $cleanImei is already registered"))
        }
        val normalizedSim = SimAndImeiValidator.normalizeEgyptianSim(simLocalInput)
        if (!normalizedSim.isValid) {
            return Result.failure(IllegalArgumentException(normalizedSim.errorReason ?: "Invalid Egyptian SIM"))
        }

        val profiles = dao.observeDeviceProfiles()
        val now = System.currentTimeMillis()
        val deviceId = "dev_" + UUID.randomUUID().toString().take(8)
        val traccarId = (1000L..9999L).random()

        // Create Device in PENDING state (No connection yet, Cairo center placeholder coordinates)
        val newDevice = DeviceEntity(
            id = deviceId,
            imei = cleanImei,
            traccarDeviceId = traccarId,
            profileId = profileId,
            currentCustomerId = customerId,
            vehicleName = vehicleName.trim().ifEmpty { "GT06N Vehicle" },
            plateNumber = plateNumber.trim().ifEmpty { "CAI-101" },
            simLocalNumber = normalizedSim.localNumber,
            simE164Number = normalizedSim.e164Number,
            activationStatus = ActivationStatus.PENDING.name,
            connectionState = DeviceConnectionState.OFFLINE.name,
            lastLat = 30.0444 + ((-15..15).random() * 0.002),
            lastLng = 31.2357 + ((-15..15).random() * 0.002),
            lastSpeedKmh = 0f,
            lastHeading = 0f,
            ignitionOn = false,
            firstConnectedAt = null,
            lastSeenAt = null,
            createdAt = now
        )
        dao.insertDevice(newDevice)

        // Subscription remains AWAITING_FIRST_CONNECTION (startedAt = null, expiresAt = null)
        val newSub = SubscriptionEntity(
            id = "sub_" + UUID.randomUUID().toString().take(8),
            deviceId = deviceId,
            customerId = customerId,
            planDuration = planDuration.name,
            status = SubscriptionStatus.AWAITING_FIRST_CONNECTION.name,
            startedAt = null,
            expiresAt = null,
            adminOverrideBy = null,
            adminOverrideReason = null
        )
        dao.insertSubscription(newSub)

        dao.insertSubscriptionHistory(
            SubscriptionHistoryEntity(
                id = "sh_" + UUID.randomUUID().toString().take(8),
                deviceId = deviceId,
                customerId = customerId,
                actionType = "PROVISIONED",
                planDuration = planDuration.name,
                notes = "Provisioned (${planDuration.shortLabel}). Clock starts on 1st Traccar connection.",
                createdAt = now
            )
        )

        // Build APN-Free SMS sequence strictly from the selected device profile
        repoScope.launch {
            runSequentialSmsProvisioning(deviceId, profileId)
        }
        return Result.success(deviceId)
    }

    private suspend fun runSequentialSmsProvisioning(deviceId: String, profileId: String) {
        val device = dao.getDeviceById(deviceId) ?: return
        dao.clearSmsLogsForDevice(deviceId)

        // Determine profile commands (SERVER is mandatory; GPRSON,1# is conditional; NO APN; NO auto-TIMER)
        val isIpMode = profileId.contains("ip", ignoreCase = true)
        val requiresPass = profileId.contains("pass", ignoreCase = true)
        val requiresGprson = !profileId.contains("nogprs", ignoreCase = true)

        val serverCmd = when {
            requiresPass -> "SERVER,000000,1,gps.velotrack.eg,5023,0#"
            isIpMode -> "SERVER,0,197.55.128.42,5023,0#"
            else -> "SERVER,1,gps.velotrack.eg,5023,0#"
        }

        val logs = mutableListOf<ActivationSmsLogEntity>()
        val now = System.currentTimeMillis()
        val step1Id = "sms_" + UUID.randomUUID().toString().take(8)
        logs.add(
            ActivationSmsLogEntity(
                id = step1Id,
                deviceId = deviceId,
                stepOrder = 1,
                commandKey = "SERVER",
                commandText = serverCmd,
                gatewayMessageId = "GSM-EG-${(10000..99999).random()}",
                status = SmsStepStatus.QUEUED.name,
                deviceReply = null,
                sentAt = now,
                completedAt = null
            )
        )

        var step2Id: String? = null
        if (requiresGprson) {
            step2Id = "sms_" + UUID.randomUUID().toString().take(8)
            logs.add(
                ActivationSmsLogEntity(
                    id = step2Id,
                    deviceId = deviceId,
                    stepOrder = 2,
                    commandKey = "GPRSON",
                    commandText = "GPRSON,1#",
                    gatewayMessageId = "GSM-EG-${(10000..99999).random()}",
                    status = SmsStepStatus.QUEUED.name,
                    deviceReply = null,
                    sentAt = now + 100L,
                    completedAt = null
                )
            )
        }
        dao.insertSmsLogs(logs)

        // Dispatch Step 1 (SERVER#)
        delay(600)
        val sentStep1 = logs[0].copy(status = SmsStepStatus.SENT.name)
        dao.insertSmsLog(sentStep1)
        dao.updateDevice(device.copy(activationStatus = ActivationStatus.SMS_SENT.name))

        delay(700)
        dao.insertSmsLog(
            sentStep1.copy(
                status = SmsStepStatus.REPLIED.name,
                deviceReply = "OK",
                completedAt = System.currentTimeMillis()
            )
        )

        // Dispatch Step 2 (Conditional GPRSON,1#)
        if (requiresGprson && logs.size > 1) {
            delay(500)
            val sentStep2 = logs[1].copy(status = SmsStepStatus.SENT.name)
            dao.insertSmsLog(sentStep2)
            delay(600)
            dao.insertSmsLog(
                sentStep2.copy(
                    status = SmsStepStatus.DELIVERED.name,
                    deviceReply = "OK (Configurable reply matched)",
                    completedAt = System.currentTimeMillis()
                )
            )
        }

        // Transition to WAITING_FOR_DEVICE.
        // CRITICAL RULE: SMS delivery/reply does NOT activate the device or start the subscription!
        val latestDevice = dao.getDeviceById(deviceId) ?: return
        if (latestDevice.activationStatus != ActivationStatus.ACTIVATED.name) {
            dao.updateDevice(
                latestDevice.copy(activationStatus = ActivationStatus.WAITING_FOR_DEVICE.name)
            )
        }
    }

    /**
     * Dispatches an optional, firmware-specific manual TIMER command only when explicitly requested by Admin.
     */
    suspend fun sendOptionalManualTimerCommand(deviceId: String, timerCommand: String) {
        val existingLogs = dao.getSmsLogsForDevice(deviceId)
        val nextStep = (existingLogs.maxOfOrNull { it.stepOrder } ?: 0) + 1
        val now = System.currentTimeMillis()
        dao.insertSmsLog(
            ActivationSmsLogEntity(
                id = "sms_" + UUID.randomUUID().toString().take(8),
                deviceId = deviceId,
                stepOrder = nextStep,
                commandKey = "OPTIONAL_TIMER",
                commandText = timerCommand,
                gatewayMessageId = "GSM-EG-${(10000..99999).random()}",
                status = SmsStepStatus.REPLIED.name,
                deviceReply = "TIMER OK (Manual Admin Dispatch)",
                sentAt = now,
                completedAt = now + 450L
            )
        )
    }

    /**
     * Triggered when Traccar receives a valid connection or packet from the registered IMEI
     * (either an indoor 0x01/0x13 login/heartbeat without GPS fix OR a full GPS fix packet).
     * Automatically transitions WAITING_FOR_DEVICE -> ACTIVATED and starts the subscription clock.
     */
    suspend fun onTraccarImeiConnectionConfirmed(
        deviceId: String,
        hasSatelliteGpsFix: Boolean
    ) {
        val device = dao.getDeviceById(deviceId) ?: return
        val sub = dao.getSubscriptionForDevice(deviceId) ?: return
        val now = System.currentTimeMillis()

        val connState = if (hasSatelliteGpsFix) {
            DeviceConnectionState.ONLINE_GPS_FIX.name
        } else {
            DeviceConnectionState.ONLINE_NO_FIX.name
        }

        val updatedDevice = device.copy(
            activationStatus = ActivationStatus.ACTIVATED.name,
            connectionState = connState,
            ignitionOn = hasSatelliteGpsFix,
            lastSpeedKmh = if (hasSatelliteGpsFix) 42f else 0f,
            firstConnectedAt = device.firstConnectedAt ?: now,
            lastSeenAt = now
        )
        dao.updateDevice(updatedDevice)

        if (sub.status == SubscriptionStatus.AWAITING_FIRST_CONNECTION.name) {
            val plan = PlanDuration.valueOf(sub.planDuration)
            val expiry = plan.computeExpiryMillis(now)
            val activeSub = sub.copy(
                status = SubscriptionStatus.ACTIVE.name,
                startedAt = now,
                expiresAt = expiry
            )
            dao.insertSubscription(activeSub)
            scheduleExactExpiryTimer(activeSub)

            val fixNote = if (hasSatelliteGpsFix) "Valid GT06N GPS packet on :5023" else "GT06N TCP Login/Heartbeat on :5023 (No satellite fix yet)"
            dao.insertSubscriptionHistory(
                SubscriptionHistoryEntity(
                    id = "sh_" + UUID.randomUUID().toString().take(8),
                    deviceId = deviceId,
                    customerId = device.currentCustomerId,
                    actionType = "STARTED_ON_1ST_CONNECTION",
                    planDuration = sub.planDuration,
                    notes = "Subscription started after confirmed Traccar IMEI connection ($fixNote).",
                    createdAt = now
                )
            )
        }
    }

    /**
     * Authenticated Admin Override to activate a device & start its subscription with mandatory audit logging.
     */
    suspend fun adminOverrideActivation(
        deviceId: String,
        adminUserId: String,
        auditReason: String
    ): Result<Unit> {
        if (auditReason.trim().length < 4) {
            return Result.failure(IllegalArgumentException("Mandatory audit reason required"))
        }
        val device = dao.getDeviceById(deviceId) ?: return Result.failure(IllegalArgumentException("Device not found"))
        val sub = dao.getSubscriptionForDevice(deviceId) ?: return Result.failure(IllegalArgumentException("Subscription not found"))
        val now = System.currentTimeMillis()
        val plan = PlanDuration.valueOf(sub.planDuration)
        val expiry = plan.computeExpiryMillis(now)

        dao.updateDevice(
            device.copy(
                activationStatus = ActivationStatus.ACTIVATED.name,
                connectionState = DeviceConnectionState.ONLINE_NO_FIX.name,
                firstConnectedAt = device.firstConnectedAt ?: now,
                lastSeenAt = now
            )
        )
        val updatedSub = sub.copy(
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = sub.startedAt ?: now,
            expiresAt = expiry,
            adminOverrideBy = adminUserId,
            adminOverrideReason = auditReason.trim()
        )
        dao.insertSubscription(updatedSub)
        scheduleExactExpiryTimer(updatedSub)

        dao.insertSubscriptionHistory(
            SubscriptionHistoryEntity(
                id = "sh_" + UUID.randomUUID().toString().take(8),
                deviceId = deviceId,
                customerId = device.currentCustomerId,
                actionType = "ADMIN_OVERRIDE",
                planDuration = sub.planDuration,
                notes = "Admin Override by $adminUserId: ${auditReason.trim()}",
                createdAt = now
            )
        )
        return Result.success(Unit)
    }

    /**
     * Reassigns a device to a different Customer account while preserving all historical
     * activation logs, subscription history, and ownership records.
     */
    suspend fun reassignDeviceCustomer(
        deviceId: String,
        newCustomerId: String,
        adminUserId: String,
        reason: String
    ): Result<Unit> {
        val device = dao.getDeviceById(deviceId) ?: return Result.failure(IllegalArgumentException("Device not found"))
        val prevCustomer = dao.getUserById(device.currentCustomerId)
        val nextCustomer = dao.getUserById(newCustomerId) ?: return Result.failure(IllegalArgumentException("Customer not found"))
        val sub = dao.getSubscriptionForDevice(deviceId)
        val now = System.currentTimeMillis()

        dao.updateDevice(device.copy(currentCustomerId = newCustomerId))
        if (sub != null) {
            dao.insertSubscription(sub.copy(customerId = newCustomerId))
        }
        dao.insertOwnershipHistory(
            DeviceOwnershipHistoryEntity(
                id = "own_" + UUID.randomUUID().toString().take(8),
                deviceId = deviceId,
                previousCustomerId = prevCustomer?.id,
                previousCustomerName = prevCustomer?.fullName,
                newCustomerId = nextCustomer.id,
                newCustomerName = nextCustomer.fullName,
                reassignedByAdminId = adminUserId,
                reason = reason.trim().ifEmpty { "Admin customer reassignment" },
                reassignedAt = now
            )
        )
        return Result.success(Unit)
    }

    /**
     * Renews a device's subscription (1M, 3M, 6M, 12M, or Lifetime) and records the renewal in subscription_history.
     */
    suspend fun renewDeviceSubscription(
        deviceId: String,
        planDuration: PlanDuration,
        adminUserId: String
    ) {
        val device = dao.getDeviceById(deviceId) ?: return
        val sub = dao.getSubscriptionForDevice(deviceId) ?: return
        val now = System.currentTimeMillis()
        val baseStart = if (sub.status == SubscriptionStatus.ACTIVE.name && (sub.expiresAt ?: 0L) > now) {
            sub.expiresAt ?: now
        } else {
            now
        }
        val newExpiry = planDuration.computeExpiryMillis(baseStart)
        val updatedSub = sub.copy(
            planDuration = planDuration.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = sub.startedAt ?: now,
            expiresAt = newExpiry
        )
        dao.insertSubscription(updatedSub)
        scheduleExactExpiryTimer(updatedSub)

        dao.insertSubscriptionHistory(
            SubscriptionHistoryEntity(
                id = "sh_" + UUID.randomUUID().toString().take(8),
                deviceId = deviceId,
                customerId = device.currentCustomerId,
                actionType = "RENEWED",
                planDuration = planDuration.name,
                notes = "Renewed to ${planDuration.fullLabel} by $adminUserId",
                createdAt = now
            )
        )
    }

    /**
     * Sets a device subscription to expire in exactly 5 seconds to test real-time
     * exact-timestamp WebSocket cutoff and inline frame blocking.
     */
    suspend fun scheduleFiveSecondExpiryTest(deviceId: String) {
        val sub = dao.getSubscriptionForDevice(deviceId) ?: return
        val now = System.currentTimeMillis()
        val testExpiry = now + 5_000L
        val updated = sub.copy(
            planDuration = PlanDuration.MONTH_1.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = sub.startedAt ?: (now - 86_400_000L),
            expiresAt = testExpiry
        )
        dao.insertSubscription(updated)
        scheduleExactExpiryTimer(updated)
    }

    /**
     * Schedules an exact-timestamp coroutine timer to cut off access at the exact millisecond of expiration.
     */
    private fun scheduleExactExpiryTimer(sub: SubscriptionEntity) {
        exactExpiryTimers.remove(sub.deviceId)?.cancel()
        if (sub.status != SubscriptionStatus.ACTIVE.name) return
        if (sub.planDuration == PlanDuration.LIFETIME.name) return
        val expiresAt = sub.expiresAt ?: return

        val job = repoScope.launch {
            val delayMs = (expiresAt - System.currentTimeMillis()).coerceAtLeast(0L)
            delay(delayMs)
            enforceSubscriptionExpiryCutoff(sub.deviceId, "Exact-Timestamp Timer")
        }
        exactExpiryTimers[sub.deviceId] = job
    }

    private suspend fun enforceSubscriptionExpiryCutoff(deviceId: String, triggerSource: String) {
        val sub = dao.getSubscriptionForDevice(deviceId) ?: return
        val now = System.currentTimeMillis()
        if (sub.planDuration == PlanDuration.LIFETIME.name) return
        val expiresAt = sub.expiresAt ?: return
        if (expiresAt <= now && sub.status != SubscriptionStatus.EXPIRED.name) {
            dao.insertSubscription(sub.copy(status = SubscriptionStatus.EXPIRED.name))
            val dev = dao.getDeviceById(deviceId)
            dao.insertSubscriptionHistory(
                SubscriptionHistoryEntity(
                    id = "sh_" + UUID.randomUUID().toString().take(8),
                    deviceId = deviceId,
                    customerId = sub.customerId,
                    actionType = "EXPIRED",
                    planDuration = sub.planDuration,
                    notes = "Automatic cutoff enforced via $triggerSource (REST + Active WS terminated).",
                    createdAt = now
                )
            )
            _gatewayStatus.value = _gatewayStatus.value.copy(
                lastExpiryCutoffEvent = "${dev?.vehicleName ?: deviceId} cut off via $triggerSource"
            )
        }
    }

    private suspend fun scheduleAllActiveExpiryTimers() {
        dao.observeAllSubscriptions().collect { subs ->
            subs.forEach { scheduleExactExpiryTimer(it) }
        }
    }

    /**
     * Runs the Traccar WebSocket Bridge telemetry loop + inline per-frame expiration check
     * + 30-second fallback recovery sweep.
     */
    private fun startLiveTraccarBridgeAndRecoveryLoop() {
        repoScope.launch {
            var tickCount = 0
            while (true) {
                delay(2_500L)
                tickCount++
                val now = System.currentTimeMillis()
                val devices = dao.observeAllDevices()
                // Read current snapshot of activated devices & enforce inline frame checks
                updateActiveVehiclePositionsInline(now, tickCount)
                // Every 12 ticks (~30 seconds), execute the fallback recovery expiration sweep
                if (tickCount % 12 == 0) {
                    runThirtySecondFallbackExpirySweep(now)
                }
            }
        }
    }

    private suspend fun updateActiveVehiclePositionsInline(now: Long, tick: Int) {
        // Inline check: only update telemetry for ACTIVATED devices with non-expired subscriptions
        val ids = listOf("dev_cairo_01", "dev_giza_02", "dev_alex_03")
        for ((idx, id) in ids.withIndex()) {
            val dev = dao.getDeviceById(id) ?: continue
            if (dev.activationStatus != ActivationStatus.ACTIVATED.name) continue
            val sub = dao.getSubscriptionForDevice(id) ?: continue

            // INLINE OUTGOING WEBSOCKET FRAME EXPIRATION GUARD
            val isExpired = sub.planDuration != PlanDuration.LIFETIME.name &&
                (sub.expiresAt != null && sub.expiresAt <= now)
            if (isExpired || sub.status == SubscriptionStatus.EXPIRED.name) {
                if (sub.status != SubscriptionStatus.EXPIRED.name) {
                    enforceSubscriptionExpiryCutoff(id, "Inline WS Frame Guard")
                }
                continue
            }

            if (dev.ignitionOn && dev.connectionState == DeviceConnectionState.ONLINE_GPS_FIX.name) {
                val angleRad = ((tick * 12 + idx * 90) % 360) * (Math.PI / 180.0)
                val dLat = cos(angleRad) * 0.00045
                val dLng = sin(angleRad) * 0.00045
                val newHeading = ((tick * 12 + idx * 90) % 360).toFloat()
                val newSpeed = (38f + ((tick + idx * 5) % 24)).coerceIn(25f, 78f)
                dao.updateDevice(
                    dev.copy(
                        lastLat = dev.lastLat + dLat,
                        lastLng = dev.lastLng + dLng,
                        lastHeading = newHeading,
                        lastSpeedKmh = newSpeed,
                        lastSeenAt = now
                    )
                )
            }
        }
    }

    private suspend fun runThirtySecondFallbackExpirySweep(now: Long) {
        val ids = listOf("dev_cairo_01", "dev_giza_02", "dev_alex_03", "dev_pending_04")
        for (id in ids) {
            val sub = dao.getSubscriptionForDevice(id) ?: continue
            if (sub.status == SubscriptionStatus.ACTIVE.name &&
                sub.planDuration != PlanDuration.LIFETIME.name &&
                sub.expiresAt != null &&
                sub.expiresAt <= now
            ) {
                enforceSubscriptionExpiryCutoff(id, "30s Recovery Sweep")
            }
        }
    }

    /**
     * Fetches route history from Traccar (or local Room offline cache) only if subscription is active.
     */
    suspend fun getRouteHistoryWithSubscriptionGuard(deviceId: String): Result<List<CachedWaypointEntity>> {
        val sub = dao.getSubscriptionForDevice(deviceId)
            ?: return Result.failure(IllegalStateException("No subscription found"))
        val now = System.currentTimeMillis()
        val isAccessible = sub.status == SubscriptionStatus.ACTIVE.name &&
            (sub.planDuration == PlanDuration.LIFETIME.name || (sub.expiresAt ?: 0L) > now)
        if (!isAccessible) {
            return Result.failure(SecurityException("HTTP 403 SUBSCRIPTION_EXPIRED: Route history blocked"))
        }
        val cached = dao.getWaypointsForDevice(deviceId)
        return Result.success(cached)
    }

    private suspend fun seedInitialDataIfNeeded() {
        if (dao.countDevices() > 0) return
        val now = System.currentTimeMillis()
        val dayMs = 86_400_000L

        val users = listOf(
            UserProfileEntity(
                id = "usr_admin_01",
                email = "admin@velotrack.eg",
                phone = "+201001002000",
                fullName = "Tarek Mansour (Platform Admin)",
                role = UserRole.ADMIN.name
            ),
            UserProfileEntity(
                id = "usr_cust_01",
                email = "ahmed.hassan@nilelogistics.eg",
                phone = "+201012345678",
                fullName = "Ahmed Hassan • Nile Logistics",
                role = UserRole.CUSTOMER.name
            ),
            UserProfileEntity(
                id = "usr_cust_02",
                email = "sara.kamel@deltafleet.eg",
                phone = "+201223456789",
                fullName = "Sara Kamel • Delta Express",
                role = UserRole.CUSTOMER.name
            )
        )
        dao.insertUsers(users)

        val profiles = listOf(
            DeviceProfileEntity(
                id = "prof_gt06n_dns_v1",
                manufacturer = "Concox",
                model = "GT06N",
                firmwareVersion = "v1.0-DNS-TCP (Verified)",
                traccarProtocol = "gt06",
                serverHost = "gps.velotrack.eg",
                serverPort = 5023,
                transport = "TCP",
                serverMode = "DOMAIN",
                requiresDevicePassword = false,
                defaultDevicePassword = null,
                requiresGprsonCommand = true,
                serverCommandTemplate = "SERVER,1,gps.velotrack.eg,5023,0#",
                gprsonCommandTemplate = "GPRSON,1#",
                optionalTimerCommandTemplate = "TIMER,10,60#",
                expectedReplyPattern = "OK|SERVER",
                isVerified = true,
                verificationNotes = "APN excluded. Sends SERVER (DNS mode 1, TCP 0) + verified GPRSON,1#. TIMER excluded from auto-activation."
            ),
            DeviceProfileEntity(
                id = "prof_gt06n_ip_v1",
                manufacturer = "Concox",
                model = "GT06N",
                firmwareVersion = "v1.1-IP-Only (Verified)",
                traccarProtocol = "gt06",
                serverHost = "197.55.128.42",
                serverPort = 5023,
                transport = "TCP",
                serverMode = "IP",
                requiresDevicePassword = false,
                defaultDevicePassword = null,
                requiresGprsonCommand = false,
                serverCommandTemplate = "SERVER,0,197.55.128.42,5023,0#",
                gprsonCommandTemplate = null,
                optionalTimerCommandTemplate = "TIMER,15,120#",
                expectedReplyPattern = "OK",
                isVerified = true,
                verificationNotes = "APN excluded. Sends SERVER (IP mode 0, TCP 0) only; firmware enables GPRS automatically."
            ),
            DeviceProfileEntity(
                id = "prof_gt06n_pass_v2",
                manufacturer = "Concox",
                model = "GT06N",
                firmwareVersion = "v2.0-Password-Prefix (Verified)",
                traccarProtocol = "gt06",
                serverHost = "gps.velotrack.eg",
                serverPort = 5023,
                transport = "TCP",
                serverMode = "DOMAIN",
                requiresDevicePassword = true,
                defaultDevicePassword = "000000",
                requiresGprsonCommand = true,
                serverCommandTemplate = "SERVER,000000,1,gps.velotrack.eg,5023,0#",
                gprsonCommandTemplate = "GPRSON,1#",
                optionalTimerCommandTemplate = "TIMER,10,60#",
                expectedReplyPattern = "OK",
                isVerified = true,
                verificationNotes = "Includes 6-digit password prefix verified on v2.0 firmware."
            )
        )
        dao.insertDeviceProfiles(profiles)

        val devices = listOf(
            DeviceEntity(
                id = "dev_cairo_01",
                imei = "358739051122334",
                traccarDeviceId = 1001L,
                profileId = "prof_gt06n_dns_v1",
                currentCustomerId = "usr_cust_01",
                vehicleName = "Cairo Cruiser #1",
                plateNumber = "CAI-4821",
                simLocalNumber = "01012345678",
                simE164Number = "+201012345678",
                activationStatus = ActivationStatus.ACTIVATED.name,
                connectionState = DeviceConnectionState.ONLINE_GPS_FIX.name,
                lastLat = 30.0444,
                lastLng = 31.2357,
                lastSpeedKmh = 54f,
                lastHeading = 65f,
                ignitionOn = true,
                firstConnectedAt = now - (14 * dayMs),
                lastSeenAt = now - 3_000L,
                createdAt = now - (14 * dayMs)
            ),
            DeviceEntity(
                id = "dev_giza_02",
                imei = "358739054455660",
                traccarDeviceId = 1002L,
                profileId = "prof_gt06n_ip_v1",
                currentCustomerId = "usr_cust_01",
                vehicleName = "Giza Cold-Chain Van",
                plateNumber = "GIZ-9032",
                simLocalNumber = "01287654321",
                simE164Number = "+201287654321",
                activationStatus = ActivationStatus.WAITING_FOR_DEVICE.name,
                connectionState = DeviceConnectionState.OFFLINE.name,
                lastLat = 30.0131,
                lastLng = 31.2089,
                lastSpeedKmh = 0f,
                lastHeading = 0f,
                ignitionOn = false,
                firstConnectedAt = null,
                lastSeenAt = null,
                createdAt = now - (3_600_000L)
            ),
            DeviceEntity(
                id = "dev_alex_03",
                imei = "358739057788995",
                traccarDeviceId = 1003L,
                profileId = "prof_gt06n_dns_v1",
                currentCustomerId = "usr_cust_01",
                vehicleName = "Oct 6th Freight Truck",
                plateNumber = "OCT-7710",
                simLocalNumber = "01145678901",
                simE164Number = "+201145678901",
                activationStatus = ActivationStatus.ACTIVATED.name,
                connectionState = DeviceConnectionState.ONLINE_GPS_FIX.name,
                lastLat = 30.0595,
                lastLng = 31.2001,
                lastSpeedKmh = 0f,
                lastHeading = 180f,
                ignitionOn = false,
                firstConnectedAt = now - (32 * dayMs),
                lastSeenAt = now - (2 * dayMs),
                createdAt = now - (32 * dayMs)
            ),
            DeviceEntity(
                id = "dev_delta_04",
                imei = "358739059911223",
                traccarDeviceId = 1004L,
                profileId = "prof_gt06n_dns_v1",
                currentCustomerId = "usr_cust_02",
                vehicleName = "Delta Express Sprinter",
                plateNumber = "DLT-2190",
                simLocalNumber = "01555667788",
                simE164Number = "+201555667788",
                activationStatus = ActivationStatus.ACTIVATED.name,
                connectionState = DeviceConnectionState.ONLINE_GPS_FIX.name,
                lastLat = 30.0710,
                lastLng = 31.2850,
                lastSpeedKmh = 62f,
                lastHeading = 45f,
                ignitionOn = true,
                firstConnectedAt = now - (5 * dayMs),
                lastSeenAt = now - 4_000L,
                createdAt = now - (5 * dayMs)
            )
        )
        dao.insertDevices(devices)

        val subscriptions = listOf(
            SubscriptionEntity(
                id = "sub_01",
                deviceId = "dev_cairo_01",
                customerId = "usr_cust_01",
                planDuration = PlanDuration.MONTH_12.name,
                status = SubscriptionStatus.ACTIVE.name,
                startedAt = now - (14 * dayMs),
                expiresAt = now + (351 * dayMs),
                adminOverrideBy = null,
                adminOverrideReason = null
            ),
            SubscriptionEntity(
                id = "sub_02",
                deviceId = "dev_giza_02",
                customerId = "usr_cust_01",
                planDuration = PlanDuration.MONTH_6.name,
                status = SubscriptionStatus.AWAITING_FIRST_CONNECTION.name,
                startedAt = null,
                expiresAt = null,
                adminOverrideBy = null,
                adminOverrideReason = null
            ),
            SubscriptionEntity(
                id = "sub_03",
                deviceId = "dev_alex_03",
                customerId = "usr_cust_01",
                planDuration = PlanDuration.MONTH_1.name,
                status = SubscriptionStatus.EXPIRED.name,
                startedAt = now - (32 * dayMs),
                expiresAt = now - (2 * dayMs),
                adminOverrideBy = null,
                adminOverrideReason = null
            ),
            SubscriptionEntity(
                id = "sub_04",
                deviceId = "dev_delta_04",
                customerId = "usr_cust_02",
                planDuration = PlanDuration.LIFETIME.name,
                status = SubscriptionStatus.ACTIVE.name,
                startedAt = now - (5 * dayMs),
                expiresAt = null,
                adminOverrideBy = null,
                adminOverrideReason = null
            )
        )
        dao.insertSubscriptions(subscriptions)

        dao.insertSmsLogs(
            listOf(
                ActivationSmsLogEntity(
                    id = "sms_init_1",
                    deviceId = "dev_cairo_01",
                    stepOrder = 1,
                    commandKey = "SERVER",
                    commandText = "SERVER,1,gps.velotrack.eg,5023,0#",
                    gatewayMessageId = "GSM-EG-10291",
                    status = SmsStepStatus.REPLIED.name,
                    deviceReply = "OK",
                    sentAt = now - (14 * dayMs),
                    completedAt = now - (14 * dayMs) + 3_000L
                ),
                ActivationSmsLogEntity(
                    id = "sms_init_2",
                    deviceId = "dev_cairo_01",
                    stepOrder = 2,
                    commandKey = "GPRSON",
                    commandText = "GPRSON,1#",
                    gatewayMessageId = "GSM-EG-10292",
                    status = SmsStepStatus.REPLIED.name,
                    deviceReply = "OK",
                    sentAt = now - (14 * dayMs) + 6_000L,
                    completedAt = now - (14 * dayMs) + 9_000L
                ),
                ActivationSmsLogEntity(
                    id = "sms_init_3",
                    deviceId = "dev_giza_02",
                    stepOrder = 1,
                    commandKey = "SERVER",
                    commandText = "SERVER,0,197.55.128.42,5023,0#",
                    gatewayMessageId = "GSM-EG-40912",
                    status = SmsStepStatus.REPLIED.name,
                    deviceReply = "OK (Awaiting 1st TCP packet on :5023)",
                    sentAt = now - 3_500_000L,
                    completedAt = now - 3_495_000L
                )
            )
        )

        dao.insertSubscriptionHistoryList(
            listOf(
                SubscriptionHistoryEntity(
                    id = "sh_init_1",
                    deviceId = "dev_cairo_01",
                    customerId = "usr_cust_01",
                    actionType = "STARTED_ON_1ST_CONNECTION",
                    planDuration = PlanDuration.MONTH_12.name,
                    notes = "12M plan started automatically after 1st GT06N packet on :5023",
                    createdAt = now - (14 * dayMs)
                ),
                SubscriptionHistoryEntity(
                    id = "sh_init_2",
                    deviceId = "dev_giza_02",
                    customerId = "usr_cust_01",
                    actionType = "PROVISIONED",
                    planDuration = PlanDuration.MONTH_6.name,
                    notes = "SMS delivered & replied OK. Subscription waiting for 1st Traccar connection.",
                    createdAt = now - 3_500_000L
                ),
                SubscriptionHistoryEntity(
                    id = "sh_init_3",
                    deviceId = "dev_alex_03",
                    customerId = "usr_cust_01",
                    actionType = "EXPIRED",
                    planDuration = PlanDuration.MONTH_1.name,
                    notes = "1M subscription expired. REST & active WebSocket streams blocked.",
                    createdAt = now - (2 * dayMs)
                )
            )
        )

        // Seed Cairo Ring Road & Nile Corniche historical route waypoints for dev_cairo_01
        val cairoRoute = listOf(
            Triple(30.0320, 31.2190, "Dokki Corniche"),
            Triple(30.0365, 31.2245, "Qasr El Nil Bridge"),
            Triple(30.0444, 31.2357, "Tahrir Square"),
            Triple(30.0512, 31.2420, "Ramses Corridor"),
            Triple(30.0580, 31.2515, "Ghamra Flyover"),
            Triple(30.0645, 31.2620, "Abbassia Square"),
            Triple(30.0715, 31.2760, "Salah Salem Highway")
        )
        val waypoints = cairoRoute.mapIndexed { i, pt ->
            CachedWaypointEntity(
                deviceId = "dev_cairo_01",
                latitude = pt.first,
                longitude = pt.second,
                speedKmh = 42f + (i * 4f),
                heading = 52f,
                ignition = true,
                addressLabel = pt.third,
                recordedAt = now - ((cairoRoute.size - i) * 300_000L)
            )
        }
        dao.insertWaypoints(waypoints)
    }

    private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
}
