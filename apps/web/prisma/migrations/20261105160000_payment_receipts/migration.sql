ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "checkoutSessionId" TEXT NOT NULL,
  "paymentLinkId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "interval" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenEnvelope" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "emailedAt" TIMESTAMP(3),
  "claimedUserId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentReceipt_checkoutSessionId_key" ON "PaymentReceipt"("checkoutSessionId");
CREATE UNIQUE INDEX "PaymentReceipt_stripeSubscriptionId_key" ON "PaymentReceipt"("stripeSubscriptionId");
CREATE UNIQUE INDEX "PaymentReceipt_tokenHash_key" ON "PaymentReceipt"("tokenHash");
CREATE INDEX "PaymentReceipt_email_claimedAt_idx" ON "PaymentReceipt"("email", "claimedAt");
CREATE TABLE "DeferredStripeEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "checkoutSessionId" TEXT,
  "eventCreated" INTEGER NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeferredStripeEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeferredStripeEvent_stripeSubscriptionId_resolvedAt_idx" ON "DeferredStripeEvent"("stripeSubscriptionId", "resolvedAt");
CREATE TABLE "TrialUsage" (
  "id" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "cardHash" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrialUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrialUsage_stripeSubscriptionId_key" ON "TrialUsage"("stripeSubscriptionId");
CREATE UNIQUE INDEX "TrialUsage_emailHash_key" ON "TrialUsage"("emailHash");
CREATE UNIQUE INDEX "TrialUsage_cardHash_key" ON "TrialUsage"("cardHash");
CREATE INDEX "TrialUsage_expiresAt_idx" ON "TrialUsage"("expiresAt");
