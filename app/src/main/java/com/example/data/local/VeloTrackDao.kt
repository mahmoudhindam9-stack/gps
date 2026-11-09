package com.example.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface VeloTrackDao {
    @Query("SELECT * FROM users_profile ORDER BY role ASC, fullName ASC")
    fun observeAllUsers(): Flow<List<UserProfileEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertUsers(users: List<UserProfileEntity>)

    @Query("DELETE FROM users_profile")
    suspend fun clearUsers()

    @Query("SELECT * FROM device_profiles ORDER BY manufacturer ASC, model ASC, firmwareVersion ASC")
    fun observeDeviceProfiles(): Flow<List<DeviceProfileEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeviceProfiles(profiles: List<DeviceProfileEntity>)

    @Query("DELETE FROM device_profiles")
    suspend fun clearDeviceProfiles()

    @Query("SELECT * FROM devices ORDER BY createdAt DESC")
    fun observeAllDevices(): Flow<List<DeviceEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDevices(devices: List<DeviceEntity>)

    @Query("DELETE FROM devices")
    suspend fun clearDevices()

    @Query("SELECT * FROM activation_sms_logs ORDER BY stepOrder ASC")
    fun observeAllSmsLogs(): Flow<List<ActivationSmsLogEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSmsLogs(logs: List<ActivationSmsLogEntity>)

    @Query("DELETE FROM activation_sms_logs")
    suspend fun clearSmsLogs()

    @Query("SELECT * FROM subscriptions")
    fun observeAllSubscriptions(): Flow<List<SubscriptionEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscriptions(subscriptions: List<SubscriptionEntity>)

    @Query("DELETE FROM subscriptions")
    suspend fun clearSubscriptions()

    @Query("SELECT * FROM subscription_history ORDER BY createdAt DESC")
    fun observeAllSubscriptionHistory(): Flow<List<SubscriptionHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSubscriptionHistoryList(entries: List<SubscriptionHistoryEntity>)

    @Query("DELETE FROM subscription_history")
    suspend fun clearSubscriptionHistory()

    @Query("SELECT * FROM device_ownership_history ORDER BY reassignedAt DESC")
    fun observeAllOwnershipHistory(): Flow<List<DeviceOwnershipHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOwnershipHistoryList(entries: List<DeviceOwnershipHistoryEntity>)

    @Query("DELETE FROM device_ownership_history")
    suspend fun clearOwnershipHistory()

    @Query("SELECT * FROM cached_waypoints WHERE deviceId = :deviceId ORDER BY recordedAt ASC")
    suspend fun getWaypointsForDevice(deviceId: String): List<CachedWaypointEntity>

    @Query("DELETE FROM cached_waypoints WHERE deviceId = :deviceId")
    suspend fun clearWaypointsForDevice(deviceId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWaypoints(waypoints: List<CachedWaypointEntity>)

    @Query("DELETE FROM cached_waypoints")
    suspend fun clearAllWaypoints()

    @Transaction
    suspend fun replaceSnapshotFromServer(
        users: List<UserProfileEntity>,
        profiles: List<DeviceProfileEntity>,
        devices: List<DeviceEntity>,
        subscriptions: List<SubscriptionEntity>,
        smsLogs: List<ActivationSmsLogEntity>,
        subHistory: List<SubscriptionHistoryEntity>,
        ownHistory: List<DeviceOwnershipHistoryEntity>
    ) {
        clearSmsLogs()
        clearSubscriptionHistory()
        clearOwnershipHistory()
        clearSubscriptions()
        clearDevices()
        if (users.isNotEmpty()) {
            clearUsers()
            insertUsers(users)
        }
        if (profiles.isNotEmpty()) {
            clearDeviceProfiles()
            insertDeviceProfiles(profiles)
        }
        insertDevices(devices)
        insertSubscriptions(subscriptions)
        insertSmsLogs(smsLogs)
        insertSubscriptionHistoryList(subHistory)
        insertOwnershipHistoryList(ownHistory)
    }

    @Transaction
    suspend fun clearAllOfflineCache() {
        clearAllWaypoints()
        clearSmsLogs()
        clearSubscriptionHistory()
        clearOwnershipHistory()
        clearSubscriptions()
        clearDevices()
        clearDeviceProfiles()
        clearUsers()
    }
}
