import { z } from "zod";

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm in 24-hour format");

const reminderRuleSchema = z
  .object({
    timing: z.enum(["BEFORE_DUE", "ON_DUE", "AFTER_DUE"]),
    dayOffset: z.number().int().min(0).max(60),
    templateId: z.string().uuid().nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const updateReminderConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    allowedHours: z
      .object({
        start: timeSchema,
        end: timeSchema,
      })
      .strict(),
    dailyLimit: z.number().int().min(1).max(1000),
    rules: z.array(reminderRuleSchema).max(20),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.allowedHours.start >= input.allowedHours.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedHours", "end"],
        message: "End time must be later than start time",
      });
    }

    if (input.enabled && !input.rules.some((rule) => rule.enabled)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: "An enabled configuration requires an enabled rule",
      });
    }

    const keys = new Set<string>();
    input.rules.forEach((rule, index) => {
      if (rule.enabled && !rule.templateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "templateId"],
          message: "An enabled reminder rule requires a template",
        });
      }

      const validOffset =
        (rule.timing === "ON_DUE" && rule.dayOffset === 0) ||
        (rule.timing !== "ON_DUE" &&
          rule.dayOffset >= 1 &&
          rule.dayOffset <= 60);
      if (!validOffset) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "dayOffset"],
          message:
            "ON_DUE uses offset 0; BEFORE_DUE and AFTER_DUE use offsets 1 to 60",
        });
      }

      const key = `${rule.timing}:${rule.dayOffset}`;
      if (keys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index],
          message: "Reminder rules cannot be duplicated",
        });
      }
      keys.add(key);
    });
  });

export class UpdateReminderConfigurationDto {
  static readonly schema = updateReminderConfigurationSchema;
}

export type UpdateReminderConfigurationInput = z.infer<
  typeof updateReminderConfigurationSchema
>;
