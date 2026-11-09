package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.GpsOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.UserProfileEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.PlanDuration
import com.example.data.model.SimAndImeiValidator
import com.example.ui.ActivationFormState
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber

/**
 * Dedicated Admin Device Activation Module.
 * - Strictly excludes APN configuration (SIMs auto-configure APN on power-up).
 * - Strictly excludes automatic TIMER modification during activation.
 * - Normalizes Egyptian SIM number entered WITHOUT +20.
 * - Displays live 4-Stage Activation Verification State Machine:
 *   PENDING -> SMS SENT -> WAITING FOR DEVICE -> ACTIVATED / FAILED.
 */
@Composable
fun AdminDeviceActivationScreen(
    formState: ActivationFormState,
    profiles: List<DeviceProfileEntity>,
    customers: List<UserProfileEntity>,
    allDevices: List<DeviceAggregate>,
    onUpdateForm: ((ActivationFormState) -> ActivationFormState) -> Unit,
    onGenerateValidImei: () -> Unit,
    onSubmitActivation: () -> Unit,
    onSimulateTraccarConnection: (String, Boolean) -> Unit,
    onAdminOverride: (String, String) -> Unit,
    onSendOptionalManualTimer: (String, String) -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedProfile = profiles.find { it.id == formState.selectedProfileId } ?: profiles.firstOrNull()
    val customerList = customers.filter { it.role == "CUSTOMER" }
    val simValidation = SimAndImeiValidator.normalizeEgyptianSim(formState.simLocalWithoutPlus20)
    val imeiValid = SimAndImeiValidator.isValidImei(formState.imei)

    // Inspect either the most recently submitted device or any device currently in WAITING_FOR_DEVICE
    val trackedDevice = allDevices.find { it.device.id == formState.lastActivatedDeviceId }
        ?: allDevices.firstOrNull { it.device.activationStatus != ActivationStatus.ACTIVATED.name }
        ?: allDevices.firstOrNull()

    var showOverrideDialogForDeviceId by remember { mutableStateOf<String?>(null) }
    var overrideReasonText by remember { mutableStateOf("Bench-verified IMEI login on private VPS") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
            .testTag("admin_device_activation_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Section Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                Text(
                    text = "Device Activation (SMS)",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "APN-Free Server Provisioning • Starts on 1st Traccar Connection",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            StatusPill(text = "PORT 5023 TCP", color = MaterialTheme.colorScheme.primary)
        }

        // 1. Versioned Device Profile Selector (Manufacturer + Model + Firmware)
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "1. DEVICE PROFILE & FIRMWARE (VERSIONED REGISTRY)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                profiles.forEach { profile ->
                    val isSelected = profile.id == selectedProfile?.id
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
                                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                            )
                            .border(
                                width = 1.dp,
                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                                shape = RoundedCornerShape(8.dp)
                            )
                            .clickable {
                                onUpdateForm { it.copy(selectedProfileId = profile.id) }
                            }
                            .padding(10.dp)
                            .testTag("profile_option_${profile.id}")
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${profile.manufacturer} ${profile.model} • ${profile.firmwareVersion}",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "CMD 1: ${profile.serverCommandTemplate}" +
                                    (profile.gprsonCommandTemplate?.let { " | CMD 2: $it" } ?: " (GPRSON not needed)"),
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        StatusPill(
                            text = "${profile.serverMode}/${profile.transport}",
                            color = if (isSelected) StatusMovingEmerald else StatusOfflineSlate
                        )
                    }
                }
            }
        }

        // 2. IMEI, Vehicle Callsign, Egyptian SIM (Without +20), Customer & Plan Duration
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "2. HARDWARE IMEI, EGYPTIAN SIM & SUBSCRIPTION",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                // 15-Digit IMEI Input
                OutlinedTextField(
                    value = formState.imei,
                    onValueChange = { raw ->
                        onUpdateForm { it.copy(imei = raw.filter { ch -> ch.isDigit() }.take(15)) }
                    },
                    label = { Text("Device IMEI (15 digits • Luhn Verified)") },
                    trailingIcon = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusPill(
                                text = if (imeiValid) "LUHN OK" else "${formState.imei.length}/15",
                                color = if (imeiValid) StatusMovingEmerald else StatusWaitingAmber
                            )
                            IconButton(
                                onClick = onGenerateValidImei,
                                modifier = Modifier.testTag("generate_valid_imei_button")
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = "Generate Test IMEI")
                            }
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("activation_imei_input")
                )

                // Egyptian SIM Number WITHOUT +20
                OutlinedTextField(
                    value = formState.simLocalWithoutPlus20,
                    onValueChange = { raw ->
                        onUpdateForm { it.copy(simLocalWithoutPlus20 = raw) }
                    },
                    label = { Text("Device SIM Number (Without +20, e.g. 01098765432)") },
                    supportingText = {
                        if (simValidation.isValid) {
                            Text(
                                text = "Normalized Backend Target: ${simValidation.e164Number} (APN Auto-Configured by SIM)",
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 10.sp,
                                color = StatusMovingEmerald
                            )
                        } else {
                            Text(
                                text = simValidation.errorReason ?: "Enter Egyptian mobile number without +20",
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 10.sp,
                                color = StatusExpiredCrimson
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("activation_sim_input")
                )

                // Vehicle Label & Plate Row
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedTextField(
                        value = formState.vehicleName,
                        onValueChange = { v -> onUpdateForm { it.copy(vehicleName = v) } },
                        label = { Text("Vehicle Label") },
                        singleLine = true,
                        modifier = Modifier
                            .weight(0.6f)
                            .testTag("activation_vehicle_name_input")
                    )
                    OutlinedTextField(
                        value = formState.plateNumber,
                        onValueChange = { p -> onUpdateForm { it.copy(plateNumber = p) } },
                        label = { Text("Plate") },
                        singleLine = true,
                        modifier = Modifier
                            .weight(0.4f)
                            .testTag("activation_plate_input")
                    )
                }

                // Customer Account Assignment
                Text(
                    text = "Assign Customer Account",
                    style = MaterialTheme.typography.labelLarge
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    customerList.forEach { cust ->
                        FilterChip(
                            selected = formState.customerId == cust.id,
                            onClick = { onUpdateForm { it.copy(customerId = cust.id) } },
                            label = { Text(cust.fullName) },
                            modifier = Modifier.testTag("customer_chip_${cust.id}")
                        )
                    }
                }

                // Subscription Duration Selector (1M, 3M, 6M, 12M, Lifetime)
                Text(
                    text = "Subscription Duration (Starts after 1st Traccar connection)",
                    style = MaterialTheme.typography.labelLarge
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    PlanDuration.entries.forEach { plan ->
                        FilterChip(
                            selected = formState.planDuration == plan,
                            onClick = { onUpdateForm { it.copy(planDuration = plan) } },
                            label = { Text(plan.shortLabel) },
                            modifier = Modifier.testTag("plan_chip_${plan.name.lowercase()}")
                        )
                    }
                }

                if (formState.errorMessage != null) {
                    Text(
                        text = formState.errorMessage,
                        color = StatusExpiredCrimson,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                // One-Click Activate Device Button
                Button(
                    onClick = onSubmitActivation,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .testTag("submit_device_activation_button")
                ) {
                    Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "Activate Device (Send Server SMS)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // 3. Live 4-Stage Activation Verification State Machine Inspector
        if (trackedDevice != null) {
            ActivationStateMachineCard(
                aggregate = trackedDevice,
                onSimulateTraccarConnection = { hasFix ->
                    onSimulateTraccarConnection(trackedDevice.device.id, hasFix)
                },
                onOpenAdminOverrideDialog = {
                    showOverrideDialogForDeviceId = trackedDevice.device.id
                },
                onSendOptionalManualTimer = { timerCmd ->
                    onSendOptionalManualTimer(trackedDevice.device.id, timerCmd)
                }
            )
        }
    }

    if (showOverrideDialogForDeviceId != null) {
        val targetId = showOverrideDialogForDeviceId!!
        AlertDialog(
            onDismissRequest = { showOverrideDialogForDeviceId = null },
            title = { Text("Authenticated Admin Override") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Force-activates the device and starts its subscription immediately. Logged permanently in subscription_history.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = overrideReasonText,
                        onValueChange = { overrideReasonText = it },
                        label = { Text("Mandatory Audit Reason") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_override_reason_input")
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onAdminOverride(targetId, overrideReasonText)
                        showOverrideDialogForDeviceId = null
                    },
                    modifier = Modifier.testTag("confirm_admin_override_button")
                ) {
                    Text("Confirm Override")
                }
            },
            dismissButton = {
                TextButton(onClick = { showOverrideDialogForDeviceId = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun ActivationStateMachineCard(
    aggregate: DeviceAggregate,
    onSimulateTraccarConnection: (Boolean) -> Unit,
    onOpenAdminOverrideDialog: () -> Unit,
    onSendOptionalManualTimer: (String) -> Unit
) {
    val dev = aggregate.device
    val currentStatus = runCatching { ActivationStatus.valueOf(dev.activationStatus) }
        .getOrDefault(ActivationStatus.PENDING)

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .testTag("activation_state_machine_card")
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Text(
                        text = "3. 4-STAGE ACTIVATION VERIFICATION",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "${dev.vehicleName} • IMEI ${dev.imei} (${dev.simE164Number})",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                StatusPill(
                    text = currentStatus.shortLabel,
                    color = if (currentStatus == ActivationStatus.ACTIVATED) StatusMovingEmerald else StatusWaitingAmber
                )
            }

            // 4-Stage Pipeline Stepper: PENDING -> SMS SENT -> WAITING FOR DEVICE -> ACTIVATED
            val stages = listOf(
                ActivationStatus.PENDING,
                ActivationStatus.SMS_SENT,
                ActivationStatus.WAITING_FOR_DEVICE,
                ActivationStatus.ACTIVATED
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                stages.forEachIndexed { idx, stage ->
                    val reached = currentStatus.stepIndex >= stage.stepIndex
                    val color = when {
                        currentStatus == ActivationStatus.ACTIVATED -> StatusMovingEmerald
                        reached -> StatusWaitingAmber
                        else -> StatusOfflineSlate
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(20.dp)
                                .clip(CircleShape)
                                .background(color.copy(alpha = 0.22f))
                                .border(1.dp, color, CircleShape)
                        ) {
                            Text(
                                text = "${idx + 1}",
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = color
                            )
                        }
                        Text(
                            text = stage.shortLabel,
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 9.sp,
                            fontWeight = if (reached) FontWeight.Bold else FontWeight.Normal,
                            color = color
                        )
                    }
                }
            }

            // Dispatched SMS Sequence Log (Zero APN, Zero Auto-TIMER)
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                    .padding(8.dp)
            ) {
                Text(
                    text = "DISPATCHED GSM COMMAND LOG (NO APN • NO AUTO-TIMER)",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 9.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (aggregate.smsLogs.isEmpty()) {
                    Text(
                        text = "Queueing SMS commands...",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp
                    )
                } else {
                    aggregate.smsLogs.forEach { log ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Sms,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(13.dp)
                                )
                                Text(
                                    text = "#${log.stepOrder} ${log.commandText}",
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                            StatusPill(
                                text = log.deviceReply?.let { "${log.status}: $it" } ?: log.status,
                                color = StatusMovingEmerald
                            )
                        }
                    }
                }
            }

            // Verification Controls: Simulate 1st Traccar Packet (No GPS Fix vs GPS Fix) or Admin Override
            if (currentStatus != ActivationStatus.ACTIVATED) {
                Text(
                    text = "SMS delivery does NOT activate the subscription. Confirm 1st Traccar :5023 packet or use Admin Override:",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = { onSimulateTraccarConnection(false) },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp)
                            .testTag("verify_login_no_fix_button")
                    ) {
                        Icon(Icons.Default.GpsOff, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Login (No GPS Fix)", fontSize = 11.sp)
                    }
                    Button(
                        onClick = { onSimulateTraccarConnection(true) },
                        colors = ButtonDefaults.buttonColors(containerColor = StatusMovingEmerald),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp)
                            .testTag("verify_full_gps_fix_button")
                    ) {
                        Icon(Icons.Default.GpsFixed, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Confirm GPS Fix", fontSize = 11.sp)
                    }
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (currentStatus != ActivationStatus.ACTIVATED) {
                    OutlinedButton(
                        onClick = onOpenAdminOverrideDialog,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 40.dp)
                            .testTag("open_admin_override_button")
                    ) {
                        Icon(Icons.Default.VerifiedUser, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Admin Override", fontSize = 11.sp)
                    }
                }
                val optionalTimer = aggregate.profile.optionalTimerCommandTemplate
                if (optionalTimer != null) {
                    OutlinedButton(
                        onClick = { onSendOptionalManualTimer(optionalTimer) },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 40.dp)
                            .testTag("send_optional_timer_button")
                    ) {
                        Icon(Icons.Default.Build, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Optional $optionalTimer", fontSize = 11.sp)
                    }
                }
            }
        }
    }
}
