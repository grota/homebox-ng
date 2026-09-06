PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_instance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_upload_mb` integer DEFAULT 10 NOT NULL,
	`detection_provider` text DEFAULT 'google' NOT NULL,
	`detection_config` text
);
--> statement-breakpoint
INSERT INTO `__new_instance_settings`("id", "max_upload_mb", "detection_provider", "detection_config") SELECT "id", "max_upload_mb", "detection_provider", "detection_config" FROM `instance_settings`;--> statement-breakpoint
DROP TABLE `instance_settings`;--> statement-breakpoint
ALTER TABLE `__new_instance_settings` RENAME TO `instance_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `instance_settings` SET `detection_provider` = 'google' WHERE `detection_provider` = 'remote';