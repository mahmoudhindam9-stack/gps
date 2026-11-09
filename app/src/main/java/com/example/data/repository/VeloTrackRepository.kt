package com.example.data.repository

import android.content.Context
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
import com.example.data.model.AuthenticatedSession
import com.example.data.model.BackendConnectionState
import com.example.data.model.DeviceAggregate
import com.example.data.model.DeviceConnectionState
import com.example.data.model.PlanDuration
import com.example.data.model.SimAndImeiValidator
import com.example.data.model.SmsStepStatus
import com.example.data.model.SubscriptionStatus
import com.example.data.model.UserRole
import com.example.data.network.ActivateDeviceRequestDto
import com.example.data.network.AdminOverrideRequestDto
import com.example.data.network.CreateProfileRequestDto
import com.example.data.network.LoginRequestDto
import com.example.data.network.ReassignCustomerRequestDto
import com.example.data.network.RenewSubscriptionRequestDto
import com.example.data.network.ServerDeviceBundleDto
import com.example.data.network.ServerDeviceProfileDto
import com.example.data.network.ServerHealthResponseDto
import com.example.data.network.ServerUserDto
import com.example.data.network.TraccarDeviceDto
import com.example.data.network.TraccarPositionDto
import com.example.data.network.TraccarSocketFrameDto
import com.example.data.network.VeloTrackApiService
import com.example.data.network.VeloTrackNetworkClient
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine

data class ServerStatusSnapshot(
    val connectionState: BackendConnectionState = BackendConnectionState.DISCONNECTED,
    val traccarBridgeConnected: Boolean = false,
    val traccarLastSyncAtMs: Long? = null,
    val smsGatewayConfigured: Boolean = false,
    val lastErrorMessage: String? = null
)

/**
 * Pure domain correlation and protocol rules used by both backend integration tests
 * and offline state validation. Contains zero fake or random generators.
 */
object TraccarProtocolCorrelator {
    private val jsessionRegex = Regex("JSESSIONID=([^;\\s]+)", RegexOption.IGNORE_CASE)

    fun extractSessionCookie(setCookieHeaders: List<String>): String? {
        for (header in setCookieHeaders) {
            val match = jsessionRegex.find(header)
            if (match != null && match.groupValues[1].isNotBlank()) {
                return "JSESSIONID=${match.groupValues[1]}"
            }
        }
        return null
    }

    fun parseTraccarSocketFrame(json: String): TraccarSocketFrameDto? {
        val adapter = VeloTrackNetworkClient.getMoshi().adapter(TraccarSocketFrameDto::class.java)
        return runCatching { adapter.fromJson(json) }.getOrNull()
    }

    fun knotsToKmh(knots: Double): Float {
        return (knots * 1.852).toFloat()
    }

    /**
     * Applies a real Traccar device/position event to a VeloTrack device + subscription pair.
     * - Correlates strictly by traccarDeviceId or 15-digit IMEI.
     * - Distinguishes indoor login/heartbeat without GPS fix (ONLINE_NO_FIX) from full GPS fix (ONLINE_GPS_FIX).
     * - Starts AWAITING_FIRST_CONNECTION subscription ONLY upon the first confirmed connection.
     */
    fun applyTraccarEventToDevice(
        device: DeviceEntity,
        subscription: SubscriptionEntity,
        traccarDevice: TraccarDeviceDto?,
        traccarPosition: TraccarPositionDto?,
        eventTimestampMs: Long
    ): Pair<DeviceEntity, SubscriptionEntity> {
        val matchesDevice = traccarDevice != null &&
            (traccarDevice.id == device.traccarDeviceId || traccarDevice.uniqueId == device.imei)
        val matchesPosition = traccarPosition != null &&
            traccarPosition.deviceId == device.traccarDeviceId

        if (!matchesDevice && !matchesPosition) {
            return device to subscription
        }

        val isOnlineSignal = (matchesDevice && (traccarDevice?.status == "online" || traccarDevice?.lastUpdate != null)) ||
            matchesPosition
        val isOfflineSignal = matchesDevice && traccarDevice?.status == "offline" && !matchesPosition

        if (isOfflineSignal) {
            return device.copy(connectionState = DeviceConnectionState.OFFLINE.name) to subscription
        }
        if (!isOnlineSignal) {
            return device to subscription
        }

        val hasGpsFix = matchesPosition && traccarPosition?.valid == true
        val newConnState = when {
            hasGpsFix -> DeviceConnectionState.ONLINE_GPS_FIX.name
            device.hasValidFix -> DeviceConnectionState.ONLINE_GPS_FIX.name
            else -> DeviceConnectionState.ONLINE_NO_FIX.name
        }

        val updatedDevice = device.copy(
            activationStatus = ActivationStatus.ACTIVATED.name,
            connectionState = newConnState,
            hasValidFix = device.hasValidFix || hasGpsFix,
            lastLat = if (hasGpsFix) traccarPosition?.latitude else device.lastLat,
            lastLng = if (hasGpsFix) traccarPosition?.longitude else device.lastLng,
            lastSpeedKmh = if (hasGpsFix && traccarPosition != null) knotsToKmh(traccarPosition.speed) else device.lastSpeedKmh,
            lastHeading = if (hasGpsFix && traccarPosition != null) traccarPosition.course.toFloat() else device.lastHeading,
            ignitionOn = (traccarPosition?.attributes?.get("ignition") as? Boolean) ?: device.ignitionOn,
            firstConnectedAt = device.firstConnectedAt ?: eventTimestampMs,
            lastSeenAt = eventTimestampMs
        )

        val updatedSubscription = if (subscription.status == SubscriptionStatus.AWAITING_FIRST_CONNECTION.name) {
            val plan = PlanDuration.valueOf(subscription.planDuration)
            subscription.copy(
                status = SubscriptionStatus.ACTIVE.name,
                startedAt = eventTimestampMs,
                expiresAt = plan.computeExpiryMillis(eventTimestampMs)
            )
        } else {
            subscription
        }

        return updatedDevice to updatedSubscription
    }

    /**
     * Applies a real SMS gateway/webhook status update to an SMS log and device.
     * CRITICAL RULE: SMS accepted/sent/delivered/replied NEVER activates the device or starts the subscription.
     */
    fun applySmsGatewayEvent(
        device: DeviceEntity,
        subscription: SubscriptionEntity,
        smsLog: ActivationSmsLogEntity,
        newSmsStatus: SmsStepStatus,
        gatewayMessageId: String? = smsLog.gatewayMessageId,
        replyText: String? = null,
        failureReason: String? = null,
        eventTimestampMs: Long
    ): Triple<DeviceEntity, SubscriptionEntity, ActivationSmsLogEntity> {
        val updatedLog = smsLog.copy(
            gatewayMessageId = gatewayMessageId,
            status = newSmsStatus.name,
            deviceReply = replyText ?: smsLog.deviceReply,
            failureReason = failureReason ?: smsLog.failureReason,
            completedAt = if (newSmsStatus in setOf(SmsStepStatus.DELIVERED, SmsStepStatus.REPLIED, SmsStepStatus.FAILED, SmsStepStatus.TIMED_OUT)) {
                eventTimestampMs
            } else {
                smsLog.completedAt
            }
        )

        val updatedDeviceStatus = when (newSmsStatus) {
            SmsStepStatus.QUEUED -> device.activationStatus
            SmsStepStatus.ACCEPTED, SmsStepStatus.SENT -> {
                if (device.activationStatus == ActivationStatus.PENDING.name) ActivationStatus.SMS_SENT.name
                else device.activationStatus
            }
            SmsStepStatus.DELIVERED, SmsStepStatus.REPLIED -> {
                if (device.activationStatus != ActivationStatus.ACTIVATED.name) {
                    ActivationStatus.WAITING_FOR_DEVICE.name
                } else {
                    device.activationStatus
                }
            }
            SmsStepStatus.FAILED, SmsStepStatus.TIMED_OUT -> {
                if (device.activationStatus != ActivationStatus.ACTIVATED.name) {
                    ActivationStatus.FAILED.name
                } else {
                    device.activationStatus
                }
            }
        }

        // Subscription remains untouched (never activated by SMS!)
        return Triple(
            device.copy(activationStatus = updatedDeviceStatus),
            subscription,
            updatedLog
        )
    }
}

class VeloTrackRepository(
    private val dao: VeloTrackDao,
    private val context: Context? = null,
    private var apiProvider: () -> VeloTrackApiService = { VeloTrackNetworkClient.createApiService(context) }
) {
    private val _session = MutableStateFlow<AuthenticatedSession?>(null)
    val session: StateFlow<AuthenticatedSession?> = _session.asStateFlow()

    private val _serverStatus = MutableStateFlow(ServerStatusSnapshot())
    val serverStatus: StateFlow<ServerStatusSnapshot> = _serverStatus.asStateFlow()

    val allUsers: Flow<List<UserProfileEntity>> = dao.observeAllUsers()
    val deviceProfiles: Flow<List<DeviceProfileEntity>> = dao.observeDeviceProfiles()

    fun observeCachedDeviceAggregates(): Flow<List<DeviceAggregate>> {
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

            base.first.mapNotNull { device ->
                val sub = subMap[device.id] ?: return@mapNotNull null
                DeviceAggregate(
                    device = device,
                    profile = profileMap[device.profileId],
                    customer = userMap[device.currentCustomerId],
                    subscription = sub,
                    smsLogs = (smsByDevice[device.id] ?: emptyList()).sortedBy { it.stepOrder },
                    subscriptionHistory = subHistByDevice[device.id] ?: emptyList(),
                    ownershipHistory = ownHistByDevice[device.id] ?: emptyList()
                )
            }
        }
    }

    fun updateBackendBaseUrl(newUrl: String) {
        VeloTrackNetworkClient.baseUrl = VeloTrackNetworkClient.normalizeBaseUrl(newUrl)
    }

    suspend fun checkServerHealth(): Result<ServerHealthResponseDto> {
        return runCatching {
            val response = apiProvider().getHealth()
            if (!response.isSuccessful || response.body() == null) {
                throw IllegalStateException("HTTP ${response.code()}")
            }
            val body = response.body()!!
            _serverStatus.value = _serverStatus.value.copy(
                connectionState = if (_session.value != null) BackendConnectionState.CONNECTED else BackendConnectionState.DISCONNECTED,
                traccarBridgeConnected = body.traccarConnected,
                traccarLastSyncAtMs = body.traccarLastSyncAtMs,
                smsGatewayConfigured = body.smsGatewayConfigured,
                lastErrorMessage = null
            )
            body
        }.onFailure { err ->
            _serverStatus.value = _serverStatus.value.copy(
                connectionState = BackendConnectionState.DISCONNECTED,
                traccarBridgeConnected = false,
                lastErrorMessage = err.message ?: "Server unreachable"
            )
        }
    }

    suspend fun login(email: String, password: String): Result<AuthenticatedSession> {
        val cleanEmail = email.trim()
        if (cleanEmail.isEmpty() || password.isEmpty()) {
            return Result.failure(IllegalArgumentException("Email and password required"))
        }
        _serverStatus.value = _serverStatus.value.copy(
            connectionState = BackendConnectionState.CONNECTING,
            lastErrorMessage = null
        )
        return runCatching {
            val response = apiProvider().login(LoginRequestDto(cleanEmail, password))
            if (!response.isSuccessful || response.body() == null) {
                val code = response.code()
                throw IllegalStateException(
                    if (code == 401) "Invalid credentials" else "Login failed (HTTP $code)"
                )
            }
            val body = response.body()!!
            val role = runCatching { UserRole.valueOf(body.user.role) }.getOrDefault(UserRole.CUSTOMER)
            val authSession = AuthenticatedSession(
                token = body.token,
                userId = body.user.id,
                email = body.user.email,
                fullName = body.user.fullName,
                role = role
            )
            VeloTrackNetworkClient.bearerToken = body.token
            _session.value = authSession
            _serverStatus.value = _serverStatus.value.copy(
                connectionState = BackendConnectionState.CONNECTED,
                lastErrorMessage = null
            )
            refreshSnapshotFromServer()
            authSession
        }.onFailure { err ->
            VeloTrackNetworkClient.bearerToken = null
            _session.value = null
            _serverStatus.value = _serverStatus.value.copy(
                connectionState = BackendConnectionState.DISCONNECTED,
                lastErrorMessage = err.message
            )
        }
    }

    suspend fun logout() {
        VeloTrackNetworkClient.bearerToken = null
        _session.value = null
        _serverStatus.value = ServerStatusSnapshot(connectionState = BackendConnectionState.DISCONNECTED)
        dao.clearAllOfflineCache()
    }

    suspend fun refreshSnapshotFromServer(): Result<Unit> {
        val activeSession = _session.value
            ?: return Result.failure(IllegalStateException("Not authenticated"))
        return runCatching {
            val api = apiProvider()
            val healthRes = runCatching { api.getHealth() }.getOrNull()
            val profilesRes = api.getProfiles()
            val devicesRes = api.getDevices()
            if (devicesRes.code() == 401 || profilesRes.code() == 401) {
                logout()
                throw SecurityException("Session expired (HTTP 401)")
            }
            if (!devicesRes.isSuccessful || !profilesRes.isSuccessful) {
                throw IllegalStateException("Sync failed (HTTP ${devicesRes.code()})")
            }

            val usersList = if (activeSession.role == UserRole.ADMIN) {
                val uRes = api.getUsers()
                if (uRes.isSuccessful) uRes.body().orEmpty() else emptyList()
            } else {
                emptyList()
            }

            val bundles = devicesRes.body().orEmpty()
            val profiles = profilesRes.body().orEmpty()

            persistServerSnapshotToCache(usersList, profiles, bundles)

            _serverStatus.value = _serverStatus.value.copy(
                connectionState = BackendConnectionState.CONNECTED,
                traccarBridgeConnected = healthRes?.body()?.traccarConnected ?: _serverStatus.value.traccarBridgeConnected,
                traccarLastSyncAtMs = healthRes?.body()?.traccarLastSyncAtMs ?: System.currentTimeMillis(),
                smsGatewayConfigured = healthRes?.body()?.smsGatewayConfigured ?: _serverStatus.value.smsGatewayConfigured,
                lastErrorMessage = null
            )
        }.onFailure { err ->
            _serverStatus.value = _serverStatus.value.copy(
                lastErrorMessage = err.message ?: "Refresh failed"
            )
        }
    }

    suspend fun createDeviceProfile(request: CreateProfileRequestDto): Result<ServerDeviceProfileDto> {
        if (request.serverCommandTemplate.contains("APN", ignoreCase = true) ||
            request.serverCommandTemplate.contains("TIMER", ignoreCase = true)
        ) {
            return Result.failure(IllegalArgumentException("APN and automatic TIMER commands are prohibited"))
        }
        return runCatching {
            val res = apiProvider().createProfile(request)
            if (!res.isSuccessful || res.body() == null) {
                throw IllegalStateException("Create profile failed (HTTP ${res.code()})")
            }
            val created = res.body()!!
            refreshSnapshotFromServer()
            created
        }
    }

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
            return Result.failure(IllegalArgumentException("Invalid 15-digit IMEI"))
        }
        val normalizedSim = SimAndImeiValidator.normalizeEgyptianSim(simLocalInput)
        if (!normalizedSim.isValid) {
            return Result.failure(IllegalArgumentException(normalizedSim.errorReason ?: "Invalid SIM"))
        }
        if (profileId.isBlank() || customerId.isBlank() || vehicleName.isBlank() || plateNumber.isBlank()) {
            return Result.failure(IllegalArgumentException("All fields required"))
        }

        return runCatching {
            val res = apiProvider().activateDevice(
                ActivateDeviceRequestDto(
                    profileId = profileId,
                    imei = cleanImei,
                    customerId = customerId,
                    vehicleName = vehicleName.trim(),
                    plateNumber = plateNumber.trim(),
                    planDuration = planDuration.name,
                    simLocalWithoutPlus20 = normalizedSim.localNumber
                )
            )
            if (!res.isSuccessful || res.body() == null) {
                throw IllegalStateException("Activation request failed (HTTP ${res.code()})")
            }
            val body = res.body()!!
            refreshSnapshotFromServer()
            body.device.id
        }
    }

    suspend fun adminOverrideActivation(
        deviceId: String,
        auditReason: String
    ): Result<Unit> {
        val cleanReason = auditReason.trim()
        if (cleanReason.length < 4) {
            return Result.failure(IllegalArgumentException("Audit reason required"))
        }
        return runCatching {
            val res = apiProvider().adminOverrideActivation(
                deviceId = deviceId,
                request = AdminOverrideRequestDto(auditReason = cleanReason)
            )
            if (!res.isSuccessful) {
                throw IllegalStateException("Override failed (HTTP ${res.code()})")
            }
            refreshSnapshotFromServer()
        }
    }

    suspend fun reassignDeviceCustomer(
        deviceId: String,
        newCustomerId: String,
        reason: String
    ): Result<Unit> {
        if (newCustomerId.isBlank() || reason.trim().isEmpty()) {
            return Result.failure(IllegalArgumentException("Customer and reason required"))
        }
        return runCatching {
            val res = apiProvider().reassignDeviceCustomer(
                deviceId = deviceId,
                request = ReassignCustomerRequestDto(
                    newCustomerId = newCustomerId,
                    reason = reason.trim()
                )
            )
            if (!res.isSuccessful) {
                throw IllegalStateException("Reassignment failed (HTTP ${res.code()})")
            }
            refreshSnapshotFromServer()
        }
    }

    suspend fun renewDeviceSubscription(
        deviceId: String,
        planDuration: PlanDuration
    ): Result<Unit> {
        return runCatching {
            val res = apiProvider().renewSubscription(
                deviceId = deviceId,
                request = RenewSubscriptionRequestDto(planDuration = planDuration.name)
            )
            if (!res.isSuccessful) {
                throw IllegalStateException("Renewal failed (HTTP ${res.code()})")
            }
            refreshSnapshotFromServer()
        }
    }

    suspend fun fetchRouteHistoryFromServer(
        deviceId: String,
        fromMillis: Long = System.currentTimeMillis() - 86_400_000L,
        toMillis: Long = System.currentTimeMillis()
    ): Result<List<CachedWaypointEntity>> {
        val fromIso = Instant.ofEpochMilli(fromMillis).toString()
        val toIso = Instant.ofEpochMilli(toMillis).toString()

        return runCatching {
            val res = apiProvider().getDeviceRouteHistory(deviceId, fromIso, toIso)
            if (res.code() == 403) {
                throw SecurityException("EXPIRED")
            }
            if (!res.isSuccessful || res.body() == null) {
                throw IllegalStateException("HTTP ${res.code()}")
            }
            val waypoints = res.body()!!.map { dto ->
                CachedWaypointEntity(
                    id = dto.traccarPositionId,
                    deviceId = deviceId,
                    latitude = dto.latitude,
                    longitude = dto.longitude,
                    speedKmh = dto.speedKmh,
                    heading = dto.heading,
                    ignition = dto.ignition,
                    valid = dto.valid,
                    recordedAt = dto.recordedAtMs
                )
            }
            dao.clearWaypointsForDevice(deviceId)
            dao.insertWaypoints(waypoints)
            waypoints
        }
    }

    suspend fun triggerTraccarSyncOnBackend(): Result<Unit> {
        return runCatching {
            val res = apiProvider().triggerTraccarSync()
            if (!res.isSuccessful) {
                throw IllegalStateException("Traccar sync failed (HTTP ${res.code()})")
            }
            refreshSnapshotFromServer()
        }
    }

    private suspend fun persistServerSnapshotToCache(
        usersDto: List<ServerUserDto>,
        profilesDto: List<ServerDeviceProfileDto>,
        bundlesDto: List<ServerDeviceBundleDto>
    ) {
        val customerMap = mutableMapOf<String, UserProfileEntity>()
        usersDto.forEach { u ->
            customerMap[u.id] = UserProfileEntity(
                id = u.id,
                email = u.email,
                phone = u.phone,
                fullName = u.fullName,
                role = u.role,
                isActive = u.isActive,
                createdAt = u.createdAtMs
            )
        }
        bundlesDto.mapNotNull { it.customer }.forEach { u ->
            customerMap[u.id] = UserProfileEntity(
                id = u.id,
                email = u.email,
                phone = u.phone,
                fullName = u.fullName,
                role = u.role,
                isActive = u.isActive,
                createdAt = u.createdAtMs
            )
        }

        val profileEntities = profilesDto.map { p ->
            DeviceProfileEntity(
                id = p.id,
                manufacturer = p.manufacturer,
                model = p.model,
                firmwareVersion = p.firmwareVersion,
                traccarProtocol = p.traccarProtocol,
                serverHost = p.serverHost,
                serverPort = p.serverPort,
                transport = p.transport,
                serverMode = p.serverMode,
                requiresDevicePassword = p.requiresDevicePassword,
                defaultDevicePassword = p.defaultDevicePassword,
                requiresGprsonCommand = p.requiresGprsonCommand,
                serverCommandTemplate = p.serverCommandTemplate,
                gprsonCommandTemplate = p.gprsonCommandTemplate,
                optionalTimerCommandTemplate = p.optionalTimerCommandTemplate,
                expectedReplyPattern = p.expectedReplyPattern,
                isVerified = p.isVerified
            )
        }

        val deviceEntities = bundlesDto.map { b ->
            val d = b.device
            DeviceEntity(
                id = d.id,
                imei = d.imei,
                traccarDeviceId = d.traccarDeviceId,
                profileId = d.profileId,
                currentCustomerId = d.currentCustomerId,
                vehicleName = d.vehicleName,
                plateNumber = d.plateNumber,
                simLocalNumber = d.simLocalNumber,
                simE164Number = d.simE164Number,
                activationStatus = d.activationStatus,
                connectionState = d.connectionState,
                hasValidFix = d.hasValidFix,
                lastLat = d.lastLat,
                lastLng = d.lastLng,
                lastSpeedKmh = d.lastSpeedKmh,
                lastHeading = d.lastHeading,
                ignitionOn = d.ignitionOn,
                firstConnectedAt = d.firstConnectedAtMs,
                lastSeenAt = d.lastSeenAtMs,
                createdAt = d.createdAtMs
            )
        }

        val subEntities = bundlesDto.map { b ->
            val s = b.subscription
            SubscriptionEntity(
                id = s.id,
                deviceId = s.deviceId,
                customerId = s.customerId,
                planDuration = s.planDuration,
                status = s.status,
                startedAt = s.startedAtMs,
                expiresAt = s.expiresAtMs,
                adminOverrideBy = s.adminOverrideBy,
                adminOverrideReason = s.adminOverrideReason
            )
        }

        val smsEntities = bundlesDto.flatMap { b ->
            b.smsLogs.map { l ->
                ActivationSmsLogEntity(
                    id = l.id,
                    deviceId = l.deviceId,
                    stepOrder = l.stepOrder,
                    commandKey = l.commandKey,
                    commandText = l.commandText,
                    gatewayMessageId = l.gatewayMessageId,
                    status = l.status,
                    deviceReply = l.deviceReply,
                    failureReason = l.failureReason,
                    sentAt = l.sentAtMs,
                    completedAt = l.completedAtMs
                )
            }
        }

        val subHistoryEntities = bundlesDto.flatMap { b ->
            b.subscriptionHistory.map { h ->
                SubscriptionHistoryEntity(
                    id = h.id,
                    deviceId = h.deviceId,
                    customerId = h.customerId,
                    actionType = h.actionType,
                    planDuration = h.planDuration,
                    notes = h.notes,
                    createdAt = h.createdAtMs
                )
            }
        }

        val ownHistoryEntities = bundlesDto.flatMap { b ->
            b.ownershipHistory.map { o ->
                DeviceOwnershipHistoryEntity(
                    id = o.id,
                    deviceId = o.deviceId,
                    previousCustomerId = o.previousCustomerId,
                    previousCustomerName = o.previousCustomerId?.let { customerMap[it]?.fullName },
                    newCustomerId = o.newCustomerId,
                    newCustomerName = customerMap[o.newCustomerId]?.fullName ?: o.newCustomerId,
                    reassignedByAdminId = o.reassignedByAdminId,
                    reason = o.reason,
                    reassignedAt = o.reassignedAtMs
                )
            }
        }

        dao.replaceSnapshotFromServer(
            users = customerMap.values.toList(),
            profiles = profileEntities,
            devices = deviceEntities,
            subscriptions = subEntities,
            smsLogs = smsEntities,
            subHistory = subHistoryEntities,
            ownHistory = ownHistoryEntities
        )
    }

    private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
}
