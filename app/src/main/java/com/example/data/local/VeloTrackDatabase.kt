package com.example.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        UserProfileEntity::class,
        DeviceProfileEntity::class,
        DeviceEntity::class,
        ActivationSmsLogEntity::class,
        SubscriptionEntity::class,
        SubscriptionHistoryEntity::class,
        DeviceOwnershipHistoryEntity::class,
        DeviceCommandEntity::class,
        CachedWaypointEntity::class
    ],
    version = 4,
    exportSchema = false
)
abstract class VeloTrackDatabase : RoomDatabase() {
    abstract fun veloTrackDao(): VeloTrackDao

    companion object {
        @Volatile
        private var INSTANCE: VeloTrackDatabase? = null

        fun getInstance(context: Context): VeloTrackDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    VeloTrackDatabase::class.java,
                    "velotrack_local_cache.db"
                )
                    .fallbackToDestructiveMigration(dropAllTables = true)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
