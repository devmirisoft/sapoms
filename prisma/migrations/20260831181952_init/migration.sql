-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuthRole" AS ENUM ('ADMIN', 'NSM', 'ACCOUNTANT', 'RSM', 'ASM', 'STAFF', 'DEALER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'NSM', 'ACCOUNTANT', 'RSM', 'ASM', 'STAFF', 'DEALER');

-- CreateEnum
CREATE TYPE "SalesRegion" AS ENUM ('NORTH_1', 'NORTH_2', 'SOUTH_1', 'SOUTH_2', 'WEST_1', 'WEST_2', 'EAST', 'ROM', 'CENTRAL');

-- CreateEnum
CREATE TYPE "Warehouse" AS ENUM ('AHMEDABAD', 'AMBALA');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'DECLINED', 'PROCESSING', 'PARTIALLY_READY', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderAcceptanceStatus" AS ENUM ('AWAITING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "OrderFulfilmentStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'PARTIALLY_READY', 'READY', 'DISPATCHED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OrderDiscountType" AS ENUM ('NONE', 'SLAB', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DiscountRequestScope" AS ENUM ('ORDER', 'PRODUCT');

-- CreateEnum
CREATE TYPE "DiscountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'ORDER_DEBIT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletSettlementStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "OrderDraftStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FundRequestType" AS ENUM ('ADVANCE_ORDER', 'ADDITIONAL_FUNDS');

-- CreateEnum
CREATE TYPE "FundRequestStatus" AS ENUM ('REQUESTED', 'RSM_APPROVED', 'STAFF_APPROVED', 'FUNDED', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "auth_audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "session_id" TEXT,
    "legacy_actor_id" TEXT,
    "role" "AuthRole",
    "event_type" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "username" TEXT,
    "normalized_username" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "product_code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "category_id" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "sku" TEXT,
    "catalogue_number" TEXT,
    "unit_name" TEXT,
    "pack_size" INTEGER,
    "unit_price_paise" BIGINT NOT NULL DEFAULT 0,
    "pack_price_paise" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hot_items" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "variant_id" BIGINT,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "badge" TEXT NOT NULL DEFAULT 'Hot pick',
    "sku_snapshot" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "specs_snapshot" TEXT NOT NULL DEFAULT '',
    "image_snapshot" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hot_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slider_images" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT,
    "image_url" TEXT NOT NULL,
    "cloudinary_public_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slider_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "image_url" TEXT,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accountant_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "designation" TEXT,

    CONSTRAINT "accountant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "parent_rsm_id" BIGINT,
    "parent_asm_id" BIGINT,
    "display_name" TEXT NOT NULL,
    "designation" TEXT,
    "location" TEXT,
    "mobile_no" TEXT,
    "alternate_no" TEXT,
    "permanent_address" TEXT,
    "local_address" TEXT,
    "gender" TEXT,
    "dob" DATE,
    "nationality" TEXT,
    "marital_status" TEXT,
    "qualification" TEXT,
    "emergency_contact_no_1" TEXT,
    "emergency_contact_no_2" TEXT,
    "staff_role_type" TEXT,
    "sales_region" "SalesRegion",
    "warehouse" "Warehouse",
    "assigned_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reporting_manager_id" BIGINT,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "legacy_php_id" TEXT,
    "dealer_code" TEXT,
    "business_name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "address" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "discount_percent" DECIMAL(9,4),
    "credit_days" INTEGER,
    "credit_limit_paise" BIGINT,
    "annual_target_paise" BIGINT,
    "notes" TEXT,
    "priority_contact" TEXT NOT NULL DEFAULT 'primary',
    "secondary_contact_name" TEXT,
    "secondary_contact_phone" TEXT,
    "secondary_contact_email" TEXT,
    "additional_contacts" JSONB,
    "terms_accepted_at" TIMESTAMPTZ(6),
    "image_url" TEXT,
    "region" "SalesRegion",
    "rsm_user_id" BIGINT,
    "created_by_user_id" BIGINT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dealer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_passwords" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT,
    "staff_id" BIGINT,
    "password_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_by_user_id" BIGINT NOT NULL,
    "revoked_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "diagnostic_passwords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_staff_assignments" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "staff_id" BIGINT NOT NULL,
    "assigned_by_user_id" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dealer_staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_requests" (
    "id" BIGSERIAL NOT NULL,
    "request_reference" TEXT,
    "request_identity_key" TEXT NOT NULL,
    "open_request_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dealer_name" TEXT NOT NULL,
    "dealer_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "assigned_staff_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_staff_names" TEXT NOT NULL,
    "region" "SalesRegion",
    "rsm_user_id" BIGINT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL DEFAULT '',
    "reviewed_by_name" TEXT NOT NULL DEFAULT '',
    "created_dealer_id" TEXT NOT NULL DEFAULT '',
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "last_rejection_reason" TEXT NOT NULL DEFAULT '',
    "form_snapshot" JSONB NOT NULL,
    "approval_lock" JSONB,
    "audit_trail" JSONB NOT NULL DEFAULT '[]',
    "creation_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "resubmitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dealer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "legacy_php_id" TEXT,
    "order_number" TEXT NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "assigned_staff_id" BIGINT,
    "created_by_user_id" BIGINT,
    "idempotency_key" TEXT,
    "order_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ship_to" TEXT,
    "ref_no" TEXT,
    "note" TEXT,
    "gross_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "allocated_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "coupon_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "coupon_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "coupon_code" TEXT,
    "base_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "base_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "post_base_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "additional_discount_type" "OrderDiscountType" NOT NULL DEFAULT 'NONE',
    "additional_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "custom_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "slab_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "slab_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "total_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "total_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "final_payable_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_ACCEPTANCE',
    "acceptance_status" "OrderAcceptanceStatus" NOT NULL DEFAULT 'AWAITING',
    "rsm_approval_status" "OrderAcceptanceStatus" NOT NULL DEFAULT 'AWAITING',
    "rsm_reviewed_by_user_id" BIGINT,
    "rsm_reviewed_by_name" TEXT,
    "rsm_reviewed_at" TIMESTAMPTZ(6),
    "rsm_note" TEXT,
    "acceptance_note" TEXT,
    "acceptance_reviewed_by_user_id" BIGINT,
    "acceptance_reviewed_by_name" TEXT,
    "acceptance_reviewed_at" TIMESTAMPTZ(6),
    "fulfilment_status" "OrderFulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "dispatch_partner" TEXT,
    "tracking_number" TEXT,
    "tracking_link" TEXT,
    "dock" TEXT,
    "accepted_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "dispatched_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_bills" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "order_number" TEXT NOT NULL,
    "bill_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "bill_date" DATE NOT NULL,
    "pdf_name" TEXT,
    "pdf_url" TEXT,
    "pdf_files" JSONB,
    "paid_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "last_payment_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "legacy_php_order_item_id" TEXT,
    "product_id" BIGINT,
    "product_variant_id" BIGINT,
    "product_name_snapshot" TEXT NOT NULL,
    "catalogue_number_snapshot" TEXT NOT NULL,
    "sku_snapshot" TEXT,
    "category_snapshot" TEXT,
    "quantity_packs" INTEGER NOT NULL,
    "pack_size" INTEGER NOT NULL,
    "total_pieces" INTEGER NOT NULL,
    "unit_price_paise" BIGINT NOT NULL DEFAULT 0,
    "pack_price_paise" BIGINT NOT NULL DEFAULT 0,
    "list_price_total_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "final_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "is_priority" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "product_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_dispatches" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "order_item_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OrderFulfilmentStatus" NOT NULL DEFAULT 'DISPATCHED',
    "remark" TEXT,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "legacy_source" TEXT,
    "legacy_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequences" (
    "year" INTEGER NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "dealer_wallets" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'INACTIVE',
    "balance_paise" BIGINT NOT NULL DEFAULT 0,
    "reserved_paise" BIGINT NOT NULL DEFAULT 0,
    "total_credited_paise" BIGINT NOT NULL DEFAULT 0,
    "total_consumed_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dealer_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "wallet_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "type" "WalletTransactionType" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "balance_before_paise" BIGINT NOT NULL,
    "balance_after_paise" BIGINT NOT NULL,
    "idempotency_key" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_settlements" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "original_paise" BIGINT NOT NULL,
    "remaining_paise" BIGINT NOT NULL,
    "status" "WalletSettlementStatus" NOT NULL DEFAULT 'OPEN',
    "closing_transaction_id" BIGINT,
    "opened_by_user_id" BIGINT,
    "closed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_settlement_applications" (
    "id" BIGSERIAL NOT NULL,
    "settlement_id" BIGINT NOT NULL,
    "bill_id" BIGINT,
    "order_id" BIGINT,
    "amount_paise" BIGINT NOT NULL,
    "wallet_transaction_id" BIGINT,
    "idempotency_key" TEXT,
    "applied_by_user_id" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_settlement_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "legacy_source" TEXT,
    "legacy_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_product_notes" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "order_item_id" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_product_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_summary_overrides" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "gross_amount_paise" BIGINT NOT NULL,
    "discount_amount_paise" BIGINT NOT NULL,
    "final_payable_amount_paise" BIGINT NOT NULL,
    "discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_summary_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_overlays" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "value" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "legacy_source" TEXT,
    "legacy_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_overlays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_drafts" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "status" "OrderDraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL DEFAULT 'Untitled Draft',
    "snapshot" JSONB,
    "approval_state" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_carts" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "draft_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_discount_requests" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "staff_id" BIGINT,
    "order_id" BIGINT,
    "order_draft_id" BIGINT,
    "scope" "DiscountRequestScope" NOT NULL,
    "status" "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rsm_approval_status" "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rsm_reviewed_by_user_id" BIGINT,
    "rsm_reviewed_by_name" TEXT,
    "rsm_reviewed_at" TIMESTAMPTZ(6),
    "rsm_note" TEXT,
    "requested_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "current_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "requested_order_discount_percent" DECIMAL(7,4),
    "requested_product_discounts" JSONB,
    "target_product_key" TEXT,
    "gross_amount_paise" BIGINT,
    "requested_discount_amount_paise" BIGINT,
    "requested_net_payable_amount_paise" BIGINT,
    "order_signature" TEXT,
    "order_snapshot" JSONB,
    "admin_note" TEXT,
    "allow_reorder" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_discount_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_discount_reorder_logs" (
    "id" BIGSERIAL NOT NULL,
    "request_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_discount_reorder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_otps" (
    "id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" BIGSERIAL NOT NULL,
    "lead_no" TEXT NOT NULL,
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customer_details" JSONB NOT NULL,
    "syringe_filter" JSONB,
    "capsule" JSONB,
    "cartridge_filter" JSONB,
    "commercial_info" JSONB NOT NULL,
    "company_name" TEXT NOT NULL,
    "submitted_by_user_id" BIGINT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_by_role" "UserRole" NOT NULL,
    "visited_date" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_lead_sequences" (
    "id" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_lead_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "invoice_number" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "total_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "invoice_date" DATE NOT NULL,
    "cloudinary_url" TEXT NOT NULL,
    "cloudinary_public_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_bytes" INTEGER,
    "created_by_user_id" BIGINT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_exports" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "file_name" TEXT NOT NULL,
    "cloudinary_url" TEXT NOT NULL,
    "cloudinary_public_id" TEXT,
    "file_bytes" INTEGER,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_fund_requests" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "type" "FundRequestType" NOT NULL,
    "status" "FundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount_paise" BIGINT NOT NULL,
    "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0,
    "order_amount_paise" BIGINT,
    "order_form_snapshot" JSONB,
    "order_id" BIGINT,
    "dealer_note" TEXT,
    "rsm_user_id" BIGINT,
    "staff_id" BIGINT,
    "rsm_reviewed_by_user_id" BIGINT,
    "rsm_reviewed_by_name" TEXT,
    "rsm_reviewed_at" TIMESTAMPTZ(6),
    "rsm_note" TEXT,
    "staff_reviewed_by_user_id" BIGINT,
    "staff_reviewed_by_name" TEXT,
    "staff_reviewed_at" TIMESTAMPTZ(6),
    "staff_note" TEXT,
    "accountant_user_id" BIGINT,
    "accountant_name" TEXT,
    "funded_at" TIMESTAMPTZ(6),
    "accountant_note" TEXT,
    "wallet_transaction_id" BIGINT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dealer_fund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_audit_logs_legacy_actor_id_created_at_idx" ON "auth_audit_logs"("legacy_actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_username_key" ON "users"("normalized_username");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

-- CreateIndex
CREATE INDEX "product_categories_name_idx" ON "product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_catalogue_number_idx" ON "product_variants"("catalogue_number");

-- CreateIndex
CREATE INDEX "hot_items_position_idx" ON "hot_items"("position");

-- CreateIndex
CREATE INDEX "hot_items_is_active_position_idx" ON "hot_items"("is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "hot_items_product_id_variant_id_key" ON "hot_items"("product_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "slider_images_cloudinary_public_id_key" ON "slider_images"("cloudinary_public_id");

-- CreateIndex
CREATE INDEX "slider_images_is_active_position_idx" ON "slider_images"("is_active", "position");

-- CreateIndex
CREATE INDEX "slider_images_position_idx" ON "slider_images"("position");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accountant_profiles_user_id_key" ON "accountant_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE INDEX "staff_profiles_parent_rsm_id_idx" ON "staff_profiles"("parent_rsm_id");

-- CreateIndex
CREATE INDEX "staff_profiles_parent_asm_id_idx" ON "staff_profiles"("parent_asm_id");

-- CreateIndex
CREATE INDEX "staff_profiles_reporting_manager_id_idx" ON "staff_profiles"("reporting_manager_id");

-- CreateIndex
CREATE INDEX "staff_profiles_warehouse_idx" ON "staff_profiles"("warehouse");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_profiles_user_id_key" ON "dealer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_profiles_legacy_php_id_key" ON "dealer_profiles"("legacy_php_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_profiles_dealer_code_key" ON "dealer_profiles"("dealer_code");

-- CreateIndex
CREATE INDEX "dealer_profiles_deleted_at_idx" ON "dealer_profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "dealer_profiles_region_idx" ON "dealer_profiles"("region");

-- CreateIndex
CREATE INDEX "dealer_profiles_rsm_user_id_idx" ON "dealer_profiles"("rsm_user_id");

-- CreateIndex
CREATE INDEX "diagnostic_passwords_dealer_id_expires_at_idx" ON "diagnostic_passwords"("dealer_id", "expires_at");

-- CreateIndex
CREATE INDEX "diagnostic_passwords_staff_id_expires_at_idx" ON "diagnostic_passwords"("staff_id", "expires_at");

-- CreateIndex
CREATE INDEX "diagnostic_passwords_revoked_at_idx" ON "diagnostic_passwords"("revoked_at");

-- CreateIndex
CREATE INDEX "dealer_staff_assignments_dealer_id_active_idx" ON "dealer_staff_assignments"("dealer_id", "active");

-- CreateIndex
CREATE INDEX "dealer_staff_assignments_staff_id_active_idx" ON "dealer_staff_assignments"("staff_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_staff_assignments_dealer_id_staff_id_key" ON "dealer_staff_assignments"("dealer_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_requests_request_reference_key" ON "dealer_requests"("request_reference");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_requests_open_request_key_key" ON "dealer_requests"("open_request_key");

-- CreateIndex
CREATE INDEX "dealer_requests_status_updated_at_idx" ON "dealer_requests"("status", "updated_at");

-- CreateIndex
CREATE INDEX "dealer_requests_submitted_by_id_status_updated_at_idx" ON "dealer_requests"("submitted_by_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "dealer_requests_region_status_updated_at_idx" ON "dealer_requests"("region", "status", "updated_at");

-- CreateIndex
CREATE INDEX "dealer_requests_rsm_user_id_status_updated_at_idx" ON "dealer_requests"("rsm_user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "dealer_requests_dealer_name_idx" ON "dealer_requests"("dealer_name");

-- CreateIndex
CREATE INDEX "dealer_requests_dealer_code_idx" ON "dealer_requests"("dealer_code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_legacy_php_id_key" ON "orders"("legacy_php_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_dealer_id_created_at_idx" ON "orders"("dealer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_assigned_staff_id_created_at_idx" ON "orders"("assigned_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_acceptance_status_idx" ON "orders"("acceptance_status");

-- CreateIndex
CREATE INDEX "orders_rsm_approval_status_idx" ON "orders"("rsm_approval_status");

-- CreateIndex
CREATE INDEX "orders_fulfilment_status_idx" ON "orders"("fulfilment_status");

-- CreateIndex
CREATE INDEX "orders_order_number_idx" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "ledger_bills_dealer_id_bill_date_idx" ON "ledger_bills"("dealer_id", "bill_date");

-- CreateIndex
CREATE INDEX "ledger_bills_order_id_idx" ON "ledger_bills"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_bills_dealer_id_order_number_key" ON "ledger_bills"("dealer_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_legacy_php_order_item_id_key" ON "order_items"("legacy_php_order_item_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items"("product_variant_id");

-- CreateIndex
CREATE INDEX "order_items_catalogue_number_snapshot_idx" ON "order_items"("catalogue_number_snapshot");

-- CreateIndex
CREATE INDEX "order_item_dispatches_order_id_created_at_idx" ON "order_item_dispatches"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_item_dispatches_order_item_id_created_at_idx" ON "order_item_dispatches"("order_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_dispatches_legacy_source_legacy_id_key" ON "order_item_dispatches"("legacy_source", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_wallets_dealer_id_key" ON "dealer_wallets"("dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_transactions_dealer_id_created_at_idx" ON "wallet_transactions"("dealer_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_order_id_idx" ON "wallet_transactions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_settlements_closing_transaction_id_key" ON "wallet_settlements"("closing_transaction_id");

-- CreateIndex
CREATE INDEX "wallet_settlements_dealer_id_status_idx" ON "wallet_settlements"("dealer_id", "status");

-- CreateIndex
CREATE INDEX "wallet_settlements_status_created_at_idx" ON "wallet_settlements"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_settlement_applications_wallet_transaction_id_key" ON "wallet_settlement_applications"("wallet_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_settlement_applications_idempotency_key_key" ON "wallet_settlement_applications"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_settlement_applications_settlement_id_created_at_idx" ON "wallet_settlement_applications"("settlement_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_settlement_applications_bill_id_idx" ON "wallet_settlement_applications"("bill_id");

-- CreateIndex
CREATE INDEX "order_notes_order_id_updated_at_idx" ON "order_notes"("order_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_notes_legacy_source_legacy_id_key" ON "order_notes"("legacy_source", "legacy_id");

-- CreateIndex
CREATE INDEX "order_product_notes_order_id_updated_at_idx" ON "order_product_notes"("order_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_product_notes_order_item_id_key" ON "order_product_notes"("order_item_id");

-- CreateIndex
CREATE INDEX "order_summary_overrides_order_id_created_at_idx" ON "order_summary_overrides"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_overlays_order_id_created_at_idx" ON "order_overlays"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_overlays_type_status_updated_at_idx" ON "order_overlays"("type", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_overlays_legacy_source_legacy_id_key" ON "order_overlays"("legacy_source", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_drafts_order_id_key" ON "order_drafts"("order_id");

-- CreateIndex
CREATE INDEX "order_drafts_dealer_id_status_idx" ON "order_drafts"("dealer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "draft_carts_dealer_id_key" ON "draft_carts"("dealer_id");

-- CreateIndex
CREATE INDEX "custom_discount_requests_dealer_id_status_idx" ON "custom_discount_requests"("dealer_id", "status");

-- CreateIndex
CREATE INDEX "custom_discount_requests_rsm_approval_status_status_created_idx" ON "custom_discount_requests"("rsm_approval_status", "status", "created_at");

-- CreateIndex
CREATE INDEX "custom_discount_requests_order_id_idx" ON "custom_discount_requests"("order_id");

-- CreateIndex
CREATE INDEX "custom_discount_requests_order_draft_id_idx" ON "custom_discount_requests"("order_draft_id");

-- CreateIndex
CREATE INDEX "custom_discount_requests_status_created_at_idx" ON "custom_discount_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "custom_discount_reorder_logs_request_id_idx" ON "custom_discount_reorder_logs"("request_id");

-- CreateIndex
CREATE INDEX "custom_discount_reorder_logs_order_id_idx" ON "custom_discount_reorder_logs"("order_id");

-- CreateIndex
CREATE INDEX "email_otps_user_id_expires_at_idx" ON "email_otps"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "email_otps_used_at_idx" ON "email_otps"("used_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_lead_no_key" ON "form_submissions"("lead_no");

-- CreateIndex
CREATE INDEX "form_submissions_submitted_by_user_id_visited_date_idx" ON "form_submissions"("submitted_by_user_id", "visited_date");

-- CreateIndex
CREATE INDEX "form_submissions_visited_date_idx" ON "form_submissions"("visited_date");

-- CreateIndex
CREATE INDEX "invoices_dealer_id_created_at_idx" ON "invoices"("dealer_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_dealer_id_invoice_number_key" ON "invoices"("dealer_id", "invoice_number");

-- CreateIndex
CREATE INDEX "order_exports_dealer_id_created_at_idx" ON "order_exports"("dealer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_fund_requests_order_id_key" ON "dealer_fund_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_fund_requests_wallet_transaction_id_key" ON "dealer_fund_requests"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "dealer_fund_requests_dealer_id_status_idx" ON "dealer_fund_requests"("dealer_id", "status");

-- CreateIndex
CREATE INDEX "dealer_fund_requests_status_created_at_idx" ON "dealer_fund_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "dealer_fund_requests_rsm_user_id_status_idx" ON "dealer_fund_requests"("rsm_user_id", "status");

-- CreateIndex
CREATE INDEX "dealer_fund_requests_staff_id_status_idx" ON "dealer_fund_requests"("staff_id", "status");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_items" ADD CONSTRAINT "hot_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_items" ADD CONSTRAINT "hot_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_items" ADD CONSTRAINT "hot_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slider_images" ADD CONSTRAINT "slider_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_profiles" ADD CONSTRAINT "accountant_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_parent_rsm_id_fkey" FOREIGN KEY ("parent_rsm_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_parent_asm_id_fkey" FOREIGN KEY ("parent_asm_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_reporting_manager_id_fkey" FOREIGN KEY ("reporting_manager_id") REFERENCES "admin_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_rsm_user_id_fkey" FOREIGN KEY ("rsm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_passwords" ADD CONSTRAINT "diagnostic_passwords_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_passwords" ADD CONSTRAINT "diagnostic_passwords_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_passwords" ADD CONSTRAINT "diagnostic_passwords_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_passwords" ADD CONSTRAINT "diagnostic_passwords_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_bills" ADD CONSTRAINT "ledger_bills_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_bills" ADD CONSTRAINT "ledger_bills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_dispatches" ADD CONSTRAINT "order_item_dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_dispatches" ADD CONSTRAINT "order_item_dispatches_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_wallets" ADD CONSTRAINT "dealer_wallets_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "dealer_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlements" ADD CONSTRAINT "wallet_settlements_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlements" ADD CONSTRAINT "wallet_settlements_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlement_applications" ADD CONSTRAINT "wallet_settlement_applications_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlement_applications" ADD CONSTRAINT "wallet_settlement_applications_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "ledger_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlement_applications" ADD CONSTRAINT "wallet_settlement_applications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlement_applications" ADD CONSTRAINT "wallet_settlement_applications_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_settlement_applications" ADD CONSTRAINT "wallet_settlement_applications_applied_by_user_id_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_product_notes" ADD CONSTRAINT "order_product_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_product_notes" ADD CONSTRAINT "order_product_notes_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_product_notes" ADD CONSTRAINT "order_product_notes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_summary_overrides" ADD CONSTRAINT "order_summary_overrides_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_summary_overrides" ADD CONSTRAINT "order_summary_overrides_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_overlays" ADD CONSTRAINT "order_overlays_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_overlays" ADD CONSTRAINT "order_overlays_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_carts" ADD CONSTRAINT "draft_carts_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_requests" ADD CONSTRAINT "custom_discount_requests_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_requests" ADD CONSTRAINT "custom_discount_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_requests" ADD CONSTRAINT "custom_discount_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_requests" ADD CONSTRAINT "custom_discount_requests_order_draft_id_fkey" FOREIGN KEY ("order_draft_id") REFERENCES "order_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_requests" ADD CONSTRAINT "custom_discount_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_reorder_logs" ADD CONSTRAINT "custom_discount_reorder_logs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "custom_discount_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_discount_reorder_logs" ADD CONSTRAINT "custom_discount_reorder_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_rsm_user_id_fkey" FOREIGN KEY ("rsm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_rsm_reviewed_by_user_id_fkey" FOREIGN KEY ("rsm_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_staff_reviewed_by_user_id_fkey" FOREIGN KEY ("staff_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_accountant_user_id_fkey" FOREIGN KEY ("accountant_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

