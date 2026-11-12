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
import com.example.data.network.ServerDeviceShareResponseDto
import com.example.data.network.ServerFleetEventDto
import com.example.data.network.ServerFleetTelemetryDto
import com.example.data.network.ServerGeofenceDto
import com.example.data.network.ServerMileageSummaryDto
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
    FLEET("Fleet"),
    SERVER("Server")
}

enum class FleetSubTab {
    EVENTS,
    GEOFENCES,
    TELEMETRY,
    REPORTS,
    SHARE
}

enum class FleetPeriodPreset(
    val hours: Long,
    val labelEn: String,
    val labelAr: String
) {
    HOURS_24(24L, "24H", "24 ساعة"),
    DAYS_7(24L * 7L, "7D", "7 أيام"),
    DAYS_30(24L * 30L, "30D", "30 يوم"),
    DAYS_90(24L * 90L, "90D", "90 يوم")
}

data class FleetIntelligenceUiState(
    val activeSubTab: FleetSubTab = FleetSubTab.EVENTS,
    val selectedDeviceId: String? = null,
    val selectedPeriod: FleetPeriodPreset = FleetPeriodPreset.HOURS_24,
    val selectedEventType: String = "ALL",
    val isArabic: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val events: List<ServerFleetEventDto> = emptyList(),
    val geofences: List<ServerGeofenceDto> = emptyList(),
    val telemetry: List<ServerFleetTelemetryDto> = emptyList(),
    val mileageReports: List<ServerMileageSummaryDto> = emptyList(),
    val latestShareLink: ServerDeviceShareResponseDto? = null
)

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

    private val _fleetIntelligence = MutableStateFlow(FleetIntelligenceUiState())
    val fleetIntelligence: StateFlow<FleetIntelligenceUiState> = _fleetIntelligence.asStateFlow()

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

    val hasAdminAccount: StateFlow<Boolean> = combine(allUsers, session) { users, activeSession ->
        activeSession?.role == UserRole.ADMIN ||
            users.any { it.role.equals("ADMIN", ignoreCase = true) && it.isActive }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val deviceProfiles: StateFlow<List<DeviceProfileEntity>> = repository.deviceProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val visibleDevices: StateFlow<List<DeviceAggregate>> = combine(
        repository.observeCachedDeviceAggregates(),
        session
    ) { list, activeSession ->
        when {
            activeSession == null -> emptyList()
            activeSession.role == UserRole.ADMIN -> list
            else -> list.filter { it.device.currentCustomerId == activeSession.userId }
        }
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
        if (tab == AppTab.FLEET) {
            refreshFleetIntelligence()
        }
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

    fun bootstrapFirstAdmin(
        username: String,
        email: String,
        fullName: String,
        phone: String,
        password: String
    ) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.bootstrapFirstAdmin(
                username = username,
                email = email,
                fullName = fullName,
                phone = phone,
                password = password
            )
            _isLoading.value = false
            res.onSuccess { auth ->
                _currentTab.value = AppTab.MAP
                val label = auth.username ?: auth.email.ifBlank { auth.fullName }
                showBanner("First Admin created • $label")
            }.onFailure { err ->
                showBanner(err.message ?: "First Admin creation failed")
            }
        }
    }

    fun createAccountInSupabase(
        fullName: String,
        username: String,
        phone: String,
        email: String = "",
        password: String,
        role: UserRole = UserRole.CUSTOMER,
        onCreated: ((UserProfileEntity) -> Unit)? = null
    ) {
        viewModelScope.launch {
            _isLoading.value = true
            val res = repository.createUserAccountInSupabase(
                fullName = fullName,
                username = username,
                phone = phone,
                email = email,
                password = password,
                role = role
            )
            _isLoading.value = false
            res.onSuccess { created ->
                _activationForm.value = _activationForm.value.copy(customerId = created.id)
                showBanner("Account created (${created.username ?: created.fullName})")
                onCreated?.invoke(created)
            }.onFailure { err ->
                showBanner(err.message ?: "Account creation failed")
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

    fun selectFleetSubTab(subTab: FleetSubTab) {
        _fleetIntelligence.value = _fleetIntelligence.value.copy(
            activeSubTab = subTab,
            errorMessage = null
        )
        refreshFleetIntelligence()
    }

    fun setFleetIntelligenceDeviceFilter(deviceId: String?) {
        _fleetIntelligence.value = _fleetIntelligence.value.copy(
            selectedDeviceId = deviceId,
            errorMessage = null
        )
        refreshFleetIntelligence()
    }

    fun setFleetIntelligencePeriod(period: FleetPeriodPreset) {
        _fleetIntelligence.value = _fleetIntelligence.value.copy(
            selectedPeriod = period,
            errorMessage = null
        )
        refreshFleetIntelligence()
    }

    fun setFleetIntelligenceEventType(eventType: String) {
        _fleetIntelligence.value = _fleetIntelligence.value.copy(selectedEventType = eventType)
    }

    fun toggleFleetLanguage() {
        _fleetIntelligence.value = _fleetIntelligence.value.copy(
            isArabic = !_fleetIntelligence.value.isArabic
        )
    }

    fun refreshFleetIntelligence() {
        val current = _fleetIntelligence.value
        val toMs = System.currentTimeMillis()
        val fromMs = toMs - (current.selectedPeriod.hours * 3_600_000L)

        viewModelScope.launch {
            _fleetIntelligence.value = _fleetIntelligence.value.copy(
                isLoading = true,
                errorMessage = null
            )
            when (current.activeSubTab) {
                FleetSubTab.EVENTS -> {
                    val res = repository.fetchFleetEvents(fromMs, toMs, current.selectedDeviceId)
                    res.onSuccess { list ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            events = list
                        )
                    }.onFailure { err ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Events failed"
                        )
                    }
                }

                FleetSubTab.GEOFENCES -> {
                    val res = repository.fetchGeofences()
                    res.onSuccess { list ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            geofences = list
                        )
                    }.onFailure { err ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Geofences failed"
                        )
                    }
                }

                FleetSubTab.TELEMETRY -> {
                    val res = repository.fetchFleetTelemetry(current.selectedDeviceId)
                    res.onSuccess { list ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            telemetry = list
                        )
                    }.onFailure { err ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Telemetry failed"
                        )
                    }
                }

                FleetSubTab.REPORTS -> {
                    val res = repository.fetchMileageSummary(fromMs, toMs, current.selectedDeviceId)
                    res.onSuccess { list ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            mileageReports = list
                        )
                    }.onFailure { err ->
                        _fleetIntelligence.value = _fleetIntelligence.value.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Reports failed"
                        )
                    }
                }

                FleetSubTab.SHARE -> {
                    _fleetIntelligence.value = _fleetIntelligence.value.copy(isLoading = false)
                }
            }
        }
    }

    fun createFleetGeofence(
        name: String,
        description: String,
        area: String,
        deviceIds: List<String>
    ) {
        viewModelScope.launch {
            _fleetIntelligence.value = _fleetIntelligence.value.copy(
                isLoading = true,
                errorMessage = null
            )
            val res = repository.createGeofence(name, description, area, deviceIds)
            res.onSuccess {
                showBanner("Geofence saved")
                refreshFleetIntelligence()
            }.onFailure { err ->
                _fleetIntelligence.value = _fleetIntelligence.value.copy(
                    isLoading = false,
                    errorMessage = err.message ?: "Create geofence failed"
                )
            }
        }
    }

    fun deleteFleetGeofence(geofenceId: Long) {
        viewModelScope.launch {
            _fleetIntelligence.value = _fleetIntelligence.value.copy(
                isLoading = true,
                errorMessage = null
            )
            val res = repository.deleteGeofence(geofenceId)
            res.onSuccess {
                showBanner("Geofence deleted")
                refreshFleetIntelligence()
            }.onFailure { err ->
                _fleetIntelligence.value = _fleetIntelligence.value.copy(
                    isLoading = false,
                    errorMessage = err.message ?: "Delete geofence failed"
                )
            }
        }
    }

    fun createFleetShareLink(deviceId: String, expiresInHours: Int) {
        viewModelScope.launch {
            _fleetIntelligence.value = _fleetIntelligence.value.copy(
                isLoading = true,
                errorMessage = null
            )
            val res = repository.createDeviceShareLink(deviceId, expiresInHours)
            res.onSuccess { share ->
                _fleetIntelligence.value = _fleetIntelligence.value.copy(
                    isLoading = false,
                    latestShareLink = share,
                    errorMessage = null
                )
                showBanner("Share link ready")
            }.onFailure { err ->
                _fleetIntelligence.value = _fleetIntelligence.value.copy(
                    isLoading = false,
                    errorMessage = err.message ?: "Create share link failed"
                )
            }
        }
    }

    fun clearBanner() {
        _statusBanner.value = null
    }

    private fun showBanner(message: String) {
        _statusBanner.value = message
    }
}
