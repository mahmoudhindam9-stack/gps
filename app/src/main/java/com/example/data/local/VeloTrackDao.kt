package com.example.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface VeloTrackDao {
    @Query("SELECT * FROM users_profile ORDER BY role ASC, fullName ASC")
    fun observeAllUsers(): Flow<List<UserProfileEntity>>

    @Query("SELECT * FROM users_profile WHERE id = :userId LIMIT 1")
    suspend fun getUserById(userId: String): UserProfileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertUsers(users: List<UserProfileEntity>)

    @Query("SELECT * FROM device_profiles ORDER BY isVerified DESC, manufacturer ASC, model ASC")
    fun observeDeviceProfiles(): Flow<List<DeviceProfileEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeviceProfiles(profiles: List<DeviceProfileEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeviceProfile(profile: DeviceProfileEntity)

    @Query("SELECT * FROM devices ORDER BY createdAt DESC")
    fun observeAllDevices(): Flow<List<DeviceEntity>>

    @Query("SELECT * FROM devices WHERE currentCustomerId = :customerId ORDER BY createdAt DESC")
    fun observeCustomerDevices(customerId: String): Flow<List<DeviceEntity>>

    @Query("SELECT * FROM devices WHERE id = :deviceId LIMIT 1")
    suspend fun getDeviceById(deviceId: String): DeviceEntity?

    @Query("SELECT * FROM devices WHERE imei = :imei LIMIT 1")
    suspend fun getDeviceByImei(imei: String): DeviceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDevice(device: DeviceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDevices(devices: List<DeviceEntity>)

    @Update
    suspend fun updateDevice(device: DeviceEntity)

    @Query("SELECT * FROM activation_sms_logs ORDER BY stepOrder ASC")
    fun observeAllSmsLogs(): Flow<List<ActivationSmsLogEntity>>

    @Query("SELECT * FROM activation_sms_logs WHERE deviceId = :deviceId ORDER BY stepOrder ASC")
    suspend fun getSmsLogsForDevice(deviceId: String): List<ActivationSmsLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSmsLog(log: ActivationSmsLogEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSmsLogs(logs: List<ActivationSmsLogEntity>)

    @Query("DELETE FROM activation_sms_logs WHERE deviceId = :deviceId")
    suspend fun clearSmsLogsForDevice(deviceId: String)

    @Query("SELECT * FROM subscriptions")
    fun observeAllSubscriptions(): Flow<List<SubscriptionEntity>>

    @Query("SELECT * FROM subscriptions WHERE deviceId = :deviceId LIMIT 1")
    suspend fun getSubscriptionForDevice(deviceId: String): SubscriptionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscription(subscription: SubscriptionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscriptions(subscriptions: List<SubscriptionEntity>)

    @Query("SELECT * FROM subscription_history ORDER BY createdAt DESC")
    fun observeAllSubscriptionHistory(): Flow<List<SubscriptionHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscriptionHistory(entry: SubscriptionHistoryEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscriptionHistoryList(entries: List<SubscriptionHistoryEntity>)

    @Query("SELECT * FROM device_ownership_history ORDER BY reassignedAt DESC")
    fun observeAllOwnershipHistory(): Flow<List<DeviceOwnershipHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOwnershipHistory(entry: DeviceOwnershipHistoryEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOwnershipHistoryList(entries: List<DeviceOwnershipHistoryEntity>)

    @Query("SELECT * FROM cached_waypoints WHERE deviceId = :deviceId ORDER BY recordedAt ASC")
    suspend fun getWaypointsForDevice(deviceId: String): List<CachedWaypointEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWaypoints(waypoints: List<CachedWaypointEntity>)

    @Query("DELETE FROM cached_waypoints WHERE recordedAt < :cutoffMillis")
    suspend fun purgeWaypointsOlderThan(cutoffMillis: Long): Int

    @Query("SELECT COUNT(*) FROM devices")
    suspend fun countDevices(): Int
}
