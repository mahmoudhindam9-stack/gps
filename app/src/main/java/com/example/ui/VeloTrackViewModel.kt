package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.local.CachedWaypointEntity
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.UserProfileEntity
import com.example.data.local.VeloTrackDatabase
import com.example.data.model.ActivationStatus
import com.example.data.model.AuthenticatedSession
import com.example.data.model.DeviceAggregate
import com.example.data.model.GitHubReleaseState
import com.example.data.model.PlanDuration
import com.example.data.model.SubscriptionStatus
import com.example.data.model.TraccarCommandType
import com.example.data.model.UserRole
import com.example.data.model.VehicleIcon
import com.example.data.model.VehicleType
import com.example.data.network.VeloTrackNetworkClient
import com.example.data.repository.ServerStatusSnapshot
import com.example.data.repository.VeloTrackRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
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
    val selectedProfileId: String = "",
    val imei: String = "",
    val serialNumber: String = "",
    val customerId: String = "",
    val vehicleName: String = "",
    val vehicleType: VehicleType = VehicleType.CAR,
    val vehicleIcon: VehicleIcon = VehicleIcon.CAR,
    val plateNumber: String = "",
    val planDuration: PlanDuration = PlanDuration.MONTH_12,
    val simLocalWithoutPlus20: String = "",
    val errorMessage: String? = null,
    val lastActivatedDeviceId: String? = null
)

data class RoutePlaybackState(
    val deviceId: String,
    val waypoints: List<CachedWaypointEntity>,
    val currentIndex: Int = 0,
    val blockedReason: String? = null
)

class VeloTrackViewModel(application: Application) : AndroidViewModel(application) {
    private val dao = VeloTrackDatabase.getInstance(application).veloTrackDao()
    private val repository = VeloTrackRepository(dao, application)

    private val _isDarkTheme = MutableStateFlow(true)
    val isDarkTheme: StateFlow<Boolean> = _isDarkTheme.asStateFlow()

    private val _currentTab = MutableStateFlow(AppTab.MAP)
    val currentTab: StateFlow<AppTab> = _currentTab.asStateFlow()

    private val _fleetFilter = MutableStateFlow(FleetFilter.ALL)
    val fleetFilter: StateFlow<FleetFilter> = _fleetFilter.asStateFlow()

    private val _selectedDeviceId = MutableStateFlow<String?>(null)
    val selectedDeviceId: StateFlow<String?> = _selectedDeviceId.asStateFlow()

    private val _activationForm = MutableStateFlow(ActivationFormState())
    val activationForm: StateFlow<ActivationFormState> = _activationForm.asStateFlow()

    private val _routePlayback = MutableStateFlow<RoutePlaybackState?>(null)
    val routePlayback: StateFlow<RoutePlaybackState?> = _routePlayback.asStateFlow()

    private val _statusBanner = MutableStateFlow<String?>(null)
    val statusBanner: StateFlow<String?> = _statusBanner.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _serverUrlInput = MutableStateFlow(VeloTrackNetworkClient.baseUrl)
    val serverUrlInput: StateFlow<String> = _serverUrlInput.asStateFlow()

    val session: StateFlow<AuthenticatedSession?> = repository.session
    val serverStatus: StateFlow<ServerStatusSnapshot> = repository.serverStatus
    val releaseState: StateFlow<GitHubReleaseState> = repository.releaseState

    init {
        viewModelScope.launch {
            if (releaseState.value.autoUpdateEnabled) {
                repository.checkGitHubRelease()
            }
        }
    }

    val allUsers: StateFlow<List<UserProfileEntity>> = repository.allUsers
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val deviceProfiles: StateFlow<List<DeviceProfileEntity>> = repository.deviceProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val visibleDevices: StateFlow<List<DeviceAggregate>> = repository.observeCachedDeviceAggregates()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

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
                    it.subscription.status == SubscriptionStatus.SUSPENDED.name ||
                    (it.subscription.status == SubscriptionStatus.ACTIVE.name && !it.isSubscriptionAccessible(now))
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun toggleDarkTheme() {
        _isDarkTheme.value = !_isDarkTheme.value
    }

    fun selectTab(tab: AppTab) {
        val role = session.value?.role ?: UserRole.CUSTOMER
        if (role == UserRole.CUSTOMER && (tab == AppTab.ACTIVATE || tab == AppTab.SERVER)) {
            _currentTab.value = AppTab.MAP
            return
        }
        _currentTab.value = tab
    }

    fun setFleetFilter(filter: FleetFilter) {
        _fleetFilter.value = filter
    }

    fun selectDevice(deviceId: String?) {
        _selectedDeviceId.value = deviceId
        _routePlayback.value = null
    }

    fun updateServerUrl(url: String) {
        _serverUrlInput.value = url
        repository.updateBackendBaseUrl(url)
    }

    fun toggleAutoUpdate() {
        val next = !releaseState.value.autoUpdateEnabled
        repository.setAutoUpdateEnabled(next)
        if (next) {
            checkGitHubRelease()
        }
    }

    fun checkGitHubRelease() {
        viewModelScope.launch {
            val res = repository.checkGitHubRelease()
            res.onSuccess { info ->
                showBanner(
                    if (info.updateAvailable) "Update ${info.tagName} available"
                    else "Up to date (${info.tagName})"
                )
            }.onFailure { err ->
                showBanner(err.message ?: "GitHub check failed")
            }
        }
    }

    fun login(identifier: String, password: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.login(identifier, password)
            _isLoading.value = false
            res.onSuccess { auth ->
                _currentTab.value = AppTab.MAP
                val label = auth.username ?: auth.email.ifBlank { auth.fullName }
                showBanner(
                    if (auth.mustChangePassword) "Password change required"
                    else "${auth.role.shortLabel} • $label"
                )
            }.onFailure { err ->
                showBanner(err.message ?: "Login failed")
            }
        }
    }

    fun changePassword(currentPassword: String, newPassword: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.changePassword(currentPassword, newPassword)
            _isLoading.value = false
            res.onSuccess { auth ->
                _currentTab.value = AppTab.MAP
                showBanner("${auth.role.shortLabel} • ${auth.username ?: auth.email.ifBlank { auth.fullName }}")
            }.onFailure { err ->
                showBanner(err.message ?: "Password update failed")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            _selectedDeviceId.value = null
            _routePlayback.value = null
            _currentTab.value = AppTab.MAP
        }
    }

    fun refreshFromServer() {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.refreshSnapshotFromServer()
            _isLoading.value = false
            res.onFailure { err ->
                showBanner(err.message ?: "Sync failed")
            }
        }
    }

    fun checkServerHealth() {
        viewModelScope.launch {
            _isLoading.value = true
            repository.checkServerHealth()
            _isLoading.value = false
        }
    }

    fun syncTraccarOnBackend() {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.triggerTraccarSyncOnBackend()
            _isLoading.value = false
            res.onSuccess {
                showBanner("Synced")
            }.onFailure { err ->
                showBanner(err.message ?: "Traccar sync failed")
            }
        }
    }

    fun updateActivationForm(transform: (ActivationFormState) -> ActivationFormState) {
        _activationForm.value = transform(_activationForm.value).copy(errorMessage = null)
    }

    fun submitDeviceActivation() {
        val form = _activationForm.value
        viewModelScope.launch {
            _isLoading.value = true
            val result = repository.activateDeviceBySms(
                profileId = form.selectedProfileId,
                imei = form.imei,
                serialNumber = form.serialNumber,
                customerId = form.customerId,
                vehicleName = form.vehicleName,
                vehicleType = form.vehicleType,
                vehicleIcon = form.vehicleIcon,
                plateNumber = form.plateNumber,
                planDuration = form.planDuration,
                simLocalInput = form.simLocalWithoutPlus20
            )
            _isLoading.value = false
            result.onSuccess { newDeviceId ->
                _activationForm.value = ActivationFormState(
                    selectedProfileId = form.selectedProfileId,
                    customerId = form.customerId,
                    vehicleType = form.vehicleType,
                    vehicleIcon = form.vehicleIcon,
                    planDuration = form.planDuration,
                    lastActivatedDeviceId = newDeviceId
                )
                _selectedDeviceId.value = newDeviceId
                showBanner("SMS_SENT")
            }.onFailure { err ->
                _activationForm.value = form.copy(errorMessage = err.message ?: "Activation failed")
            }
        }
    }

    fun sendActivationSms(deviceId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.sendActivationSms(deviceId)
            _isLoading.value = false
            res.onSuccess { duplicatePrevented ->
                showBanner(if (duplicatePrevented) "SMS already active" else "SMS_SENT")
            }.onFailure { err ->
                showBanner(err.message ?: "Send SMS failed")
            }
        }
    }

    fun triggerAdminOverride(deviceId: String, auditReason: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.adminOverrideActivation(deviceId, auditReason)
            _isLoading.value = false
            res.onSuccess {
                showBanner("ACTIVATED")
            }.onFailure { err ->
                showBanner(err.message ?: "Override failed")
            }
        }
    }

    fun reassignDeviceToCustomer(deviceId: String, newCustomerId: String, reason: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.reassignDeviceCustomer(deviceId, newCustomerId, reason)
            _isLoading.value = false
            res.onSuccess {
                showBanner("Reassigned")
            }.onFailure { err ->
                showBanner(err.message ?: "Reassign failed")
            }
        }
    }

    fun renewDeviceSubscription(deviceId: String, planDuration: PlanDuration) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.renewDeviceSubscription(deviceId, planDuration)
            _isLoading.value = false
            res.onSuccess {
                showBanner("Renewed (${planDuration.shortLabel})")
            }.onFailure { err ->
                showBanner(err.message ?: "Renewal failed")
            }
        }
    }

    fun suspendDeviceSubscription(deviceId: String, reason: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.suspendDeviceSubscription(deviceId, reason)
            _isLoading.value = false
            res.onSuccess {
                showBanner("SUSPENDED")
            }.onFailure { err ->
                showBanner(err.message ?: "Suspend failed")
            }
        }
    }

    fun resumeDeviceSubscription(deviceId: String, reason: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.resumeDeviceSubscription(deviceId, reason)
            _isLoading.value = false
            res.onSuccess {
                showBanner("ACTIVE")
            }.onFailure { err ->
                showBanner(err.message ?: "Resume failed")
            }
        }
    }

    fun sendDeviceCommand(deviceId: String, commandType: TraccarCommandType) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.sendDeviceCommand(deviceId, commandType, confirmed = true)
            _isLoading.value = false
            res.onSuccess { status ->
                showBanner("${commandType.shortLabel}: $status")
            }.onFailure { err ->
                showBanner(err.message ?: "Command failed")
            }
        }
    }

    fun openRouteHistory(deviceId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val result = repository.fetchRouteHistoryFromServer(deviceId)
            _isLoading.value = false
            result.onSuccess { waypoints ->
                _routePlayback.value = RoutePlaybackState(
                    deviceId = deviceId,
                    waypoints = waypoints,
                    currentIndex = 0,
                    blockedReason = null
                )
            }.onFailure { err ->
                _routePlayback.value = RoutePlaybackState(
                    deviceId = deviceId,
                    waypoints = emptyList(),
                    currentIndex = 0,
                    blockedReason = err.message ?: "EXPIRED"
                )
                showBanner(err.message ?: "History blocked")
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

    fun clearBanner() {
        _statusBanner.value = null
    }

    private fun showBanner(message: String) {
        _statusBanner.value = message
    }
}
