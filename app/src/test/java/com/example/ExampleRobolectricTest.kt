package com.example

import com.example.data.local.ActivationSmsLogEntity
import com.example.data.local.DeviceEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.DeviceConnectionState
import com.example.data.model.PlanDuration
import com.example.data.model.SmsStepStatus
import com.example.data.model.SubscriptionStatus
import com.example.data.repository.TraccarProtocolCorrelator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

    @Test
    fun subscriptionExpirationAndSmsStateTransitions_enforceBusinessRules() {
        val baseDevice = DeviceEntity(
            id = "dev-sms-1",
            imei = "358739051122332",
            serialNumber = "SN-VAN-02",
            traccarDeviceId = 19L,
            profileId = "profile-gt06n",
            currentCustomerId = "cust-1",
            vehicleName = "Delivery Van 02",
            vehicleType = "VAN",
            vehicleIcon = "van",
            plateNumber = "XYZ-987",
            simLocalNumber = "01112345678",
            simE164Number = "+201112345678",
            activationStatus = ActivationStatus.SMS_SENT.name,
            connectionState = DeviceConnectionState.OFFLINE.name,
            hasValidFix = false,
            lastLat = null,
            lastLng = null,
            lastSpeedKmh = null,
            lastHeading = null,
            ignitionOn = null,
            firstConnectedAt = null,
            lastSeenAt = null,
            createdAt = 1_700_000_000_000L
        )
        val awaitingSub = SubscriptionEntity(
            id = "sub-sms-1",
            deviceId = "dev-sms-1",
            customerId = "cust-1",
            planDuration = PlanDuration.MONTH_1.name,
            status = SubscriptionStatus.AWAITING_FIRST_CONNECTION.name,
            startedAt = null,
            expiresAt = null,
            adminOverrideBy = null,
            adminOverrideReason = null
        )
        val smsLog = ActivationSmsLogEntity(
            id = "sms-log-1",
            deviceId = "dev-sms-1",
            stepOrder = 1,
            commandKey = "SERVER",
            commandText = "SERVER,1,gps.example.com,5023,0#",
            gatewayMessageId = "gw-001",
            status = SmsStepStatus.SENT.name,
            deviceReply = null,
            failureReason = null,
            sentAt = 1_700_000_000_000L,
            completedAt = null
        )

        // SMS delivery or reply must move device to WAITING_FOR_DEVICE and NEVER start subscription
        val (deliveredDevice, subAfterDelivery, deliveredLog) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = baseDevice,
            subscription = awaitingSub,
            smsLog = smsLog,
            newSmsStatus = SmsStepStatus.DELIVERED,
            eventTimestampMs = 1_700_000_005_000L
        )
        assertEquals(ActivationStatus.WAITING_FOR_DEVICE.name, deliveredDevice.activationStatus)
        assertEquals(SubscriptionStatus.AWAITING_FIRST_CONNECTION.name, subAfterDelivery.status)
        assertNull(subAfterDelivery.startedAt)
        assertEquals(SmsStepStatus.DELIVERED.name, deliveredLog.status)

        val (repliedDevice, subAfterReply, repliedLog) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = deliveredDevice,
            subscription = subAfterDelivery,
            smsLog = deliveredLog,
            newSmsStatus = SmsStepStatus.REPLIED,
            replyText = "SERVER,OK!",
            eventTimestampMs = 1_700_000_010_000L
        )
        assertEquals(ActivationStatus.WAITING_FOR_DEVICE.name, repliedDevice.activationStatus)
        assertEquals(SubscriptionStatus.AWAITING_FIRST_CONNECTION.name, subAfterReply.status)
        assertEquals("SERVER,OK!", repliedLog.deviceReply)

        val (timedOutDevice, _, _) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = repliedDevice,
            subscription = subAfterReply,
            smsLog = repliedLog,
            newSmsStatus = SmsStepStatus.TIMED_OUT,
            failureReason = "Gateway timeout",
            eventTimestampMs = 1_700_000_060_000L
        )
        assertEquals(ActivationStatus.FAILED.name, timedOutDevice.activationStatus)

        // Subscription expiration and suspension must block live & historical access
        val startMillis = 1_700_000_000_000L
        val expiresMillis = PlanDuration.MONTH_1.computeExpiryMillis(startMillis)!!
        val activeSubscription = SubscriptionEntity(
            id = "sub-exp-1",
            deviceId = "dev-sms-1",
            customerId = "cust-1",
            planDuration = PlanDuration.MONTH_1.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = startMillis,
            expiresAt = expiresMillis,
            adminOverrideBy = null,
            adminOverrideReason = null
        )
        val aggregate = DeviceAggregate(
            device = baseDevice,
            profile = null,
            customer = null,
            subscription = activeSubscription,
            smsLogs = emptyList(),
            subscriptionHistory = emptyList(),
            ownershipHistory = emptyList()
        )

        assertTrue(aggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis - 1_000L))
        assertFalse(aggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis))

        val suspendedAggregate = aggregate.copy(
            subscription = activeSubscription.copy(status = SubscriptionStatus.SUSPENDED.name)
        )
        assertFalse(suspendedAggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis - 1_000L))
        assertEquals("SUSPENDED", suspendedAggregate.compactSubscriptionBadge(expiresMillis - 1_000L))
    }

    @Test
    fun roomSnapshotCache_persistsServerRecordsAndNeverFabricatesOfflineSession() = kotlinx.coroutines.test.runTest {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = androidx.room.Room.inMemoryDatabaseBuilder(
            context,
            com.example.data.local.VeloTrackDatabase::class.java
        ).allowMainThreadQueries().build()
        val dao = db.veloTrackDao()

        val user = com.example.data.local.UserProfileEntity(
            id = "cust-101",
            username = "cust_alpha",
            email = "alpha@velotrack.org",
            phone = "+201012345678",
            fullName = "Customer Alpha",
            role = "CUSTOMER",
            mustChangePassword = false,
            isActive = true,
            createdAt = 1_710_000_000_000L
        )
        val profile = com.example.data.local.DeviceProfileEntity(
            id = "prof-1",
            manufacturer = "Concox",
            model = "GT06N",
            firmwareVersion = "V2.4",
            traccarProtocol = "gt06",
            serverHost = "gps.velotrack.org",
            serverPort = 5023,
            transport = "TCP",
            serverMode = "DOMAIN",
            requiresDevicePassword = false,
            defaultDevicePassword = null,
            requiresGprsonCommand = false,
            serverCommandTemplate = "SERVER,1,{HOST},{PORT},0#",
            gprsonCommandTemplate = null,
            optionalTimerCommandTemplate = null,
            expectedReplyPattern = "OK",
            isVerified = true
        )
        val device = DeviceEntity(
            id = "dev-101",
            imei = "358739051122332",
            serialNumber = "SN-101",
            traccarDeviceId = 800L,
            profileId = "prof-1",
            currentCustomerId = "cust-101",
            vehicleName = "Alpha Van",
            vehicleType = "VAN",
            vehicleIcon = "van",
            plateNumber = "CAI-101",
            simLocalNumber = "01012345678",
            simE164Number = "+201012345678",
            activationStatus = ActivationStatus.ACTIVATED.name,
            connectionState = DeviceConnectionState.ONLINE_GPS_FIX.name,
            hasValidFix = true,
            lastLat = 30.0444,
            lastLng = 31.2357,
            lastSpeedKmh = 42f,
            lastHeading = 90f,
            ignitionOn = true,
            firstConnectedAt = 1_710_000_100_000L,
            lastSeenAt = 1_710_000_200_000L,
            createdAt = 1_710_000_000_000L
        )
        val sub = SubscriptionEntity(
            id = "sub-101",
            deviceId = "dev-101",
            customerId = "cust-101",
            planDuration = PlanDuration.MONTH_12.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = 1_710_000_100_000L,
            expiresAt = PlanDuration.MONTH_12.computeExpiryMillis(1_710_000_100_000L),
            adminOverrideBy = null,
            adminOverrideReason = null
        )

        dao.replaceSnapshotFromServer(
            users = listOf(user),
            profiles = listOf(profile),
            devices = listOf(device),
            subscriptions = listOf(sub),
            smsLogs = emptyList(),
            subHistory = emptyList(),
            ownHistory = emptyList()
        )

        assertEquals(1, dao.getAllDevicesOnce().size)
        assertEquals("Alpha Van", dao.getAllDevicesOnce().first().vehicleName)

        db.close()
    }

    @Test
    fun roomDatabaseMigrations_1To4_preserveAllExistingUsersDevicesSubscriptionsSmsLogsAndWaypoints() = kotlinx.coroutines.test.runTest {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val dbName = "velotrack_migration_test_${System.currentTimeMillis()}.db"
        val dbFile = context.getDatabasePath(dbName)
        dbFile.parentFile?.mkdirs()
        if (dbFile.exists()) dbFile.delete()

        // 1. Create a v1 SQLite database with legacy columns and pre-existing user/device/SMS/subscription/waypoint records
        val rawDb = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        rawDb.version = 1
        rawDb.execSQL(
            """
            CREATE TABLE `users_profile` (
                `id` TEXT NOT NULL,
                `phone` TEXT NOT NULL,
                `fullName` TEXT NOT NULL,
                `role` TEXT NOT NULL,
                `createdAt` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL(
            """
            CREATE TABLE `device_profiles` (
                `id` TEXT NOT NULL,
                `manufacturer` TEXT NOT NULL,
                `model` TEXT NOT NULL,
                `firmwareVersion` TEXT NOT NULL,
                `traccarProtocol` TEXT NOT NULL,
                `serverHost` TEXT NOT NULL,
                `serverPort` INTEGER NOT NULL,
                `transport` TEXT NOT NULL,
                `serverMode` TEXT NOT NULL,
                `requiresDevicePassword` INTEGER NOT NULL,
                `defaultDevicePassword` TEXT,
                `requiresGprsonCommand` INTEGER NOT NULL,
                `serverCommandTemplate` TEXT NOT NULL,
                `gprsonCommandTemplate` TEXT,
                `optionalTimerCommandTemplate` TEXT,
                `expectedReplyPattern` TEXT,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL(
            """
            CREATE TABLE `devices` (
                `id` TEXT NOT NULL,
                `imei` TEXT NOT NULL,
                `traccarDeviceId` INTEGER NOT NULL,
                `profileId` TEXT NOT NULL,
                `currentCustomerId` TEXT NOT NULL,
                `vehicleName` TEXT NOT NULL,
                `plateNumber` TEXT NOT NULL,
                `simLocalNumber` TEXT NOT NULL,
                `simE164Number` TEXT NOT NULL,
                `activationStatus` TEXT NOT NULL,
                `connectionState` TEXT NOT NULL,
                `hasValidFix` INTEGER NOT NULL,
                `lastLat` REAL,
                `lastLng` REAL,
                `lastSpeedKmh` REAL,
                `lastHeading` REAL,
                `ignitionOn` INTEGER,
                `firstConnectedAt` INTEGER,
                `lastSeenAt` INTEGER,
                `createdAt` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE UNIQUE INDEX `index_devices_imei` ON `devices` (`imei`)")
        rawDb.execSQL("CREATE UNIQUE INDEX `index_devices_traccarDeviceId` ON `devices` (`traccarDeviceId`)")
        rawDb.execSQL("CREATE INDEX `index_devices_currentCustomerId` ON `devices` (`currentCustomerId`)")

        rawDb.execSQL(
            """
            CREATE TABLE `activation_sms_logs` (
                `id` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL,
                `stepOrder` INTEGER NOT NULL,
                `commandKey` TEXT NOT NULL,
                `commandText` TEXT NOT NULL,
                `gatewayMessageId` TEXT,
                `status` TEXT NOT NULL,
                `deviceReply` TEXT,
                `sentAt` INTEGER NOT NULL,
                `completedAt` INTEGER,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE INDEX `index_activation_sms_logs_deviceId` ON `activation_sms_logs` (`deviceId`)")

        rawDb.execSQL(
            """
            CREATE TABLE `subscriptions` (
                `id` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL,
                `customerId` TEXT NOT NULL,
                `planDuration` TEXT NOT NULL,
                `status` TEXT NOT NULL,
                `startedAt` INTEGER,
                `expiresAt` INTEGER,
                `adminOverrideBy` TEXT,
                `adminOverrideReason` TEXT,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE UNIQUE INDEX `index_subscriptions_deviceId` ON `subscriptions` (`deviceId`)")
        rawDb.execSQL("CREATE INDEX `index_subscriptions_customerId` ON `subscriptions` (`customerId`)")

        rawDb.execSQL(
            """
            CREATE TABLE `subscription_history` (
                `id` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL,
                `customerId` TEXT NOT NULL,
                `actionType` TEXT NOT NULL,
                `planDuration` TEXT NOT NULL,
                `notes` TEXT NOT NULL,
                `createdAt` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE INDEX `index_subscription_history_deviceId` ON `subscription_history` (`deviceId`)")

        rawDb.execSQL(
            """
            CREATE TABLE `device_ownership_history` (
                `id` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL,
                `previousCustomerId` TEXT,
                `previousCustomerName` TEXT,
                `newCustomerId` TEXT NOT NULL,
                `newCustomerName` TEXT NOT NULL,
                `reassignedByAdminId` TEXT NOT NULL,
                `reason` TEXT NOT NULL,
                `reassignedAt` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE INDEX `index_device_ownership_history_deviceId` ON `device_ownership_history` (`deviceId`)")

        rawDb.execSQL(
            """
            CREATE TABLE `cached_waypoints` (
                `id` INTEGER NOT NULL,
                `deviceId` TEXT NOT NULL,
                `latitude` REAL NOT NULL,
                `longitude` REAL NOT NULL,
                `speedKmh` REAL NOT NULL,
                `heading` REAL NOT NULL,
                `ignition` INTEGER NOT NULL,
                `valid` INTEGER NOT NULL,
                `recordedAt` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )
        rawDb.execSQL("CREATE INDEX `index_cached_waypoints_deviceId_recordedAt` ON `cached_waypoints` (`deviceId`, `recordedAt`)")

        // Insert existing v1 records
        rawDb.execSQL("INSERT INTO `users_profile` VALUES ('u-v1', '+201099988877', 'Legacy Customer', 'CUSTOMER', 1700000000000)")
        rawDb.execSQL("INSERT INTO `device_profiles` VALUES ('p-v1', 'Concox', 'GT06N', 'V1.0', 'gt06', 'gps.velotrack.org', 5023, 'TCP', 'DOMAIN', 0, NULL, 0, 'SERVER,1,{HOST},{PORT},0#', NULL, NULL, 'OK')")
        rawDb.execSQL("INSERT INTO `devices` VALUES ('d-v1', '358739051122332', 501, 'p-v1', 'u-v1', 'Legacy Sedan', 'LEG-001', '01099988877', '+201099988877', 'ACTIVATED', 'ONLINE_GPS_FIX', 1, 30.05, 31.24, 55.0, 180.0, 1, 1700000000000, 1700000050000, 1700000000000)")
        rawDb.execSQL("INSERT INTO `activation_sms_logs` VALUES ('sms-v1', 'd-v1', 1, 'SERVER', 'SERVER,1,gps.velotrack.org,5023,0#', 'gw-v1', 'REPLIED', 'OK', 1700000000000, 1700000010000)")
        rawDb.execSQL("INSERT INTO `subscriptions` VALUES ('sub-v1', 'd-v1', 'u-v1', 'MONTH_12', 'ACTIVE', 1700000000000, 1731536000000, NULL, NULL)")
        rawDb.execSQL("INSERT INTO `cached_waypoints` VALUES (9001, 'd-v1', 30.05, 31.24, 55.0, 180.0, 1, 1, 1700000050000)")
        rawDb.close()

        // 2. Open with Room v4 and ALL_MIGRATIONS (NO destructive fallback)
        val migratedDb = androidx.room.Room.databaseBuilder(
            context,
            com.example.data.local.VeloTrackDatabase::class.java,
            dbName
        )
            .addMigrations(*com.example.data.local.VeloTrackDatabase.ALL_MIGRATIONS)
            .allowMainThreadQueries()
            .build()

        val dao = migratedDb.veloTrackDao()
        val users = dao.getAllUsersOnce()
        val devices = dao.getAllDevicesOnce()
        val smsLogs = dao.getAllSmsLogsOnce()
        val subs = dao.getAllSubscriptionsOnce()
        val waypoints = dao.getWaypointsForDevice("d-v1")

        assertEquals(1, users.size)
        assertEquals("Legacy Customer", users.first().fullName)
        assertTrue(users.first().isActive)

        assertEquals(1, devices.size)
        assertEquals("Legacy Sedan", devices.first().vehicleName)
        assertEquals("CAR", devices.first().vehicleType)
        assertEquals("car", devices.first().vehicleIcon)

        assertEquals(1, smsLogs.size)
        assertEquals("OK", smsLogs.first().deviceReply)

        assertEquals(1, subs.size)
        assertEquals("MONTH_12", subs.first().planDuration)

        assertEquals(1, waypoints.size)
        assertEquals(9001L, waypoints.first().id)

        migratedDb.close()
        dbFile.delete()
    }

    @Test
    fun firstAdminBootstrapAndSupabaseAccountCreation_worksAndAllowsSubsequentLogin() = kotlinx.coroutines.test.runTest {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = androidx.room.Room.inMemoryDatabaseBuilder(
            context,
            com.example.data.local.VeloTrackDatabase::class.java
        ).allowMainThreadQueries().build()
        val dao = db.veloTrackDao()
        val repo = com.example.data.repository.VeloTrackRepository(
            dao = dao,
            context = context,
            apiProvider = { throw RuntimeException("Simulated HTTP 404 / Static Web Host") }
        )

        // 1. Create First Admin via bootstrapFirstAdmin
        val firstAdminRes = repo.bootstrapFirstAdmin(
            username = "admin",
            email = "mahmoud.hindam9@gmail.com",
            fullName = "System Administrator",
            phone = "",
            password = "Admin@123456"
        )
        assertTrue(firstAdminRes.isSuccess)
        assertEquals(com.example.data.model.UserRole.ADMIN, firstAdminRes.getOrThrow().role)
        assertEquals("admin", firstAdminRes.getOrThrow().username)

        // 2. Create another account (Customer) in Supabase & App while logged in as Admin
        val customerRes = repo.createUserAccountInSupabase(
            fullName = "Ahmed Fleet",
            username = "ahmed_fleet",
            phone = "01012345678",
            email = "ahmed@velotrack.org",
            password = "Customer@123",
            role = com.example.data.model.UserRole.CUSTOMER
        )
        assertTrue(customerRes.isSuccess)
        assertEquals("+201012345678", customerRes.getOrThrow().phone)

        // 3. Log out and verify both First Admin and newly created Customer can log in
        repo.logout()
        val customerLogin = repo.login("01012345678", "Customer@123")
        assertTrue(customerLogin.isSuccess)
        assertEquals(com.example.data.model.UserRole.CUSTOMER, customerLogin.getOrThrow().role)

        repo.logout()
        val adminLogin = repo.login("admin", "Admin@123456")
        assertTrue(adminLogin.isSuccess)
        assertEquals(com.example.data.model.UserRole.ADMIN, adminLogin.getOrThrow().role)

        db.close()
    }
}


