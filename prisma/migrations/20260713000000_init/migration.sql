-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('platform_owner', 'owner', 'manager', 'sales_rep', 'cpa', 'wholesale_dealer');

-- CreateEnum
CREATE TYPE "DealershipStatus" AS ENUM ('pending', 'active', 'suspended', 'canceled', 'payment_failed');

-- CreateEnum
CREATE TYPE "PlanSlug" AS ENUM ('wholesaler', 'independent_dealer', 'growing_dealership');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('pending', 'checkout_started', 'active', 'payment_failed', 'canceled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'on_time', 'behind');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('in_stock', 'needs_attention', 'pending_deal', 'sold', 'loss');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('lead', 'active_deal', 'customer');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('individual', 'dealer', 'wholesale');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('website', 'referral', 'walk_in', 'ads', 'social_media', 'other');

-- CreateEnum
CREATE TYPE "DealJacketWorkflowStatus" AS ENUM ('draft', 'pending_review', 'changes_requested', 'resubmitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('Retail', 'Wholesale', 'Fleet');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('percentage', 'manual');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'paid');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('advertising', 'accounting', 'office', 'salary_wages', 'other', 'software', 'utilities', 'rent', 'insurance');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('unpaid', 'paid', 'partial');

-- CreateEnum
CREATE TYPE "FlooringRateType" AS ENUM ('monthly', 'daily', 'apr');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('monthly', 'quarterly', 'annual', 'custom');

-- CreateEnum
CREATE TYPE "TaxPeriodStatus" AS ENUM ('open', 'due', 'paid', 'filed', 'closed');

-- CreateEnum
CREATE TYPE "CpaNotePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CpaNoteStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('compliance', 'appointment', 'payroll', 'follow_up', 'task');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('draft', 'processed', 'paid');

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "dealershipName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "plan" "PlanSlug",
    "status" "RegistrationStatus" NOT NULL DEFAULT 'pending',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "monthlyFee" DECIMAL(12,2) NOT NULL DEFAULT 39.99,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "completionTokenHash" TEXT,
    "completionTokenExpiresAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "welcomeEmailLockId" TEXT,
    "temporaryPasswordHash" TEXT,
    "temporaryPasswordSentAt" TIMESTAMP(3),
    "dealershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealerships" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "plan" "PlanSlug",
    "status" "DealershipStatus" NOT NULL DEFAULT 'pending',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "monthlyFee" DECIMAL(12,2) NOT NULL DEFAULT 39.99,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dealerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "imageUrl" TEXT,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dealershipId" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "fullName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "vin" TEXT NOT NULL,
    "stockNumber" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "year" INTEGER NOT NULL,
    "bodyStyle" TEXT,
    "exteriorColor" TEXT,
    "interiorColor" TEXT,
    "drivetrain" TEXT,
    "fuelType" TEXT,
    "engine" TEXT,
    "transmission" TEXT,
    "mileage" INTEGER,
    "doors" INTEGER,
    "acquisitionDate" DATE,
    "acquisitionCost" DECIMAL(12,2),
    "askingPrice" DECIMAL(12,2),
    "marketValue" DECIMAL(12,2),
    "wholesalePrice" DECIMAL(12,2),
    "reconditioningCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalInvested" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "registrationFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "auctionFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "flooringFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "titleStatus" TEXT,
    "licensePlate" TEXT,
    "state" TEXT,
    "sellerAuction" TEXT,
    "purchaseType" TEXT,
    "notes" TEXT,
    "titleReceived" BOOLEAN NOT NULL DEFAULT true,
    "soldAt" TIMESTAMP(3),
    "soldPrice" DECIMAL(12,2),
    "flooringStartDate" DATE,
    "flooringPlanId" UUID,
    "status" "VehicleStatus" NOT NULL DEFAULT 'in_stock',
    "isWholesale" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_images" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "storagePath" TEXT NOT NULL,
    "url" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_status_history" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "fromStatus" "VehicleStatus",
    "toStatus" "VehicleStatus" NOT NULL,
    "note" TEXT,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_history" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "askingPrice" DECIMAL(12,2),
    "marketValue" DECIMAL(12,2),
    "note" TEXT,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "repairDate" DATE NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'repair',
    "repairType" TEXT,
    "description" TEXT NOT NULL,
    "expenseName" TEXT,
    "shopVendor" TEXT,
    "paymentMethod" TEXT,
    "invoiceNumber" TEXT,
    "notes" TEXT,
    "receiptStoragePath" TEXT,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "partsCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" "PaymentMethodStatus" NOT NULL DEFAULT 'unpaid',
    "datePaid" DATE,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flooring_plans" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Standard Floor Plan',
    "rateType" "FlooringRateType" NOT NULL DEFAULT 'monthly',
    "baseRate" DECIMAL(12,4) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rateIncreaseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "increaseAfterDays" INTEGER,
    "increaseAmountType" TEXT,
    "increaseAmount" DECIMAL(12,2),
    "maxCap" DECIMAL(12,2),
    "buyFee" DECIMAL(12,2),
    "lateFeePerDay" DECIMAL(12,2),
    "lateFeeAfterDays" INTEGER,
    "gracePeriodDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "flooring_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'individual',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "driversLicenseNumber" TEXT,
    "imageUrl" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'lead',
    "salesRepId" UUID,
    "source" "LeadSource",
    "dateOfBirth" DATE,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "saleDate" DATE NOT NULL,
    "totalPriceOtd" DECIMAL(12,2) NOT NULL,
    "totalCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "salesTaxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "licenseFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dmvFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "soldPriceBeforeTax" DECIMAL(12,2),
    "commissionAmount" DECIMAL(12,2),
    "commissionRate" DECIMAL(5,2),
    "commissionType" "CommissionType",
    "netProfit" DECIMAL(12,2),
    "salesRepId" UUID,
    "rosNumber" TEXT,
    "zipOfSale" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_jackets" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "dealId" UUID,
    "salesRepId" UUID,
    "jacketNumber" TEXT NOT NULL,
    "soldPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalSalePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "downPayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountFinanced" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalInvested" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "additionalExpenses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "profitGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "profitNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tradeInAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warrantyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gapAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fees" JSONB NOT NULL DEFAULT '{}',
    "lender" TEXT,
    "rosNumber" TEXT,
    "notes" TEXT,
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "dealType" "DealType" NOT NULL DEFAULT 'Retail',
    "workflowStatus" "DealJacketWorkflowStatus" NOT NULL DEFAULT 'draft',
    "dateSold" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deal_jackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_jacket_documents" (
    "id" UUID NOT NULL,
    "dealJacketId" UUID NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'application/pdf',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_jacket_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_jacket_activity" (
    "id" UUID NOT NULL,
    "dealJacketId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_jacket_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealership_expenses" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "vendor" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "referenceNumber" TEXT,
    "paymentMethod" TEXT,
    "receiptStoragePath" TEXT,
    "notes" TEXT,
    "taxDeductible" BOOLEAN NOT NULL DEFAULT true,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dealership_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rep_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "hireDate" DATE,
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "monthlyGoal" DECIMAL(12,2) NOT NULL DEFAULT 50000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_rep_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rep_commissions" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "salesRepId" UUID NOT NULL,
    "dealJacketId" UUID NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "grossProfit" DECIMAL(12,2) NOT NULL,
    "soldPrice" DECIMAL(12,2) NOT NULL,
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending_review',
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_rep_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "payType" TEXT NOT NULL DEFAULT 'salary',
    "payRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hireDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'draft',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payout_items" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "staffMemberId" UUID,
    "salesRepId" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "proofPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealership_tax_settings" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "state" TEXT,
    "filingFrequency" "TaxFilingFrequency" NOT NULL DEFAULT 'quarterly',
    "reminderDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealership_tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filing_periods" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "TaxPeriodStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_filing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filing_period_deals" (
    "id" UUID NOT NULL,
    "filingPeriodId" UUID NOT NULL,
    "dealJacketId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filing_period_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filing_documents" (
    "id" UUID NOT NULL,
    "filingPeriodId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_filing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_notes" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "priority" "CpaNotePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CpaNoteStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID,
    "assignedToId" UUID,
    "vehicleId" UUID,
    "stockNumber" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_note_comments" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "userId" UUID,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_note_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_note_attachments" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "uploadedBy" UUID,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpa_note_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "eventDate" DATE NOT NULL,
    "eventTime" TEXT,
    "title" TEXT NOT NULL,
    "eventType" "CalendarEventType" NOT NULL DEFAULT 'task',
    "description" TEXT,
    "sourceModule" TEXT,
    "sourceId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_day_notes" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "noteDate" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_day_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "messageText" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "dealershipId" UUID,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "type" TEXT NOT NULL DEFAULT 'info',
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "dealershipId" UUID,
    "changedById" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "dealershipId" UUID,
    "bucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "sourceEntity" TEXT,
    "sourceEntityId" UUID,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registrations_email_key" ON "registrations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_stripeSubscriptionId_key" ON "registrations"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "registrations_state_idx" ON "registrations"("state");

-- CreateIndex
CREATE INDEX "registrations_city_idx" ON "registrations"("city");

-- CreateIndex
CREATE INDEX "registrations_stripeCustomerId_idx" ON "registrations"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "registrations_stripeCheckoutSessionId_idx" ON "registrations"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "dealerships_slug_key" ON "dealerships"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "dealerships_stripeSubscriptionId_key" ON "dealerships"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "dealerships_status_idx" ON "dealerships"("status");

-- CreateIndex
CREATE INDEX "dealerships_state_idx" ON "dealerships"("state");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "users_dealershipId_email_key" ON "users"("dealershipId", "email");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_tokenHash_idx" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_dealershipId_idx" ON "invitations"("dealershipId");

-- CreateIndex
CREATE INDEX "invitations_tokenHash_idx" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "vehicles_dealershipId_status_deletedAt_idx" ON "vehicles"("dealershipId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "vehicles_dealershipId_stockNumber_idx" ON "vehicles"("dealershipId", "stockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_dealershipId_vin_key" ON "vehicles"("dealershipId", "vin");

-- CreateIndex
CREATE INDEX "vehicle_images_vehicleId_idx" ON "vehicle_images"("vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_status_history_vehicleId_createdAt_idx" ON "vehicle_status_history"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "pricing_history_vehicleId_createdAt_idx" ON "pricing_history"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_expenses_dealershipId_vehicleId_idx" ON "vehicle_expenses"("dealershipId", "vehicleId");

-- CreateIndex
CREATE INDEX "flooring_plans_dealershipId_isActive_idx" ON "flooring_plans"("dealershipId", "isActive");

-- CreateIndex
CREATE INDEX "customers_dealershipId_status_deletedAt_idx" ON "customers"("dealershipId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "customers_dealershipId_email_idx" ON "customers"("dealershipId", "email");

-- CreateIndex
CREATE INDEX "customers_dealershipId_phone_idx" ON "customers"("dealershipId", "phone");

-- CreateIndex
CREATE INDEX "customer_notes_customerId_idx" ON "customer_notes"("customerId");

-- CreateIndex
CREATE INDEX "customer_documents_customerId_idx" ON "customer_documents"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "deals_vehicleId_key" ON "deals"("vehicleId");

-- CreateIndex
CREATE INDEX "deals_dealershipId_saleDate_idx" ON "deals"("dealershipId", "saleDate");

-- CreateIndex
CREATE UNIQUE INDEX "deal_jackets_dealId_key" ON "deal_jackets"("dealId");

-- CreateIndex
CREATE INDEX "deal_jackets_dealershipId_workflowStatus_idx" ON "deal_jackets"("dealershipId", "workflowStatus");

-- CreateIndex
CREATE INDEX "deal_jackets_dealershipId_jacketNumber_idx" ON "deal_jackets"("dealershipId", "jacketNumber");

-- CreateIndex
CREATE INDEX "deal_jacket_documents_dealJacketId_idx" ON "deal_jacket_documents"("dealJacketId");

-- CreateIndex
CREATE INDEX "deal_jacket_activity_dealJacketId_createdAt_idx" ON "deal_jacket_activity"("dealJacketId", "createdAt");

-- CreateIndex
CREATE INDEX "dealership_expenses_dealershipId_expenseDate_idx" ON "dealership_expenses"("dealershipId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_profiles_userId_key" ON "sales_rep_profiles"("userId");

-- CreateIndex
CREATE INDEX "sales_rep_profiles_dealershipId_idx" ON "sales_rep_profiles"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_commissions_dealJacketId_key" ON "sales_rep_commissions"("dealJacketId");

-- CreateIndex
CREATE INDEX "sales_rep_commissions_dealershipId_salesRepId_idx" ON "sales_rep_commissions"("dealershipId", "salesRepId");

-- CreateIndex
CREATE INDEX "staff_members_dealershipId_idx" ON "staff_members"("dealershipId");

-- CreateIndex
CREATE INDEX "payroll_runs_dealershipId_periodStart_idx" ON "payroll_runs"("dealershipId", "periodStart");

-- CreateIndex
CREATE INDEX "payroll_payout_items_payrollRunId_idx" ON "payroll_payout_items"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "dealership_tax_settings_dealershipId_key" ON "dealership_tax_settings"("dealershipId");

-- CreateIndex
CREATE INDEX "tax_filing_periods_dealershipId_status_idx" ON "tax_filing_periods"("dealershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "filing_period_deals_filingPeriodId_dealJacketId_key" ON "filing_period_deals"("filingPeriodId", "dealJacketId");

-- CreateIndex
CREATE INDEX "tax_filing_documents_filingPeriodId_idx" ON "tax_filing_documents"("filingPeriodId");

-- CreateIndex
CREATE INDEX "cpa_notes_dealershipId_status_idx" ON "cpa_notes"("dealershipId", "status");

-- CreateIndex
CREATE INDEX "cpa_note_comments_noteId_idx" ON "cpa_note_comments"("noteId");

-- CreateIndex
CREATE INDEX "cpa_note_attachments_noteId_idx" ON "cpa_note_attachments"("noteId");

-- CreateIndex
CREATE INDEX "calendar_events_dealershipId_eventDate_idx" ON "calendar_events"("dealershipId", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_day_notes_dealershipId_noteDate_key" ON "calendar_day_notes"("dealershipId", "noteDate");

-- CreateIndex
CREATE INDEX "conversations_dealershipId_idx" ON "conversations"("dealershipId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_dealershipId_createdAt_idx" ON "audit_logs"("dealershipId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "files_dealershipId_sourceEntity_sourceEntityId_idx" ON "files"("dealershipId", "sourceEntity", "sourceEntityId");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_flooringPlanId_fkey" FOREIGN KEY ("flooringPlanId") REFERENCES "flooring_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_history" ADD CONSTRAINT "pricing_history_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_history" ADD CONSTRAINT "pricing_history_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flooring_plans" ADD CONSTRAINT "flooring_plans_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jackets" ADD CONSTRAINT "deal_jackets_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jacket_documents" ADD CONSTRAINT "deal_jacket_documents_dealJacketId_fkey" FOREIGN KEY ("dealJacketId") REFERENCES "deal_jackets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jacket_activity" ADD CONSTRAINT "deal_jacket_activity_dealJacketId_fkey" FOREIGN KEY ("dealJacketId") REFERENCES "deal_jackets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_jacket_activity" ADD CONSTRAINT "deal_jacket_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealership_expenses" ADD CONSTRAINT "dealership_expenses_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_profiles" ADD CONSTRAINT "sales_rep_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_profiles" ADD CONSTRAINT "sales_rep_profiles_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_commissions" ADD CONSTRAINT "sales_rep_commissions_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_commissions" ADD CONSTRAINT "sales_rep_commissions_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_commissions" ADD CONSTRAINT "sales_rep_commissions_dealJacketId_fkey" FOREIGN KEY ("dealJacketId") REFERENCES "deal_jackets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_commissions" ADD CONSTRAINT "sales_rep_commissions_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payout_items" ADD CONSTRAINT "payroll_payout_items_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payout_items" ADD CONSTRAINT "payroll_payout_items_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealership_tax_settings" ADD CONSTRAINT "dealership_tax_settings_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filing_period_deals" ADD CONSTRAINT "filing_period_deals_filingPeriodId_fkey" FOREIGN KEY ("filingPeriodId") REFERENCES "tax_filing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filing_period_deals" ADD CONSTRAINT "filing_period_deals_dealJacketId_fkey" FOREIGN KEY ("dealJacketId") REFERENCES "deal_jackets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_documents" ADD CONSTRAINT "tax_filing_documents_filingPeriodId_fkey" FOREIGN KEY ("filingPeriodId") REFERENCES "tax_filing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_notes" ADD CONSTRAINT "cpa_notes_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_notes" ADD CONSTRAINT "cpa_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_notes" ADD CONSTRAINT "cpa_notes_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_note_comments" ADD CONSTRAINT "cpa_note_comments_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "cpa_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_note_comments" ADD CONSTRAINT "cpa_note_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_note_attachments" ADD CONSTRAINT "cpa_note_attachments_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "cpa_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_day_notes" ADD CONSTRAINT "calendar_day_notes_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
