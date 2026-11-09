package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.local.CachedWaypointEntity
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.UserProfileEntity
import com.example.data.local.VeloTrackDatabase
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.PlanDuration
import com.example.data.model.SimAndImeiValidator
import com.example.data.model.SubscriptionStatus
import com.example.data.model.UserRole
import com.example.data.repository.GatewayRuntimeStatus
import com.example.data.repository.VeloTrackRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class AppTab(val shortLabel: String) {
    MAP("Map"),
    ACTIVATE("Activate"),
    DEVICES("Devices"),
    SERVER("Server")
}

enum class FleetFilter(val shortLabel: String) {
    ALL("All"),
    ACTIVE("Active"),
    WAITING("Waiting"),
    EXPIRED("Expired")
}

data class ActivationFormState(
    val selectedProfileId: String = "prof_gt06n_dns_v1",
    val imei: String = "358739056284915",
    val customerId: String = "usr_cust_01",
    val vehicleName: String = "Nasr City Shuttle",
    val plateNumber: String = "CAI-6140",
    val planDuration: PlanDuration = PlanDuration.MONTH_12,
    val simLocalWithoutPlus20: String = "01098765432",
    val errorMessage: String? = null,
    val lastActivatedDeviceId: String? = null
)

data class RoutePlaybackState(
    val deviceId: String,
    val waypoints: List<CachedWaypointEntity>,
    val currentIndex: Int = 0,
    val isPlaying: Boolean = false,
    val blockedReason: String? = null
)

@OptIn(ExperimentalCoroutinesApi::class)
class VeloTrackViewModel(application: Application) : AndroidViewModel(application) {
    private val dao = VeloTrackDatabase.getInstance(application).veloTrackDao()
    private val repository = VeloTrackRepository(dao)

    private val _isDarkTheme = MutableStateFlow(true)
    val isDarkTheme: StateFlow<Boolean> = _isDarkTheme.asStateFlow()

    private val _currentTab = MutableStateFlow(AppTab.MAP)
    val currentTab: StateFlow<AppTab> = _currentTab.asStateFlow()

    private val _activeRole = MutableStateFlow(UserRole.ADMIN)
    val activeRole: StateFlow<UserRole> = _activeRole.asStateFlow()

    private val _activeCustomerId = MutableStateFlow("usr_cust_01")
    val activeCustomerId: StateFlow<String> = _activeCustomerId.asStateFlow()

    private val _fleetFilter = MutableStateFlow(FleetFilter.ALL)
    val fleetFilter: StateFlow<FleetFilter> = _fleetFilter.asStateFlow()

    private val _selectedDeviceId = MutableStateFlow<String?>("dev_cairo_01")
    val selectedDeviceId: StateFlow<String?> = _selectedDeviceId.asStateFlow()

    private val _activationForm = MutableStateFlow(ActivationFormState())
    val activationForm: StateFlow<ActivationFormState> = _activationForm.asStateFlow()

    private val _routePlayback = MutableStateFlow<RoutePlaybackState?>(null)
    val routePlayback: StateFlow<RoutePlaybackState?> = _routePlayback.asStateFlow()

    private val _statusBanner = MutableStateFlow<String?>(null)
    val statusBanner: StateFlow<String?> = _statusBanner.asStateFlow()

    val gatewayStatus: StateFlow<GatewayRuntimeStatus> = repository.gatewayStatus

    val allUsers: StateFlow<List<UserProfileEntity>> = repository.allUsers
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val deviceProfiles: StateFlow<List<DeviceProfileEntity>> = repository.deviceProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val visibleDevices: StateFlow<List<DeviceAggregate>> = combine(_activeRole, _activeCustomerId) { role, custId ->
        repository.updateRlsSessionContext(
            userId = if (role == UserRole.ADMIN) "usr_admin_01" else custId,
            role = role
        )
        role to custId
    }.flatMapLatest { (role, custId) ->
        repository.observeDeviceAggregates(role, custId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val filteredDevices: StateFlow<List<DeviceAggregate>> = combine(visibleDevices, _fleetFilter) { list, filter ->
        val now = System.currentTimeMillis()
        when (filter) {
            FleetFilter.ALL -> list
            FleetFilter.ACTIVE -> list.filter {
                it.device.activationStatus == ActivationStatus.ACTIVATED.name && it.isSubscriptionAccessible(now)
            }
            FleetFilter.WAITING -> list.filter {
                it.device.activationStatus != ActivationStatus.ACTIVATED.name ||
                    it.subscription.status == SubscriptionStatus.AWAITING_FIRST_CONNECTION.name
            }
            FleetFilter.EXPIRED -> list.filter {
                it.subscription.status == SubscriptionStatus.EXPIRED.name ||
                    (it.subscription.status == SubscriptionStatus.ACTIVE.name && !it.isSubscriptionAccessible(now))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun toggleDarkTheme() {
        _isDarkTheme.value = !_isDarkTheme.value
    }

    fun selectTab(tab: AppTab) {
        if (_activeRole.value == UserRole.CUSTOMER && (tab == AppTab.ACTIVATE || tab == AppTab.SERVER)) {
            _currentTab.value = AppTab.MAP
            return
        }
        _currentTab.value = tab
    }

    fun switchUserRole(role: UserRole, customerId: String = _activeCustomerId.value) {
        _activeRole.value = role
        _activeCustomerId.value = customerId
        if (role == UserRole.CUSTOMER && (_currentTab.value == AppTab.ACTIVATE || _currentTab.value == AppTab.SERVER)) {
            _currentTab.value = AppTab.MAP
        }
        _routePlayback.value = null
        showBanner(
            if (role == UserRole.ADMIN) {
                "Admin Mode • Full IMEI, SMS & Subscription Control"
            } else {
                "Customer Mode • Supabase RLS Isolated (SET LOCAL ROLE authenticated)"
            }
        )
    }

    fun setFleetFilter(filter: FleetFilter) {
        _fleetFilter.value = filter
    }

    fun selectDevice(deviceId: String?) {
        _selectedDeviceId.value = deviceId
        _routePlayback.value = null
    }

    fun updateActivationForm(transform: (ActivationFormState) -> ActivationFormState) {
        _activationForm.value = transform(_activationForm.value).copy(errorMessage = null)
    }

    fun generateRandomValidImei() {
        val generated = SimAndImeiValidator.generateValidGt06nImei()
        updateActivationForm { it.copy(imei = generated) }
    }

    fun submitDeviceActivation() {
        val form = _activationForm.value
        viewModelScope.launch {
            val result = repository.activateDeviceBySms(
                profileId = form.selectedProfileId,
                imei = form.imei,
                customerId = form.customerId,
                vehicleName = form.vehicleName,
                plateNumber = form.plateNumber,
                planDuration = form.planDuration,
                simLocalInput = form.simLocalWithoutPlus20
            )
            result.onSuccess { newDeviceId ->
                val nextImei = SimAndImeiValidator.generateValidGt06nImei(System.currentTimeMillis() + 77L)
                _activationForm.value = form.copy(
                    imei = nextImei,
                    errorMessage = null,
                    lastActivatedDeviceId = newDeviceId
                )
                _selectedDeviceId.value = newDeviceId
                showBanner("SMS Sequence Dispatched -> Status: WAITING FOR DEVICE (1st Traccar packet required)")
            }.onFailure { err ->
                _activationForm.value = form.copy(errorMessage = err.message ?: "Activation failed")
            }
        }
    }

    fun simulateTraccarConnection(deviceId: String, hasGpsFix: Boolean) {
        viewModelScope.launch {
            repository.onTraccarImeiConnectionConfirmed(deviceId, hasGpsFix)
            val fixText = if (hasGpsFix) "GPS Fix" else "Login/Heartbeat (No GPS Fix)"
            showBanner("Traccar :5023 packet confirmed ($fixText) -> ACTIVATED & Subscription Started")
        }
    }

    fun triggerAdminOverride(deviceId: String, auditReason: String) {
        viewModelScope.launch {
            val res = repository.adminOverrideActivation(
                deviceId = deviceId,
                adminUserId = "usr_admin_01",
                auditReason = auditReason
            )
            res.onSuccess {
                showBanner("Admin Override applied & logged to subscription_history")
            }.onFailure { err ->
                showBanner(err.message ?: "Admin Override failed")
            }
        }
    }

    fun dispatchOptionalManualTimer(deviceId: String, timerCommand: String) {
        viewModelScope.launch {
            repository.sendOptionalManualTimerCommand(deviceId, timerCommand)
            showBanner("Optional firmware TIMER command ($timerCommand) sent")
        }
    }

    fun reassignDeviceToCustomer(deviceId: String, newCustomerId: String, reason: String) {
        viewModelScope.launch {
            repository.reassignDeviceCustomer(
                deviceId = deviceId,
                newCustomerId = newCustomerId,
                adminUserId = "usr_admin_01",
                reason = reason
            ).onSuccess {
                showBanner("Device reassigned • Ownership & history preserved")
            }
        }
    }

    fun renewDeviceSubscription(deviceId: String, planDuration: PlanDuration) {
        viewModelScope.launch {
            repository.renewDeviceSubscription(deviceId, planDuration, "usr_admin_01")
            showBanner("Subscription renewed (${planDuration.shortLabel}) • Live stream unlocked")
        }
    }

    fun triggerFiveSecondExpiryTest(deviceId: String) {
        viewModelScope.launch {
            repository.scheduleFiveSecondExpiryTest(deviceId)
            showBanner("5s Expiry Timer scheduled • Watch live stream cut off in 5s")
        }
    }

    fun openRouteHistory(deviceId: String) {
        viewModelScope.launch {
            val result = repository.getRouteHistoryWithSubscriptionGuard(deviceId)
            result.onSuccess { waypoints ->
                _routePlayback.value = RoutePlaybackState(
                    deviceId = deviceId,
                    waypoints = waypoints,
                    currentIndex = 0,
                    isPlaying = false,
                    blockedReason = null
                )
            }.onFailure { err ->
                _routePlayback.value = RoutePlaybackState(
                    deviceId = deviceId,
                    waypoints = emptyList(),
                    currentIndex = 0,
                    isPlaying = false,
                    blockedReason = err.message ?: "Subscription Expired — Access Blocked"
                )
                showBanner(err.message ?: "Route history blocked")
            }
        }
    }

    fun scrubRoutePlayback(index: Int) {
        val current = _routePlayback.value ?: return
        if (current.waypoints.isEmpty()) return
        _routePlayback.value = current.copy(
            currentIndex = index.coerceIn(0, current.waypoints.lastIndex)
        )
    }

    fun closeRoutePlayback() {
        _routePlayback.value = null
    }

    fun reconnectTraccarSessionBridge() {
        viewModelScope.launch {
            repository.triggerTraccarSessionReconnectAndSync()
            showBanner("Traccar JSESSIONID renewed & GET /api/devices state synced")
        }
    }

    fun updateRetentionDays(days: Int) {
        repository.updateRetentionDays(days)
        showBanner("Controlled batched retention window set to $days days")
    }

    fun clearBanner() {
        _statusBanner.value = null
    }

    private fun showBanner(message: String) {
        _statusBanner.value = message
    }
}
