import type { ZodDtoConstructor } from "@mensaly/contracts";
import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";

function dtoSchema(
  metatype: ArgumentMetadata["metatype"],
): ZodDtoConstructor["schema"] | undefined {
  if (
    typeof metatype === "function" &&
    "schema" in metatype &&
    typeof metatype.schema === "object"
  ) {
    return (metatype as unknown as ZodDtoConstructor).schema;
  }

  return undefined;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = dtoSchema(metadata.metatype);

    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Invalid request data",
      details: result.error.issues.map((issue) => ({
        field: issue.path.join(".") || undefined,
        message: issue.message,
      })),
    });
  }
}
