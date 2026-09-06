CREATE TABLE `instance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_upload_mb` integer DEFAULT 10 NOT NULL,
	`detection_provider` text DEFAULT 'remote' NOT NULL,
	`detection_config` text
);
--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;