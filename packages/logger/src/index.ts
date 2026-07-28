import pino from "pino";

const options: pino.LoggerOptions = {
  name: "mensaly",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "token",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
};

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(options, destination);
}

export const logger = createLogger();
