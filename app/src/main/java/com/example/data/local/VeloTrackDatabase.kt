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
    exportSchema = true
)
abstract class VeloTrackDatabase : RoomDatabase() {
    abstract fun veloTrackDao(): VeloTrackDao

    companion object {
        @Volatile
        private var INSTANCE: VeloTrackDatabase? = null

        private fun hasColumn(
            db: SupportSQLiteDatabase,
            tableName: String,
            columnName: String
        ): Boolean {
            db.query("PRAGMA table_info(`$tableName`)").use { cursor ->
                val nameIndex = cursor.getColumnIndex("name")
                if (nameIndex < 0) return false
                while (cursor.moveToNext()) {
                    if (cursor.getString(nameIndex).equals(columnName, ignoreCase = true)) {
                        return true
                    }
                }
            }
            return false
        }

        private fun addColumnIfMissing(
            db: SupportSQLiteDatabase,
            tableName: String,
            columnName: String,
            columnDefinitionSql: String
        ) {
            if (!hasColumn(db, tableName, columnName)) {
                db.execSQL("ALTER TABLE `$tableName` ADD COLUMN `$columnName` $columnDefinitionSql")
            }
        }

        /**
         * Non-destructive migration 1 -> 2:
         * Preserves all existing cached users, device profiles, and SMS logs while adding
         * account security and verification columns introduced in v2.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                addColumnIfMissing(db, "users_profile", "username", "TEXT")
                addColumnIfMissing(db, "users_profile", "email", "TEXT NOT NULL DEFAULT ''")
                addColumnIfMissing(db, "users_profile", "mustChangePassword", "INTEGER NOT NULL DEFAULT 0")
                addColumnIfMissing(db, "users_profile", "isActive", "INTEGER NOT NULL DEFAULT 1")
                addColumnIfMissing(db, "device_profiles", "isVerified", "INTEGER NOT NULL DEFAULT 0")
                addColumnIfMissing(db, "activation_sms_logs", "failureReason", "TEXT")
            }
        }

        /**
         * Non-destructive migration 2 -> 3:
         * Preserves all existing devices and subscriptions while adding vehicle presentation
         * and hardware serial metadata columns introduced in v3.
         */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                addColumnIfMissing(db, "devices", "serialNumber", "TEXT")
                addColumnIfMissing(db, "devices", "vehicleType", "TEXT NOT NULL DEFAULT 'CAR'")
                addColumnIfMissing(db, "devices", "vehicleIcon", "TEXT NOT NULL DEFAULT 'car'")
            }
        }

        /**
         * Non-destructive migration 3 -> 4:
         * Adds the audited `device_commands` table and index without altering existing tables.
         */
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

        val ALL_MIGRATIONS: Array<Migration> = arrayOf(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4
        )

        fun getInstance(context: Context): VeloTrackDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    VeloTrackDatabase::class.java,
                    "velotrack_local_cache.db"
                )
                    .addMigrations(*ALL_MIGRATIONS)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
