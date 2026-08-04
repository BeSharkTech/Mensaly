CREATE TYPE "StripeConnectAccountType" AS ENUM ('STANDARD', 'EXPRESS');

ALTER TABLE "stripe_connection"
  ADD COLUMN "accountType" "StripeConnectAccountType" NOT NULL DEFAULT 'STANDARD';
