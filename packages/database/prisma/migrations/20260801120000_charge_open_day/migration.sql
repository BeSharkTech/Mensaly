ALTER TABLE "plan"
  ADD COLUMN "chargeOpenDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "enrollment"
  ADD COLUMN "chargeOpenDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "plan"
  ADD CONSTRAINT "plan_charge_open_day"
    CHECK ("chargeOpenDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "plan_charge_window"
    CHECK ("chargeOpenDay" <= "dueDay");

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_charge_open_day"
    CHECK ("chargeOpenDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "enrollment_charge_window"
    CHECK ("chargeOpenDay" <= "dueDay");
