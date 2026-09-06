CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`theme_mode` text DEFAULT 'auto' NOT NULL,
	`light_theme_id` text DEFAULT 'light-default' NOT NULL,
	`dark_theme_id` text DEFAULT 'dark-default' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);