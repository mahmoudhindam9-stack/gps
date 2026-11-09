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

@Composable
fun AdminDeviceActivationScreen(
    formState: ActivationFormState,
    profiles: List<DeviceProfileEntity>,
    customers: List<UserProfileEntity>,
    allDevices: List<DeviceAggregate>,
    onUpdateForm: ((ActivationFormState) -> ActivationFormState) -> Unit,
    onSubmitActivation: () -> Unit,
    onAdminOverride: (String, String) -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedProfile = profiles.find { it.id == formState.selectedProfileId } ?: profiles.firstOrNull()
    val customerList = customers.filter { it.role == "CUSTOMER" }
    val simValidation = SimAndImeiValidator.normalizeEgyptianSim(formState.simLocalWithoutPlus20)
    val imeiValid = SimAndImeiValidator.isValidImei(formState.imei)

    val trackedDevice = allDevices.find { it.device.id == formState.lastActivatedDeviceId }
        ?: allDevices.firstOrNull { it.device.activationStatus != ActivationStatus.ACTIVATED.name }

    var showOverrideDialogForDeviceId by remember { mutableStateOf<String?>(null) }
    var overrideReasonText by remember { mutableStateOf("") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
            .testTag("admin_device_activation_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = "Activate",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            StatusPill(text = "GT06 :5023", color = MaterialTheme.colorScheme.primary)
        }

        // 1. Profile Selection
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
                    text = "PROFILE",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                if (profiles.isEmpty()) {
                    StatusPill(text = "NO PROFILES", color = StatusOfflineSlate)
                } else {
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
                                    text = profile.serverCommandTemplate,
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 10.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            StatusPill(
                                text = if (profile.isVerified) "VERIFIED" else "UNVERIFIED",
                                color = if (profile.isVerified) StatusMovingEmerald else StatusWaitingAmber
                            )
                        }
                    }
                }
            }
        }

        // 2. Device Details Form
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
                OutlinedTextField(
                    value = formState.imei,
                    onValueChange = { raw ->
                        onUpdateForm { it.copy(imei = raw.filter { ch -> ch.isDigit() }.take(15)) }
                    },
                    label = { Text("IMEI") },
                    trailingIcon = {
                        StatusPill(
                            text = if (imeiValid) "OK" else "${formState.imei.length}/15",
                            color = if (imeiValid) StatusMovingEmerald else StatusOfflineSlate
                        )
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("activation_imei_input")
                )

                OutlinedTextField(
                    value = formState.simLocalWithoutPlus20,
                    onValueChange = { raw ->
                        onUpdateForm { it.copy(simLocalWithoutPlus20 = raw) }
                    },
                    label = { Text("SIM") },
                    trailingIcon = {
                        if (formState.simLocalWithoutPlus20.isNotEmpty()) {
                            StatusPill(
                                text = if (simValidation.isValid) simValidation.e164Number else (simValidation.errorReason ?: "ERR"),
                                color = if (simValidation.isValid) StatusMovingEmerald else StatusExpiredCrimson
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("activation_sim_input")
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedTextField(
                        value = formState.vehicleName,
                        onValueChange = { v -> onUpdateForm { it.copy(vehicleName = v) } },
                        label = { Text("Vehicle") },
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

                if (customerList.isNotEmpty()) {
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
                }

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
                        text = "Activate",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // 3. Activation State Tracker
        if (trackedDevice != null) {
            ActivationStateMachineCard(
                aggregate = trackedDevice,
                onOpenAdminOverrideDialog = {
                    showOverrideDialogForDeviceId = trackedDevice.device.id
                }
            )
        }
    }

    if (showOverrideDialogForDeviceId != null) {
        val targetId = showOverrideDialogForDeviceId!!
        AlertDialog(
            onDismissRequest = { showOverrideDialogForDeviceId = null },
            title = { Text("Override") },
            text = {
                OutlinedTextField(
                    value = overrideReasonText,
                    onValueChange = { overrideReasonText = it },
                    label = { Text("Reason") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("admin_override_reason_input")
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        onAdminOverride(targetId, overrideReasonText)
                        showOverrideDialogForDeviceId = null
                    },
                    modifier = Modifier.testTag("confirm_admin_override_button")
                ) {
                    Text("Override")
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
    onOpenAdminOverrideDialog: () -> Unit
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
                Text(
                    text = "${dev.vehicleName} • ${dev.imei}",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )
                StatusPill(
                    text = currentStatus.shortLabel,
                    color = when (currentStatus) {
                        ActivationStatus.ACTIVATED -> StatusMovingEmerald
                        ActivationStatus.FAILED -> StatusExpiredCrimson
                        else -> StatusWaitingAmber
                    }
                )
            }

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
                    val reached = currentStatus.stepIndex >= stage.stepIndex && currentStatus != ActivationStatus.FAILED
                    val color = when {
                        currentStatus == ActivationStatus.ACTIVATED -> StatusMovingEmerald
                        currentStatus == ActivationStatus.FAILED -> StatusExpiredCrimson
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

            if (aggregate.smsLogs.isNotEmpty()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                        .padding(8.dp)
                ) {
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
                                color = if (log.status == "FAILED" || log.status == "TIMED_OUT") StatusExpiredCrimson else StatusMovingEmerald
                            )
                        }
                    }
                }
            }

            if (currentStatus != ActivationStatus.ACTIVATED) {
                OutlinedButton(
                    onClick = onOpenAdminOverrideDialog,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 40.dp)
                        .testTag("open_admin_override_button")
                ) {
                    Icon(Icons.Default.VerifiedUser, contentDescription = null, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Override", fontSize = 11.sp)
                }
            }
        }
    }
}
