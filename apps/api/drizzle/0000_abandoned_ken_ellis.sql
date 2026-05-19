CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`extension_token` text NOT NULL,
	`notify_email` text NOT NULL,
	`digest_weekday` integer DEFAULT 1 NOT NULL,
	`threshold_days` integer DEFAULT 14 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_extension_token_unique` ON `users` (`extension_token`);--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`entity_type` text,
	`jw_object_id` text,
	`jw_title` text,
	`jw_path` text,
	`expires_at` text,
	`match_status` text DEFAULT 'pending' NOT NULL,
	`added_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`expiry_checked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_watchlist_user_service_external` ON `watchlist_items` (`user_id`,`service`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_user` ON `watchlist_items` (`user_id`);