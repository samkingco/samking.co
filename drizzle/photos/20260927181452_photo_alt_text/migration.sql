ALTER TABLE `photos` ADD `alt_text` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `alt_text_status` text CONSTRAINT `photos_alt_text_status_check` CHECK (`alt_text_status` IN ('generated', 'approved', 'edited'));--> statement-breakpoint
ALTER TABLE `photos` ADD `alt_text_input_hash` text;
