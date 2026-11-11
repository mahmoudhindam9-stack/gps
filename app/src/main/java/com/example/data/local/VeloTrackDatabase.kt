package com.example.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

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

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `device_commands` (
                        `id` TEXT NOT NULL,
                        `deviceId` TEXT NOT NULL,
                        `traccarDeviceId` INTEGER NOT NULL,
                        `issuedByUserId` TEXT NOT NULL,
                        `issuedByRole` TEXT NOT NULL,
                        `commandType` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `failureReason` TEXT,
                        `sentAt` INTEGER NOT NULL,
                        `completedAt` INTEGER,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_device_commands_deviceId` ON `device_commands` (`deviceId`)"
                )
            }
        }

        fun getInstance(context: Context): VeloTrackDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    VeloTrackDatabase::class.java,
                    "velotrack_local_cache.db"
                )
                    .addMigrations(MIGRATION_3_4)
                    .fallbackToDestructiveMigration(dropAllTables = true)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
