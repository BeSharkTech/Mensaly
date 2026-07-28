ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_discount_within_amount"
  CHECK ("discountCents" <= "amountCents");
