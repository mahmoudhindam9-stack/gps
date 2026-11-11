package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.model.AuthenticatedSession
import com.example.data.model.BackendConnectionState
import com.example.data.model.UserRole
import com.example.data.repository.ServerStatusSnapshot
import com.example.ui.AppTab
import com.example.ui.VeloTrackViewModel
import com.example.ui.screens.AdminDeviceActivationScreen
import com.example.ui.screens.DevicesAndSubscriptionsScreen
import com.example.ui.screens.FleetIntelligenceScreen
import com.example.ui.screens.LiveFleetMapScreen
import com.example.ui.screens.ServerArchitectureScreen
import com.example.ui.screens.StatusPill
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber
import com.example.ui.theme.VeloTrackTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val viewModel: VeloTrackViewModel = viewModel()
            val isDarkTheme by viewModel.isDarkTheme.collectAsStateWithLifecycle()

            VeloTrackTheme(darkTheme = isDarkTheme) {
                VeloTrackAppShell(viewModel = viewModel)
            }
        }
    }
}

@Composable
fun VeloTrackAppShell(viewModel: VeloTrackViewModel) {
    val isDarkTheme by viewModel.isDarkTheme.collectAsStateWithLifecycle()
    val currentTab by viewModel.currentTab.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()
    val serverStatus by viewModel.serverStatus.collectAsStateWithLifecycle()
    val releaseState by viewModel.releaseState.collectAsStateWithLifecycle()
    val serverUrlInput by viewModel.serverUrlInput.collectAsStateWithLifecycle()
    val fleetFilter by viewModel.fleetFilter.collectAsStateWithLifecycle()
    val selectedDeviceId by viewModel.selectedDeviceId.collectAsStateWithLifecycle()
    val visibleDevices by viewModel.visibleDevices.collectAsStateWithLifecycle()
    val filteredDevices by viewModel.filteredDevices.collectAsStateWithLifecycle()
    val allUsers by viewModel.allUsers.collectAsStateWithLifecycle()
    val deviceProfiles by viewModel.deviceProfiles.collectAsStateWithLifecycle()
    val activationForm by viewModel.activationForm.collectAsStateWithLifecycle()
    val routePlayback by viewModel.routePlayback.collectAsStateWithLifecycle()
    val fleetIntelligence by viewModel.fleetIntelligence.collectAsStateWithLifecycle()
    val statusBanner by viewModel.statusBanner.collectAsStateWithLifecycle()

    if (session != null && session?.mustChangePassword == false && currentTab != AppTab.MAP) {
        BackHandler {
            viewModel.selectTab(AppTab.MAP)
        }
    }

    val activeRole = session?.role ?: UserRole.CUSTOMER
    val availableTabs = if (activeRole == UserRole.ADMIN) {
        listOf(AppTab.MAP, AppTab.ACTIVATE, AppTab.DEVICES, AppTab.FLEET, AppTab.SERVER)
    } else {
        listOf(AppTab.MAP, AppTab.DEVICES, AppTab.FLEET)
    }

    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            VeloTrackTopHeader(
                session = session,
                serverStatus = serverStatus,
                isDarkTheme = isDarkTheme,
                onRefresh = { viewModel.refreshFromServer() },
                onToggleTheme = { viewModel.toggleDarkTheme() },
                onLogout = { viewModel.logout() }
            )
        },
        bottomBar = {
            if (session != null && !session!!.mustChangePassword) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 6.dp
                ) {
                    availableTabs.forEach { tab ->
                        val icon = when (tab) {
                            AppTab.MAP -> Icons.Default.Map
                            AppTab.ACTIVATE -> Icons.Default.Sms
                            AppTab.DEVICES -> Icons.Default.Devices
                            AppTab.FLEET -> Icons.Default.Radar
                            AppTab.SERVER -> Icons.Default.Dns
                        }
                        NavigationBarItem(
                            selected = currentTab == tab,
                            onClick = { viewModel.selectTab(tab) },
                            icon = { Icon(icon, contentDescription = tab.shortLabel) },
                            label = { Text(tab.shortLabel) },
                            modifier = Modifier.testTag("nav_tab_${tab.name.lowercase()}")
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            if (statusBanner != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.primaryContainer)
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .testTag("status_feedback_banner")
                ) {
                    Text(
                        text = statusBanner!!,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = { viewModel.clearBanner() },
                        modifier = Modifier.size(22.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Dismiss",
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                if (session == null) {
                    VeloTrackLoginScreen(
                        serverStatus = serverStatus,
                        onLogin = { identifier, pass -> viewModel.login(identifier, pass) }
                    )
                } else if (session!!.mustChangePassword) {
                    VeloTrackForcePasswordChangeScreen(
                        onChangePassword = { currentPass, newPass ->
                            viewModel.changePassword(currentPass, newPass)
                        }
                    )
                } else {
                    when (currentTab) {
                        AppTab.MAP -> LiveFleetMapScreen(
                            devices = filteredDevices,
                            selectedDeviceId = selectedDeviceId,
                            activeFilter = fleetFilter,
                            activeRole = activeRole,
                            routePlayback = routePlayback,
                            isDarkTheme = isDarkTheme,
                            onSelectFilter = { viewModel.setFleetFilter(it) },
                            onSelectDevice = { viewModel.selectDevice(it) },
                            onOpenRouteHistory = { viewModel.openRouteHistory(it) },
                            onScrubRoute = { viewModel.scrubRoutePlayback(it) },
                            onCloseRouteHistory = { viewModel.closeRoutePlayback() },
                            onQuickRenew = { devId, plan ->
                                viewModel.renewDeviceSubscription(devId, plan)
                            },
                            onNavigateToActivate = { viewModel.selectTab(AppTab.ACTIVATE) },
                            onRefresh = { viewModel.refreshFromServer() }
                        )

                        AppTab.ACTIVATE -> AdminDeviceActivationScreen(
                            formState = activationForm,
                            profiles = deviceProfiles,
                            customers = allUsers,
                            allDevices = visibleDevices,
                            onUpdateForm = { viewModel.updateActivationForm(it) },
                            onSubmitActivation = { viewModel.submitDeviceActivation() },
                            onSendActivationSms = { devId -> viewModel.sendActivationSms(devId) },
                            onAdminOverride = { devId, reason ->
                                viewModel.triggerAdminOverride(devId, reason)
                            }
                        )

                        AppTab.DEVICES -> DevicesAndSubscriptionsScreen(
                            devices = visibleDevices,
                            customers = allUsers,
                            activeRole = activeRole,
                            onReassignCustomer = { devId, newCustId, reason ->
                                viewModel.reassignDeviceToCustomer(devId, newCustId, reason)
                            },
                            onRenewSubscription = { devId, plan ->
                                viewModel.renewDeviceSubscription(devId, plan)
                            },
                            onSuspendSubscription = { devId, reason ->
                                viewModel.suspendDeviceSubscription(devId, reason)
                            },
                            onResumeSubscription = { devId, reason ->
                                viewModel.resumeDeviceSubscription(devId, reason)
                            },
                            onSendCommand = { devId, cmdType ->
                                viewModel.sendDeviceCommand(devId, cmdType)
                            }
                        )

                        AppTab.FLEET -> FleetIntelligenceScreen(
                            devices = visibleDevices,
                            activeRole = activeRole,
                            uiState = fleetIntelligence,
                            isDarkTheme = isDarkTheme,
                            onSelectSubTab = { viewModel.selectFleetSubTab(it) },
                            onSelectDeviceFilter = { viewModel.setFleetIntelligenceDeviceFilter(it) },
                            onSelectPeriod = { viewModel.setFleetIntelligencePeriod(it) },
                            onSelectEventTypeFilter = { viewModel.setFleetIntelligenceEventType(it) },
                            onToggleLanguage = { viewModel.toggleFleetLanguage() },
                            onRefreshActiveSection = { viewModel.refreshFleetIntelligence() },
                            onCreateGeofence = { name, desc, area, devIds ->
                                viewModel.createFleetGeofence(name, desc, area, devIds)
                            },
                            onDeleteGeofence = { id -> viewModel.deleteFleetGeofence(id) },
                            onCreateShareLink = { devId, hrs ->
                                viewModel.createFleetShareLink(devId, hrs)
                            }
                        )

                        AppTab.SERVER -> ServerArchitectureScreen(
                            serverUrlInput = serverUrlInput,
                            serverStatus = serverStatus,
                            releaseState = releaseState,
                            onUpdateServerUrl = { viewModel.updateServerUrl(it) },
                            onCheckHealth = { viewModel.checkServerHealth() },
                            onSyncTraccar = { viewModel.syncTraccarOnBackend() },
                            onToggleAutoUpdate = { viewModel.toggleAutoUpdate() },
                            onCheckGitHubRelease = { viewModel.checkGitHubRelease() }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VeloTrackLoginScreen(
    serverStatus: ServerStatusSnapshot,
    onLogin: (String, String) -> Unit
) {
    var identifier by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag("login_screen")
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 420.dp)
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Login",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    StatusPill(
                        text = serverStatus.connectionState.shortLabel,
                        color = when (serverStatus.connectionState) {
                            BackendConnectionState.CONNECTED -> StatusMovingEmerald
                            BackendConnectionState.CONNECTING, BackendConnectionState.RECONNECTING -> StatusWaitingAmber
                            BackendConnectionState.UNAUTHORIZED -> StatusExpiredCrimson
                            BackendConnectionState.DISCONNECTED -> StatusOfflineSlate
                        }
                    )
                }

                OutlinedTextField(
                    value = identifier,
                    onValueChange = { identifier = it },
                    label = { Text("Username or Phone") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("login_email_input")
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("login_password_input")
                )

                if (serverStatus.lastErrorMessage != null) {
                    Text(
                        text = serverStatus.lastErrorMessage,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp,
                        color = StatusExpiredCrimson
                    )
                }

                Button(
                    onClick = { onLogin(identifier, password) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .testTag("login_submit_button")
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Login", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun VeloTrackForcePasswordChangeScreen(
    onChangePassword: (String, String) -> Unit
) {
    var currentPassword by rememberSaveable { mutableStateOf("") }
    var newPassword by rememberSaveable { mutableStateOf("") }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag("force_password_change_screen")
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 420.dp)
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Change Password",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    StatusPill(
                        text = "REQUIRED",
                        color = StatusWaitingAmber
                    )
                }

                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("Current Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("change_password_current_input")
                )

                OutlinedTextField(
                    value = newPassword,
                    onValueChange = { newPassword = it },
                    label = { Text("New Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("change_password_new_input")
                )

                Button(
                    onClick = { onChangePassword(currentPassword, newPassword) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .testTag("change_password_submit_button")
                ) {
                    Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Update Password", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun VeloTrackTopHeader(
    session: AuthenticatedSession?,
    serverStatus: ServerStatusSnapshot,
    isDarkTheme: Boolean,
    onRefresh: () -> Unit,
    onToggleTheme: () -> Unit,
    onLogout: () -> Unit
) {
    val connColor = when (serverStatus.connectionState) {
        BackendConnectionState.CONNECTED -> StatusMovingEmerald
        BackendConnectionState.CONNECTING, BackendConnectionState.RECONNECTING -> StatusWaitingAmber
        BackendConnectionState.UNAUTHORIZED -> StatusExpiredCrimson
        BackendConnectionState.DISCONNECTED -> StatusOfflineSlate
    }

    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "VeloTrack GPS",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                StatusPill(
                    text = serverStatus.connectionState.shortLabel,
                    color = connColor
                )
                if (session != null) {
                    StatusPill(
                        text = session.role.shortLabel,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                if (session != null && !session.mustChangePassword) {
                    IconButton(
                        onClick = onRefresh,
                        modifier = Modifier
                            .size(36.dp)
                            .testTag("header_refresh_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Refresh"
                        )
                    }
                }
                IconButton(
                    onClick = onToggleTheme,
                    modifier = Modifier
                        .size(36.dp)
                        .testTag("toggle_theme_button")
                ) {
                    Icon(
                        imageVector = if (isDarkTheme) Icons.Default.LightMode else Icons.Default.DarkMode,
                        contentDescription = "Theme"
                    )
                }
                if (session != null) {
                    IconButton(
                        onClick = onLogout,
                        modifier = Modifier
                            .size(36.dp)
                            .testTag("header_logout_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = "Logout"
                        )
                    }
                }
            }
        }
    }
}
