package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.model.UserRole
import com.example.ui.AppTab
import com.example.ui.VeloTrackViewModel
import com.example.ui.screens.AdminDeviceActivationScreen
import com.example.ui.screens.DevicesAndSubscriptionsScreen
import com.example.ui.screens.LiveFleetMapScreen
import com.example.ui.screens.ServerArchitectureScreen
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusMovingEmerald
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
    val activeRole by viewModel.activeRole.collectAsStateWithLifecycle()
    val activeCustomerId by viewModel.activeCustomerId.collectAsStateWithLifecycle()
    val fleetFilter by viewModel.fleetFilter.collectAsStateWithLifecycle()
    val selectedDeviceId by viewModel.selectedDeviceId.collectAsStateWithLifecycle()
    val visibleDevices by viewModel.visibleDevices.collectAsStateWithLifecycle()
    val filteredDevices by viewModel.filteredDevices.collectAsStateWithLifecycle()
    val allUsers by viewModel.allUsers.collectAsStateWithLifecycle()
    val deviceProfiles by viewModel.deviceProfiles.collectAsStateWithLifecycle()
    val activationForm by viewModel.activationForm.collectAsStateWithLifecycle()
    val routePlayback by viewModel.routePlayback.collectAsStateWithLifecycle()
    val gatewayStatus by viewModel.gatewayStatus.collectAsStateWithLifecycle()
    val statusBanner by viewModel.statusBanner.collectAsStateWithLifecycle()

    if (currentTab != AppTab.MAP) {
        BackHandler {
            viewModel.selectTab(AppTab.MAP)
        }
    }

    val availableTabs = if (activeRole == UserRole.ADMIN) {
        listOf(AppTab.MAP, AppTab.ACTIVATE, AppTab.DEVICES, AppTab.SERVER)
    } else {
        listOf(AppTab.MAP, AppTab.DEVICES)
    }

    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            VeloTrackTopHeader(
                activeRole = activeRole,
                activeCustomerId = activeCustomerId,
                isDarkTheme = isDarkTheme,
                onSwitchRole = { role, custId -> viewModel.switchUserRole(role, custId) },
                onToggleTheme = { viewModel.toggleDarkTheme() }
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp
            ) {
                availableTabs.forEach { tab ->
                    val icon = when (tab) {
                        AppTab.MAP -> Icons.Default.Map
                        AppTab.ACTIVATE -> Icons.Default.Sms
                        AppTab.DEVICES -> Icons.Default.Devices
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
                        onSimulateTraccarPacket = { devId, hasFix ->
                            viewModel.simulateTraccarConnection(devId, hasFix)
                        },
                        onQuickRenew = { devId, plan ->
                            viewModel.renewDeviceSubscription(devId, plan)
                        },
                        onTestFiveSecExpiry = { devId ->
                            viewModel.triggerFiveSecondExpiryTest(devId)
                        }
                    )

                    AppTab.ACTIVATE -> AdminDeviceActivationScreen(
                        formState = activationForm,
                        profiles = deviceProfiles,
                        customers = allUsers,
                        allDevices = visibleDevices,
                        onUpdateForm = { viewModel.updateActivationForm(it) },
                        onGenerateValidImei = { viewModel.generateRandomValidImei() },
                        onSubmitActivation = { viewModel.submitDeviceActivation() },
                        onSimulateTraccarConnection = { devId, hasFix ->
                            viewModel.simulateTraccarConnection(devId, hasFix)
                        },
                        onAdminOverride = { devId, reason ->
                            viewModel.triggerAdminOverride(devId, reason)
                        },
                        onSendOptionalManualTimer = { devId, timerCmd ->
                            viewModel.dispatchOptionalManualTimer(devId, timerCmd)
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
                        onTriggerFiveSecExpiry = { devId ->
                            viewModel.triggerFiveSecondExpiryTest(devId)
                        },
                        onSimulateFirstConnection = { devId ->
                            viewModel.simulateTraccarConnection(devId, true)
                        }
                    )

                    AppTab.SERVER -> ServerArchitectureScreen(
                        gatewayStatus = gatewayStatus,
                        onReconnectTraccarBridge = { viewModel.reconnectTraccarSessionBridge() },
                        onUpdateRetentionDays = { viewModel.updateRetentionDays(it) }
                    )
                }
            }
        }
    }
}

@Composable
private fun VeloTrackTopHeader(
    activeRole: UserRole,
    activeCustomerId: String,
    isDarkTheme: Boolean,
    onSwitchRole: (UserRole, String) -> Unit,
    onToggleTheme: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
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
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(StatusMovingEmerald.copy(alpha = 0.16f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "GT06N :5023",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            color = StatusMovingEmerald
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
                        contentDescription = "Toggle Theme"
                    )
                }
            }

            // Role & Tenant Isolation Switcher (Admin vs Customer #1 vs Customer #2)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
            ) {
                RoleChipButton(
                    label = "ADMIN",
                    isSelected = activeRole == UserRole.ADMIN,
                    isAdmin = true,
                    onClick = { onSwitchRole(UserRole.ADMIN, activeCustomerId) },
                    testTag = "role_switch_admin"
                )
                RoleChipButton(
                    label = "CUSTOMER: Ahmed (Nile)",
                    isSelected = activeRole == UserRole.CUSTOMER && activeCustomerId == "usr_cust_01",
                    isAdmin = false,
                    onClick = { onSwitchRole(UserRole.CUSTOMER, "usr_cust_01") },
                    testTag = "role_switch_cust_01"
                )
                RoleChipButton(
                    label = "CUSTOMER: Sara (Delta)",
                    isSelected = activeRole == UserRole.CUSTOMER && activeCustomerId == "usr_cust_02",
                    isAdmin = false,
                    onClick = { onSwitchRole(UserRole.CUSTOMER, "usr_cust_02") },
                    testTag = "role_switch_cust_02"
                )
            }
        }
    }
}

@Composable
private fun RoleChipButton(
    label: String,
    isSelected: Boolean,
    isAdmin: Boolean,
    onClick: () -> Unit,
    testTag: String
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (isSelected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
            )
            .border(
                width = 1.dp,
                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                shape = RoundedCornerShape(8.dp)
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .testTag(testTag)
    ) {
        Icon(
            imageVector = if (isAdmin) Icons.Default.Security else Icons.Default.Person,
            contentDescription = null,
            tint = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = label,
            fontFamily = JetBrainsMonoFontFamily,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
        )
    }
}
