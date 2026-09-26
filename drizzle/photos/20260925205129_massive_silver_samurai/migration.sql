CREATE TABLE `catalog` (
	`id` integer PRIMARY KEY,
	`document_id` text NOT NULL,
	`synced_at` text NOT NULL,
	CONSTRAINT "catalog_check_1" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `collection_photos` (
	`collection_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `collection_photos_pk` PRIMARY KEY(`collection_id`, `photo_id`),
	CONSTRAINT `fk_collection_photos_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`),
	CONSTRAINT `fk_collection_photos_photo_id_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_roots` (
	`collection_id` text PRIMARY KEY,
	`added_at` text NOT NULL,
	CONSTRAINT `fk_collection_roots_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`)
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY,
	`parent_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`sort_order` text NOT NULL,
	`reversed` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "collections_check_2" CHECK("reversed" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `equipment_aliases` (
	`kind` text NOT NULL,
	`source_name` text NOT NULL,
	`display_name` text NOT NULL,
	`focal_length_display` text DEFAULT 'native' NOT NULL,
	CONSTRAINT `equipment_aliases_pk` PRIMARY KEY(`kind`, `source_name`),
	CONSTRAINT "equipment_aliases_check_4" CHECK("kind" IN ('camera', 'lens')),
	CONSTRAINT "equipment_aliases_check_5" CHECK("focal_length_display" IN ('native', '35mm'))
);
--> statement-breakpoint
CREATE TABLE `photo_derivatives` (
	`id` integer PRIMARY KEY,
	`export_id` integer NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`uploaded_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_photo_derivatives_export_id_photo_exports_id_fk` FOREIGN KEY (`export_id`) REFERENCES `photo_exports`(`id`),
	CONSTRAINT "photo_derivatives_check_7" CHECK("kind" IN ('source', 'thumb', 'detail', 'og'))
);
--> statement-breakpoint
CREATE TABLE `photo_exports` (
	`id` integer PRIMARY KEY,
	`photo_id` text NOT NULL,
	`capture_one_output_id` text NOT NULL,
	`profile` text NOT NULL,
	`source_path` text NOT NULL,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`metadata_json` text NOT NULL,
	`raw_metadata_json` text NOT NULL,
	`current` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_photo_exports_photo_id_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`),
	CONSTRAINT "photo_exports_check_6" CHECK("current" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY,
	`capture_one_variant_id` text NOT NULL UNIQUE,
	`capture_one_variant_name` text NOT NULL,
	`metadata_json` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "photos_check_3" CHECK("status" IN ('active', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_photos_position_unique` ON `collection_photos` (`collection_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_derivatives_export_kind_unique` ON `photo_derivatives` (`export_id`,`kind`) WHERE "photo_derivatives"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `photo_derivatives_r2_key_unique` ON `photo_derivatives` (`r2_key`);--> statement-breakpoint
CREATE INDEX `photo_derivatives_pending_idx` ON `photo_derivatives` (`uploaded_at`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_exports_revision_unique` ON `photo_exports` (`photo_id`,`profile`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_exports_current_idx` ON `photo_exports` (`photo_id`,`profile`) WHERE "photo_exports"."current" = 1;--> statement-breakpoint
CREATE INDEX `photo_exports_deleted_idx` ON `photo_exports` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `photos_status_idx` ON `photos` (`status`);