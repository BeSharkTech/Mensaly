import pino from "pino";

const options: pino.LoggerOptions = {
  name: "mensaly",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "token",
      "body",
      "payload",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.email",
      "*.phone",
      "*.cpf",
      "*.rg",
      "*.taxId",
      "*.recipientPhoneSnapshot",
      "*.externalReference",
      "*.*.authorization",
      "*.*.cookie",
      "*.*.password",
      "*.*.token",
      "*.*.email",
      "*.*.phone",
      "*.*.cpf",
      "*.*.rg",
      "*.*.taxId",
    ],
    censor: "[REDACTED]",
  },
};

export function createLogger(
  destination?: pino.DestinationStream,
): pino.Logger {
  return pino(options, destination);
}

export const logger = createLogger();
