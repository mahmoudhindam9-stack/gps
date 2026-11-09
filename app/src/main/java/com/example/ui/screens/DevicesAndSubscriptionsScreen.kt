package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.local.UserProfileEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.PlanDuration
import com.example.data.model.UserRole
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber

@Composable
fun DevicesAndSubscriptionsScreen(
    devices: List<DeviceAggregate>,
    customers: List<UserProfileEntity>,
    activeRole: UserRole,
    onReassignCustomer: (String, String, String) -> Unit,
    onRenewSubscription: (String, PlanDuration) -> Unit,
    modifier: Modifier = Modifier
) {
    val customerAccounts = customers.filter { it.role == UserRole.CUSTOMER.name }
    var reassignTargetDevice by remember { mutableStateOf<DeviceAggregate?>(null) }
    var selectedNewCustomerId by remember { mutableStateOf("") }
    var reassignReason by remember { mutableStateOf("") }

    var renewTargetDevice by remember { mutableStateOf<DeviceAggregate?>(null) }
    var selectedRenewPlan by remember { mutableStateOf(PlanDuration.MONTH_12) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(14.dp)
            .testTag("devices_subscriptions_screen"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = "Devices",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            StatusPill(
                text = "${devices.size}",
                color = MaterialTheme.colorScheme.primary
            )
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            items(devices, key = { it.device.id }) { agg ->
                DeviceManagementCard(
                    aggregate = agg,
                    activeRole = activeRole,
                    onOpenReassign = {
                        reassignTargetDevice = agg
                        selectedNewCustomerId = customerAccounts.firstOrNull {
                            it.id != agg.customer?.id
                        }?.id ?: ""
                        reassignReason = ""
                    },
                    onOpenRenew = {
                        renewTargetDevice = agg
                    }
                )
            }
        }
    }

    if (reassignTargetDevice != null) {
        val target = reassignTargetDevice!!
        AlertDialog(
            onDismissRequest = { reassignTargetDevice = null },
            title = { Text("Reassign") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "${target.device.vehicleName} • ${target.device.imei}",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState())
                    ) {
                        customerAccounts.forEach { cust ->
                            FilterChip(
                                selected = selectedNewCustomerId == cust.id,
                                onClick = { selectedNewCustomerId = cust.id },
                                label = { Text(cust.fullName) }
                            )
                        }
                    }
                    OutlinedTextField(
                        value = reassignReason,
                        onValueChange = { reassignReason = it },
                        label = { Text("Reason") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onReassignCustomer(target.device.id, selectedNewCustomerId, reassignReason)
                        reassignTargetDevice = null
                    },
                    modifier = Modifier.testTag("confirm_reassign_customer_button")
                ) {
                    Text("Reassign")
                }
            },
            dismissButton = {
                TextButton(onClick = { reassignTargetDevice = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (renewTargetDevice != null) {
        val target = renewTargetDevice!!
        AlertDialog(
            onDismissRequest = { renewTargetDevice = null },
            title = { Text("Renew") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "${target.device.vehicleName} • ${target.device.imei}",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState())
                    ) {
                        PlanDuration.entries.forEach { plan ->
                            FilterChip(
                                selected = selectedRenewPlan == plan,
                                onClick = { selectedRenewPlan = plan },
                                label = { Text(plan.shortLabel) }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onRenewSubscription(target.device.id, selectedRenewPlan)
                        renewTargetDevice = null
                    },
                    modifier = Modifier.testTag("confirm_renew_subscription_button")
                ) {
                    Text("Renew")
                }
            },
            dismissButton = {
                TextButton(onClick = { renewTargetDevice = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun DeviceManagementCard(
    aggregate: DeviceAggregate,
    activeRole: UserRole,
    onOpenReassign: () -> Unit,
    onOpenRenew: () -> Unit
) {
    val dev = aggregate.device
    val now = System.currentTimeMillis()
    val isActivated = dev.activationStatus == ActivationStatus.ACTIVATED.name
    val isAccessible = aggregate.isSubscriptionAccessible(now)
    val isExpired = isActivated && !isAccessible
    var showAuditLogs by remember { mutableStateOf(false) }

    val statusColor = when {
        isExpired -> StatusExpiredCrimson
        !isActivated -> StatusWaitingAmber
        else -> StatusMovingEmerald
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .testTag("device_mgmt_card_${dev.id}")
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "${dev.vehicleName} (${dev.plateNumber})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    if (aggregate.customer != null) {
                        Text(
                            text = aggregate.customer.fullName,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                StatusPill(
                    text = aggregate.compactSubscriptionBadge(now),
                    color = statusColor
                )
            }

            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                    .padding(8.dp)
            ) {
                Column {
                    Text("IMEI", fontFamily = JetBrainsMonoFontFamily, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(dev.imei, fontFamily = JetBrainsMonoFontFamily, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Column {
                    Text("SIM", fontFamily = JetBrainsMonoFontFamily, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(dev.simE164Number, fontFamily = JetBrainsMonoFontFamily, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("STATE", fontFamily = JetBrainsMonoFontFamily, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(dev.activationStatus, fontFamily = JetBrainsMonoFontFamily, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = statusColor)
                }
            }

            if (activeRole == UserRole.ADMIN) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    OutlinedButton(
                        onClick = onOpenRenew,
                        modifier = Modifier
                            .heightIn(min = 38.dp)
                            .testTag("btn_renew_${dev.id}")
                    ) {
                        Icon(Icons.Default.Autorenew, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Renew", fontSize = 11.sp)
                    }
                    OutlinedButton(
                        onClick = onOpenReassign,
                        modifier = Modifier
                            .heightIn(min = 38.dp)
                            .testTag("btn_reassign_${dev.id}")
                    ) {
                        Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Reassign", fontSize = 11.sp)
                    }
                    OutlinedButton(
                        onClick = { showAuditLogs = !showAuditLogs },
                        modifier = Modifier
                            .heightIn(min = 38.dp)
                            .testTag("btn_audit_logs_${dev.id}")
                    ) {
                        Icon(Icons.Default.History, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Logs (${aggregate.subscriptionHistory.size + aggregate.ownershipHistory.size})", fontSize = 11.sp)
                    }
                }
            }

            if (showAuditLogs) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
                        .padding(8.dp)
                ) {
                    aggregate.subscriptionHistory.forEach { entry ->
                        Text(
                            text = "${entry.actionType} • ${entry.planDuration}",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp
                        )
                    }
                    aggregate.ownershipHistory.forEach { own ->
                        Text(
                            text = "${own.previousCustomerName ?: "-"} -> ${own.newCustomerName}",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            color = StatusOfflineSlate
                        )
                    }
                }
            }
        }
    }
}
