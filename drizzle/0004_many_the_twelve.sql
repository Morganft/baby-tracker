CREATE TABLE `day_override` (
	`date` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`reference_wake_time` text NOT NULL,
	`nap_count` integer NOT NULL,
	`wake_windows` text NOT NULL,
	`expected_nap_durations` text NOT NULL,
	`daily_total_sleep_target` integer,
	`daytime_cap` integer,
	`bedtime_start` text,
	`bedtime_end` text,
	`target_bedtime` text,
	`wake_window_min` text,
	`wake_window_max` text,
	`nap_duration_min` text,
	`nap_duration_max` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
