CREATE TABLE `active_template` (
	`id` text PRIMARY KEY DEFAULT 'active' NOT NULL,
	`source_template_id` text,
	`name` text NOT NULL,
	`reference_wake_time` text NOT NULL,
	`nap_count` integer NOT NULL,
	`wake_windows` text NOT NULL,
	`expected_nap_durations` text NOT NULL,
	`daily_total_sleep_target` integer,
	`daytime_cap` integer,
	`bedtime_start` text,
	`bedtime_end` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `baby` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`birth_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `night_waking` (
	`id` text PRIMARY KEY NOT NULL,
	`sleep_entry_id` text NOT NULL,
	`time` integer NOT NULL,
	FOREIGN KEY (`sleep_entry_id`) REFERENCES `sleep_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'settings' NOT NULL,
	`short_nap_threshold_min` integer DEFAULT 15 NOT NULL,
	`short_nap_reduction_percent` integer DEFAULT 30 NOT NULL,
	`clock_24h` integer DEFAULT true NOT NULL,
	`track_timezone` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`timezone` text NOT NULL,
	`type` text NOT NULL,
	`location` text,
	`put_down` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`reference_wake_time` text NOT NULL,
	`nap_count` integer NOT NULL,
	`wake_windows` text NOT NULL,
	`expected_nap_durations` text NOT NULL,
	`daily_total_sleep_target` integer,
	`daytime_cap` integer,
	`bedtime_start` text,
	`bedtime_end` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
