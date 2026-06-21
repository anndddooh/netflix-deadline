ALTER TABLE `users` ADD `notify_email_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_line_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_alexa_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `line_user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `line_link_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `line_link_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `alexa_user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `alexa_link_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `alexa_link_expires_at` integer;